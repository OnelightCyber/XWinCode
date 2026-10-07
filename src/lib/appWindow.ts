import { t, tn } from "../i18n";
import { api } from "./ipc";
import { isDirty } from "./models";
import { useStore } from "./store";

export async function appWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function requestClose() {
  const s = useStore.getState();
  const dirty = s.tabs.filter((p) => isDirty(p));
  if (dirty.length) {
    if (s.settings?.autoSave) await s.saveAll();
    else {
      const { ask } = await import("@tauri-apps/plugin-dialog");
      const ok = await ask(tn("dialog.quitUnsaved", dirty.length), {
        title: "XWinCode",
        kind: "warning",
        okLabel: t("dialog.quit"),
        cancelLabel: t("common.cancel"),
      });
      if (!ok) return;
    }
  }
  if (s.task?.status === "running") await s.stop();
  await api.quitApp();
}
