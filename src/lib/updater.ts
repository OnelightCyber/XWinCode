import { isTauri } from "./ipc";

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
}

type PendingUpdate = Awaited<ReturnType<typeof import("@tauri-apps/plugin-updater").check>>;

let pending: PendingUpdate = null;

export async function findUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  pending = await check({ timeout: 20000 });
  return pending ? { version: pending.version, notes: pending.body ?? "", date: pending.date ?? null } : null;
}

export async function installUpdate(onProgress: (fraction: number | null) => void): Promise<void> {
  if (!pending) throw new Error("no update");
  let total = 0;
  let received = 0;
  await pending.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress(total ? 0 : null);
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(total ? Math.min(1, received / total) : null);
    } else {
      onProgress(1);
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
