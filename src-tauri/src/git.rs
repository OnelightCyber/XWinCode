use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;

use crate::{env, project, trust};

const MAX_BLOB: usize = 4 * 1024 * 1024;
const MAX_FILES: usize = 5000;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitFile {
    pub path: String,
    pub status: String,
    pub staged: bool,
    pub unstaged: bool,
    pub origin: Option<String>,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub available: bool,
    pub locked: bool,
    pub repo: bool,
    pub head: Option<String>,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<GitFile>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub current: bool,
    pub remote: bool,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short: String,
    pub subject: String,
    pub author: String,
    pub time: i64,
}

struct Output {
    ok: bool,
    stdout: Vec<u8>,
    stderr: String,
}

impl Output {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).trim().to_string()
    }

    fn failure(&self) -> String {
        let message = self.stderr.trim();
        if message.contains("Please tell me who you are") || message.contains("Author identity unknown") {
            return t!("err.gitIdentity");
        }
        if message.is_empty() {
            let out = self.text();
            if out.is_empty() {
                t!("err.gitFailed")
            } else {
                out
            }
        } else {
            message.to_string()
        }
    }

    fn check(self) -> Result<Output, String> {
        if self.ok {
            Ok(self)
        } else {
            Err(self.failure())
        }
    }
}

async fn run<I, S>(root: &str, args: I, timeout_secs: u64) -> Result<Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let git = env::which("git").ok_or_else(|| t!("err.gitMissing"))?;
    let mut cmd = env::command(git);
    cmd.current_dir(root)
        .args(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "-c", "color.ui=false"])
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    match tokio::time::timeout(Duration::from_secs(timeout_secs), cmd.output()).await {
        Ok(Ok(out)) => Ok(Output { ok: out.status.success(), stdout: out.stdout, stderr: String::from_utf8_lossy(&out.stderr).to_string() }),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(t!("err.timeout")),
    }
}

fn relative(root: &str, path: &str) -> Result<String, String> {
    let norm = |s: &str| s.replace('\\', "/").trim_end_matches('/').to_string();
    let base = norm(root);
    let full = norm(path);
    if full.eq_ignore_ascii_case(&base) {
        return Ok(".".into());
    }
    let inside = full.len() > base.len()
        && full.is_char_boundary(base.len())
        && full[..base.len()].eq_ignore_ascii_case(&base)
        && full.as_bytes()[base.len()] == b'/';
    if !inside {
        return Err(t!("err.fileNotFound"));
    }
    Ok(format!("./{}", &full[base.len() + 1..]))
}

fn absolute(top: &str, rel: &str) -> String {
    let joined = format!("{}/{}", top.trim_end_matches(['/', '\\']), rel);
    if cfg!(windows) {
        joined.replace('/', "\\")
    } else {
        joined
    }
}

#[derive(Default, Debug, PartialEq)]
struct Parsed {
    head: Option<String>,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    files: Vec<GitFile>,
}

fn classify(x: char, y: char) -> &'static str {
    if x == 'D' || y == 'D' {
        "deleted"
    } else if x == 'A' || x == 'C' {
        "added"
    } else if x == 'R' {
        "renamed"
    } else {
        "modified"
    }
}

