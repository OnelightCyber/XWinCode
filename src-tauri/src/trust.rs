use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use crate::settings;

static LOCK: Mutex<()> = Mutex::new(());

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("trusted-projects.json"))
}

fn key(root: &str) -> String {
    let path = std::fs::canonicalize(root).unwrap_or_else(|_| PathBuf::from(root));
    path.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase()
}

fn save(app: &AppHandle, roots: &[String]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(roots).map_err(|e| e.to_string())?;
    std::fs::write(store_path(app)?, json).map_err(|e| e.to_string())
}

fn load(app: &AppHandle) -> Vec<String> {
    store_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn init(app: &AppHandle) {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    if store_path(app).is_ok_and(|p| !p.exists()) {
        let known: Vec<String> = settings::load(app).recent_projects.iter().map(|r| key(&r.path)).collect();
        let _ = save(app, &known);
    }
}

pub fn is_trusted(app: &AppHandle, root: &str) -> bool {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let k = key(root);
    load(app).iter().any(|r| *r == k)
}

pub fn trust(app: &AppHandle, root: &str) -> Result<(), String> {
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let k = key(root);
    let mut roots = load(app);
    if !roots.contains(&k) {
        roots.push(k);
        save(app, &roots)?;
    }
    Ok(())
}

pub fn require(app: &AppHandle, root: &str) -> Result<(), String> {
    if is_trusted(app, root) {
        Ok(())
    } else {
        Err(t!("err.untrusted"))
    }
}

#[tauri::command(async)]
pub fn project_trusted(app: AppHandle, root: String) -> bool {
    is_trusted(&app, &root)
}

#[tauri::command(async)]
pub fn trust_project(app: AppHandle, root: String) -> Result<(), String> {
    if !Path::new(&root).is_dir() {
        return Err(t!("err.fileNotFound"));
    }
    trust(&app, &root)
}

#[cfg(test)]
mod tests {
    use super::key;

    #[test]
    fn keys_ignore_case_and_trailing_separators() {
        assert_eq!(key(r"Z:\No Such\Project\"), key(r"z:\no such\project"));
        assert_ne!(key(r"Z:\No Such\Project"), key(r"Z:\No Such\Project2"));
    }
}
