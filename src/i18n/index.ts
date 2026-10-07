import { create } from "zustand";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import es from "./locales/es.json";
import de from "./locales/de.json";
import pt from "./locales/pt.json";
import it from "./locales/it.json";
import zh from "./locales/zh.json";
import ja from "./locales/ja.json";

export type Dict = typeof en;
export type TKey = keyof Dict;
export type PluralKey = TKey extends infer K ? (K extends `${infer B}_other` ? B : never) : never;

export const LANGUAGES = [
  { code: "en", name: "English", locale: "en-US" },
  { code: "fr", name: "Français", locale: "fr-FR" },
  { code: "es", name: "Español", locale: "es-ES" },
  { code: "de", name: "Deutsch", locale: "de-DE" },
  { code: "pt", name: "Português (Brasil)", locale: "pt-BR" },
  { code: "it", name: "Italiano", locale: "it-IT" },
  { code: "zh", name: "简体中文", locale: "zh-CN" },
  { code: "ja", name: "日本語", locale: "ja-JP" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

const DICTS: Record<Lang, Partial<Dict>> = { en, fr, es, de, pt, it, zh, ja };

let lang: Lang = "en";
let dict: Partial<Dict> = en;
let plurals = new Intl.PluralRules("en-US");

export const useLanguage = create<{ lang: Lang }>(() => ({ lang: "en" }));

function isLang(code: string): code is Lang {
  return code in DICTS;
}

export function resolveLanguage(preference: string | undefined): Lang {
  if (preference && preference !== "system" && isLang(preference)) return preference;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLang(base)) return base;
  }
  return "en";
}

export function setLanguage(code: Lang) {
  lang = code;
  dict = DICTS[code];
  plurals = new Intl.PluralRules(locale());
  document.documentElement.lang = code;
  useLanguage.setState({ lang: code });
}

export function currentLanguage(): Lang {
  return lang;
}

export function locale(): string {
  return LANGUAGES.find((l) => l.code === lang)?.locale ?? "en-US";
}

function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function t(key: TKey, params?: Record<string, string | number>): string {
  return fill(dict[key] ?? en[key] ?? key, params);
}

export function tn(key: PluralKey, count: number, params?: Record<string, string | number>): string {
  const exact = `${key}_${plurals.select(count)}` as TKey;
  const other = `${key}_other` as TKey;
  const text = dict[exact] ?? dict[other] ?? en[exact] ?? en[other] ?? key;
  return fill(text, { count: count.toLocaleString(locale()), ...params });
}

export function keys(shortcut: string): string {
  const names: Record<string, TKey> = {
    Ctrl: "key.ctrl",
    Shift: "key.shift",
    Alt: "key.alt",
    Del: "key.del",
    Enter: "key.enter",
    Esc: "key.esc",
    Tab: "key.tab",
  };
  return shortcut
    .split("+")
    .map((part) => (names[part] ? t(names[part]) : part))
    .join("+");
}
