use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn fresh_env() -> Vec<(String, String)> {
    let inherited: HashMap<String, String> = std::env::vars().map(|(k, v)| (k.to_uppercase(), v)).collect();
    let mut out: Vec<(String, String)> = Vec::new();

    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;

        let read = |root: RegKey, sub: &str| -> Vec<(String, String)> {
            let Ok(key) = root.open_subkey(sub) else { return vec![] };
            key.enum_values()
                .flatten()
                .filter_map(|(name, _)| key.get_value::<String, _>(&name).ok().map(|v| (name, v)))
                .collect()
        };
        let system = read(
            RegKey::predef(HKEY_LOCAL_MACHINE),
            r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
        );
        let user = read(RegKey::predef(HKEY_CURRENT_USER), "Environment");

        let mut vars = inherited.clone();
        let mut path_parts: Vec<String> = Vec::new();
        for (name, value) in system.iter().chain(user.iter()) {
            let expanded = expand(value, &vars);
            if name.eq_ignore_ascii_case("path") {
                path_parts.extend(expanded.split(';').filter(|s| !s.is_empty()).map(String::from));
            } else if !vars.contains_key(&name.to_uppercase()) {
                vars.insert(name.to_uppercase(), expanded.clone());
                out.push((name.clone(), expanded));
            }
        }
        if let Some(current) = inherited.get("PATH") {
            for part in current.split(';').filter(|s| !s.is_empty()) {
                if !path_parts.iter().any(|p| p.eq_ignore_ascii_case(part)) {
                    path_parts.push(part.to_string());
                }
            }
        }
        for dir in swift_fallback_dirs() {
            let d = dir.to_string_lossy().to_string();
            if !path_parts.iter().any(|p| p.eq_ignore_ascii_case(&d)) {
                path_parts.push(d);
            }
        }
        out.push(("PATH".into(), path_parts.join(";")));
    }

    #[cfg(not(windows))]
    {
        let _ = inherited;
    }
    out
}

#[cfg_attr(not(windows), allow(dead_code))]
fn expand(value: &str, vars: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match vars.get(&name.to_uppercase()) {
                    Some(v) => out.push_str(v),
                    None => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

pub fn swift_fallback_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(local) = std::env::var("LOCALAPPDATA") else { return dirs };
    let base = Path::new(&local).join("Programs").join("Swift");
    for (sub, tail) in [("Toolchains", "usr\\bin"), ("Runtimes", "usr\\bin")] {
        if let Ok(entries) = std::fs::read_dir(base.join(sub)) {
            let mut found: Vec<PathBuf> = entries.flatten().map(|e| e.path().join(tail)).filter(|p| p.is_dir()).collect();
            found.sort();
            found.reverse();
            if let Some(first) = found.into_iter().next() {
                dirs.push(first);
            }
        }
    }
    dirs
}

pub fn which_in(path_var: &str, exe: &str) -> Option<PathBuf> {
    let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat", ""] } else { &[""] };
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path_var.split(sep).filter(|s| !s.is_empty()) {
        for ext in exts {
            let candidate = Path::new(dir).join(format!("{exe}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn system_exe(rel: &str) -> PathBuf {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    PathBuf::from(root).join("System32").join(rel)
}

pub fn which(exe: &str) -> Option<PathBuf> {
    let env = fresh_env();
    let path = env
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("path"))
        .map(|(_, v)| v.clone())
        .or_else(|| std::env::var("PATH").ok())
        .unwrap_or_default();
    which_in(&path, exe)
}

pub fn command(program: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    cmd.envs(fresh_env());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub fn looks_utf16(bytes: &[u8]) -> bool {
    let odd = bytes.iter().skip(1).step_by(2).take(64);
    let total = odd.clone().count();
    total >= 2 && odd.filter(|b| **b == 0).count() * 2 > total
}

pub fn decode_output(bytes: &[u8]) -> String {
    if looks_utf16(bytes) {
        let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        return String::from_utf16_lossy(&units).trim_start_matches('\u{feff}').to_string();
    }
    String::from_utf8_lossy(bytes).replace('\0', "")
}

pub async fn capture(
    program: impl AsRef<std::ffi::OsStr>,
    args: &[&str],
    timeout_secs: u64,
) -> Result<(bool, String, String), String> {
    let mut cmd = command(program);
    cmd.args(args).stdin(std::process::Stdio::null()).kill_on_drop(true);
    let fut = cmd.output();
    match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), fut).await {
        Ok(Ok(out)) => Ok((out.status.success(), decode_output(&out.stdout), decode_output(&out.stderr))),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(t!("err.timeout")),
    }
}

pub fn sh_quote(s: &str) -> String {
    if !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:=@+,".contains(c)) {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', r"'\''"))
}

pub fn ps_encode(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_vars() {
        let mut vars = HashMap::new();
        vars.insert("USERPROFILE".to_string(), "C:\\Users\\me".to_string());
        assert_eq!(expand("%USERPROFILE%\\bin;%NOPE%", &vars), "C:\\Users\\me\\bin;%NOPE%");
    }

    #[test]
    fn quotes_sh() {
        assert_eq!(sh_quote("abc"), "abc");
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
    }

    #[test]
    fn detects_utf16() {
        let wide: Vec<u8> = "Bonjour".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert!(looks_utf16(&wide));
        assert!(!looks_utf16(b"Bonjour"));
        assert_eq!(decode_output(&wide), "Bonjour");
    }

    #[test]
    fn encodes_ps() {
        assert_eq!(ps_encode("a"), "YQA=");
    }
}
