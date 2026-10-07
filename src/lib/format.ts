import { useEffect, useState } from "react";
import { locale, t } from "../i18n";
import { isTauri } from "./ipc";

const formatters = new Map<string, Intl.RelativeTimeFormat>();

function rtf(): Intl.RelativeTimeFormat {
  const tag = locale();
  let f = formatters.get(tag);
  if (!f) {
    f = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });
    formatters.set(tag, f);
  }
  return f;
}

export function relativeTime(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const s = Math.round((at - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return t("time.justNow");
  if (abs < 3600) return rtf().format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf().format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf().format(Math.round(s / 86400), "day");
  if (abs < 86400 * 365) return rtf().format(Math.round(s / (86400 * 30)), "month");
  return rtf().format(Math.round(s / (86400 * 365)), "year");
}

export function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

export function shortDate(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? "" : new Date(at).toLocaleDateString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function prettyPath(path: string): string {
  return path.replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}

let cachedVersion: string | null = null;

export function useAppVersion(): string {
  const [version, setVersion] = useState(cachedVersion ?? "0.1.0");
  useEffect(() => {
    if (cachedVersion || !isTauri) return;
    void import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((v) => {
        cachedVersion = v;
        setVersion(v);
      })
      .catch(() => undefined);
  }, []);
  return version;
}
