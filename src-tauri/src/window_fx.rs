use std::sync::Mutex;

use tauri::{Manager, WebviewWindow};

pub fn mica_supported() -> bool {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            .and_then(|k| k.get_value::<String, _>("CurrentBuildNumber"))
            .ok()
            .and_then(|b| b.parse::<u32>().ok())
            .map(|b| b >= 22000)
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

pub fn apply(window: &WebviewWindow, material: &str) -> bool {
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::window::{Effect, EffectsBuilder};
    if material == "none" || !mica_supported() {
        let _ = window.set_effects(None::<WindowEffectsConfig>);
        return false;
    }
    let effect = match material {
        "mica-alt" => Effect::Tabbed,
        "acrylic" => Effect::Acrylic,
        _ => Effect::Mica,
    };
    window.set_effects(EffectsBuilder::new().effect(effect).build()).is_ok()
}

pub struct Vibrancy(pub Mutex<bool>);

#[tauri::command]
pub fn vibrancy_supported(app: tauri::AppHandle) -> bool {
    app.try_state::<Vibrancy>().map(|v| *v.0.lock().unwrap()).unwrap_or(false)
}

#[tauri::command]
pub fn set_window_material(window: WebviewWindow, state: tauri::State<'_, Vibrancy>, material: String) -> bool {
    let active = apply(&window, &material);
    *state.0.lock().unwrap() = active;
    active
}

#[tauri::command]
pub fn system_theme() -> String {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let light = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
            .and_then(|k| k.get_value::<u32, _>("AppsUseLightTheme"))
            .map(|v| v != 0)
            .unwrap_or(false);
        if light { "light".into() } else { "dark".into() }
    }
    #[cfg(not(windows))]
    {
        "dark".into()
    }
}

#[tauri::command]
pub fn set_ui_scale(window: WebviewWindow, percent: u32) -> Result<(), String> {
    window.set_zoom(percent.clamp(80, 150) as f64 / 100.0).map_err(|e| e.to_string())
}
