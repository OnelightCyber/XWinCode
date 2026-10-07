use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::ChildStdin;

use crate::diagnostics::{self, Diagnostic};
use crate::env;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

pub struct TaskSpec {
    pub label: String,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub display: Option<String>,
}

struct Running {
    id: u64,
    pid: Option<u32>,
    stdin: Option<Arc<tokio::sync::Mutex<ChildStdin>>>,
    cancelled: bool,
}

#[derive(Default)]
pub struct TaskManager {
    current: Mutex<Option<Running>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartEvent {
    task_id: u64,
    label: String,
    command: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    task_id: u64,
    stream: &'static str,
    lines: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticEvent {
    task_id: u64,
    #[serde(flatten)]
    diagnostic: Diagnostic,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    task_id: u64,
    code: Option<i32>,
    success: bool,
    cancelled: bool,
    duration_ms: u64,
}

impl TaskManager {
    pub fn is_running(&self) -> bool {
        self.current.lock().unwrap().is_some()
    }

    pub fn stop(&self) -> bool {
        let pid = {
            let mut guard = self.current.lock().unwrap();
            match guard.as_mut() {
                Some(r) => {
                    r.cancelled = true;
                    r.pid
                }
                None => return false,
            }
        };
        if let Some(pid) = pid {
            kill_tree(pid);
        }
        true
    }

    pub async fn spawn(&self, app: AppHandle, spec: TaskSpec) -> Result<u64, String> {
        if self.is_running() {
            self.stop();
            for _ in 0..30 {
                if !self.is_running() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }

        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let mut cmd = env::command(&spec.program);
        cmd.args(&spec.args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = &spec.cwd {
            cmd.current_dir(cwd);
        }

        let display = spec
            .display
            .clone()
            .unwrap_or_else(|| {
                format!(
                    "{} {}",
                    spec.program.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    spec.args.join(" ")
                )
            })
            .replace(['\r', '\n'], " ");

        let mut child = cmd.spawn().map_err(|e| t!("err.launch", command = display, error = e))?;
        let stdin = child.stdin.take().map(|s| Arc::new(tokio::sync::Mutex::new(s)));
        *self.current.lock().unwrap() = Some(Running { id, pid: child.id(), stdin, cancelled: false });

        let _ = app.emit("task://start", StartEvent { task_id: id, label: spec.label.clone(), command: display });

        let started = Instant::now();
        let out = child.stdout.take().map(|s| tokio::spawn(pump(app.clone(), id, "stdout", s)));
        let err = child.stderr.take().map(|s| tokio::spawn(pump(app.clone(), id, "stderr", s)));

        let app2 = app.clone();
        tokio::spawn(async move {
            let status = child.wait().await;
            if let Some(h) = out {
                let _ = h.await;
            }
            if let Some(h) = err {
                let _ = h.await;
            }
            let manager = app2.state::<TaskManager>();
            let cancelled = {
                let mut guard = manager.current.lock().unwrap();
                let cancelled = guard.as_ref().map(|r| r.id == id && r.cancelled).unwrap_or(false);
                if guard.as_ref().map(|r| r.id) == Some(id) {
                    *guard = None;
                }
                cancelled
            };
            let code = status.as_ref().ok().and_then(|s| s.code());
            let success = status.map(|s| s.success()).unwrap_or(false) && !cancelled;
            let _ = app2.emit(
                "task://exit",
                ExitEvent { task_id: id, code, success, cancelled, duration_ms: started.elapsed().as_millis() as u64 },
            );
        });

        Ok(id)
    }

    pub async fn write_input(&self, text: &str) -> Result<(), String> {
        let stdin = self.current.lock().unwrap().as_ref().and_then(|r| r.stdin.clone());
        let Some(stdin) = stdin else { return Err(t!("err.noProgram")) };
        let mut s = stdin.lock().await;
        s.write_all(text.as_bytes()).await.map_err(|e| e.to_string())?;
        s.write_all(b"\n").await.map_err(|e| e.to_string())?;
        s.flush().await.map_err(|e| e.to_string())
    }
}


async fn pump<R: AsyncRead + Unpin>(app: AppHandle, id: u64, stream: &'static str, mut reader: R) {
    let mut buf = vec![0u8; 8192];
    let mut pending: Vec<u8> = Vec::new();
    let mut utf16: Option<bool> = None;
    loop {
        let mut lines = Vec::new();
        let n = match tokio::time::timeout(std::time::Duration::from_millis(200), reader.read(&mut buf)).await {
            Err(_) => {
                if !pending.is_empty() && !(utf16 == Some(true) && pending.len() % 2 == 1) {
                    let line: Vec<u8> = std::mem::take(&mut pending);
                    lines.push(clean_line(&app, id, &line));
                    emit_lines(&app, id, stream, lines);
                }
                continue;
            }
            Ok(Ok(0)) | Ok(Err(_)) => break,
            Ok(Ok(n)) => n,
        };
        pending.extend_from_slice(&buf[..n]);
        let wide = *utf16.get_or_insert_with(|| env::looks_utf16(&pending));
        loop {
            let pos = if wide {
                (0..pending.len().saturating_sub(1)).step_by(2).find(|&i| pending[i] == b'\n' && pending[i + 1] == 0).map(|i| i + 1)
            } else {
                pending.iter().position(|b| *b == b'\n')
            };
            let Some(pos) = pos else { break };
            let line: Vec<u8> = pending.drain(..=pos).collect();
            lines.push(clean_line(&app, id, &line));
        }
        emit_lines(&app, id, stream, lines);
    }
    if !pending.is_empty() {
        let line = clean_line(&app, id, &pending);
        emit_lines(&app, id, stream, vec![line]);
    }
}

fn emit_lines(app: &AppHandle, id: u64, stream: &'static str, lines: Vec<String>) {
    if !lines.is_empty() {
        let _ = app.emit("task://output", OutputEvent { task_id: id, stream, lines });
    }
}

fn clean_line(app: &AppHandle, id: u64, raw: &[u8]) -> String {
    let text = env::decode_output(raw);
    let text = text.trim_end_matches(['\n', '\r']);
    let text = text.rsplit('\r').find(|s| !s.trim().is_empty()).unwrap_or("");
    let line = diagnostics::strip_ansi(text);
    if let Some(d) = diagnostics::parse_line(&line) {
        let _ = app.emit("task://diagnostic", DiagnosticEvent { task_id: id, diagnostic: d });
    }
    line
}

pub fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new(env::system_exe("taskkill.exe"))
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(env::CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
}

#[tauri::command(async)]
pub fn stop_task(manager: State<'_, TaskManager>) -> Result<bool, String> {
    Ok(manager.stop())
}

#[tauri::command]
pub async fn send_task_input(manager: State<'_, TaskManager>, text: String) -> Result<(), String> {
    manager.write_input(&text).await
}
