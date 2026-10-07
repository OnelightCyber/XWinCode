use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{env, settings, wsl};

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<u32, Session>>,
}

#[derive(Clone, Serialize)]
struct DataEvent {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitEvent {
    id: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyInfo {
    id: u32,
    title: String,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }
}

fn build_command(app: &AppHandle, shell: &str, cwd: Option<&str>) -> Result<(CommandBuilder, String), String> {
    let (mut cmd, title) = match shell {
        "cmd" => (CommandBuilder::new(env::system_exe("cmd.exe")), t!("term.cmd")),
        "wsl" => {
            let distro = settings::load(app).wsl_distro.filter(|d| wsl::valid_distro(d));
            let mut c = CommandBuilder::new(wsl::exe());
            c.args(wsl::distro_args(&distro));
            if let Some(dir) = cwd {
                c.args(["--cd", dir]);
            }
            (c, distro.unwrap_or_else(|| "WSL".into()))
        }
        _ => {
            let exe = env::which("pwsh").unwrap_or_else(|| env::system_exe(r"WindowsPowerShell\v1.0\powershell.exe"));
            let mut c = CommandBuilder::new(exe);
            c.arg("-NoLogo");
            (c, "PowerShell".to_string())
        }
    };
    if let Some(dir) = cwd {
        if shell != "wsl" {
            cmd.cwd(dir);
        }
    }
    for (k, v) in env::fresh_env() {
        cmd.env(k, v);
    }
    cmd.env("NoDefaultCurrentDirectoryInExePath", "1");
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    Ok((cmd, title))
}

#[tauri::command(async)]
pub fn pty_open(
    app: AppHandle,
    state: State<'_, PtyState>,
    shell: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<PtyInfo, String> {
    let (cmd, title) = build_command(&app, &shell, cwd.as_deref())?;
    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| t!("err.terminalLaunch", error = e))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);

    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        let mut carry: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let valid = match std::str::from_utf8(&carry) {
                        Ok(_) => carry.len(),
                        Err(e) if e.error_len().is_none() => e.valid_up_to(),
                        Err(_) => carry.len(),
                    };
                    let chunk: Vec<u8> = carry.drain(..valid).collect();
                    let data = String::from_utf8_lossy(&chunk).into_owned();
                    if !data.is_empty() {
                        let _ = app2.emit("pty://data", DataEvent { id, data });
                    }
                }
            }
        }
        let _ = app2.emit("pty://exit", ExitEvent { id });
    });

    state.sessions.lock().unwrap().insert(id, Session { master: pair.master, writer, child });
    Ok(PtyInfo { id, title })
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let s = sessions.get_mut(&id).ok_or_else(|| t!("err.terminalClosed"))?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    let s = sessions.get(&id).ok_or_else(|| t!("err.terminalClosed"))?;
    s.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u32) -> Result<(), String> {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
    Ok(())
}
