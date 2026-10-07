use std::path::Path;

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::bridge;
use crate::diagnostics::windows_to_wsl;
use crate::env::{self, sh_quote};
use crate::process::{TaskManager, TaskSpec};
use crate::project::{self, ProjectKind};
use crate::{settings, wsl};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Destination {
    Local,
    AnyIos,
    Device { udid: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildRequest {
    pub root: String,
    pub action: String,
    pub configuration: String,
    pub destination: Destination,
}

pub fn valid_udid(udid: &str) -> bool {
    !udid.is_empty() && udid.len() <= 64 && udid.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

pub fn connection_flag(app: &AppHandle) -> &'static str {
    match settings::load(app).ios_connection.as_str() {
        "usb" => " --usb",
        "network" => " --network",
        _ => "",
    }
}

#[tauri::command]
pub async fn start_build(
    app: AppHandle,
    tasks: State<'_, TaskManager>,
    request: BuildRequest,
) -> Result<u64, String> {
    crate::trust::require(&app, &request.root)?;
    let root = Path::new(&request.root);
    let info = project::inspect(root)?;
    let cfg = match request.configuration.as_str() {
        "release" => "release",
        _ => "debug",
    };

    let spec = if info.kind == ProjectKind::IosApp {
        let device_udid = match &request.destination {
            Destination::Device { udid } if valid_udid(udid) => Some(udid.clone()),
            Destination::Device { .. } => return Err(t!("err.invalidDevice")),
            _ => None,
        };
        let (label, prelude, command) = match request.action.as_str() {
            "build" => (t!("task.build", name = info.name), String::new(), format!("xtool dev build -c {cfg}")),
            "run" => {
                let Some(udid) = device_udid else {
                    return Err(t!("err.runNeedsDevice"));
                };
                let conn = connection_flag(&app);
                (t!("task.runIos", name = info.name), bridge::wsl_prelude()?, format!("xtool dev run -c {cfg} -u {}{conn}", sh_quote(&udid)))
            }
            "archive" => (t!("task.archiveIos", name = info.name), String::new(), "xtool dev build -c release --ipa".to_string()),
            "clean" => (
                t!("task.clean", name = info.name),
                String::new(),
                format!("rm -rf .build xtool && echo {}", sh_quote(&t!("task.cleaned"))),
            ),
            "test" => return Err(t!("err.iosTests")),
            other => return Err(t!("err.unknownAction", action = other)),
        };
        let distro = settings::load(&app).wsl_distro;
        TaskSpec {
            label,
            program: wsl::exe(),
            args: wsl::script_args(&distro, Some(&request.root), &format!("{prelude}{command}")),
            cwd: None,
            display: Some(command),
        }
    } else {
        if !matches!(request.destination, Destination::Local) {
            return Err(t!("err.windowsPackage"));
        }
        let swift = env::which("swift").ok_or_else(|| t!("err.swiftMissing"))?;
        let (label, args): (String, Vec<&str>) = match request.action.as_str() {
            "build" => (t!("task.build", name = info.name), vec!["build", "-c", cfg]),
            "run" => {
                if info.kind == ProjectKind::Library {
                    return Err(t!("err.libraryRun"));
                }
                (t!("task.run", name = info.name), vec!["run", "-c", cfg])
            }
            "test" => (t!("task.test", name = info.name), vec!["test", "-c", cfg]),
            "clean" => (t!("task.clean", name = info.name), vec!["package", "clean"]),
            "archive" => (t!("task.archive", name = info.name), vec!["build", "-c", "release"]),
            other => return Err(t!("err.unknownAction", action = other)),
        };
        TaskSpec {
            label,
            program: swift,
            display: Some(format!("swift {}", args.join(" "))),
            args: args.into_iter().map(String::from).collect(),
            cwd: Some(root.to_path_buf()),
        }
    };

    tasks.spawn(app.clone(), spec).await
}

#[tauri::command]
pub async fn install_app(
    app: AppHandle,
    tasks: State<'_, TaskManager>,
    udid: String,
    path: String,
) -> Result<u64, String> {
    if !valid_udid(&udid) {
        return Err(t!("err.invalidDevice"));
    }
    if !Path::new(&path).exists() {
        return Err(t!("err.fileNotFound"));
    }
    let command = format!("xtool install -u {}{} {}", sh_quote(&udid), connection_flag(&app), sh_quote(&windows_to_wsl(&path)));
    let script = format!("{}{command}", bridge::wsl_prelude()?);
    let distro = settings::load(&app).wsl_distro;
    let name = Path::new(&path).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    tasks
        .spawn(
            app.clone(),
            TaskSpec {
                label: t!("task.install", name = name),
                program: wsl::exe(),
                args: wsl::script_args(&distro, None, &script),
                cwd: None,
                display: Some(command),
            },
        )
        .await
}
