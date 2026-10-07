use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::diagnostics::windows_to_wsl;
use crate::env::sh_quote;
use crate::process::{TaskManager, TaskSpec};
use crate::{bridge, env, settings, wsl};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    id: &'static str,
    label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    id: &'static str,
    name: String,
    group: &'static str,
    status: &'static str,
    version: Option<String>,
    detail: String,
    actions: Vec<Action>,
}

fn action(id: &'static str, label: String) -> Action {
    Action { id, label }
}

fn first_match(text: &str, pattern: &str) -> Option<String> {
    regex::Regex::new(pattern).ok()?.captures(text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
}

fn ps_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if matches!(c, '\'' | '\u{2018}' | '\u{2019}' | '\u{201A}' | '\u{201B}') {
            out.push(c);
        }
        out.push(c);
    }
    out.push('\'');
    out
}

fn win_quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    let mut out = String::from('"');
    let mut slashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => slashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(slashes));
                out.push(c);
                slashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(slashes * 2));
    out.push('"');
    out
}

fn powershell_exe() -> std::path::PathBuf {
    env::system_exe(r"WindowsPowerShell\v1.0\powershell.exe")
}

async fn check_swift() -> Component {
    let Some(swift) = env::which("swift") else {
        return Component {
            id: "swift",
            name: t!("tool.swift.name"),
            group: "windows",
            status: "missing",
            version: None,
            detail: t!("tool.swift.missing"),
            actions: vec![action("install-swift", t!("tool.action.installWinget"))],
        };
    };
    let version = env::capture(&swift, &["--version"], 30)
        .await
        .ok()
        .and_then(|(_, out, err)| first_match(&format!("{out}{err}"), r"Swift version ([0-9][\w.\-]*)"));
    Component {
        id: "swift",
        name: t!("tool.swift.name"),
        group: "windows",
        status: if version.is_some() { "ok" } else { "warning" },
        version,
        detail: swift.to_string_lossy().to_string(),
        actions: vec![],
    }
}

async fn check_msvc() -> Component {
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| "C:\\Program Files (x86)".into());
    let vswhere = PathBuf::from(pf86).join("Microsoft Visual Studio").join("Installer").join("vswhere.exe");
    let found = if vswhere.is_file() {
        env::capture(
            &vswhere,
            &["-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-latest", "-property", "displayName"],
            20,
        )
        .await
        .ok()
        .map(|(_, out, _)| out.trim().to_string())
        .filter(|s| !s.is_empty())
    } else {
        None
    };
    let name = t!("tool.msvc.name");
    match found {
        Some(display) => Component { id: "msvc", name, group: "windows", status: "ok", version: None, detail: display, actions: vec![] },
        None => Component {
            id: "msvc",
            name,
            group: "windows",
            status: "missing",
            version: None,
            detail: t!("tool.msvc.missing"),
            actions: vec![action("install-msvc", t!("tool.action.installBuildTools"))],
        },
    }
}

fn check_sourcekit() -> Component {
    match env::which("sourcekit-lsp") {
        Some(p) => Component {
            id: "sourcekit",
            name: "SourceKit-LSP".into(),
            group: "windows",
            status: "ok",
            version: None,
            detail: p.to_string_lossy().to_string(),
            actions: vec![],
        },
        None => Component {
            id: "sourcekit",
            name: "SourceKit-LSP".into(),
            group: "windows",
            status: "warning",
            version: None,
            detail: t!("tool.sourcekit.missing"),
            actions: vec![],
        },
    }
}

async fn check_apple_devices() -> Component {
    if bridge::windows_usbmuxd_available().await {
        Component {
            id: "appleDevices",
            name: "Apple Mobile Device".into(),
            group: "ios",
            status: "ok",
            version: None,
            detail: t!("tool.appleDevices.ok"),
            actions: vec![],
        }
    } else {
        Component {
            id: "appleDevices",
            name: "Apple Mobile Device".into(),
            group: "ios",
            status: "missing",
            version: None,
            detail: t!("tool.appleDevices.missing"),
            actions: vec![action("install-apple-devices", t!("tool.action.openStore"))],
        }
    }
}

