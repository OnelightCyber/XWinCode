use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::settings::{self, RecentProject};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ProjectKind {
    IosApp,
    Executable,
    Library,
    Unknown,
}

impl ProjectKind {
    fn as_str(self) -> &'static str {
        match self {
            ProjectKind::IosApp => "iosApp",
            ProjectKind::Executable => "executable",
            ProjectKind::Library => "library",
            ProjectKind::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub name: String,
    pub kind: ProjectKind,
    pub bundle_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectOptions {
    pub template: String,
    pub name: String,
    pub organization_id: String,
    pub location: String,
}

pub fn validate_name(name: &str) -> Result<(), String> {
    let mut chars = name.chars();
    let Some(first) = chars.next() else { return Err(t!("err.nameEmpty")) };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(t!("err.nameStart"));
    }
    if let Some(bad) = name.chars().find(|c| !(c.is_ascii_alphanumeric() || *c == '_' || *c == '-')) {
        return Err(t!("err.nameChar", char = bad));
    }
    Ok(())
}

fn validate_org(org: &str) -> Result<(), String> {
    let ok = !org.is_empty()
        && org.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
    if ok {
        Ok(())
    } else {
        Err(t!("err.orgId"))
    }
}

fn swift_text(s: &str) -> String {
    s.replace('"', "'")
}

fn template_files(template: &str, name: &str, org: &str) -> Result<Vec<(String, String)>, String> {
    let module = name.replace('-', "_");
    let library_comment = t!("tpl.ios.libraryComment");
    let gitignore = "\
.DS_Store
/.build
/Packages
xcuserdata/
DerivedData/
.swiftpm/configuration/registries.json
.swiftpm/xcode/package.xcworkspace/contents.xcworkspacedata
.netrc
/xtool
"
    .to_string();

    let files = match template {
        "iosApp" => vec![
            (
                "Package.swift".to_string(),
                format!(
                    r#"// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "{name}",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        // {library_comment}
        .library(
            name: "{module}",
            targets: ["{module}"]
        ),
    ],
    targets: [
        .target(
            name: "{module}"
        ),
    ]
)
"#
                ),
            ),
            ("xtool.yml".to_string(), format!("version: 1\nbundleID: {org}.{}\n", name.replace('_', "-"))),
            (".gitignore".to_string(), gitignore),
            (
                format!("Sources/{module}/{module}App.swift"),
                format!(
                    r#"import SwiftUI

@main
struct {module}App: App {{
    var body: some Scene {{
        WindowGroup {{
            ContentView()
        }}
    }}
}}
"#
                ),
            ),
            (
                format!("Sources/{module}/ContentView.swift"),
                r#"import SwiftUI

struct ContentView: View {
    @State private var taps = 0

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "hammer.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)

            Text("{title}")
                .font(.title2.bold())
                .multilineTextAlignment(.center)

            Button {
                taps += 1
            } label: {
                Label("{taps}", systemImage: "hand.tap")
                    .padding(.horizontal, 8)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}
"#
                .replace("{title}", &swift_text(&t!("tpl.ios.title")))
                .replace("{taps}", &swift_text(&t!("tpl.ios.taps"))),
            ),
        ],
        "executable" => vec![
            (
                "Package.swift".to_string(),
                format!(
                    r#"// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "{name}",
    targets: [
        .executableTarget(
            name: "{module}"
        ),
    ]
)
"#
                ),
            ),
            (".gitignore".to_string(), gitignore),
            (
                format!("Sources/{module}/main.swift"),
                format!(
                    "// {}\n\nprint(\"{}\")\n\nlet languages = [\"Swift\", \"Rust\", \"TypeScript\"]\nfor (index, language) in languages.enumerated() {{\n    print(\"\\(index + 1). \\(language)\")\n}}\n",
                    t!("tpl.cli.comment"),
                    swift_text(&t!("tpl.cli.hello"))
                ),
            ),
        ],
        "library" => vec![
            (
                "Package.swift".to_string(),
                format!(
                    r#"// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "{name}",
    products: [
        .library(
            name: "{module}",
            targets: ["{module}"]
        ),
    ],
    targets: [
        .target(
            name: "{module}"
        ),
        .testTarget(
            name: "{module}Tests",
            dependencies: ["{module}"]
        ),
    ]
)
"#
                ),
            ),
            (".gitignore".to_string(), gitignore),
            (
                format!("Sources/{module}/{module}.swift"),
                format!("/// {}\npublic func add(_ a: Int, _ b: Int) -> Int {{\n    a + b\n}}\n", t!("tpl.lib.comment")),
            ),
            (
                format!("Tests/{module}Tests/{module}Tests.swift"),
                format!(
                    r#"import Testing
@testable import {module}

@Test func addition() {{
    #expect(add(2, 3) == 5)
}}
"#
                ),
            ),
        ],
        other => return Err(t!("err.unknownTemplate", template = other)),
    };
    Ok(files)
}

