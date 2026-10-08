import { t } from "../i18n";
import { api, errorMessage } from "./ipc";
import { revealInExplorer } from "./links";
import { useStore } from "./store";

let running = false;

export async function takeScreenshot(device: { udid: string; name: string; osVersion?: string | null }): Promise<void> {
  if (running) return;
  running = true;
  const { toast } = useStore.getState();
  try {
    const path = await api.iphoneScreenshot(device.udid, device.name, device.osVersion ?? null);
    toast("success", t("dev.screenshotSaved"), { label: t("ctx.showInExplorer"), run: () => void revealInExplorer(path) });
  } catch (e) {
    toast("error", errorMessage(e));
  } finally {
    running = false;
  }
}
