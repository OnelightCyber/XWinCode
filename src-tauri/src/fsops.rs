use std::path::{Path, PathBuf};

use serde::Serialize;

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

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
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
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(err)?;
    }
    std::fs::write(&path, contents).map_err(err)
}

#[tauri::command]
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

#[tauri::command]
pub fn create_dir(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        return Err(t!("err.nameTaken"));
    }
    std::fs::create_dir_all(&path).map_err(err)
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    if Path::new(&to).exists() {
        return Err(t!("err.nameTaken"));
    }
    std::fs::rename(&from, &to).map_err(err)
}

#[tauri::command(async)]
pub fn delete_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
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
pub fn replace_in_file(path: String, query: String, replacement: String, case_sensitive: bool) -> Result<u32, String> {
    if query.is_empty() {
        return Ok(0);
    }
    let bytes = std::fs::read(&path).map_err(err)?;
    let text = String::from_utf8(bytes).map_err(|_| t!("err.binaryFile"))?;
    let re = regex::RegexBuilder::new(&regex::escape(&query)).case_insensitive(!case_sensitive).build().map_err(err)?;
    let count = re.find_iter(&text).count() as u32;
    if count > 0 {
        std::fs::write(&path, re.replace_all(&text, regex::NoExpand(&replacement)).as_bytes()).map_err(err)?;
    }
    Ok(count)
}

#[tauri::command]
pub async fn search_project(root: String, query: String, case_sensitive: bool) -> Result<Vec<SearchHit>, String> {
    if query.is_empty() {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let needle = if case_sensitive { query.clone() } else { query.to_lowercase() };
        let mut hits = Vec::new();
        let walker = walkdir::WalkDir::new(&root).into_iter().filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !(e.depth() > 0 && HIDDEN.contains(&name.as_ref()))
        });
        for entry in walker.flatten() {
            if !entry.file_type().is_file() || entry.metadata().map(|m| m.len() > 2 * 1024 * 1024).unwrap_or(true) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
            for (i, line) in text.lines().enumerate() {
                let hay = if case_sensitive { line.to_string() } else { line.to_lowercase() };
                if let Some(col) = hay.find(&needle) {
                    hits.push(SearchHit {
                        path: entry.path().to_string_lossy().to_string(),
                        line: i as u32 + 1,
                        column: hay[..col].chars().count() as u32 + 1,
                        text: line.trim().chars().take(200).collect(),
                    });
                    if hits.len() >= 1000 {
                        return hits;
                    }
                }
            }
        }
        hits
    })
    .await
    .map_err(err)
}
