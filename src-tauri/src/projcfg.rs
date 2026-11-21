use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use base64::Engine;
use plist::{Dictionary, Value};
use serde::{Deserialize, Serialize};

const B64: base64::engine::GeneralPurpose = base64::engine::general_purpose::STANDARD;
const DEFAULT_ICON: &str = "Resources/AppIcon.png";
const MAX_IMAGE: u64 = 25 * 1024 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub bundle_id: String,
    pub display_name: String,
    pub version: String,
    pub build: String,
    pub permissions: BTreeMap<String, String>,
    #[serde(default, skip_deserializing)]
    pub icon: Option<String>,
    #[serde(default)]
    pub min_ios: Option<String>,
    #[serde(default)]
    pub devices: Option<String>,
    #[serde(default)]
    pub orientations: Option<Vec<String>>,
    #[serde(default)]
    pub appearance: Option<String>,
    #[serde(default)]
    pub background_modes: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub app_groups: Vec<String>,
    #[serde(default)]
    pub associated_domains: Vec<String>,
}

const ORIENTATIONS: &[(&str, &str)] = &[
    ("portrait", "UIInterfaceOrientationPortrait"),
    ("upsideDown", "UIInterfaceOrientationPortraitUpsideDown"),
    ("landscapeLeft", "UIInterfaceOrientationLandscapeLeft"),
    ("landscapeRight", "UIInterfaceOrientationLandscapeRight"),
];
const BACKGROUND_MODES: &[&str] = &["audio", "location", "fetch", "remote-notification", "bluetooth-central", "processing"];
const CAPABILITIES: &[(&str, &str)] = &[
    ("healthkit", "com.apple.developer.healthkit"),
    ("homekit", "com.apple.developer.homekit"),
    ("push", "aps-environment"),
    ("appleSignIn", "com.apple.developer.applesignin"),
    ("nfc", "com.apple.developer.nfc.readersession.formats"),
];
const APP_GROUPS: &str = "com.apple.security.application-groups";
const DOMAINS: &str = "com.apple.developer.associated-domains";
const DEFAULT_ENTITLEMENTS: &str = "App.entitlements";

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_string().map(str::to_string)).collect())
        .unwrap_or_default()
}

fn string_array(items: &[String]) -> Value {
    Value::Array(items.iter().map(|s| Value::String(s.clone())).collect())
}

