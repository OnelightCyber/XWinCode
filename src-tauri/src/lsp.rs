use std::process::Stdio;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};

use crate::project::{self, ProjectKind};
use crate::{env, settings, wsl};

struct Server {
    stdin: ChildStdin,
    child: Child,
    wsl: bool,
}

#[derive(Default)]
pub struct LspState {
    inner: tokio::sync::Mutex<Option<Server>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspInfo {
    mode: &'static str,
    server: String,
}

#[derive(Clone, Serialize)]
struct LogEvent {
    line: String,
}

fn map_uris(value: &mut Value, f: &dyn Fn(&str) -> Option<String>) {
    match value {
        Value::String(s) => {
            if let Some(n) = f(s) {
                *s = n;
            }
        }
        Value::Array(a) => a.iter_mut().for_each(|v| map_uris(v, f)),
        Value::Object(o) => {
            let keys: Vec<String> = o.keys().filter(|k| f(k).is_some()).cloned().collect();
            for k in keys {
                if let Some(v) = o.remove(&k) {
                    o.insert(f(&k).unwrap(), v);
                }
            }
            o.values_mut().for_each(|v| map_uris(v, f));
        }
        _ => {}
    }
}

fn win_uri_to_wsl(s: &str) -> Option<String> {
    let rest = s.strip_prefix("file:///")?;
    let b = rest.as_bytes();
    if b.is_empty() || !b[0].is_ascii_alphabetic() {
        return None;
    }
    let after = if rest[1..].starts_with("%3A") || rest[1..].starts_with("%3a") {
        &rest[4..]
    } else if rest[1..].starts_with(':') {
        &rest[2..]
    } else {
        return None;
    };
    Some(format!("file:///mnt/{}{}", (b[0] as char).to_ascii_lowercase(), after))
}

fn wsl_uri_to_win(s: &str) -> Option<String> {
    let rest = s.strip_prefix("file:///mnt/")?;
    let b = rest.as_bytes();
    if b.is_empty() || !b[0].is_ascii_alphabetic() || (b.len() > 1 && b[1] != b'/') {
        return None;
    }
    Some(format!("file:///{}%3A{}", (b[0] as char).to_ascii_lowercase(), &rest[1..]))
}

async fn read_messages(app: AppHandle, stdout: tokio::process::ChildStdout, wsl: bool) {
    let mut reader = BufReader::new(stdout);
    loop {
        let mut length: Option<usize> = None;
        loop {
            let mut header = String::new();
            match reader.read_line(&mut header).await {
                Ok(0) | Err(_) => {
                    let _ = app.emit("lsp://exit", ());
                    return;
                }
                Ok(_) => {}
            }
            let header = header.trim_end();
            if header.is_empty() {
                break;
            }
            if let Some(v) = header.strip_prefix("Content-Length:") {
                length = v.trim().parse().ok();
            }
        }
        let Some(len) = length else { continue };
        let mut body = vec![0u8; len];
        if reader.read_exact(&mut body).await.is_err() {
            let _ = app.emit("lsp://exit", ());
            return;
        }
        let text = if wsl {
            match serde_json::from_slice::<Value>(&body) {
                Ok(mut v) => {
                    map_uris(&mut v, &wsl_uri_to_win);
                    v.to_string()
                }
                Err(_) => String::from_utf8_lossy(&body).into_owned(),
            }
        } else {
            String::from_utf8_lossy(&body).into_owned()
        };
        let _ = app.emit("lsp://message", text);
    }
}

#[tauri::command]
pub async fn lsp_start(app: AppHandle, state: State<'_, LspState>, root: String) -> Result<LspInfo, String> {
    crate::trust::require(&app, &root)?;
    let mut guard = state.inner.lock().await;
    if let Some(mut old) = guard.take() {
        let _ = old.child.kill().await;
    }
    let info = project::inspect(std::path::Path::new(&root))?;
    let use_wsl = info.kind == ProjectKind::IosApp;

    let mut cmd = if use_wsl {
        let distro = settings::load(&app).wsl_distro;
        if !wsl::exe().is_file() {
            return Err(t!("err.wslMissing"));
        }
        match wsl::run(&distro, "command -v sourcekit-lsp", 120).await {
            Ok((true, _, _)) => {}
            Ok(_) => return Err(t!("err.sourcekitMissingWsl")),
            Err(e) => return Err(t!("err.wslNotResponding", error = e)),
        }
        let mut c = env::command(wsl::exe());
        c.args(wsl::script_args(&distro, Some(&root), "exec sourcekit-lsp"));
        c
    } else {
        let exe = env::which("sourcekit-lsp").ok_or_else(|| t!("err.sourcekitMissing"))?;
        let mut c = env::command(exe);
        c.current_dir(&root);
        c
    };
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| t!("err.sourcekitLaunch", error = e))?;

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    if let Ok(Some(status)) = child.try_wait() {
        return Err(t!("err.sourcekitExited", status = status));
    }
    let stdin = child.stdin.take().ok_or("stdin indisponible")?;
    if let Some(out) = child.stdout.take() {
        tokio::spawn(read_messages(app.clone(), out, use_wsl));
    }
    if let Some(err) = child.stderr.take() {
        let app2 = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app2.emit("lsp://log", LogEvent { line });
            }
        });
    }
    *guard = Some(Server { stdin, child, wsl: use_wsl });
    Ok(LspInfo { mode: if use_wsl { "wsl" } else { "windows" }, server: "sourcekit-lsp".into() })
}

#[tauri::command]
pub async fn lsp_send(state: State<'_, LspState>, message: String) -> Result<(), String> {
    let mut guard = state.inner.lock().await;
    let server = guard.as_mut().ok_or_else(|| t!("err.lspStopped"))?;
    let body = if server.wsl {
        let mut v: Value = serde_json::from_str(&message).map_err(|e| e.to_string())?;
        map_uris(&mut v, &win_uri_to_wsl);
        v.to_string()
    } else {
        message
    };
    let frame = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
    server.stdin.write_all(frame.as_bytes()).await.map_err(|e| e.to_string())?;
    server.stdin.flush().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn lsp_stop(state: State<'_, LspState>) -> Result<(), String> {
    if let Some(mut s) = state.inner.lock().await.take() {
        let _ = s.child.kill().await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_roundtrip() {
        assert_eq!(win_uri_to_wsl("file:///c%3A/Users/me/A%20B/x.swift").as_deref(), Some("file:///mnt/c/Users/me/A%20B/x.swift"));
        assert_eq!(win_uri_to_wsl("file:///D:/x").as_deref(), Some("file:///mnt/d/x"));
        assert_eq!(wsl_uri_to_win("file:///mnt/c/Users/me/x.swift").as_deref(), Some("file:///c%3A/Users/me/x.swift"));
        assert_eq!(wsl_uri_to_win("file:///home/me/x"), None);
        assert_eq!(win_uri_to_wsl("https://example.com"), None);
    }

    #[test]
    fn maps_nested_values_and_keys() {
        let mut v: Value = serde_json::json!({"changes": {"file:///mnt/c/a.swift": [{"uri": "file:///mnt/c/b.swift"}]}});
        map_uris(&mut v, &wsl_uri_to_win);
        assert!(v["changes"]["file:///c%3A/a.swift"][0]["uri"] == "file:///c%3A/b.swift");
    }
}
