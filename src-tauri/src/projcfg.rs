use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use plist::{Dictionary, Value};
use serde::{Deserialize, Serialize};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
const DEFAULT_ICON: &str = "Resources/AppIcon.png";
const MAX_IMAGE: u64 = 25 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub bundle_id: String,
    pub display_name: String,
    pub version: String,
    pub build: String,
    pub permissions: BTreeMap<String, String>,
    #[serde(default, skip_deserializing)]
    pub icon: Option<String>,
}

fn is_permission(key: &str) -> bool {
    key.starts_with("NS") && key.ends_with("UsageDescription")
}

fn yml_get(yml: &str, key: &str) -> Option<String> {
    yml.lines().find_map(|l| {
        let rest = l.strip_prefix(key)?.strip_prefix(':')?;
        let v = rest.trim().trim_matches('"').trim_matches('\'').trim().to_string();
        (!v.is_empty()).then_some(v)
    })
}

fn yml_set(yml: &str, key: &str, value: &str) -> String {
    let mut found = false;
    let mut out: Vec<String> = yml
        .lines()
        .map(|l| {
            if l.strip_prefix(key).is_some_and(|r| r.starts_with(':')) {
                found = true;
                format!("{key}: {value}")
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        out.push(format!("{key}: {value}"));
    }
    let mut s = out.join("\n");
    s.push('\n');
    s
}

fn xtool_yml(root: &Path) -> Result<(PathBuf, String), String> {
    let path = root.join("xtool.yml");
    let text = std::fs::read_to_string(&path).map_err(|_| t!("err.notIosProject"))?;
    Ok((path, text))
}

fn in_project(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let outside = || t!("err.pathOutsideProject", path = rel);
    let rel_path = Path::new(rel);
    if rel.is_empty() || !rel_path.components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err(outside());
    }
    let path = root.join(rel_path);
    let base = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let existing = path.ancestors().find(|a| a.exists()).unwrap_or(root);
    let real = std::fs::canonicalize(existing).map_err(|e| e.to_string())?;
    if !real.starts_with(&base) {
        return Err(outside());
    }
    Ok(path)
}

fn info_path(root: &Path, yml: &str) -> Result<PathBuf, String> {
    in_project(root, &yml_get(yml, "infoPath").unwrap_or_else(|| "Info.plist".into()))
}

fn read_dict(path: &Path) -> Result<Dictionary, String> {
    if !path.exists() {
        return Ok(Dictionary::new());
    }
    Value::from_file(path)
        .map_err(|e| t!("err.fileUnreadable", path = path.display(), error = e))?
        .into_dictionary()
        .ok_or_else(|| t!("err.plistNotDict", path = path.display()))
}

fn mime_of(bytes: &[u8], path: &Path) -> &'static str {
    if bytes.starts_with(b"\x89PNG") {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8]) {
        "image/jpeg"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.starts_with(b"BM") {
        "image/bmp"
    } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("svg")) {
        "image/svg+xml"
    } else {
        "application/octet-stream"
    }
}

fn data_url(path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_IMAGE {
        return Err(t!("err.imageTooBig"));
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", mime_of(&bytes, path), B64.encode(&bytes)))
}

#[tauri::command(async)]
pub fn read_project_config(root: String) -> Result<ProjectConfig, String> {
    let root = Path::new(&root);
    let (_, yml) = xtool_yml(root)?;
    let info = read_dict(&info_path(root, &yml)?)?;
    let get = |k: &str| info.get(k).and_then(Value::as_string).map(str::to_string);
    let permissions = info
        .iter()
        .filter(|(k, _)| is_permission(k))
        .map(|(k, v)| (k.clone(), v.as_string().unwrap_or_default().to_string()))
        .collect();
    let icon = yml_get(&yml, "iconPath")
        .and_then(|p| in_project(root, &p).ok())
        .filter(|p| p.is_file())
        .and_then(|p| data_url(&p).ok());
    Ok(ProjectConfig {
        bundle_id: yml_get(&yml, "bundleID").unwrap_or_default(),
        display_name: get("CFBundleDisplayName").unwrap_or_default(),
        version: get("CFBundleShortVersionString").unwrap_or_else(|| "1.0".into()),
        build: get("CFBundleVersion").unwrap_or_else(|| "1".into()),
        permissions,
        icon,
    })
}

fn validate(cfg: &ProjectConfig) -> Result<(), String> {
    let parts: Vec<&str> = cfg.bundle_id.split('.').collect();
    if parts.len() < 2 || parts.iter().any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')) {
        return Err(t!("err.bundleIdInvalid"));
    }
    let numeric = |s: &str| !s.is_empty() && s.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()));
    if !numeric(&cfg.version) || cfg.version.split('.').count() > 3 {
        return Err(t!("err.versionInvalid"));
    }
    if !numeric(&cfg.build) {
        return Err(t!("err.buildInvalid"));
    }
    if let Some((k, _)) = cfg.permissions.iter().find(|(k, v)| !is_permission(k) || v.trim().is_empty()) {
        return Err(t!("err.permissionText", key = k));
    }
    Ok(())
}

