use once_cell::sync::Lazy;
use regex::Regex;
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub file: Option<String>,
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
}

static LOCATED: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^(?P<file>.+?):(?P<line>\d+):(?P<col>\d+): (?P<sev>error|warning|note): (?P<msg>.*)$").unwrap()
});
static BARE: Lazy<Regex> = Lazy::new(|| Regex::new(r"^(?P<sev>error|warning): (?P<msg>.+)$").unwrap());
static ANSI: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]").unwrap());

pub fn strip_ansi(s: &str) -> String {
    ANSI.replace_all(s, "").into_owned()
}

pub fn parse_line(line: &str) -> Option<Diagnostic> {
    let line = line.trim_end();
    if let Some(c) = LOCATED.captures(line) {
        let file = c["file"].trim().to_string();
        return Some(Diagnostic {
            file: Some(wsl_to_windows(&file)),
            line: c["line"].parse().unwrap_or(1),
            column: c["col"].parse().unwrap_or(1),
            severity: c["sev"].to_string(),
            message: c["msg"].to_string(),
        });
    }
    if let Some(c) = BARE.captures(line) {
        return Some(Diagnostic {
            file: None,
            line: 0,
            column: 0,
            severity: c["sev"].to_string(),
            message: c["msg"].to_string(),
        });
    }
    None
}

pub fn wsl_to_windows(path: &str) -> String {
    let bytes = path.as_bytes();
    if path.starts_with("/mnt/") && bytes.len() >= 6 && bytes[5].is_ascii_alphabetic() && (bytes.len() == 6 || bytes[6] == b'/') {
        let drive = (bytes[5] as char).to_ascii_uppercase();
        let rest = &path[6..];
        return format!("{drive}:{}", if rest.is_empty() { "\\".to_string() } else { rest.replace('/', "\\") });
    }
    path.to_string()
}

pub fn windows_to_wsl(path: &str) -> String {
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let drive = (bytes[0] as char).to_ascii_lowercase();
        return format!("/mnt/{drive}{}", path[2..].replace('\\', "/"));
    }
    path.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_windows_path() {
        let d = parse_line(r"C:\Users\me\App\Sources\main.swift:12:5: error: cannot find 'x' in scope").unwrap();
        assert_eq!(d.file.as_deref(), Some(r"C:\Users\me\App\Sources\main.swift"));
        assert_eq!((d.line, d.column), (12, 5));
        assert_eq!(d.severity, "error");
        assert_eq!(d.message, "cannot find 'x' in scope");
    }

    #[test]
    fn parses_wsl_path() {
        let d = parse_line("/mnt/c/dev/App/Sources/App/ContentView.swift:3:1: warning: unused").unwrap();
        assert_eq!(d.file.as_deref(), Some(r"C:\dev\App\Sources\App\ContentView.swift"));
        assert_eq!(d.severity, "warning");
    }

    #[test]
    fn parses_bare() {
        let d = parse_line("error: link command failed with exit code 1").unwrap();
        assert!(d.file.is_none());
    }

    #[test]
    fn ignores_noise() {
        assert!(parse_line("[3/7] Compiling App main.swift").is_none());
    }

    #[test]
    fn path_roundtrip() {
        assert_eq!(windows_to_wsl(r"D:\a\b"), "/mnt/d/a/b");
        assert_eq!(wsl_to_windows("/mnt/d/a/b"), r"D:\a\b");
        assert_eq!(wsl_to_windows("/home/me"), "/home/me");
    }

    #[test]
    fn strips_ansi() {
        assert_eq!(strip_ansi("\x1b[1;31merror\x1b[0m"), "error");
    }
}
