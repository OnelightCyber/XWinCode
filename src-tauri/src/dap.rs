use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::{env, project};

const MAX_FRAME: usize = 64 * 1024 * 1024;

struct Adapter {
    session: u64,
    stdin: ChildStdin,
    child: Child,
}

#[derive(Default)]
pub struct DapState {
    inner: Mutex<Option<Adapter>>,
    next: AtomicU64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapStarted {
    session: u64,
    program: String,
}

#[derive(Clone, Serialize)]
struct MessageEvent {
    session: u64,
    message: String,
}

#[derive(Clone, Serialize)]
struct ClosedEvent {
    session: u64,
}

async fn bin_path(root: &str) -> Result<PathBuf, String> {
    let swift = env::which("swift").ok_or_else(|| t!("err.swiftMissing"))?;
    let mut cmd = env::command(swift);
    cmd.args(["build", "--show-bin-path"]).current_dir(root).stdin(Stdio::null()).kill_on_drop(true);
    let out = timeout(Duration::from_secs(120), cmd.output())
        .await
        .map_err(|_| t!("err.timeout"))?
        .map_err(|e| e.to_string())?;
    let text = env::decode_output(&out.stdout);
    text.lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| t!("err.noProgram"))
}

fn pick_program(bin: &Path, name: &str) -> Option<PathBuf> {
    let preferred = bin.join(format!("{name}.exe"));
    if preferred.is_file() {
        return Some(preferred);
    }
    let mut found: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(bin)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let file = p.file_name().map(|f| f.to_string_lossy().to_lowercase()).unwrap_or_default();
            file.ends_with(".exe") && !file.contains("packagetests") && !file.contains("test-runner")
        })
        .filter_map(|p| std::fs::metadata(&p).and_then(|m| m.modified()).ok().map(|t| (t, p)))
        .collect();
    found.sort_by_key(|f| std::cmp::Reverse(f.0));
    found.into_iter().next().map(|(_, p)| p)
}

async fn read_frame(reader: &mut BufReader<ChildStdout>) -> Option<String> {
    let mut length: Option<usize> = None;
    loop {
        let mut header = String::new();
        match reader.read_line(&mut header).await {
            Ok(0) | Err(_) => return None,
            Ok(_) => {}
        }
        let header = header.trim_end();
        if header.is_empty() {
            if length.is_some() {
                break;
            }
            continue;
        }
        if let Some(v) = header.strip_prefix("Content-Length:") {
            length = v.trim().parse().ok();
        }
    }
    let len = length.filter(|l| *l <= MAX_FRAME)?;
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await.ok()?;
    Some(String::from_utf8_lossy(&body).into_owned())
}

async fn pump(app: AppHandle, stdout: ChildStdout, session: u64) {
    let mut reader = BufReader::new(stdout);
    while let Some(message) = read_frame(&mut reader).await {
        let _ = app.emit("dap://message", MessageEvent { session, message });
    }
    let state = app.state::<DapState>();
    let mut guard = state.inner.lock().await;
    if guard.as_ref().is_some_and(|a| a.session == session) {
        guard.take();
    }
    drop(guard);
    let _ = app.emit("dap://closed", ClosedEvent { session });
}

async fn kill(adapter: Option<Adapter>) {
    if let Some(mut a) = adapter {
        if let Some(pid) = a.child.id() {
            crate::process::kill_tree(pid);
        }
        let _ = a.child.kill().await;
    }
}

#[tauri::command]
pub async fn dap_start(app: AppHandle, state: State<'_, DapState>, root: String) -> Result<DapStarted, String> {
    crate::trust::require(&app, &root)?;
    kill(state.inner.lock().await.take()).await;
    let adapter = env::which("lldb-dap").ok_or_else(|| t!("err.lldbMissing"))?;
    let info = project::inspect(Path::new(&root))?;
    let bin = bin_path(&root).await?;
    let program = pick_program(&bin, &info.name).ok_or_else(|| t!("err.noProgram"))?;
    let mut cmd = env::command(adapter);
    cmd.current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| t!("err.lldbLaunch", error = e))?;
    let stdin = child.stdin.take().ok_or_else(|| t!("err.lldbLaunch", error = "stdin"))?;
    let stdout = child.stdout.take().ok_or_else(|| t!("err.lldbLaunch", error = "stdout"))?;
    let session = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    *state.inner.lock().await = Some(Adapter { session, stdin, child });
    tauri::async_runtime::spawn(pump(app, stdout, session));
    Ok(DapStarted { session, program: program.to_string_lossy().to_string() })
}

#[tauri::command]
pub async fn dap_send(state: State<'_, DapState>, message: String) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let adapter = guard.as_mut().ok_or_else(|| t!("err.debuggerOff"))?;
    let frame = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
    adapter.stdin.write_all(frame.as_bytes()).await.map_err(|e| e.to_string())?;
    adapter.stdin.flush().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn dap_stop(state: State<'_, DapState>) -> Result<(), String> {
    kill(state.inner.lock().await.take()).await;
    Ok(())
}

pub async fn shutdown(app: &AppHandle) {
    kill(app.state::<DapState>().inner.lock().await.take()).await;
}

#[cfg(test)]
mod tests {
    use super::pick_program;

    #[test]
    fn picks_the_named_program_then_the_newest() {
        let dir = std::env::temp_dir().join(format!("xwc-dap-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("HelloPackageTests.exe"), "").unwrap();
        std::fs::write(dir.join("Other.exe"), "").unwrap();
        assert_eq!(pick_program(&dir, "Hello").unwrap().file_name().unwrap(), "Other.exe");
        std::fs::write(dir.join("Hello.exe"), "").unwrap();
        assert_eq!(pick_program(&dir, "Hello").unwrap().file_name().unwrap(), "Hello.exe");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
