use std::process::Stdio;
use std::time::Duration;

use plist::Value;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;

use crate::builder::{connection_flag, valid_udid};
use crate::env::{self, sh_quote};
use crate::{bridge, diagnostics, settings, wsl};

const MISSING: &str = "XWC_MISSING_TOOLS";

fn valid_bundle_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 255 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

fn network_flag(app: &AppHandle) -> &'static str {
    if settings::load(app).ios_connection == "network" {
        " -n"
    } else {
        ""
    }
}

fn missing_tools() -> String {
    format!("{MISSING}: {}", t!("err.imdMissing"))
}

struct LogSession {
    id: u64,
    child: Child,
}

#[derive(Default)]
pub struct DeviceLogState {
    inner: tokio::sync::Mutex<Option<LogSession>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogLines {
    session: u64,
    lines: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogExit {
    session: u64,
    code: Option<i32>,
}

async fn stop_session(state: &DeviceLogState) {
    if let Some(mut s) = state.inner.lock().await.take() {
        if let Some(pid) = s.child.id() {
            crate::process::kill_tree(pid);
        }
        let _ = s.child.kill().await;
    }
}

#[tauri::command]
pub async fn device_log_start(
    app: AppHandle,
    state: State<'_, DeviceLogState>,
    udid: String,
    process: Option<String>,
) -> Result<u64, String> {
    if !valid_udid(&udid) {
        return Err(t!("err.invalidDevice"));
    }
    stop_session(&state).await;
    if !bridge::windows_usbmuxd_available().await {
        return Err(t!("err.amdsDown"));
    }
    let filter = match process.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) if p.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '|')) => format!(" -p {}", sh_quote(p)),
        Some(_) => return Err(t!("err.invalidProcess")),
        None => " -q".into(),
    };
    let script = format!(
        "{}command -v idevicesyslog >/dev/null 2>&1 || {{ echo {}; exit 3; }}\ntrap 'exit 0' HUP TERM INT\nidevicesyslog --no-colors -u {}{}{} 2>&1",
        bridge::wsl_prelude()?,
        sh_quote(&missing_tools()),
        sh_quote(&udid),
        network_flag(&app),
        filter
    );
    let distro = settings::load(&app).wsl_distro;
    let mut cmd = env::command(wsl::exe());
    cmd.args(wsl::script_args(&distro, None, &script))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| t!("err.consoleLaunch", error = e))?;
    let stdout = child.stdout.take().ok_or_else(|| t!("err.noOutput"))?;

    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    *state.inner.lock().await = Some(LogSession { id, child });

    let app2 = app.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut batch: Vec<String> = Vec::new();
        loop {
            match tokio::time::timeout(Duration::from_millis(80), lines.next_line()).await {
                Ok(Ok(Some(line))) => {
                    let line = diagnostics::strip_ansi(line.trim_end_matches('\r'));
                    if !line.trim().is_empty() {
                        batch.push(line);
                    }
                    if batch.len() < 400 {
                        continue;
                    }
                }
                Ok(Ok(None)) | Ok(Err(_)) => break,
                Err(_) => {}
            }
            if !batch.is_empty() {
                let _ = app2.emit("devicelog://lines", LogLines { session: id, lines: std::mem::take(&mut batch) });
            }
        }
        if !batch.is_empty() {
            let _ = app2.emit("devicelog://lines", LogLines { session: id, lines: batch });
        }
        let state = tauri::Manager::state::<DeviceLogState>(&app2);
        let code = {
            let mut guard = state.inner.lock().await;
            match guard.as_mut() {
                Some(s) if s.id == id => {
                    let code = s.child.wait().await.ok().and_then(|st| st.code());
                    *guard = None;
                    code
                }
                _ => None,
            }
        };
        let _ = app2.emit("devicelog://exit", LogExit { session: id, code });
    });
    Ok(id)
}

