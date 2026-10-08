use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::process::Child;
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};

use crate::builder::valid_udid;
use crate::env;

const VERSION: &str = "1.3.2";
const URL: &str = "https://github.com/danielpaulus/go-ios/releases/download/v1.3.2/go-ios-win.zip";
const ZIP_SHA256: &str = "939c6bcaafed183a92afb9f79cc11b1f935fa6389bfc94d3902e3f52c4dff3fe";
const EXE_SHA256: &str = "c99b04f1d615fa716637efae457d5c554f32259f9d249375de0086e3cc1a1df5";
const PORTS: [u16; 4] = [28117, 38117, 48117, 58117];
const IDLE: Duration = Duration::from_secs(180);

struct Agent {
    child: Option<Child>,
    port: u16,
    used: Instant,
}

#[derive(Default)]
pub struct CaptureState {
    agent: Mutex<Option<Agent>>,
    tool: Mutex<()>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

async fn sha256_of(path: &Path) -> Option<String> {
    let bytes = tokio::fs::read(path).await.ok()?;
    Some(hex(&Sha256::digest(&bytes)))
}

fn tools_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map(|d| d.join("tools")).map_err(|e| e.to_string())
}

fn last_line(text: &str) -> String {
    let line = text.lines().map(str::trim).rfind(|l| !l.is_empty()).unwrap_or("").to_string();
    match serde_json::from_str::<serde_json::Value>(&line) {
        Ok(v) => {
            let err = v.get("err").or_else(|| v.get("error")).and_then(|e| e.as_str()).filter(|e| !e.is_empty());
            err.or_else(|| v.get("msg").and_then(|m| m.as_str())).unwrap_or("").to_string()
        }
        Err(_) => line,
    }
}

async fn download(work: &Path, exe: &Path) -> Result<(), String> {
    let zip = work.join("go-ios-win.zip");
    let out = env::command(env::system_exe("curl.exe"))
        .args(["-fsSL", "--proto", "=https", "--tlsv1.2", "--retry", "2", "--max-time", "300", "-o"])
        .arg(&zip)
        .arg(URL)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| t!("err.captureDownload", error = e.to_string()))?;
    if !out.status.success() {
        return Err(t!("err.captureDownload", error = last_line(&String::from_utf8_lossy(&out.stderr))));
    }
    if sha256_of(&zip).await.as_deref() != Some(ZIP_SHA256) {
        return Err(t!("err.captureChecksum"));
    }
    let unpacked = work.join("out");
    tokio::fs::create_dir_all(&unpacked).await.map_err(|e| e.to_string())?;
    let status = env::command(env::system_exe("tar.exe"))
        .arg("-xf")
        .arg(&zip)
        .arg("-C")
        .arg(&unpacked)
        .arg("ios.exe")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .status()
        .await
        .map_err(|e| e.to_string())?;
    let fresh = unpacked.join("ios.exe");
    if !status.success() || sha256_of(&fresh).await.as_deref() != Some(EXE_SHA256) {
        return Err(t!("err.captureChecksum"));
    }
    if let Some(dir) = exe.parent() {
        tokio::fs::create_dir_all(dir).await.map_err(|e| e.to_string())?;
    }
    let _ = tokio::fs::remove_file(exe).await;
    tokio::fs::rename(&fresh, exe).await.map_err(|e| e.to_string())
}

async fn tool(app: &AppHandle, state: &CaptureState) -> Result<PathBuf, String> {
    let _guard = state.tool.lock().await;
    let root = tools_dir(app)?;
    let exe = root.join(format!("go-ios-{VERSION}")).join("ios.exe");
    if sha256_of(&exe).await.as_deref() == Some(EXE_SHA256) {
        return Ok(exe);
    }
    let work = root.join(format!("go-ios-download-{}", std::process::id()));
    let _ = tokio::fs::remove_dir_all(&work).await;
    tokio::fs::create_dir_all(&work).await.map_err(|e| e.to_string())?;
    let result = download(&work, &exe).await;
    let _ = tokio::fs::remove_dir_all(&work).await;
    result.map(|_| exe)
}

