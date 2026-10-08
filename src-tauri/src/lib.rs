#[macro_use]
mod i18n;
mod bridge;
mod builder;
mod capture;
mod dap;
mod device;
mod diagnostics;
mod env;
mod fsops;
mod idevice;
mod installs;
mod lsp;
mod preview;
mod process;
mod projcfg;
mod project;
mod pty;
mod settings;
mod toolchain;
mod trust;
mod window_fx;
mod wsl;

pub fn usbmux_stdio() -> i32 {
    bridge::usbmux_stdio()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn is_app_url(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost") || (cfg!(debug_assertions) && url.host_str() == Some("localhost") && url.port() == Some(1420))
        }
        "about" => url.as_str() == "about:blank",
        _ => false,
    }
}

fn navigation_guard() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry, ()>::new("navigation-guard")
        .on_navigation(|webview, url| {
            if is_app_url(url) {
                return true;
            }
            if matches!(url.scheme(), "http" | "https") {
                use tauri_plugin_opener::OpenerExt;
                let _ = webview.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()
}

fn shutdown(app: &tauri::AppHandle) {
    use tauri::Manager;
    app.state::<process::TaskManager>().stop();
    pty::shutdown(app);
    tauri::async_runtime::block_on(async {
        idevice::shutdown(app).await;
        lsp::shutdown(app).await;
        preview::shutdown(app).await;
        dap::shutdown(app).await;
        capture::shutdown(app).await;
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(navigation_guard())
        .manage(process::TaskManager::default())
        .manage(pty::PtyState::default())
        .manage(lsp::LspState::default())
        .manage(idevice::DeviceLogState::default())
        .manage(preview::PreviewState::default())
        .manage(dap::DapState::default())
        .manage(capture::CaptureState::default())
        .setup(|app| {
            use tauri::Manager;
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let prefs = settings::load(app.handle());
            i18n::set(&prefs.language);
            trust::init(app.handle());
            let mut vibrant = false;
            if let Some(w) = app.get_webview_window("main") {
                vibrant = window_fx::apply(&w, &prefs.material);
                if prefs.ui_scale != 100 {
                    let _ = w.set_zoom(prefs.ui_scale.clamp(80, 150) as f64 / 100.0);
                }
            }
            app.manage(window_fx::Vibrancy(std::sync::Mutex::new(vibrant)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            i18n::set_language,
            fsops::read_dir,
            fsops::read_text_file,
            fsops::write_text_file,
            fsops::create_file,
            fsops::create_dir,
            fsops::rename_path,
            fsops::delete_path,
            fsops::path_exists,
            fsops::search_project,
            fsops::replace_in_file,
            fsops::list_files,
            project::create_project,
            project::open_project,
            project::default_projects_dir,
            projcfg::read_project_config,
            projcfg::write_project_config,
            projcfg::set_project_icon,
            projcfg::read_image_data_url,
            trust::project_trusted,
            trust::trust_project,
            settings::get_settings,
            settings::save_settings,
            settings::remove_recent,
            toolchain::check_toolchain,
            toolchain::run_fix_action,
            toolchain::run_setup_task,
            toolchain::install_sdk,
            wsl::list_wsl_distros,
            wsl::wsl_warmup,
            device::list_devices,
            bridge::wsl_device_check,
            idevice::device_log_start,
            idevice::device_log_stop,
            idevice::device_apps,
            idevice::device_app_action,
            installs::list_installs,
            installs::record_install,
            installs::forget_install,
            builder::start_build,
            builder::install_app,
            process::stop_task,
            process::send_task_input,
            window_fx::vibrancy_supported,
            window_fx::set_window_material,
            window_fx::set_ui_scale,
            window_fx::system_theme,
            quit_app,
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            preview::preview_prepare,
            preview::preview_connect,
            preview::preview_send,
            preview::preview_disconnect,
            capture::iphone_screenshot,
            dap::dap_start,
            dap::dap_send,
            dap::dap_stop,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start XWinCode")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                shutdown(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::is_app_url;

    #[test]
    fn only_the_app_origin_is_navigable() {
        let ok = |u: &str| is_app_url(&u.parse().unwrap());
        assert!(ok("http://tauri.localhost/"));
        assert!(ok("https://tauri.localhost/index.html"));
        assert!(ok("tauri://localhost/"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("http://tauri.localhost.example.com/"));
        assert!(!ok("http://localhost:8080/"));
        assert!(!ok("file:///C:/Windows/win.ini"));
        assert!(!ok("javascript:alert(1)"));
        assert!(!ok("data:text/html,hi"));
    }
}