async fn check_wsl_stack(distro: &Option<String>) -> Vec<Component> {
    let distros = wsl::list_distros().await;
    let wsl_name = t!("tool.wsl.name");
    let wsl_component = match &distros {
        Ok(list) if !list.is_empty() => Component {
            id: "wsl",
            name: wsl_name,
            group: "ios",
            status: "ok",
            version: distro.clone().or_else(|| list.first().cloned()),
            detail: t!("tool.wsl.ok", list = list.join(", ")),
            actions: vec![],
        },
        Ok(_) => Component {
            id: "wsl",
            name: wsl_name,
            group: "ios",
            status: "missing",
            version: None,
            detail: t!("tool.wsl.noDistro"),
            actions: vec![action("install-wsl", t!("tool.action.installUbuntu"))],
        },
        Err(e) => Component {
            id: "wsl",
            name: wsl_name,
            group: "ios",
            status: "missing",
            version: None,
            detail: e.clone(),
            actions: vec![action("install-wsl", t!("tool.action.installWsl"))],
        },
    };
    let wsl_ok = wsl_component.status == "ok";
    let mut out = vec![wsl_component];

    let probe = if wsl_ok {
        let script = "swift --version 2>&1 | head -1 | sed 's/^/SWIFT=/'; \
            command -v socat >/dev/null 2>&1 && echo SOCAT=1 || echo SOCAT=0; \
            command -v idevicesyslog >/dev/null 2>&1 && command -v ideviceinstaller >/dev/null 2>&1 && echo IMD=1 || echo IMD=0; \
            if command -v xtool >/dev/null 2>&1; then echo XTOOL=1; \
            xtool sdk status 2>&1 | head -1 | sed 's/^/SDK=/'; \
            xtool auth status 2>&1 | head -1 | sed 's/^/AUTH=/'; \
            else echo XTOOL=0; fi";
        wsl::run(distro, script, 60).await.map(|(_, out, _)| out).unwrap_or_default()
    } else {
        String::new()
    };
    let field = |key: &str| probe.lines().find_map(|l| l.strip_prefix(&format!("{key}=")).map(|v| v.trim().to_string()));

    let swift_version = field("SWIFT").and_then(|s| first_match(&s, r"Swift version ([0-9][\w.\-]*)"));
    let has_socat = field("SOCAT").as_deref() == Some("1");
    let swift_ok = swift_version.is_some() && has_socat;
    out.push(Component {
        id: "wslSwift",
        name: t!("tool.wslSwift.name"),
        group: "ios",
        status: if swift_ok { "ok" } else { "missing" },
        detail: if !wsl_ok {
            t!("tool.needsWsl")
        } else if swift_ok {
            t!("tool.wslSwift.ok")
        } else if swift_version.is_some() {
            t!("tool.wslSwift.noSocat")
        } else {
            t!("tool.wslSwift.missing")
        },
        version: swift_version,
        actions: if wsl_ok {
            vec![action("install-wsl-swift", if swift_ok { t!("tool.action.reinstall") } else { t!("tool.action.install") })]
        } else {
            vec![]
        },
    });

    let has_xtool = field("XTOOL").as_deref() == Some("1");
    out.push(Component {
        id: "xtool",
        name: "xtool".into(),
        group: "ios",
        status: if has_xtool { "ok" } else { "missing" },
        version: None,
        detail: if !wsl_ok {
            t!("tool.needsWsl")
        } else if has_xtool {
            t!("tool.xtool.ok")
        } else {
            t!("tool.xtool.missing")
        },
        actions: if wsl_ok {
            vec![action("install-xtool", if has_xtool { t!("tool.action.update") } else { t!("tool.action.install") })]
        } else {
            vec![]
        },
    });

    let has_imd = field("IMD").as_deref() == Some("1");
    out.push(Component {
        id: "imobiledevice",
        name: t!("tool.imd.name"),
        group: "ios",
        status: if has_imd { "ok" } else { "warning" },
        version: None,
        detail: if !wsl_ok {
            t!("tool.needsWsl")
        } else if has_imd {
            t!("tool.imd.ok")
        } else {
            t!("tool.imd.missing")
        },
        actions: if wsl_ok && !has_imd { vec![action("install-imobiledevice", t!("tool.action.install"))] } else { vec![] },
    });

    let sdk_line = field("SDK").unwrap_or_default();
    let sdk_ok = sdk_line.contains("is installed");
    out.push(Component {
        id: "darwinSdk",
        name: t!("tool.sdk.name"),
        group: "ios",
        status: if sdk_ok { "ok" } else { "missing" },
        version: None,
        detail: if !has_xtool {
            t!("tool.needsXtool")
        } else if sdk_ok {
            t!("tool.sdk.ok")
        } else {
            t!("tool.sdk.missing")
        },
        actions: if has_xtool {
            vec![action("open-xcode-download", t!("tool.action.downloadXcode")), action("install-sdk", t!("tool.action.chooseXip"))]
        } else {
            vec![]
        },
    });

    let auth_ok = field("AUTH").map(|s| s.starts_with("Logged in")).unwrap_or(false);
    out.push(Component {
        id: "appleId",
        name: t!("tool.appleId.name"),
        group: "ios",
        status: if auth_ok { "ok" } else { "missing" },
        version: None,
        detail: if !has_xtool {
            t!("tool.needsXtool")
        } else if auth_ok {
            t!("tool.appleId.ok")
        } else {
            t!("tool.appleId.missing")
        },
        actions: if has_xtool { vec![action("xtool-login", t!("tool.action.signIn"))] } else { vec![] },
    });
    out
}