#[tauri::command]
pub async fn device_log_stop(state: State<'_, DeviceLogState>) -> Result<(), String> {
    stop_session(&state).await;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceApp {
    bundle_id: String,
    name: String,
    version: Option<String>,
    build: Option<String>,
    signer: Option<String>,
}

fn extract_plist(out: &str) -> Option<&str> {
    let start = out.find("<?xml")?;
    let end = out.rfind("</plist>")? + "</plist>".len();
    (end > start).then(|| &out[start..end])
}

fn parse_apps(xml: &str) -> Result<Vec<DeviceApp>, String> {
    let value = Value::from_reader_xml(xml.as_bytes()).map_err(|e| t!("err.appListUnreadable", error = e))?;
    let mut apps: Vec<DeviceApp> = value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_dictionary)
                .filter_map(|d| {
                    let get = |k: &str| d.get(k).and_then(Value::as_string).map(str::to_string);
                    let bundle_id = get("CFBundleIdentifier")?;
                    Some(DeviceApp {
                        name: get("CFBundleDisplayName").or_else(|| get("CFBundleName")).unwrap_or_else(|| bundle_id.clone()),
                        version: get("CFBundleShortVersionString"),
                        build: get("CFBundleVersion"),
                        signer: get("SignerIdentity"),
                        bundle_id,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    apps.sort_by_key(|a| a.name.to_lowercase());
    Ok(apps)
}

#[tauri::command]
pub async fn device_apps(app: AppHandle, udid: String) -> Result<Vec<DeviceApp>, String> {
    if !valid_udid(&udid) {
        return Err(t!("err.invalidDevice"));
    }
    let script = format!(
        "{}command -v ideviceinstaller >/dev/null 2>&1 || {{ echo {}; exit 3; }}\nideviceinstaller -u {}{} -l -o list_user -o xml 2>&1",
        bridge::wsl_prelude()?,
        sh_quote(&missing_tools()),
        sh_quote(&udid),
        network_flag(&app)
    );
    let distro = settings::load(&app).wsl_distro;
    let (_, out, err) = wsl::run(&distro, &script, 90).await?;
    if out.contains(MISSING) {
        return Err(missing_tools());
    }
    match extract_plist(&out) {
        Some(xml) => parse_apps(xml),
        None => {
            let text = format!("{out}{err}");
            let msg = text.lines().map(str::trim).filter(|l| !l.is_empty()).last().map(str::to_string).unwrap_or_else(|| t!("err.noAnswer"));
            Err(t!("err.appList", error = msg))
        }
    }
}

#[tauri::command]
pub async fn device_app_action(app: AppHandle, udid: String, bundle_id: String, action: String) -> Result<String, String> {
    if !valid_udid(&udid) || !valid_bundle_id(&bundle_id) {
        return Err(t!("err.invalidApp"));
    }
    let verb = match action.as_str() {
        "launch" => "launch",
        "uninstall" => "uninstall",
        other => return Err(t!("err.unknownAction", action = other)),
    };
    let script = format!(
        "{}xtool {verb} -u {}{} {} 2>&1",
        bridge::wsl_prelude()?,
        sh_quote(&udid),
        connection_flag(&app),
        sh_quote(&bundle_id)
    );
    let distro = settings::load(&app).wsl_distro;
    let (ok, out, err) = wsl::run(&distro, &script, 120).await?;
    let text = diagnostics::strip_ansi(format!("{out}{err}").trim());
    if ok {
        Ok(text)
    } else {
        let last = text.lines().map(str::trim).filter(|l| !l.is_empty()).last().map(str::to_string).unwrap_or_else(|| t!("err.failed"));
        Err(last)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ideviceinstaller_xml() {
        let out = r#"noise
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><array>
<dict><key>CFBundleIdentifier</key><string>com.example.zeta</string><key>CFBundleName</key><string>Zeta</string></dict>
<dict><key>CFBundleIdentifier</key><string>com.hugo.pulse</string><key>CFBundleDisplayName</key><string>Pulse</string>
<key>CFBundleShortVersionString</key><string>1.0</string><key>SignerIdentity</key><string>Apple Development: X</string></dict>
</array></plist>"#;
        let apps = parse_apps(extract_plist(out).unwrap()).unwrap();
        assert_eq!(apps.len(), 2);
        assert_eq!(apps[0].name, "Pulse");
        assert_eq!(apps[0].version.as_deref(), Some("1.0"));
        assert_eq!(apps[1].bundle_id, "com.example.zeta");
    }

    #[test]
    fn bundle_ids() {
        assert!(valid_bundle_id("com.hugo.pulse-2"));
        assert!(!valid_bundle_id("com.x; rm -rf /"));
    }
}
