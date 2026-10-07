use std::path::{Path, PathBuf};
use std::time::SystemTime;

use plist::Value;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::diagnostics::wsl_to_windows;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallRecord {
    pub udid: String,
    pub device_name: String,
    pub bundle_id: String,
    pub app_name: String,
    pub project_root: Option<String>,
    pub installed_at: String,
    pub expires_at: Option<String>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("installs.json"))
}

fn load(app: &AppHandle) -> Vec<InstallRecord> {
    store_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn store(app: &AppHandle, records: &[InstallRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(records).map_err(|e| e.to_string())?;
    std::fs::write(store_path(app)?, json).map_err(|e| e.to_string())
}

fn rfc3339(t: SystemTime) -> String {
    chrono::DateTime::<chrono::Local>::from(t).to_rfc3339()
}

fn profile_plist(bytes: &[u8]) -> Option<plist::Dictionary> {
    let text = String::from_utf8_lossy(bytes);
    let start = text.find("<?xml")?;
    let end = text.find("</plist>")? + "</plist>".len();
    Value::from_reader_xml(text[start..end].as_bytes()).ok()?.into_dictionary()
}

pub struct AppBundleInfo {
    pub bundle_id: String,
    pub name: String,
    pub expires_at: Option<String>,
}

pub fn read_app_bundle(app_dir: &Path) -> Result<AppBundleInfo, String> {
    let info = Value::from_file(app_dir.join("Info.plist"))
        .map_err(|e| t!("err.infoPlistUnreadable", path = app_dir.display(), error = e))?;
    let dict = info.as_dictionary().ok_or_else(|| t!("err.infoPlistUnexpected"))?;
    let get = |k: &str| dict.get(k).and_then(Value::as_string).map(str::to_string);
    let bundle_id = get("CFBundleIdentifier").ok_or_else(|| t!("err.noBundleId"))?;
    let name = get("CFBundleDisplayName").or_else(|| get("CFBundleName")).unwrap_or_else(|| bundle_id.clone());
    let expires_at = std::fs::read(app_dir.join("embedded.mobileprovision"))
        .ok()
        .and_then(|b| profile_plist(&b))
        .and_then(|p| p.get("ExpirationDate").and_then(Value::as_date))
        .map(|d| rfc3339(d.into()));
    Ok(AppBundleInfo { bundle_id, name, expires_at })
}

fn newest_app(root: &Path) -> Option<PathBuf> {
    std::fs::read_dir(root.join("xtool"))
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "app") && e.path().is_dir())
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).unwrap_or(SystemTime::UNIX_EPOCH))
        .map(|e| e.path())
}

#[tauri::command(async)]
pub fn list_installs(app: AppHandle) -> Vec<InstallRecord> {
    load(&app)
}

#[tauri::command(async)]
pub fn record_install(
    app: AppHandle,
    udid: String,
    device_name: String,
    project_root: Option<String>,
    app_path: Option<String>,
) -> Result<InstallRecord, String> {
    let app_dir = match app_path.filter(|p| !p.is_empty()) {
        Some(p) => PathBuf::from(if p.starts_with('/') { wsl_to_windows(&p) } else { p }),
        None => project_root.as_deref().and_then(|r| newest_app(Path::new(r))).ok_or_else(|| t!("err.builtAppMissing"))?,
    };
    let info = read_app_bundle(&app_dir)?;
    let record = InstallRecord {
        udid,
        device_name,
        bundle_id: info.bundle_id,
        app_name: info.name,
        project_root,
        installed_at: rfc3339(SystemTime::now()),
        expires_at: info.expires_at,
    };
    let mut all = load(&app);
    all.retain(|r| !(r.udid == record.udid && r.bundle_id == record.bundle_id));
    all.insert(0, record.clone());
    all.truncate(200);
    store(&app, &all)?;
    Ok(record)
}

#[tauri::command]
pub fn forget_install(app: AppHandle, udid: String, bundle_id: String) -> Result<(), String> {
    let mut all = load(&app);
    all.retain(|r| !(r.udid == udid && r.bundle_id == bundle_id));
    store(&app, &all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_profile_expiration() {
        let mut fake = b"\x30\x82\x01binary-cms-header".to_vec();
        fake.extend_from_slice(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>ExpirationDate</key><date>2026-10-14T12:00:00Z</date><key>Name</key><string>XC Wildcard</string></dict></plist>"#,
        );
        fake.extend_from_slice(b"\x00\x01trailing-signature");
        let p = profile_plist(&fake).unwrap();
        assert!(p.get("ExpirationDate").and_then(Value::as_date).is_some());
    }
}
