import { isTauri } from "./ipc";

const EXTERNAL = /^(https?:\/\/|mailto:)/i;

export function isExternalUrl(url: string): boolean {
  return EXTERNAL.test(url);
}

export async function revealInExplorer(path: string): Promise<void> {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

export async function openExternal(url: string): Promise<void> {
  if (!isExternalUrl(url)) return;
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else window.open(url, "_blank", "noopener,noreferrer");
}