#[tauri::command]
pub async fn check_toolchain(app: AppHandle) -> Result<Vec<Component>, String> {
    let distro = settings::load(&app).wsl_distro;
    let (swift, msvc, apple, wsl_stack) =
        tokio::join!(check_swift(), check_msvc(), check_apple_devices(), check_wsl_stack(&distro));
    let mut all = vec![swift, msvc, check_sourcekit(), apple];
    all.extend(wsl_stack);
    Ok(all)
}

fn ps_wrap(script: &str) -> String {
    format!(
        "$Host.UI.RawUI.WindowTitle = 'XWinCode'; Write-Host {} -ForegroundColor Cyan; {script}; Write-Host ''; Write-Host {} -ForegroundColor Green",
        ps_quote(&t!("setup.banner")),
        ps_quote(&t!("setup.done"))
    )
}

fn open_console(program: &std::path::Path, args: &[String]) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut launcher = format!("Start-Process -FilePath {}", ps_quote(&program.to_string_lossy()));
        if !args.is_empty() {
            let line: Vec<String> = args.iter().map(|a| win_quote(a)).collect();
            launcher.push_str(&format!(" -ArgumentList {}", ps_quote(&line.join(" "))));
        }
        std::process::Command::new(powershell_exe())
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", &env::ps_encode(&launcher)])
            .envs(env::fresh_env())
            .creation_flags(env::CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = (program, args);
        Err(t!("err.windowsOnly"))
    }
}

fn open_powershell(script: &str) -> Result<(), String> {
    let full = ps_wrap(script);
    open_console(&powershell_exe(), &["-NoExit".into(), "-NoProfile".into(), "-EncodedCommand".into(), env::ps_encode(&full)])
}

fn open_elevated_powershell(script: &str) -> Result<(), String> {
    let full = ps_wrap(script);
    let launcher = format!(
        "Start-Process -FilePath {} -Verb RunAs -ArgumentList '-NoExit','-NoProfile','-EncodedCommand','{}'",
        ps_quote(&powershell_exe().to_string_lossy()),
        env::ps_encode(&full)
    );
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(powershell_exe())
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", &env::ps_encode(&launcher)])
            .creation_flags(env::CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = launcher;
        Err(t!("err.windowsOnly"))
    }
}

