use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

const MAX_TEXT_FILE: u64 = 8 * 1024 * 1024;
const HIDDEN: &[&str] = &[".build", ".bsp", ".git", ".swiftpm", "xtool", ".DS_Store", "node_modules", ".vscode", "Packages"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    path: String,
    line: u32,
    column: u32,
    text: String,
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchOptions {
    case_sensitive: bool,
    whole_word: bool,
    regex: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSymbol {
    name: String,
    kind: String,
    path: String,
    line: u32,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn matcher(query: &str, options: &SearchOptions) -> Result<regex::Regex, String> {
    let core = if options.regex { query.to_string() } else { regex::escape(query) };
    let pattern = if options.whole_word { format!(r"\b(?:{core})\b") } else { core };
    regex::RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .size_limit(1 << 21)
        .build()
        .map_err(|e| t!("err.regexInvalid", error = e.to_string().lines().last().unwrap_or_default().trim()))
}

fn project_files(root: &str) -> impl Iterator<Item = walkdir::DirEntry> {
    walkdir::WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.depth() > 0 && HIDDEN.contains(&name.as_ref()))
        })
        .flatten()
        .filter(|e| e.file_type().is_file() && e.metadata().map(|m| m.len() <= 2 * 1024 * 1024).unwrap_or(false))
}

fn declarations() -> regex::Regex {
    regex::Regex::new(
        r"^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|package|open|final|static|class|override|mutating|nonmutating|nonisolated|indirect|required|convenience)\s+)*(struct|class|enum|protocol|actor|extension|func|typealias)\s+([\p{L}_][\p{L}\p{N}_]*)",
    )
    .expect("static pattern")
}

fn symbols_in(text: &str, path: &str, out: &mut Vec<ProjectSymbol>, limit: usize) {
    let pattern = declarations();
    for (i, line) in text.lines().enumerate() {
        if out.len() >= limit {
            return;
        }
        if let Some(caps) = pattern.captures(line) {
            out.push(ProjectSymbol { name: caps[2].to_string(), kind: caps[1].to_string(), path: path.to_string(), line: i as u32 + 1 });
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceStamp {
    path: String,
    stamp: String,
}

#[tauri::command]
pub async fn list_sources(root: String) -> Result<Vec<SourceStamp>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        project_files(&root)
            .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("swift")))
            .take(2000)
            .filter_map(|e| {
                let meta = e.metadata().ok()?;
                let modified = meta.modified().ok()?.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis();
                Some(SourceStamp { path: e.path().to_string_lossy().to_string(), stamp: format!("{modified}:{}", meta.len()) })
            })
            .collect()
    })
    .await
    .map_err(err)
}

#[tauri::command]
pub async fn project_symbols(root: String) -> Result<Vec<ProjectSymbol>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = Vec::new();
        for entry in project_files(&root) {
            if out.len() >= 8000 {
                break;
            }
            if !entry.path().extension().is_some_and(|e| e.eq_ignore_ascii_case("swift")) {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(entry.path()) {
                symbols_in(&text, &entry.path().to_string_lossy(), &mut out, 8000);
            }
        }
        out
    })
    .await
    .map_err(err)
}

#[tauri::command(async)]
pub fn read_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> = std::fs::read_dir(&path)
        .map_err(err)?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if HIDDEN.contains(&name.as_str()) {
                return None;
            }
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            Some(Entry { name, path: e.path().to_string_lossy().to_string(), is_dir })
        })
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[tauri::command(async)]
pub fn read_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(err)?;
    if meta.len() > MAX_TEXT_FILE {
        return Err(t!("err.fileTooBig"));
    }
    let bytes = std::fs::read(&path).map_err(err)?;
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return Err(t!("err.binaryFile"));
    }
    String::from_utf8(bytes).map_err(|_| t!("err.binaryFile"))
}

fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let target = match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => std::fs::canonicalize(path)?,
        _ => path.to_path_buf(),
    };
    let dir = target.parent().filter(|p| !p.as_os_str().is_empty()).map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = dir.join(format!(".{name}.{}.xwc-tmp", std::process::id()));
    let staged = (|| {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(contents)?;
        file.sync_all()
    })();
    if staged.is_ok() && std::fs::rename(&temp, &target).is_ok() {
        return Ok(());
    }
    let _ = std::fs::remove_file(&temp);
    std::fs::write(&target, contents)
}

#[tauri::command(async)]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = Path::new(&path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    write_atomic(path, contents.as_bytes()).map_err(err)
}

#[tauri::command(async)]
pub fn create_file(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err(t!("err.nameTaken"));
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    std::fs::write(&p, "").map_err(err)
}

#[tauri::command(async)]
pub fn create_dir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(t!("err.nameTaken"));
    }
    std::fs::create_dir_all(&path).map_err(err)
}