#[tauri::command]
pub fn write_project_config(root: String, config: ProjectConfig) -> Result<(), String> {
    validate(&config)?;
    let root = Path::new(&root);
    let (yml_path, mut yml) = xtool_yml(root)?;
    yml = yml_set(&yml, "bundleID", &config.bundle_id);
    if yml_get(&yml, "infoPath").is_none() {
        yml = yml_set(&yml, "infoPath", "Info.plist");
    }
    let info_file = info_path(root, &yml)?;
    let mut info = read_dict(&info_file)?;

    let name = config.display_name.trim();
    if name.is_empty() {
        info.remove("CFBundleDisplayName");
    } else {
        info.insert("CFBundleDisplayName".into(), name.into());
    }
    info.insert("CFBundleShortVersionString".into(), config.version.clone().into());
    info.insert("CFBundleVersion".into(), config.build.clone().into());
    let stale: Vec<String> = info.keys().filter(|k| is_permission(k) && !config.permissions.contains_key(*k)).cloned().collect();
    for k in stale {
        info.remove(&k);
    }
    for (k, v) in &config.permissions {
        info.insert(k.clone(), v.trim().into());
    }

    if let Some(parent) = info_file.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Value::Dictionary(info).to_file_xml(&info_file).map_err(|e| e.to_string())?;
    std::fs::write(&yml_path, yml).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn set_project_icon(root: String, png_base64: String) -> Result<String, String> {
    let bytes = B64.decode(png_base64.trim()).map_err(|_| t!("err.imageInvalid"))?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err(t!("err.iconPng"));
    }
    let root = Path::new(&root);
    let (yml_path, yml) = xtool_yml(root)?;
    let rel = yml_get(&yml, "iconPath").unwrap_or_else(|| DEFAULT_ICON.into());
    let path = in_project(root, &rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    if yml_get(&yml, "iconPath").is_none() {
        std::fs::write(&yml_path, yml_set(&yml, "iconPath", &rel)).map_err(|e| e.to_string())?;
    }
    Ok(format!("data:image/png;base64,{}", B64.encode(&bytes)))
}

#[tauri::command(async)]
pub fn read_image_data_url(path: String) -> Result<String, String> {
    data_url(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_stay_inside_the_project() {
        let root = std::env::temp_dir().join(format!("xwc-projcfg-{}", std::process::id()));
        std::fs::create_dir_all(root.join("Resources")).unwrap();
        assert!(in_project(&root, "Resources/AppIcon.png").is_ok());
        assert!(in_project(&root, "Info.plist").is_ok());
        assert!(in_project(&root, "New/Folder/Icon.png").is_ok());
        for bad in ["", "../x.png", "Resources/../../x.png", "C:/Windows/x.png", "C:x.png", "/etc/passwd", "\\\\server\\share\\x.png"] {
            assert!(in_project(&root, bad).is_err(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn yml_roundtrip() {
        let yml = "version: 1\nbundleID: com.example.App\n";
        assert_eq!(yml_get(yml, "bundleID").as_deref(), Some("com.example.App"));
        assert_eq!(yml_get(yml, "iconPath"), None);
        let y2 = yml_set(yml, "bundleID", "com.me.App");
        assert_eq!(y2, "version: 1\nbundleID: com.me.App\n");
        let y3 = yml_set(&y2, "iconPath", "Resources/AppIcon.png");
        assert!(y3.ends_with("iconPath: Resources/AppIcon.png\n"));
        assert_eq!(yml_get("bundleIDs: x\n", "bundleID"), None);
    }

    #[test]
    fn validates() {
        let mut cfg = ProjectConfig {
            bundle_id: "com.me.App".into(),
            display_name: "App".into(),
            version: "1.2.0".into(),
            build: "7".into(),
            permissions: BTreeMap::new(),
            icon: None,
        };
        assert!(validate(&cfg).is_ok());
        cfg.version = "1.x".into();
        assert!(validate(&cfg).is_err());
        cfg.version = "1.0".into();
        cfg.permissions.insert("NSCameraUsageDescription".into(), " ".into());
        assert!(validate(&cfg).is_err());
    }
}