fn free_block() -> Option<u16> {
    PORTS.into_iter().find(|&base| (0..8).all(|i| TcpListener::bind(("127.0.0.1", base + i)).is_ok()))
}

async fn http_get(port: u16, path: &str) -> Option<u16> {
    let request = async {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await.ok()?;
        stream.write_all(format!("GET {path} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").as_bytes()).await.ok()?;
        let mut head = [0u8; 64];
        let n = stream.read(&mut head).await.ok()?;
        String::from_utf8_lossy(&head[..n]).split_whitespace().nth(1)?.parse().ok()
    };
    timeout(Duration::from_secs(2), request).await.ok().flatten()
}

async fn stop(agent: Agent) {
    let Agent { child, port, .. } = agent;
    let _ = http_get(port, "/shutdown").await;
    if let Some(mut child) = child {
        if let Some(pid) = child.id() {
            crate::process::kill_tree(pid);
        }
        let _ = child.start_kill();
    }
}

async fn alive(agent: &mut Agent) -> bool {
    match agent.child.as_mut() {
        Some(child) => matches!(child.try_wait(), Ok(None)),
        None => http_get(agent.port, "/health").await == Some(200),
    }
}

async fn agent(app: &AppHandle, state: &CaptureState, exe: &Path) -> Result<u16, String> {
    let mut guard = state.agent.lock().await;
    if let Some(agent) = guard.as_mut() {
        if alive(agent).await {
            agent.used = Instant::now();
            return Ok(agent.port);
        }
    }
    if let Some(dead) = guard.take() {
        stop(dead).await;
    }
    for port in PORTS {
        if http_get(port, "/health").await == Some(200) {
            *guard = Some(Agent { child: None, port, used: Instant::now() });
            drop(guard);
            watch_idle(app.clone(), port);
            return Ok(port);
        }
    }
    let port = free_block().ok_or_else(|| t!("err.captureAgent"))?;
    let pairs = tools_dir(app)?.join("go-ios-pairing");
    tokio::fs::create_dir_all(&pairs).await.map_err(|e| e.to_string())?;
    let child = env::command(exe)
        .args(["tunnel", "start", "--userspace"])
        .arg(format!("--tunnel-info-port={port}"))
        .arg(format!("--pair-record-path={}", pairs.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| t!("err.captureAgent"))?;
    *guard = Some(Agent { child: Some(child), port, used: Instant::now() });
    drop(guard);
    for _ in 0..50 {
        if http_get(port, "/health").await == Some(200) {
            watch_idle(app.clone(), port);
            return Ok(port);
        }
        sleep(Duration::from_millis(100)).await;
    }
    let failed = state.agent.lock().await.take();
    if let Some(agent) = failed {
        stop(agent).await;
    }
    Err(t!("err.captureAgent"))
}

fn watch_idle(app: AppHandle, port: u16) {
    tauri::async_runtime::spawn(async move {
        loop {
            sleep(Duration::from_secs(30)).await;
            let state = app.state::<CaptureState>();
            let mut guard = state.agent.lock().await;
            let idle = match guard.as_ref() {
                Some(agent) if agent.port == port => agent.used.elapsed() >= IDLE,
                _ => return,
            };
            if idle {
                let agent = guard.take();
                drop(guard);
                if let Some(agent) = agent {
                    stop(agent).await;
                }
                return;
            }
        }
    });
}

async fn wait_for_tunnel(port: u16, udid: &str) {
    let path = format!("/tunnel/{udid}");
    for _ in 0..60 {
        if http_get(port, &path).await == Some(200) {
            return;
        }
        sleep(Duration::from_millis(200)).await;
    }
}

pub(crate) fn file_name(name: &str, ext: &str) -> String {
    let clean: String = name.chars().map(|c| if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' { c } else { ' ' }).collect();
    let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    let clean: String = clean.chars().take(40).collect();
    let device = if clean.is_empty() { "iPhone".to_string() } else { clean };
    format!("{device} {}.{ext}", chrono::Local::now().format("%Y-%m-%d at %H.%M.%S"))
}

pub(crate) fn unique(dir: &Path, name: &str, ext: &str) -> PathBuf {
    let base = file_name(name, ext);
    let first = dir.join(&base);
    if !first.exists() {
        return first;
    }
    let stem = base.trim_end_matches(&format!(".{ext}")).to_string();
    (2..100).map(|i| dir.join(format!("{stem} {i}.{ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

async fn shoot(exe: &Path, port: u16, udid: &str, path: &Path) -> Result<(), String> {
    let run = env::command(exe)
        .arg("screenshot")
        .arg(format!("--udid={udid}"))
        .arg(format!("--tunnel-info-port={port}"))
        .arg(format!("--output={}", path.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .output();
    let out = timeout(Duration::from_secs(40), run).await.map_err(|_| t!("err.noAnswer"))?.map_err(|e| e.to_string())?;
    let saved = tokio::fs::metadata(path).await.map(|m| m.len() > 0).unwrap_or(false);
    if out.status.success() && saved {
        return Ok(());
    }
    let text = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    Err(last_line(&text))
}

async fn attached(exe: &Path, udid: &str) -> bool {
    let run = env::command(exe).arg("list").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true).output();
    match timeout(Duration::from_secs(15), run).await {
        Ok(Ok(out)) => String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok()).any(|v| {
            v.get("deviceList").and_then(|d| d.as_array()).is_some_and(|list| list.iter().any(|d| d.as_str() == Some(udid)))
        }),
        _ => true,
    }
}

async fn mount_image(app: &AppHandle, exe: &Path, udid: &str) {
    let Ok(dir) = tools_dir(app).map(|d| d.join("go-ios-images")) else { return };
    if tokio::fs::create_dir_all(&dir).await.is_err() {
        return;
    }
    let run = env::command(exe)
        .args(["image", "auto"])
        .arg(format!("--udid={udid}"))
        .arg(format!("--basedir={}", dir.display()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .status();
    let _ = timeout(Duration::from_secs(180), run).await;
}

#[tauri::command]
pub async fn iphone_screenshot(app: AppHandle, state: State<'_, CaptureState>, udid: String, name: String, os: Option<String>) -> Result<String, String> {
    if !valid_udid(&udid) {
        return Err(t!("err.invalidDevice"));
    }
    let exe = tool(&app, &state).await?;
    if !attached(&exe, &udid).await {
        return Err(t!("err.previewGone"));
    }
    let port = agent(&app, &state, &exe).await?;
    let modern = os.as_deref().and_then(|v| v.split('.').next()?.trim().parse::<u32>().ok()).map_or(true, |major| major >= 17);
    if modern {
        wait_for_tunnel(port, &udid).await;
    }
    let dir = app.path().picture_dir().map_err(|e| e.to_string())?.join("XWinCode");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let path = unique(&dir, &name, "png");
    if let Err(first) = shoot(&exe, port, &udid, &path).await {
        mount_image(&app, &exe, &udid).await;
        if shoot(&exe, port, &udid, &path).await.is_err() {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(t!("err.captureFailed", error = first));
        }
    }
    if let Some(agent) = state.agent.lock().await.as_mut() {
        agent.used = Instant::now();
    }
    Ok(path.to_string_lossy().into_owned())
}

pub async fn shutdown(app: &AppHandle) {
    let agent = app.state::<CaptureState>().agent.lock().await.take();
    if let Some(agent) = agent {
        stop(agent).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_screenshots_after_the_device() {
        let name = file_name("Hugo’s iPhone 16e", "png");
        assert!(name.starts_with("Hugo s iPhone 16e "), "{name}");
        assert!(name.ends_with(".png"));
        assert!(file_name("../..\\:*?", "mp4").starts_with("iPhone "));
        assert!(!file_name("a/b\\c", "png").contains(['/', '\\']));
    }

    #[test]
    fn reads_the_last_error() {
        assert_eq!(last_line("ok\n{\"level\":\"ERROR\",\"msg\":\"Taking screenshot failed\",\"err\":\"device locked\"}\n"), "device locked");
        assert_eq!(last_line("{\"level\":\"ERROR\",\"msg\":\"Starting screenshot service failed\"}"), "Starting screenshot service failed");
        assert_eq!(last_line("curl: (6) Could not resolve host\n"), "curl: (6) Could not resolve host");
        assert_eq!(last_line(""), "");
    }
}
