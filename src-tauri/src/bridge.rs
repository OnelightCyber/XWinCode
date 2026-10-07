use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};

use crate::diagnostics::windows_to_wsl;
use crate::env::sh_quote;
use crate::{settings, wsl};

pub const USBMUXD_WINDOWS: &str = "127.0.0.1:27015";

pub async fn windows_usbmuxd_available() -> bool {
    matches!(
        tokio::time::timeout(std::time::Duration::from_millis(600), tokio::net::TcpStream::connect(USBMUXD_WINDOWS)).await,
        Ok(Ok(_))
    )
}

pub fn usbmux_stdio() -> i32 {
    let Ok(sock) = TcpStream::connect(USBMUXD_WINDOWS) else {
        eprintln!("XWinCode: Apple Mobile Device Service injoignable sur {USBMUXD_WINDOWS}");
        return 1;
    };
    let _ = sock.set_nodelay(true);
    let Ok(mut to_device) = sock.try_clone() else { return 1 };
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        let mut buf = [0u8; 64 * 1024];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if to_device.write_all(&buf[..n]).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = to_device.shutdown(Shutdown::Write);
    });
    let mut from_device = sock;
    let mut stdout = std::io::stdout().lock();
    let mut buf = [0u8; 64 * 1024];
    loop {
        match from_device.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if stdout.write_all(&buf[..n]).and_then(|_| stdout.flush()).is_err() {
                    break;
                }
            }
        }
    }
    0
}

pub fn wsl_prelude() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_wsl = windows_to_wsl(&exe.to_string_lossy());
    Ok(format!(
        r#"command -v socat >/dev/null 2>&1 || {{ echo {missing}; exit 1; }}
XWC_DIR="$(mktemp -d "${{XDG_RUNTIME_DIR:-/tmp}}/xwincode.XXXXXXXX")" || exit 1
XWC_SOCK="$XWC_DIR/usbmuxd.sock"
XWC_RELAY="$HOME/.cache/xwincode/usbmux-relay.sh"
mkdir -p "$(dirname "$XWC_RELAY")"
cat > "$XWC_RELAY" <<'XWCEOF'
#!/bin/sh
exec {exe} --usbmux-stdio
XWCEOF
chmod 700 "$XWC_RELAY"
socat UNIX-LISTEN:"$XWC_SOCK",fork,mode=600 EXEC:"$XWC_RELAY" 2>/dev/null &
XWC_SOCAT=$!
trap 'kill $XWC_SOCAT 2>/dev/null; rm -rf "$XWC_DIR"' EXIT
i=0; while [ ! -S "$XWC_SOCK" ] && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
export USBMUXD_SOCKET_ADDRESS="UNIX:$XWC_SOCK"
"#,
        exe = sh_quote(&exe_wsl),
        missing = sh_quote(&format!("error: {}", t!("err.socatMissing")))
    ))
}

#[tauri::command]
pub async fn wsl_device_check(app: tauri::AppHandle) -> Result<String, String> {
    if !windows_usbmuxd_available().await {
        return Err(t!("err.amdsDown"));
    }
    let distro = settings::load(&app).wsl_distro;
    let script = format!("{}\ntimeout 25 xtool devices 2>&1", wsl_prelude()?);
    let (_, out, err) = wsl::run(&distro, &script, 60).await?;
    let text = format!("{out}{err}").trim().to_string();
    Ok(if text.is_empty() { t!("info.noDeviceXtool") } else { text })
}

#[cfg(test)]
mod tests {
    #[test]
    fn prelude_quotes_exe() {
        let p = super::wsl_prelude().unwrap();
        assert!(p.contains("--usbmux-stdio"));
        assert!(p.contains("USBMUXD_SOCKET_ADDRESS=\"UNIX:"));
    }
}