fn parse_status(raw: &[u8]) -> Parsed {
    let text = String::from_utf8_lossy(raw);
    let mut out = Parsed::default();
    let mut tokens = text.split('\0');
    while let Some(token) = tokens.next() {
        if let Some(rest) = token.strip_prefix("# ") {
            let (key, value) = rest.split_once(' ').unwrap_or((rest, ""));
            match key {
                "branch.oid" if value != "(initial)" => out.head = Some(value.to_string()),
                "branch.head" if value != "(detached)" => out.branch = Some(value.to_string()),
                "branch.upstream" => out.upstream = Some(value.to_string()),
                "branch.ab" => {
                    for part in value.split(' ') {
                        if let Some(n) = part.strip_prefix('+') {
                            out.ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix('-') {
                            out.behind = n.parse().unwrap_or(0);
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        let kind = token.chars().next().unwrap_or(' ');
        match kind {
            '?' => {
                if let Some(path) = token.get(2..) {
                    out.files.push(GitFile { path: path.to_string(), status: "untracked".into(), staged: false, unstaged: true, origin: None });
                }
            }
            '1' | '2' | 'u' => {
                let fields = match kind {
                    '1' => 9,
                    '2' => 10,
                    _ => 11,
                };
                let parts: Vec<&str> = token.splitn(fields, ' ').collect();
                if parts.len() < fields {
                    continue;
                }
                let mut xy = parts[1].chars();
                let x = xy.next().unwrap_or('.');
                let y = xy.next().unwrap_or('.');
                let origin = if kind == '2' { tokens.next().map(str::to_string) } else { None };
                let path = parts[fields - 1].to_string();
                if kind == 'u' {
                    out.files.push(GitFile { path, status: "conflict".into(), staged: false, unstaged: true, origin: None });
                } else {
                    out.files.push(GitFile { path, status: classify(x, y).into(), staged: x != '.', unstaged: y != '.', origin });
                }
            }
            _ => {}
        }
    }
    out
}

async fn toplevel(root: &str) -> Result<Option<String>, String> {
    let out = run(root, ["rev-parse", "--show-toplevel"], 15).await?;
    Ok(if out.ok { Some(out.text()) } else { None })
}

async fn status_of(root: &str) -> Result<GitStatus, String> {
    let Some(top) = toplevel(root).await? else {
        return Ok(GitStatus { available: true, ..Default::default() });
    };
    let out = run(root, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"], 30).await?.check()?;
    let parsed = parse_status(&out.stdout);
    let files = parsed
        .files
        .into_iter()
        .take(MAX_FILES)
        .map(|f| GitFile { path: absolute(&top, &f.path), origin: f.origin.map(|o| absolute(&top, &o)), ..f })
        .collect();
    Ok(GitStatus {
        available: true,
        locked: false,
        repo: true,
        head: parsed.head,
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        files,
    })
}

async fn original_of(root: &str, path: &str) -> Result<Option<String>, String> {
    let spec = format!("HEAD:{}", relative(root, path)?);
    let out = run(root, ["cat-file", "blob", spec.as_str()], 20).await?;
    if !out.ok || out.stdout.len() > MAX_BLOB || out.stdout.contains(&0) {
        return Ok(None);
    }
    Ok(String::from_utf8(out.stdout).ok())
}

async fn has_head(root: &str) -> bool {
    run(root, ["rev-parse", "--verify", "-q", "HEAD"], 15).await.map(|o| o.ok).unwrap_or(false)
}

fn pathspecs(root: &str, paths: &[String]) -> Result<Vec<String>, String> {
    paths.iter().map(|p| relative(root, p)).collect()
}

async fn stage_paths(root: &str, paths: &[String], stage: bool) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let specs = pathspecs(root, paths)?;
    let mut args: Vec<String> = if stage {
        vec!["add".into(), "-A".into(), "--".into()]
    } else if has_head(root).await {
        vec!["reset".into(), "-q".into(), "HEAD".into(), "--".into()]
    } else {
        vec!["rm".into(), "--cached".into(), "-r".into(), "-q".into(), "--ignore-unmatch".into(), "--".into()]
    };
    args.extend(specs);
    run(root, args, 60).await?.check().map(|_| ())
}

async fn discard_paths(root: &str, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    let status = status_of(root).await?;
    let known: HashMap<String, &GitFile> = status.files.iter().map(|f| (f.path.to_lowercase(), f)).collect();
    let tracked_at_head = has_head(root).await;
    for path in paths {
        let spec = relative(root, path)?;
        let entry = known.get(&path.to_lowercase());
        let fresh = !tracked_at_head || entry.is_some_and(|f| f.status == "untracked" || f.status == "added");
        if fresh {
            run(root, ["rm", "--cached", "-q", "--ignore-unmatch", "--", spec.as_str()], 30).await?;
            if Path::new(path).exists() {
                trash::delete(path).map_err(|e| e.to_string())?;
            }
        } else {
            run(root, ["checkout", "-q", "HEAD", "--", spec.as_str()], 30).await?.check()?;
        }
    }
    Ok(())
}

async fn commit_all(root: &str, message: &str, everything: bool) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err(t!("err.gitMessage"));
    }
    if everything {
        run(root, ["add", "-A"], 60).await?.check()?;
    }
    run(root, ["commit", "-q", "-m", message], 60).await?.check()?;
    Ok(run(root, ["rev-parse", "--short", "HEAD"], 15).await?.text())
}

async fn init_repo(root: &str) -> Result<(), String> {
    let modern = run(root, ["init", "-q", "-b", "main"], 30).await?;
    if !modern.ok {
        run(root, ["init", "-q"], 30).await?.check()?;
    }
    let ignore = Path::new(root).join(".gitignore");
    if !ignore.exists() {
        std::fs::write(&ignore, project::GITIGNORE).map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn branches_of(root: &str) -> Result<Vec<GitBranch>, String> {
    let out = run(root, ["for-each-ref", "--format=%(refname)%09%(HEAD)", "refs/heads", "refs/remotes"], 20).await?.check()?;
    let mut list = Vec::new();
    for line in out.text().lines() {
        let (full, mark) = line.split_once('\t').unwrap_or((line, ""));
        if let Some(name) = full.strip_prefix("refs/heads/") {
            list.push(GitBranch { name: name.to_string(), current: mark.trim() == "*", remote: false });
        } else if let Some(name) = full.strip_prefix("refs/remotes/") {
            if !name.ends_with("/HEAD") {
                list.push(GitBranch { name: name.to_string(), current: false, remote: true });
            }
        }
    }
    Ok(list)
}

fn valid_branch(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && !name.ends_with('/')
        && !name.ends_with(".lock")
        && !name.contains("..")
        && !name.contains("@{")
        && name.chars().all(|c| !c.is_control() && !" ~^:?*[\\".contains(c))
}

async fn switch_to(root: &str, name: &str, create: bool) -> Result<(), String> {
    if !valid_branch(name) {
        return Err(t!("err.gitBranchName"));
    }
    let args: Vec<&str> = if create { vec!["checkout", "-q", "-b", name] } else { vec!["checkout", "-q", name, "--"] };
    run(root, args, 60).await?.check().map(|_| ())
}

async fn sync_with(root: &str, op: &str) -> Result<String, String> {
    let out = match op {
        "fetch" => run(root, ["fetch", "--prune"], 180).await?,
        "pull" => run(root, ["pull", "--ff-only"], 180).await?,
        "push" => {
            let tracked = run(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], 15).await?.ok;
            if tracked {
                run(root, ["push"], 180).await?
            } else {
                let remotes = run(root, ["remote"], 15).await?.text();
                let Some(remote) = remotes.lines().find(|r| *r == "origin").or_else(|| remotes.lines().next()) else {
                    return Err(t!("err.gitNoRemote"));
                };
                run(root, ["push", "-u", remote, "HEAD"], 180).await?
            }
        }
        _ => return Err(t!("err.gitFailed")),
    };
    let out = out.check()?;
    let text = format!("{}\n{}", out.text(), out.stderr.trim());
    Ok(text.trim().to_string())
}

async fn log_of(root: &str, limit: u32) -> Result<Vec<GitCommit>, String> {
    if !has_head(root).await {
        return Ok(Vec::new());
    }
    let count = format!("-n{}", limit.clamp(1, 500));
    let out = run(root, ["log", count.as_str(), "--format=%H%x1f%h%x1f%s%x1f%an%x1f%ct%x1e"], 30).await?.check()?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .split('\u{1e}')
        .filter_map(|record| {
            let fields: Vec<&str> = record.trim().split('\u{1f}').collect();
            (fields.len() == 5).then(|| GitCommit {
                hash: fields[0].to_string(),
                short: fields[1].to_string(),
                subject: fields[2].to_string(),
                author: fields[3].to_string(),
                time: fields[4].parse().unwrap_or(0),
            })
        })
        .collect())
}

#[tauri::command]
pub async fn git_status(app: AppHandle, root: String) -> Result<GitStatus, String> {
    if env::which("git").is_none() {
        return Ok(GitStatus::default());
    }
    if !trust::is_trusted(&app, &root) {
        return Ok(GitStatus { available: true, locked: true, repo: Path::new(&root).join(".git").exists(), ..Default::default() });
    }
    status_of(&root).await
}

#[tauri::command]
pub async fn git_original(app: AppHandle, root: String, path: String) -> Result<Option<String>, String> {
    trust::require(&app, &root)?;
    original_of(&root, &path).await
}

#[tauri::command]
pub async fn git_stage(app: AppHandle, root: String, paths: Vec<String>, stage: bool) -> Result<(), String> {
    trust::require(&app, &root)?;
    stage_paths(&root, &paths, stage).await
}

#[tauri::command]
pub async fn git_discard(app: AppHandle, root: String, paths: Vec<String>) -> Result<(), String> {
    trust::require(&app, &root)?;
    discard_paths(&root, &paths).await
}

#[tauri::command]
pub async fn git_commit(app: AppHandle, root: String, message: String, everything: bool) -> Result<String, String> {
    trust::require(&app, &root)?;
    commit_all(&root, &message, everything).await
}

#[tauri::command]
pub async fn git_init(app: AppHandle, root: String) -> Result<(), String> {
    trust::require(&app, &root)?;
    init_repo(&root).await
}

#[tauri::command]
pub async fn git_branches(app: AppHandle, root: String) -> Result<Vec<GitBranch>, String> {
    trust::require(&app, &root)?;
    branches_of(&root).await
}

#[tauri::command]
pub async fn git_switch(app: AppHandle, root: String, name: String, create: bool) -> Result<(), String> {
    trust::require(&app, &root)?;
    switch_to(&root, &name, create).await
}

#[tauri::command]
pub async fn git_sync(app: AppHandle, root: String, op: String) -> Result<String, String> {
    trust::require(&app, &root)?;
    sync_with(&root, &op).await
}

#[tauri::command]
pub async fn git_log(app: AppHandle, root: String, limit: u32) -> Result<Vec<GitCommit>, String> {
    trust::require(&app, &root)?;
    log_of(&root, limit).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_v2() {
        let raw = b"# branch.oid 1234abcd\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\x001 .M N... 100644 100644 100644 aaa bbb Sources/App/My View.swift\x001 A. N... 000000 100644 100644 000 ccc New.swift\x002 R. N... 100644 100644 100644 ddd eee R100 Renamed.swift\0Old.swift\x001 D. N... 100644 000000 000000 fff 000 Gone.swift\0u UU N... 100644 100644 100644 100644 a b c Clash.swift\0? notes.txt\0";
        let parsed = parse_status(raw);
        assert_eq!(parsed.head.as_deref(), Some("1234abcd"));
        assert_eq!(parsed.branch.as_deref(), Some("main"));
        assert_eq!(parsed.upstream.as_deref(), Some("origin/main"));
        assert_eq!((parsed.ahead, parsed.behind), (2, 1));
        let by = |name: &str| parsed.files.iter().find(|f| f.path == name).unwrap_or_else(|| panic!("missing {name}"));
        assert_eq!(by("Sources/App/My View.swift").status, "modified");
        assert!(!by("Sources/App/My View.swift").staged && by("Sources/App/My View.swift").unstaged);
        assert_eq!(by("New.swift").status, "added");
        assert!(by("New.swift").staged);
        assert_eq!(by("Renamed.swift").status, "renamed");
        assert_eq!(by("Renamed.swift").origin.as_deref(), Some("Old.swift"));
        assert_eq!(by("Gone.swift").status, "deleted");
        assert_eq!(by("Clash.swift").status, "conflict");
        assert_eq!(by("notes.txt").status, "untracked");
        assert_eq!(parsed.files.len(), 6);
    }

    #[test]
    fn parses_fresh_repository() {
        let parsed = parse_status(b"# branch.oid (initial)\0# branch.head main\0? a.swift\0");
        assert_eq!(parsed.head, None);
        assert_eq!(parsed.branch.as_deref(), Some("main"));
        assert_eq!(parsed.files.len(), 1);
    }

    #[test]
    fn relative_paths_stay_inside_the_root() {
        assert_eq!(relative("C:\\Proj", "c:\\proj\\Sources\\A.swift").unwrap(), "./Sources/A.swift");
        assert_eq!(relative("C:/Proj/", "C:/Proj").unwrap(), ".");
        assert!(relative("C:\\Proj", "C:\\Project\\A.swift").is_err());
        assert!(relative("C:\\Proj", "D:\\Other\\A.swift").is_err());
    }

    #[test]
    fn rejects_unsafe_branch_names() {
        assert!(valid_branch("feature/login"));
        assert!(valid_branch("fix-42"));
        assert!(!valid_branch("-delete"));
        assert!(!valid_branch("a..b"));
        assert!(!valid_branch("with space"));
        assert!(!valid_branch(""));
        assert!(!valid_branch("x.lock"));
    }

    #[tokio::test]
    async fn round_trip_on_a_real_repository() {
        if env::which("git").is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("xwc-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Sources")).unwrap();
        let root = dir.to_string_lossy().to_string();
        let file = dir.join("Sources").join("Main.swift").to_string_lossy().to_string();

        assert!(!status_of(&root).await.unwrap().repo);
        init_repo(&root).await.unwrap();
        assert!(std::fs::read_to_string(dir.join(".gitignore")).unwrap().contains("/.build"));
        std::fs::create_dir_all(dir.join(".build")).unwrap();
        std::fs::write(dir.join(".build").join("junk.o"), "x").unwrap();
        std::fs::remove_file(dir.join(".gitignore")).unwrap();
        std::fs::write(dir.join(".gitignore"), "/.build\n").unwrap();
        init_repo(&root).await.unwrap();
        assert_eq!(std::fs::read_to_string(dir.join(".gitignore")).unwrap(), "/.build\n");
        run(&root, ["config", "user.name", "XWinCode Test"], 15).await.unwrap();
        run(&root, ["config", "user.email", "test@example.invalid"], 15).await.unwrap();
        run(&root, ["config", "commit.gpgsign", "false"], 15).await.unwrap();

        std::fs::write(&file, "let a = 1\n").unwrap();
        let entry = |status: &GitStatus| status.files.iter().find(|f| f.path.to_lowercase().ends_with("main.swift")).cloned().expect("Main.swift listed");
        let fresh = status_of(&root).await.unwrap();
        assert!(fresh.repo && fresh.head.is_none());
        assert_eq!(fresh.files.len(), 2);
        assert!(fresh.files.iter().all(|f| f.status == "untracked" && !f.path.contains(".build")));

        stage_paths(&root, std::slice::from_ref(&file), true).await.unwrap();
        assert!(entry(&status_of(&root).await.unwrap()).staged);
        stage_paths(&root, std::slice::from_ref(&file), false).await.unwrap();
        assert!(!entry(&status_of(&root).await.unwrap()).staged);

        let short = commit_all(&root, "First commit", true).await.unwrap();
        assert!(!short.is_empty());
        assert!(status_of(&root).await.unwrap().files.is_empty());
        assert_eq!(original_of(&root, &file).await.unwrap().as_deref(), Some("let a = 1\n"));

        std::fs::write(&file, "let a = 2\n").unwrap();
        let changed = status_of(&root).await.unwrap();
        assert_eq!(changed.files[0].status, "modified");
        discard_paths(&root, std::slice::from_ref(&file)).await.unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap().replace("\r\n", "\n"), "let a = 1\n");

        switch_to(&root, "feature/test", true).await.unwrap();
        let branches = branches_of(&root).await.unwrap();
        assert!(branches.iter().any(|b| b.name == "feature/test" && b.current));
        assert_eq!(log_of(&root, 10).await.unwrap()[0].subject, "First commit");
        assert!(commit_all(&root, "  ", false).await.is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
