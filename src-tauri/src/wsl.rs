use std::path::PathBuf;

use crate::env;

pub fn exe() -> PathBuf {
    env::system_exe("wsl.exe")
}

pub fn valid_distro(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

pub fn distro_args(distro: &Option<String>) -> Vec<String> {
    match distro.as_deref().filter(|d| valid_distro(d)) {
        Some(d) => vec!["-d".into(), d.into()],
        None => vec![],
    }
}

pub fn script_args(distro: &Option<String>, cwd: Option<&str>, script: &str) -> Vec<String> {
    let mut args = distro_args(distro);
    if let Some(cwd) = cwd {
        args.push("--cd".into());
        args.push(cwd.into());
    }
    args.extend(["-e".into(), "bash".into(), "-lc".into(), script.into()]);
    args
}

pub fn root_script_args(distro: &Option<String>, script: &str) -> Vec<String> {
    let mut args = distro_args(distro);
    args.extend(["-u".into(), "root".into(), "-e".into(), "bash".into(), "-c".into(), script.into()]);
    args
}

pub async fn run(distro: &Option<String>, script: &str, timeout_secs: u64) -> Result<(bool, String, String), String> {
    let args = script_args(distro, None, script);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    env::capture(exe(), &refs, timeout_secs).await
}

pub async fn list_distros() -> Result<Vec<String>, String> {
    if !exe().is_file() {
        return Err(t!("err.wslNotInstalled"));
    }
    let (ok, out, err) = env::capture(exe(), &["-l", "-q"], 30).await?;
    if !ok {
        let msg = if err.trim().is_empty() { out } else { err };
        return Err(msg.trim().to_string());
    }
    Ok(out.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
}

#[tauri::command]
pub async fn list_wsl_distros() -> Result<Vec<String>, String> {
    list_distros().await
}

#[tauri::command]
pub async fn wsl_warmup(app: tauri::AppHandle) -> Result<u64, String> {
    if !exe().is_file() {
        return Err(t!("err.wslNotInstalled"));
    }
    let distro = crate::settings::load(&app).wsl_distro;
    let mut args = distro_args(&distro);
    args.extend(["-e".into(), "true".into()]);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let started = std::time::Instant::now();
    let (ok, out, err) = env::capture(exe(), &refs, 120).await?;
    if !ok {
        let msg = if err.trim().is_empty() { out } else { err };
        return Err(msg.trim().to_string());
    }
    Ok(started.elapsed().as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distro_names_are_validated() {
        assert!(valid_distro("Ubuntu-24.04"));
        assert!(valid_distro("openSUSE-Tumbleweed"));
        for bad in ["", "Ubuntu & calc", "a b", "x;rm -rf /", "%PATH%", "q\"q"] {
            assert!(!valid_distro(bad), "{bad}");
            assert!(distro_args(&Some(bad.into())).is_empty());
        }
        assert_eq!(distro_args(&Some("Debian".into())), vec!["-d".to_string(), "Debian".to_string()]);
    }
}
