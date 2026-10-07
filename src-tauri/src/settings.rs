use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub recent_projects: Vec<RecentProject>,
    pub wsl_distro: Option<String>,
    pub editor_font_size: u32,
    pub minimap: bool,
    pub word_wrap: bool,
    pub auto_save: bool,
    pub organization_id: String,
    pub theme: String,
    pub language: String,
    pub material: String,
    pub ui_scale: u32,
    pub reduce_motion: bool,
    pub reopen_last_project: bool,
    pub projects_dir: Option<String>,

    pub editor_theme: String,
    pub editor_font: String,
    pub editor_line_height: f32,
    pub font_ligatures: bool,
    pub tab_size: u32,
    pub insert_spaces: bool,
    pub line_numbers: bool,
    pub indent_guides: bool,
    pub sticky_scroll: bool,
    pub smooth_caret: bool,
    pub cursor_style: String,
    pub format_on_save: bool,

    pub terminal_shell: String,
    pub terminal_font_size: u32,
    pub terminal_cursor_blink: bool,

    pub default_configuration: String,
    pub clear_console_on_build: bool,
    pub show_build_hud: bool,
    pub auto_show_debug: bool,

    pub warm_wsl: bool,
    pub ios_connection: String,
    pub auto_update: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            recent_projects: vec![],
            wsl_distro: None,
            editor_font_size: 13,
            minimap: false,
            word_wrap: false,
            auto_save: true,
            organization_id: "com.example".into(),
            theme: "system".into(),
            language: "system".into(),
            material: "mica".into(),
            ui_scale: 100,
            reduce_motion: false,
            reopen_last_project: false,
            projects_dir: None,
            editor_theme: "mono".into(),
            editor_font: "geist-mono".into(),
            editor_line_height: 1.6,
            font_ligatures: true,
            tab_size: 4,
            insert_spaces: true,
            line_numbers: true,
            indent_guides: true,
            sticky_scroll: true,
            smooth_caret: true,
            cursor_style: "line".into(),
            format_on_save: true,
            terminal_shell: "auto".into(),
            terminal_font_size: 12,
            terminal_cursor_blink: true,
            default_configuration: "debug".into(),
            clear_console_on_build: false,
            show_build_hud: true,
            auto_show_debug: true,
            warm_wsl: true,
            ios_connection: "auto".into(),
            auto_update: true,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn store(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

pub fn push_recent(app: &AppHandle, entry: RecentProject) {
    let mut s = load(app);
    s.recent_projects.retain(|r| !r.path.eq_ignore_ascii_case(&entry.path));
    s.recent_projects.insert(0, entry);
    s.recent_projects.truncate(12);
    let _ = store(app, &s);
}

#[tauri::command]
pub fn get_settings(app: AppHandle) -> Settings {
    let mut s = load(&app);
    s.recent_projects.retain(|r| std::path::Path::new(&r.path).exists());
    s
}

#[tauri::command]
pub fn save_settings(app: AppHandle, mut settings: Settings) -> Result<(), String> {
    if settings.wsl_distro.as_deref().is_some_and(|d| !crate::wsl::valid_distro(d)) {
        settings.wsl_distro = None;
    }
    store(&app, &settings)
}

#[tauri::command]
pub fn remove_recent(app: AppHandle, path: String) -> Result<(), String> {
    let mut s = load(&app);
    s.recent_projects.retain(|r| !r.path.eq_ignore_ascii_case(&path));
    store(&app, &s)
}