fn open_wsl_terminal(distro: &Option<String>, script: &str) -> Result<(), String> {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let full = format!(
        "rm -f \"$0\"\nprintf '\\033]0;XWinCode\\007\\033[36m%s\\033[0m\\n' 'XWinCode — WSL'\n{script}\necho\nprintf '\\033[32m%s\\033[0m\\n' {}\nexec bash -l\n",
        sh_quote(&t!("setup.terminalDone"))
    );
    let dir = std::env::temp_dir().join("xwincode");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("term-{}-{}.sh", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    std::fs::write(&file, full).map_err(|e| e.to_string())?;
    let mut args = wsl::distro_args(distro);
    args.extend(["-e".into(), "bash".into(), "-l".into(), windows_to_wsl(&file.to_string_lossy())]);
    open_console(&wsl::exe(), &args)
}

fn fill_messages(script: &str) -> String {
    script
        .replace("@NO_USER@", &sh_quote(&format!("error: {}", t!("setup.noLinuxUser"))))
        .replace("@APT@", &sh_quote(&format!("▸ {}", t!("setup.apt"))))
        .replace("@SWIFTLY@", &sh_quote(&format!("▸ {}", t!("setup.swiftly"))))
        .replace("@SWIFT_READY@", &sh_quote(&format!("▸ {}", t!("setup.swiftReady"))))
        .replace("@XTOOL_DOWNLOAD@", &sh_quote(&format!("▸ {}", t!("setup.xtoolDownload"))))
        .replace("@XTOOL_READY@", &sh_quote(&format!("▸ {}", t!("setup.xtoolReady"))))
        .replace("@IMD_READY@", &sh_quote(&format!("▸ {}", t!("setup.imdReady"))))
}

const SETUP_SWIFT: &str = r#"set -e
export DEBIAN_FRONTEND=noninteractive
U=$(getent passwd 1000 | cut -d: -f1)
[ -n "$U" ] || { echo @NO_USER@; exit 1; }
echo @APT@
apt-get update -q
apt-get install -y -q --no-install-recommends ca-certificates curl binutils git gnupg2 libc6-dev \
  libcurl4-openssl-dev libedit2 libncurses-dev libpython3-dev libsqlite3-0 libxml2-dev libz3-dev \
  pkg-config tzdata unzip zip zlib1g-dev socat
apt-get install -y -q --no-install-recommends libgcc-13-dev libstdc++-13-dev 2>/dev/null || true
echo @SWIFTLY@
runuser -l "$U" -c 'set -e; cd ~; curl -fsSLO "https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz"; tar zxf "swiftly-$(uname -m).tar.gz"; ./swiftly init --quiet-shell-followup --assume-yes; . "${SWIFTLY_HOME_DIR:-$HOME/.local/share/swiftly}/env.sh"; swift --version'
echo @SWIFT_READY@
"#;

const SETUP_XTOOL: &str = r#"set -e
export DEBIAN_FRONTEND=noninteractive
U=$(getent passwd 1000 | cut -d: -f1)
[ -n "$U" ] || { echo @NO_USER@; exit 1; }
echo @APT@
apt-get install -y -q socat zip libimobiledevice-utils ideviceinstaller
apt-get install -y -q libfuse2t64 2>/dev/null || apt-get install -y -q libfuse2
echo @XTOOL_DOWNLOAD@
runuser -l "$U" -c 'set -e; mkdir -p ~/.local/bin; curl -fsSL -o ~/.local/bin/xtool "https://github.com/xtool-org/xtool/releases/latest/download/xtool-$(uname -m).AppImage"; chmod +x ~/.local/bin/xtool; ~/.local/bin/xtool --version'
echo @XTOOL_READY@
"#;

const SETUP_IMOBILEDEVICE: &str = r#"set -e
export DEBIAN_FRONTEND=noninteractive
echo @APT@
apt-get update -q
apt-get install -y -q libimobiledevice-utils ideviceinstaller
echo @IMD_READY@
"#;

fn xtool_login_script() -> String {
    [t!("setup.login1"), t!("setup.login2"), t!("setup.login3")]
        .iter()
        .map(|l| format!("echo {}", sh_quote(l)))
        .chain(["echo".to_string(), "xtool auth login".to_string()])
        .collect::<Vec<_>>()
        .join("\n")
}

fn install_wsl_script() -> String {
    format!(
        "wsl.exe --install --no-distribution; \
$best = Get-Volume | Where-Object {{ $_.DriveType -eq 'Fixed' -and $_.DriveLetter }} | Sort-Object SizeRemaining -Descending | Select-Object -First 1; \
$dir = \"$($best.DriveLetter):\\WSL\\Ubuntu-24.04\"; \
Write-Host ({} + ' ' + $dir) -ForegroundColor Cyan; \
New-Item -ItemType Directory -Force (Split-Path $dir) | Out-Null; \
wsl.exe --install -d Ubuntu-24.04 --location $dir; \
Write-Host {}",
        ps_quote(&t!("setup.ubuntuLocation")),
        ps_quote(&t!("setup.createLinuxUser"))
    )
}

async fn spawn_setup(app: &AppHandle, tasks: &TaskManager, label: String, display: &str, args: Vec<String>) -> Result<u64, String> {
    tasks.spawn(app.clone(), TaskSpec { label, program: wsl::exe(), args, cwd: None, display: Some(display.into()) }).await
}

#[tauri::command]
pub async fn run_setup_task(app: AppHandle, tasks: State<'_, TaskManager>, id: String) -> Result<u64, String> {
    let distro = settings::load(&app).wsl_distro;
    match id.as_str() {
        "install-wsl-swift" => {
            let args = wsl::root_script_args(&distro, &fill_messages(SETUP_SWIFT));
            spawn_setup(&app, &tasks, t!("task.installWslSwift"), "apt + swiftly (WSL)", args).await
        }
        "install-xtool" => {
            let args = wsl::root_script_args(&distro, &fill_messages(SETUP_XTOOL));
            spawn_setup(&app, &tasks, t!("task.installXtool"), "apt + xtool (WSL)", args).await
        }
        "install-imobiledevice" => {
            let args = wsl::root_script_args(&distro, &fill_messages(SETUP_IMOBILEDEVICE));
            spawn_setup(&app, &tasks, t!("task.installImd"), "apt install libimobiledevice-utils ideviceinstaller (WSL)", args).await
        }
        other => Err(t!("err.unknownAction", action = other)),
    }
}

#[tauri::command]
pub async fn install_sdk(app: AppHandle, tasks: State<'_, TaskManager>, path: String) -> Result<u64, String> {
    if !std::path::Path::new(&path).is_file() {
        return Err(t!("err.fileNotFound"));
    }
    let distro = settings::load(&app).wsl_distro;
    let command = format!("xtool sdk install {}", sh_quote(&windows_to_wsl(&path)));
    let script = format!("echo {}; {command}", sh_quote(&format!("▸ {}", t!("setup.sdkExtract"))));
    spawn_setup(&app, &tasks, t!("task.installSdk"), &command, wsl::script_args(&distro, None, &script)).await
}

#[tauri::command]
pub async fn run_fix_action(app: AppHandle, id: String) -> Result<(), String> {
    let distro = settings::load(&app).wsl_distro;
    match id.as_str() {
        "install-swift" => open_powershell(
            "winget install --id Swift.Toolchain -e --accept-package-agreements --accept-source-agreements",
        ),
        "install-msvc" => open_powershell(
            "winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements \
             --override '--wait --passive --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621'",
        ),
        "install-wsl" => open_elevated_powershell(&install_wsl_script()),
        "install-apple-devices" => {
            use tauri_plugin_opener::OpenerExt;
            tauri::async_runtime::spawn_blocking(move || {
                app.opener()
                    .open_url("ms-windows-store://pdp/?ProductId=9NP83LWLPZ9K", None::<&str>)
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?
        }
        "xtool-login" => open_wsl_terminal(&distro, &xtool_login_script()),
        "open-xcode-download" => {
            use tauri_plugin_opener::OpenerExt;
            app.opener()
                .open_url("https://developer.apple.com/download/all/?q=Xcode", None::<&str>)
                .map_err(|e| e.to_string())
        }
        "wsl-shell" => open_wsl_terminal(&distro, "true"),
        other => Err(t!("err.unknownAction", action = other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_scripts_have_no_placeholders_left() {
        for script in [SETUP_SWIFT, SETUP_XTOOL, SETUP_IMOBILEDEVICE] {
            assert!(!fill_messages(script).contains('@'), "placeholder left in setup script");
        }
        assert_eq!(ps_quote("l'app"), "'l''app'");
    }

    #[test]
    fn quoting_survives_hostile_input() {
        assert_eq!(ps_quote("a\u{2019}b"), "'a\u{2019}\u{2019}b'");
        assert_eq!(ps_quote("$(calc)"), "'$(calc)'");
        assert_eq!(win_quote("plain"), "plain");
        assert_eq!(win_quote(""), "\"\"");
        assert_eq!(win_quote(r"C:\Users\R&D (x)\a b.sh"), r#""C:\Users\R&D (x)\a b.sh""#);
        assert_eq!(win_quote(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(win_quote(r"C:\dir with space\"), r#""C:\dir with space\\""#);
    }
}
