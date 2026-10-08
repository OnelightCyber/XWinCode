use std::fmt::Write as _;
use std::path::{Path, PathBuf};

fn collect(dir: &Path, base: &Path, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "xtool" || name == "xtool.yml" {
            continue;
        }
        if path.is_dir() {
            collect(&path, base, out);
        } else {
            let rel = path.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
            out.push((rel, path));
        }
    }
}

fn embed_preview_app() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("preview-app");
    println!("cargo:rerun-if-changed={}", root.display());
    let mut files = Vec::new();
    collect(&root, &root, &mut files);
    let mut code = String::from("pub static PREVIEW_FILES: &[(&str, &str)] = &[\n");
    for (rel, path) in files {
        let _ = writeln!(code, "    ({rel:?}, include_str!({:?})),", path.to_string_lossy());
    }
    code.push_str("];\n");
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("preview_files.rs");
    std::fs::write(out, code).unwrap();
}

fn main() {
    embed_preview_app();
    tauri_build::build()
}