fn same_entry(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

#[tauri::command(async)]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    let (source, target) = (Path::new(&from), Path::new(&to));
    if target.exists() && !same_entry(source, target) {
        return Err(t!("err.nameTaken"));
    }
    std::fs::rename(source, target).map_err(err)
}

#[tauri::command(async)]
pub fn delete_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}

const MAX_COPY_DEPTH: usize = 48;
const MAX_COPY_ENTRIES: usize = 20_000;

fn split_name(name: &str, is_dir: bool) -> (&str, &str) {
    if is_dir {
        return (name, "");
    }
    match name.rfind('.') {
        Some(i) if i > 0 => name.split_at(i),
        _ => (name, ""),
    }
}

fn free_target(dir: &Path, name: &str, is_dir: bool, keep_original: bool) -> PathBuf {
    let direct = dir.join(name);
    if keep_original && !direct.exists() {
        return direct;
    }
    let (stem, ext) = split_name(name, is_dir);
    let mut n = 2;
    loop {
        let candidate = dir.join(format!("{stem} {n}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

fn inside(parent: &Path, child: &Path) -> bool {
    match (std::fs::canonicalize(parent), std::fs::canonicalize(child)) {
        (Ok(p), Ok(c)) => c.starts_with(&p),
        _ => false,
    }
}

fn copy_tree(from: &Path, to: &Path, depth: usize, budget: &mut usize) -> Result<(), String> {
    if depth > MAX_COPY_DEPTH || *budget == 0 {
        return Err(t!("err.copyTooBig"));
    }
    *budget -= 1;
    let meta = std::fs::symlink_metadata(from).map_err(err)?;
    if meta.file_type().is_symlink() {
        return Ok(());
    }
    if meta.is_dir() {
        std::fs::create_dir(to).map_err(err)?;
        for entry in std::fs::read_dir(from).map_err(err)? {
            let entry = entry.map_err(err)?;
            copy_tree(&entry.path(), &to.join(entry.file_name()), depth + 1, budget)?;
        }
        Ok(())
    } else {
        std::fs::copy(from, to).map(|_| ()).map_err(err)
    }
}

fn copy_into(source: &Path, dir: &Path, keep_original: bool) -> Result<PathBuf, String> {
    let name = source.file_name().ok_or_else(|| t!("err.fileNotFound"))?.to_string_lossy().into_owned();
    let is_dir = source.is_dir();
    if is_dir && inside(source, dir) {
        return Err(t!("err.moveInside"));
    }
    let target = free_target(dir, &name, is_dir, keep_original);
    let mut budget = MAX_COPY_ENTRIES;
    if let Err(e) = copy_tree(source, &target, 0, &mut budget) {
        let _ = if target.is_dir() { std::fs::remove_dir_all(&target) } else { std::fs::remove_file(&target) };
        return Err(e);
    }
    Ok(target)
}

#[tauri::command(async)]
pub fn duplicate_path(path: String) -> Result<String, String> {
    let source = Path::new(&path);
    let dir = source.parent().ok_or_else(|| t!("err.fileNotFound"))?;
    Ok(copy_into(source, dir, false)?.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub fn import_paths(sources: Vec<String>, dir: String) -> Result<Vec<String>, String> {
    let target = Path::new(&dir);
    if !target.is_dir() {
        return Err(t!("err.fileNotFound"));
    }
    let mut created = Vec::new();
    for source in sources.iter().take(200) {
        let source = Path::new(source);
        if !source.exists() || source.parent().is_some_and(|p| same_entry(p, target)) {
            continue;
        }
        created.push(copy_into(source, target, true)?.to_string_lossy().into_owned());
    }
    Ok(created)
}

#[tauri::command(async)]
pub fn move_path(from: String, dir: String) -> Result<String, String> {
    let source = Path::new(&from);
    let target_dir = Path::new(&dir);
    let name = source.file_name().ok_or_else(|| t!("err.fileNotFound"))?;
    if !target_dir.is_dir() {
        return Err(t!("err.fileNotFound"));
    }
    if source.parent().is_some_and(|p| same_entry(p, target_dir)) {
        return Ok(from);
    }
    if source.is_dir() && inside(source, target_dir) {
        return Err(t!("err.moveInside"));
    }
    let target = target_dir.join(name);
    if target.exists() {
        return Err(t!("err.nameTaken"));
    }
    std::fs::rename(source, &target).map_err(err)?;
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub async fn list_files(root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        walkdir::WalkDir::new(&root)
            .into_iter()
            .filter_entry(|e| !(e.depth() > 0 && HIDDEN.contains(&e.file_name().to_string_lossy().as_ref())))
            .flatten()
            .filter(|e| e.file_type().is_file())
            .take(20_000)
            .map(|e| e.path().to_string_lossy().to_string())
            .collect()
    })
    .await
    .map_err(err)
}

#[tauri::command(async)]
pub fn replace_in_file(path: String, query: String, replacement: String, options: SearchOptions) -> Result<u32, String> {
    if query.is_empty() {
        return Ok(0);
    }
    let bytes = std::fs::read(&path).map_err(err)?;
    let text = String::from_utf8(bytes).map_err(|_| t!("err.binaryFile"))?;
    let re = matcher(&query, &options)?;
    let count = re.find_iter(&text).count() as u32;
    if count > 0 {
        let next = if options.regex { re.replace_all(&text, replacement.as_str()) } else { re.replace_all(&text, regex::NoExpand(&replacement)) };
        write_atomic(Path::new(&path), next.as_bytes()).map_err(err)?;
    }
    Ok(count)
}

fn search_in(root: &str, re: &regex::Regex) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    for entry in project_files(root) {
        let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
        if !re.is_match(&text) {
            continue;
        }
        for (i, line) in text.lines().enumerate() {
            if let Some(found) = re.find(line) {
                hits.push(SearchHit {
                    path: entry.path().to_string_lossy().to_string(),
                    line: i as u32 + 1,
                    column: line[..found.start()].chars().count() as u32 + 1,
                    text: line.trim().chars().take(200).collect(),
                });
                if hits.len() >= 1000 {
                    return hits;
                }
            }
        }
    }
    hits
}

#[tauri::command]
pub async fn search_project(root: String, query: String, options: SearchOptions) -> Result<Vec<SearchHit>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }
    let re = matcher(&query, &options)?;
    tauri::async_runtime::spawn_blocking(move || search_in(&root, &re)).await.map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("xwc-fsops-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn text(p: &Path) -> String {
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn text_round_trips_and_leaves_no_temp_file() {
        let dir = scratch("roundtrip");
        let file = dir.join("main.swift");
        let body = "Text(\"Café 🚀\")\r\n";
        write_text_file(text(&file), body.into()).unwrap();
        assert_eq!(read_text_file(text(&file)).unwrap(), body);
        write_text_file(text(&file), "second".into()).unwrap();
        assert_eq!(read_text_file(text(&file)).unwrap(), "second");
        let names: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["main.swift".to_string()]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn invalid_utf8_is_refused_and_left_untouched() {
        let dir = scratch("utf8");
        let file = dir.join("latin1.swift");
        let raw = [b'/', b'/', b' ', 0xe9, b'\n'];
        std::fs::write(&file, raw).unwrap();
        assert!(read_text_file(text(&file)).is_err());
        assert_eq!(std::fs::read(&file).unwrap(), raw);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rename_allows_case_change_and_refuses_overwrite() {
        let dir = scratch("rename");
        let lower = dir.join("view.swift");
        let other = dir.join("other.swift");
        std::fs::write(&lower, "a").unwrap();
        std::fs::write(&other, "b").unwrap();
        assert!(rename_path(text(&lower), text(&other)).is_err());
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "b");
        let upper = dir.join("View.swift");
        rename_path(text(&lower), text(&upper)).unwrap();
        let names: Vec<String> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        assert!(names.contains(&"View.swift".to_string()));
        assert_eq!(std::fs::read_to_string(&upper).unwrap(), "a");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn duplicate_picks_a_free_numbered_name() {
        let dir = scratch("duplicate");
        let file = dir.join("ContentView.swift");
        std::fs::write(&file, "a").unwrap();
        let first = duplicate_path(text(&file)).unwrap();
        assert!(first.ends_with("ContentView 2.swift"));
        let second = duplicate_path(text(&file)).unwrap();
        assert!(second.ends_with("ContentView 3.swift"));
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "a");
        let folder = dir.join("Models");
        std::fs::create_dir_all(folder.join("Deep")).unwrap();
        std::fs::write(folder.join("Deep").join("x.swift"), "x").unwrap();
        let copy = duplicate_path(text(&folder)).unwrap();
        assert!(copy.ends_with("Models 2"));
        assert_eq!(std::fs::read_to_string(Path::new(&copy).join("Deep").join("x.swift")).unwrap(), "x");
        let hidden = dir.join(".gitignore");
        std::fs::write(&hidden, "b").unwrap();
        assert!(duplicate_path(text(&hidden)).unwrap().ends_with(".gitignore 2"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn import_copies_and_never_overwrites() {
        let outside = scratch("import-src");
        let dir = scratch("import-dst");
        std::fs::write(outside.join("logo.png"), [1u8, 2, 3]).unwrap();
        std::fs::write(dir.join("logo.png"), [9u8]).unwrap();
        let made = import_paths(vec![text(&outside.join("logo.png")), text(&outside.join("missing.png"))], text(&dir)).unwrap();
        assert_eq!(made.len(), 1);
        assert!(made[0].ends_with("logo 2.png"));
        assert_eq!(std::fs::read(dir.join("logo.png")).unwrap(), [9u8]);
        assert_eq!(std::fs::read(&made[0]).unwrap(), [1u8, 2, 3]);
        assert!(import_paths(vec![text(&dir.join("logo.png"))], text(&dir)).unwrap().is_empty());
        std::fs::remove_dir_all(&outside).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn move_refuses_collisions_and_self_nesting() {
        let dir = scratch("move");
        let a = dir.join("A");
        let b = dir.join("A").join("B");
        std::fs::create_dir_all(&b).unwrap();
        let file = dir.join("x.swift");
        std::fs::write(&file, "x").unwrap();
        std::fs::write(a.join("x.swift"), "taken").unwrap();
        assert!(move_path(text(&file), text(&a)).is_err());
        assert!(move_path(text(&a), text(&b)).is_err());
        assert_eq!(move_path(text(&file), text(&dir)).unwrap(), text(&file));
        let moved = move_path(text(&file), text(&b)).unwrap();
        assert!(Path::new(&moved).exists() && !file.exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn replace_in_file_counts_and_rewrites() {
        let dir = scratch("replace");
        let file = dir.join("a.swift");
        std::fs::write(&file, "let a = 1\nlet A = 2\n").unwrap();
        let exact = SearchOptions { case_sensitive: true, ..Default::default() };
        assert_eq!(replace_in_file(text(&file), "a".into(), "b".into(), exact).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "let b = 1\nlet A = 2\n");
        let groups = SearchOptions { regex: true, ..Default::default() };
        assert_eq!(replace_in_file(text(&file), r"let (\w) = (\d)".into(), "var $1 = $2$2".into(), groups).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "var b = 11\nvar A = 22\n");
        let literal = SearchOptions::default();
        assert_eq!(replace_in_file(text(&file), "var".into(), "$1".into(), literal).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "$1 b = 11\n$1 A = 22\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn search_honours_case_words_and_patterns() {
        let dir = scratch("search");
        std::fs::write(dir.join("a.swift"), "let count = 1\nlet counter = 2\nLET Count = 3\n").unwrap();
        std::fs::create_dir_all(dir.join(".build")).unwrap();
        std::fs::write(dir.join(".build").join("b.swift"), "let count = 9\n").unwrap();
        let root = text(&dir);
        let find = |query: &str, options: SearchOptions| search_in(&root, &matcher(query, &options).unwrap()).iter().map(|h| h.line).collect::<Vec<_>>();
        assert_eq!(find("count", SearchOptions::default()), vec![1, 2, 3]);
        assert_eq!(find("count", SearchOptions { case_sensitive: true, ..Default::default() }), vec![1, 2]);
        assert_eq!(find("count", SearchOptions { whole_word: true, ..Default::default() }), vec![1, 3]);
        assert_eq!(find(r"count\w+ = \d", SearchOptions { regex: true, ..Default::default() }), vec![2]);
        assert_eq!(find("a.swift", SearchOptions::default()), Vec::<u32>::new());
        assert!(matcher("(", &SearchOptions { regex: true, ..Default::default() }).is_err());
        assert!(matcher("(", &SearchOptions::default()).is_ok());
        let hit = &search_in(&root, &matcher("Count", &SearchOptions { case_sensitive: true, ..Default::default() }).unwrap())[0];
        assert_eq!((hit.line, hit.column), (3, 5));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn finds_swift_declarations() {
        let source = "import SwiftUI\n\n@Observable\nfinal class AppModel {\n    private func load() {}\n    static func make() -> AppModel { AppModel() }\n    var count = 0\n}\n\npublic struct ContentView: View {\n}\n  enum Zone: Int { case rest }\nextension ContentView {\n    class func helper() {}\n}\nprotocol Loadable {}\nactor Store {}\ntypealias ID = String\n@MainActor func refresh() async {}\n// struct Hidden {}\n";
        let mut out = Vec::new();
        symbols_in(source, "a.swift", &mut out, 100);
        let got: Vec<(String, String, u32)> = out.into_iter().map(|s| (s.kind, s.name, s.line)).collect();
        let want = [
            ("class", "AppModel", 4),
            ("func", "load", 5),
            ("func", "make", 6),
            ("struct", "ContentView", 10),
            ("enum", "Zone", 12),
            ("extension", "ContentView", 13),
            ("func", "helper", 14),
            ("protocol", "Loadable", 16),
            ("actor", "Store", 17),
            ("typealias", "ID", 18),
            ("func", "refresh", 19),
        ];
        assert_eq!(got, want.iter().map(|(k, n, l)| (k.to_string(), n.to_string(), *l)).collect::<Vec<_>>());
    }
}
