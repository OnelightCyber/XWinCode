use std::collections::HashMap;
use std::sync::RwLock;

use once_cell::sync::Lazy;

macro_rules! locales {
    ($($code:literal),* $(,)?) => {
        &[$(($code, include_str!(concat!("../../src/i18n/locales/", $code, ".json")))),*]
    };
}

const SOURCES: &[(&str, &str)] = locales!("en", "fr", "es", "de", "pt", "it", "zh", "ja");

static TABLES: Lazy<HashMap<&'static str, HashMap<String, String>>> = Lazy::new(|| {
    SOURCES
        .iter()
        .map(|(code, json)| (*code, serde_json::from_str(json).unwrap_or_else(|e| panic!("locale {code}.json invalide : {e}"))))
        .collect()
});

static CURRENT: RwLock<&'static str> = RwLock::new("en");

fn supported(code: &str) -> Option<&'static str> {
    SOURCES.iter().map(|(c, _)| *c).find(|c| *c == code)
}

pub fn resolve(preference: &str) -> &'static str {
    if let Some(code) = supported(preference) {
        return code;
    }
    let system = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    supported(system.split(['-', '_']).next().unwrap_or("en")).unwrap_or("en")
}

pub fn set(preference: &str) {
    *CURRENT.write().unwrap() = resolve(preference);
}

pub fn tr(key: &str) -> String {
    let lang = *CURRENT.read().unwrap();
    TABLES
        .get(lang)
        .and_then(|t| t.get(key))
        .or_else(|| TABLES.get("en").and_then(|t| t.get(key)))
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

pub fn trf(key: &str, args: &[(&str, &str)]) -> String {
    let mut text = tr(key);
    for (name, value) in args {
        text = text.replace(&format!("{{{name}}}"), value);
    }
    text
}

#[macro_export]
macro_rules! t {
    ($key:literal) => {
        $crate::i18n::tr($key)
    };
    ($key:literal, $($name:ident = $value:expr),+ $(,)?) => {
        $crate::i18n::trf($key, &[$((stringify!($name), &($value).to_string())),+])
    };
}

#[tauri::command]
pub fn set_language(language: String) {
    set(&language);
}

#[cfg(test)]
mod tests {
    use super::*;

    static PLACEHOLDER: Lazy<regex::Regex> = Lazy::new(|| regex::Regex::new(r"\{(\w+)\}").unwrap());

    fn placeholders(s: &str) -> Vec<String> {
        let mut out: Vec<String> = PLACEHOLDER.captures_iter(s).map(|c| c[1].to_string()).collect();
        out.sort();
        out
    }

    #[test]
    fn locales_parse_and_match_english_placeholders() {
        let en = &TABLES["en"];
        assert!(en.len() > 100, "en.json should hold every key");
        for (code, table) in TABLES.iter() {
            for (key, text) in table {
                let reference = en.get(key).unwrap_or_else(|| panic!("{code}.json: {key} is not in en.json"));
                assert_eq!(placeholders(reference), placeholders(text), "{code}.json: {key} must keep the placeholders of en.json");
            }
        }
    }

    #[test]
    fn fills_placeholders_and_falls_back() {
        assert_eq!(trf("missing.key.{x}", &[]), "missing.key.{x}");
        assert!(resolve("fr") == "fr" && resolve("klingon") != "klingon");
    }
}