pub fn inspect(root: &Path) -> Result<ProjectInfo, String> {
    let package = root.join("Package.swift");
    if !package.is_file() {
        return Err(t!("err.noPackage"));
    }
    let manifest = std::fs::read_to_string(&package).unwrap_or_default();
    let folder_name = root.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let name = package_name(&manifest).unwrap_or(folder_name);

    let xtool = root.join("xtool.yml");
    let (kind, bundle_id) = if xtool.is_file() {
        let yml = std::fs::read_to_string(&xtool).unwrap_or_default();
        let bundle = yml
            .lines()
            .find_map(|l| l.trim().strip_prefix("bundleID:").map(|v| v.trim().trim_matches('"').to_string()));
        (ProjectKind::IosApp, bundle)
    } else if manifest.contains(".executableTarget(") || manifest.contains(".executable(") {
        (ProjectKind::Executable, None)
    } else if manifest.contains(".library(") || manifest.contains(".target(") {
        (ProjectKind::Library, None)
    } else {
        (ProjectKind::Unknown, None)
    };

    Ok(ProjectInfo { root: root.to_string_lossy().to_string(), name, kind, bundle_id })
}

fn package_name(manifest: &str) -> Option<String> {
    let start = manifest.find("Package(")?;
    let rest = &manifest[start..];
    let key = rest.find("name:")?;
    let after = &rest[key + 5..];
    let q1 = after.find('"')?;
    let after = &after[q1 + 1..];
    let q2 = after.find('"')?;
    Some(after[..q2].to_string())
}

fn remember(app: &AppHandle, info: &ProjectInfo) {
    settings::push_recent(
        app,
        RecentProject {
            path: info.root.clone(),
            name: info.name.clone(),
            kind: info.kind.as_str().into(),
            opened_at: chrono::Local::now().to_rfc3339(),
        },
    );
}

#[tauri::command(async)]
pub fn create_project(app: AppHandle, options: NewProjectOptions) -> Result<ProjectInfo, String> {
    validate_name(&options.name)?;
    validate_org(&options.organization_id)?;
    let root = PathBuf::from(&options.location).join(&options.name);
    if root.exists() {
        return Err(t!("err.folderExists", path = root.display()));
    }
    let files = template_files(&options.template, &options.name, &options.organization_id)?;
    for (rel, contents) in files {
        let path = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    }
    let mut s = settings::load(&app);
    s.organization_id = options.organization_id.clone();
    let _ = settings::store(&app, &s);

    let info = inspect(&root)?;
    crate::trust::trust(&app, &info.root)?;
    remember(&app, &info);
    Ok(info)
}

#[tauri::command(async)]
pub fn open_project(app: AppHandle, path: String) -> Result<ProjectInfo, String> {
    let mut root = PathBuf::from(&path);
    if root.is_file() {
        root = root.parent().map(Path::to_path_buf).unwrap_or(root);
    }
    let info = inspect(&root)?;
    remember(&app, &info);
    Ok(info)
}

#[tauri::command]
pub fn default_projects_dir(app: AppHandle) -> String {
    if let Some(dir) = crate::settings::load(&app).projects_dir.filter(|d| !d.trim().is_empty()) {
        return dir;
    }
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .map(|d| d.join("XWinCode Projects").to_string_lossy().to_string())
        .unwrap_or_else(|_| "C:\\".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(validate_name("MyApp").is_ok());
        assert!(validate_name("my-app_2").is_ok());
        assert!(validate_name("2app").is_err());
        assert!(validate_name("mon app").is_err());
    }

    #[test]
    fn manifest_name() {
        let m = "// swift-tools-version: 6.0\nlet package = Package(\n    name: \"Hello\",\n";
        assert_eq!(package_name(m).as_deref(), Some("Hello"));
    }

    #[test]
    fn templates_exist() {
        for t in ["iosApp", "executable", "library"] {
            assert!(!template_files(t, "Demo-App", "com.test").unwrap().is_empty());
        }
    }
}
