import { t } from "../i18n";
import { isTauri } from "./ipc";

export async function confirmAsk(message: string, okLabel = t("common.continue"), cancelLabel = t("common.cancel")): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title: "XWinCode", kind: "warning", okLabel, cancelLabel });
}

export async function askTrust(name: string): Promise<boolean> {
  const text = t("trust.message", { name });
  if (!isTauri) return window.confirm(text);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(text, { title: t("trust.title"), kind: "warning", okLabel: t("trust.trust"), cancelLabel: t("trust.restricted") });
}

export async function saveChoice(name: string): Promise<"save" | "discard" | "cancel"> {
  const text = t("dialog.saveChanges", { name });
  if (!isTauri) return window.confirm(text) ? "save" : "discard";
  const { message } = await import("@tauri-apps/plugin-dialog");
  const save = t("dialog.save");
  const discard = t("dialog.dontSave");
  const r = await message(`${text}\n${t("dialog.saveChangesDetail")}`, {
    title: "XWinCode",
    kind: "warning",
    buttons: { yes: save, no: discard, cancel: t("common.cancel") },
  });
  if (r === "Yes" || r === save) return "save";
  if (r === "No" || r === discard) return "discard";
  return "cancel";
}

export async function pickFolder(title: string, defaultPath?: string): Promise<string | null> {
  if (!isTauri) return defaultPath ?? null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: true, multiple: false, title, defaultPath });
  return typeof r === "string" ? r : null;
}

export async function pickFile(title: string, extensions: string[], name: string): Promise<string | null> {
  if (!isTauri) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ directory: false, multiple: false, title, filters: [{ name, extensions }] });
  return typeof r === "string" ? r : null;
}