fn ios_platform() -> regex::Regex {
    regex::Regex::new(r#"\.iOS\(\s*(?:\.v(\d+)(?:_(\d+))?|"(\d+(?:\.\d+){0,2})")\s*\)"#).expect("static pattern")
}

fn min_ios_of(manifest: &str) -> Option<String> {
    let caps = ios_platform().captures(manifest)?;
    if let Some(text) = caps.get(3) {
        let mut parts = text.as_str().split('.');
        let major = parts.next()?;
        return Some(format!("{major}.{}", parts.next().unwrap_or("0")));
    }
    Some(format!("{}.{}", caps.get(1)?.as_str(), caps.get(2).map_or("0", |m| m.as_str())))
}

fn with_min_ios(manifest: &str, version: &str) -> Option<String> {
    let range = ios_platform().find(manifest)?.range();
    let mut out = manifest.to_string();
    out.replace_range(range, &format!(".iOS(\"{version}\")"));
    Some(out)
}

fn entitlements_path(root: &Path, yml: &str) -> Result<Option<PathBuf>, String> {
    yml_get(yml, "entitlementsPath").map(|rel| in_project(root, &rel)).transpose()
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
    let entitlements = match entitlements_path(root, &yml)? {
        Some(path) => read_dict(&path)?,
        None => Dictionary::new(),
    };
    let devices = info.get("UIDeviceFamily").and_then(Value::as_array).map(|a| {
        let has = |n: u64| a.iter().any(|v| v.as_unsigned_integer() == Some(n));
        match (has(1), has(2)) {
            (true, false) => "iphone",
            (false, true) => "ipad",
            _ => "universal",
        }
        .to_string()
    });
    let orientations = info.get("UISupportedInterfaceOrientations").map(|v| {
        let raw = strings(Some(v));
        ORIENTATIONS.iter().filter(|(_, key)| raw.iter().any(|r| r == key)).map(|(id, _)| id.to_string()).collect()
    });
    let appearance = get("UIUserInterfaceStyle").map(|s| s.to_lowercase()).filter(|s| matches!(s.as_str(), "light" | "dark" | "automatic"));
    Ok(ProjectConfig {
        bundle_id: yml_get(&yml, "bundleID").unwrap_or_default(),
        display_name: get("CFBundleDisplayName").unwrap_or_default(),
        version: get("CFBundleShortVersionString").unwrap_or_else(|| "1.0".into()),
        build: get("CFBundleVersion").unwrap_or_else(|| "1".into()),
        permissions,
        icon,
        min_ios: std::fs::read_to_string(root.join("Package.swift")).ok().and_then(|m| min_ios_of(&m)),
        devices,
        orientations,
        appearance,
        background_modes: strings(info.get("UIBackgroundModes")),
        capabilities: CAPABILITIES.iter().filter(|(_, key)| entitlements.contains_key(key)).map(|(id, _)| id.to_string()).collect(),
        app_groups: strings(entitlements.get(APP_GROUPS)),
        associated_domains: strings(entitlements.get(DOMAINS)),
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
    if let Some(v) = &cfg.min_ios {
        let mut parts = v.split('.');
        let major = parts.next().and_then(|p| p.parse::<u32>().ok()).filter(|n| (13..=40).contains(n));
        let minor = parts.next().map_or(Some(0), |p| p.parse::<u32>().ok().filter(|n| *n < 20));
        if major.is_none() || minor.is_none() || parts.next().is_some() {
            return Err(t!("err.minIosInvalid"));
        }
    }
    if cfg.devices.as_deref().is_some_and(|d| !matches!(d, "iphone" | "ipad" | "universal")) {
        return Err(t!("err.settingInvalid"));
    }
    if cfg.appearance.as_deref().is_some_and(|a| !matches!(a, "light" | "dark" | "automatic")) {
        return Err(t!("err.settingInvalid"));
    }
    if let Some(list) = &cfg.orientations {
        if list.is_empty() {
            return Err(t!("err.orientationNeeded"));
        }
        if list.iter().any(|o| !ORIENTATIONS.iter().any(|(id, _)| id == o)) {
            return Err(t!("err.settingInvalid"));
        }
    }
    if cfg.capabilities.iter().any(|c| !CAPABILITIES.iter().any(|(id, _)| id == c)) {
        return Err(t!("err.settingInvalid"));
    }
    let plain = |s: &String| !s.is_empty() && s.len() <= 200 && s.chars().all(|c| c.is_ascii_graphic());
    if cfg.background_modes.iter().any(|m| !plain(m)) {
        return Err(t!("err.settingInvalid"));
    }
    if let Some(bad) = cfg.app_groups.iter().find(|g| !plain(g) || !g.starts_with("group.") || g.len() < 7) {
        return Err(t!("err.appGroupInvalid", group = bad));
    }
    if let Some(bad) = cfg.associated_domains.iter().find(|d| !plain(d) || !d.contains(':') || d.ends_with(':')) {
        return Err(t!("err.domainInvalid", domain = bad));
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
    if let Some(devices) = &config.devices {
        let family: &[u64] = match devices.as_str() {
            "iphone" => &[1],
            "ipad" => &[2],
            _ => &[1, 2],
        };
        info.insert("UIDeviceFamily".into(), Value::Array(family.iter().map(|n| Value::Integer((*n).into())).collect()));
    }
    if let Some(list) = &config.orientations {
        let keys: Vec<String> = ORIENTATIONS.iter().filter(|(id, _)| list.iter().any(|o| o == id)).map(|(_, key)| key.to_string()).collect();
        info.insert("UISupportedInterfaceOrientations".into(), string_array(&keys));
    }
    match config.appearance.as_deref() {
        Some("light") => drop(info.insert("UIUserInterfaceStyle".into(), "Light".into())),
        Some("dark") => drop(info.insert("UIUserInterfaceStyle".into(), "Dark".into())),
        Some(_) => drop(info.remove("UIUserInterfaceStyle")),
        None => {}
    }
    let mut modes: Vec<String> = strings(info.get("UIBackgroundModes")).into_iter().filter(|m| !BACKGROUND_MODES.contains(&m.as_str())).collect();
    modes.extend(BACKGROUND_MODES.iter().filter(|m| config.background_modes.iter().any(|c| c == *m)).map(|m| m.to_string()));
    modes.extend(config.background_modes.iter().filter(|m| !BACKGROUND_MODES.contains(&m.as_str()) && !modes.contains(m)).cloned().collect::<Vec<_>>());
    if modes.is_empty() {
        info.remove("UIBackgroundModes");
    } else {
        info.insert("UIBackgroundModes".into(), string_array(&modes));
    }

    let existing = entitlements_path(root, &yml)?;
    let mut entitlements = match &existing {
        Some(path) => read_dict(path)?,
        None => Dictionary::new(),
    };
    let before = entitlements.clone();
    for (id, key) in CAPABILITIES {
        let wanted = config.capabilities.iter().any(|c| c == id);
        if !wanted {
            entitlements.remove(key);
        } else if !entitlements.contains_key(key) {
            let value = match *id {
                "push" => Value::String("development".into()),
                "appleSignIn" => string_array(&["Default".to_string()]),
                "nfc" => string_array(&["TAG".to_string()]),
                _ => Value::Boolean(true),
            };
            entitlements.insert((*key).into(), value);
        }
    }
    for (key, list) in [(APP_GROUPS, &config.app_groups), (DOMAINS, &config.associated_domains)] {
        if list.is_empty() {
            entitlements.remove(key);
        } else {
            entitlements.insert(key.into(), string_array(list));
        }
    }
    if entitlements != before {
        let path = match existing {
            Some(path) => path,
            None => {
                yml = yml_set(&yml, "entitlementsPath", DEFAULT_ENTITLEMENTS);
                in_project(root, DEFAULT_ENTITLEMENTS)?
            }
        };
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        Value::Dictionary(entitlements).to_file_xml(&path).map_err(|e| e.to_string())?;
    }

    if let Some(version) = &config.min_ios {
        let manifest_path = root.join("Package.swift");
        if let Ok(manifest) = std::fs::read_to_string(&manifest_path) {
            if min_ios_of(&manifest).as_deref() != Some(version.as_str()) {
                if let Some(next) = with_min_ios(&manifest, version) {
                    std::fs::write(&manifest_path, next).map_err(|e| e.to_string())?;
                }
            }
        }
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
    fn reads_and_rewrites_the_ios_platform() {
        let dot = "let package = Package(\n    name: \"App\",\n    platforms: [.iOS(.v17)],\n    targets: []\n)\n";
        assert_eq!(min_ios_of(dot).as_deref(), Some("17.0"));
        assert_eq!(min_ios_of("platforms: [.iOS(.v16_4), .macOS(.v13)]").as_deref(), Some("16.4"));
        assert_eq!(min_ios_of("platforms: [ .iOS( \"18.2\" ) ]").as_deref(), Some("18.2"));
        assert_eq!(min_ios_of("platforms: [.macOS(.v13)]"), None);
        let next = with_min_ios(dot, "18.0").unwrap();
        assert!(next.contains("platforms: [.iOS(\"18.0\")],"));
        assert_eq!(min_ios_of(&next).as_deref(), Some("18.0"));
        assert!(with_min_ios("no platforms here", "18.0").is_none());
    }

    #[test]
    fn deployment_and_capabilities_round_trip() {
        let root = std::env::temp_dir().join(format!("xwc-projcfg-caps-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("xtool.yml"), "version: 1\nbundleID: com.example.App\n").unwrap();
        std::fs::write(root.join("Package.swift"), "platforms: [.iOS(.v17)],\n").unwrap();
        let path = root.to_string_lossy().to_string();

        let fresh = read_project_config(path.clone()).unwrap();
        assert_eq!(fresh.min_ios.as_deref(), Some("17.0"));
        assert!(fresh.devices.is_none() && fresh.orientations.is_none() && fresh.appearance.is_none());
        assert!(fresh.capabilities.is_empty() && fresh.background_modes.is_empty());

        let mut wanted = fresh;
        wanted.min_ios = Some("18.0".into());
        wanted.devices = Some("iphone".into());
        wanted.orientations = Some(vec!["portrait".into(), "landscapeLeft".into()]);
        wanted.appearance = Some("dark".into());
        wanted.background_modes = vec!["audio".into(), "bluetooth-central".into()];
        wanted.capabilities = vec!["healthkit".into(), "push".into()];
        wanted.app_groups = vec!["group.com.example.shared".into()];
        write_project_config(path.clone(), wanted).unwrap();

        let saved = read_project_config(path.clone()).unwrap();
        assert_eq!(saved.min_ios.as_deref(), Some("18.0"));
        assert_eq!(saved.devices.as_deref(), Some("iphone"));
        assert_eq!(saved.orientations, Some(vec!["portrait".to_string(), "landscapeLeft".to_string()]));
        assert_eq!(saved.appearance.as_deref(), Some("dark"));
        assert_eq!(saved.background_modes, vec!["audio".to_string(), "bluetooth-central".to_string()]);
        assert_eq!(saved.capabilities, vec!["healthkit".to_string(), "push".to_string()]);
        assert_eq!(saved.app_groups, vec!["group.com.example.shared".to_string()]);
        let yml = std::fs::read_to_string(root.join("xtool.yml")).unwrap();
        assert!(yml.contains("entitlementsPath: App.entitlements"));
        assert!(root.join("App.entitlements").is_file());

        let mut cleared = saved;
        cleared.capabilities.clear();
        cleared.app_groups.clear();
        cleared.background_modes.clear();
        cleared.appearance = Some("automatic".into());
        write_project_config(path.clone(), cleared).unwrap();
        let empty = read_project_config(path.clone()).unwrap();
        assert!(empty.capabilities.is_empty() && empty.app_groups.is_empty() && empty.background_modes.is_empty());
        assert!(empty.appearance.is_none());

        let mut bad = empty;
        bad.orientations = Some(vec![]);
        assert!(write_project_config(path.clone(), bad).is_err());
        let mut group = read_project_config(path.clone()).unwrap();
        group.app_groups = vec!["com.example.nogroup".into()];
        assert!(write_project_config(path, group).is_err());
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
            ..Default::default()
        };
        assert!(validate(&cfg).is_ok());
        cfg.version = "1.x".into();
        assert!(validate(&cfg).is_err());
        cfg.version = "1.0".into();
        cfg.permissions.insert("NSCameraUsageDescription".into(), " ".into());
        assert!(validate(&cfg).is_err());
    }
}
