import { useEffect, useState } from "react";
import { DebugArea } from "./components/DebugArea";
import { DevicesSheet } from "./components/DevicesSheet";
import { EditorArea } from "./components/EditorArea";
import { Ambient, Hud } from "./components/Hud";
import { Inspector } from "./components/Inspector";
import { LibrarySheet } from "./components/Library";
import { Navigator } from "./components/Navigator";
import { NewProjectSheet } from "./components/NewProjectSheet";
import { ProjectSettingsSheet } from "./components/ProjectSettingsSheet";
import { QuickOpen } from "./components/QuickOpen";
import { Resizer, usePanelSize } from "./components/Resizer";
import { SettingsSheet } from "./components/SettingsSheet";
import { Toasts } from "./components/Toasts";
import { requestClose, Toolbar } from "./components/Toolbar";
import { UpdateSheet } from "./components/UpdateSheet";
import { Welcome } from "./components/Welcome";
import { resolveLanguage, setLanguage, t, tn, useLanguage } from "./i18n";
import { handleKeydown } from "./lib/commands";
import { pickFile } from "./lib/dialogs";
import { installGlassPointer } from "./lib/glass";
import { api, isTauri, on, type TaskDiagnosticEvent, type TaskExitEvent, type TaskOutputEvent, type TaskStartEvent } from "./lib/ipc";
import { monaco } from "./lib/monaco";
import { windowsToWsl, wslToWindows } from "./lib/paths";
import { resultLabel, useStore } from "./lib/store";
import type { LogLine } from "./lib/types";

function useTaskEvents() {
  useEffect(() => {
    let pending: Omit<LogLine, "id">[] = [];
    let frame = 0;
    let artifact: string | null = null;
    let askedXip = false;
    const flush = () => {
      frame = 0;
      const lines = pending;
      pending = [];
      useStore.getState().pushLog(lines);
    };
    const subs = [
      on<TaskStartEvent>("task://start", (e) => {
        artifact = null;
        askedXip = false;
        const { task, setTask, pushLog } = useStore.getState();
        if (task && task.status === "running" && (task.id === -1 || task.id === e.taskId))
          setTask({ ...task, id: e.taskId, command: e.command, label: task.action === "setup" ? e.label : task.label });
        pushLog([{ stream: "system", text: `$ ${e.command}` }]);
      }),
      on<TaskOutputEvent>("task://output", (e) => {
        for (const line of e.lines) {
          const m = /^Wrote to (.+)$/.exec(line.trim());
          if (m) artifact = wslToWindows(m[1]);
          pending.push({ stream: e.stream, text: line });
          if (!askedXip && /Path to Xcode\.xip/i.test(line)) {
            askedXip = true;
            void answerXipPrompt();
          }
        }
        if (!frame) frame = requestAnimationFrame(flush);
      }),
      on<TaskDiagnosticEvent>("task://diagnostic", (e) => {
        const { taskId: _ignored, ...d } = e;
        useStore.getState().addDiagnostic(d);
      }),
      on<TaskExitEvent>("task://exit", (e) => {
        if (frame) {
          cancelAnimationFrame(frame);
          flush();
        }
        const state = useStore.getState();
        const { task, setTask, pushLog, toast, diagnostics, settings } = state;
        if (!task || task.id !== e.taskId) return;
        const status = e.cancelled ? "cancelled" : e.success ? "succeeded" : "failed";
        setTask({ ...task, status, durationMs: e.durationMs, exitCode: e.code });
        const secs = (e.durationMs / 1000).toFixed(1);
        const showHud = (kind: "success" | "error", text: string) => {
          if (settings?.showBuildHud !== false) state.showHud(kind, text);
        };
        const iosRun = task.action === "run" && !!task.target?.ios;
        if (status === "succeeded") {
          const done = resultLabel(task.action, "ok");
          pushLog([{ stream: "system", text: `✓ ${done} (${secs} s)` }]);
          if (task.action !== "run" || iosRun) showHud("success", iosRun ? t("hud.installed") : done);
          if (artifact && !iosRun) toast("success", `${done}\n${artifact}`);
          if (iosRun && task.target?.udid) {
            void state.recordInstall(task.target, artifact);
            if (state.deviceLogState === "off") void state.startDeviceLog(task.target.udid);
          }
        } else if (status === "failed") {
          const errors = diagnostics.filter((d) => d.severity === "error").length;
          const failed = resultLabel(task.action, "failed");
          pushLog([{ stream: "system", text: `✗ ${failed}${e.code !== null ? ` (code ${e.code})` : ""}`, severity: "error" }]);
          if (task.action !== "run" || iosRun || errors) showHud("error", errors ? tn("hud.errors", errors) : failed);
          else toast("error", t("toast.exitCode", { code: e.code ?? "?" }));
        } else {
          pushLog([{ stream: "system", text: `■ ${resultLabel(task.action, "stopped")}` }]);
        }
        if (task.action === "setup") void state.checkToolchain();
      }),
      on<{ session: number; lines: string[] }>("devicelog://lines", (e) => useStore.getState().appendDeviceLog(e.session, e.lines)),
      on<{ session: number }>("devicelog://exit", (e) => useStore.getState().endDeviceLog(e.session)),
    ];
    return () => {
      subs.forEach((p) => void p.then((u) => u()));
    };
  }, []);
}

async function answerXipPrompt() {
  const { toast, pushLog, stop } = useStore.getState();
  toast("info", t("toast.chooseXip"));
  const path = await pickFile(t("dialog.chooseXip"), ["xip"], t("dialog.xcodeArchive"));
  if (!path) {
    pushLog([{ stream: "system", text: t("log.xipSkipped"), severity: "warning" }]);
    await stop();
    return;
  }
  pushLog([{ stream: "system", text: `› ${path}` }]);
  await api.sendTaskInput(windowsToWsl(path)).catch((e) => toast("error", String(e)));
}

function useTheme() {
  const pref = useStore((s) => s.settings?.theme ?? "system");
  const editorTheme = useStore((s) => s.settings?.editorTheme ?? "mono");
  const material = useStore((s) => s.settings?.material ?? "mica");
  const reduceMotion = useStore((s) => s.settings?.reduceMotion ?? false);
  const vibrancy = useStore((s) => s.vibrancy);
  useEffect(() => {
    let cancelled = false;
    const apply = (dark: boolean) => {
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      monaco.editor.setTheme(`xwincode-${editorTheme === "xcode" ? "" : "mono-"}${dark ? "dark" : "light"}`);
      if (isTauri)
        void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
          getCurrentWindow()
            .setTheme(dark ? "dark" : "light")
            .catch(() => undefined),
        );
    };
    const resolve = async () => {
      let dark = pref === "dark";
      if (pref === "system") dark = (await api.systemTheme().catch(() => "dark")) === "dark";
      if (!cancelled && dark !== (document.documentElement.dataset.theme === "dark")) apply(dark);
    };
    apply(pref === "light" ? false : pref === "dark" ? true : document.documentElement.dataset.theme !== "light");
    void resolve();
    window.addEventListener("focus", resolve);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", resolve);
    };
  }, [pref, editorTheme]);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("vibrant", vibrancy);
    root.dataset.material = vibrancy ? material : "none";
    root.classList.toggle("reduce-motion", reduceMotion);
  }, [vibrancy, material, reduceMotion]);
}

function useInterfaceLanguage() {
  const pref = useStore((s) => s.settings?.language);
  useLanguage((s) => s.lang);
  useEffect(() => {
    if (pref === undefined) return;
    const lang = resolveLanguage(pref);
    setLanguage(lang);
    void api.setLanguage(lang).catch(() => undefined);
  }, [pref]);
}

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

export default function App() {
  const project = useStore((s) => s.project);
  const sheet = useStore((s) => s.sheet);
  const showNavigator = useStore((s) => s.navigator);
  const showDebug = useStore((s) => s.debugArea);
  const showInspector = useStore((s) => s.inspector);
  const settingsLoaded = useStore((s) => !!s.settings);
  const { w, h } = useWindowSize();
  const side = Math.max(0, w - 420 - 40);
  const nav = usePanelSize("navigator", 270, 200, Math.max(200, Math.min(520, showInspector ? side * 0.55 : side)));
  const insp = usePanelSize("inspector", 280, 220, Math.max(220, Math.min(480, showNavigator ? side * 0.45 : side)));
  const debug = usePanelSize("debug", 230, 110, Math.max(110, Math.min(720, h - 54 - 260)));

  useInterfaceLanguage();
  useTaskEvents();
  useTheme();

  useEffect(() => {
    void useStore.getState().init();
    installGlassPointer();
    window.addEventListener("keydown", handleKeydown, true);
    const noMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("input, textarea, .monaco-editor")) e.preventDefault();
    };
    window.addEventListener("contextmenu", noMenu);
    const poll = window.setInterval(() => void useStore.getState().refreshDevices(), 6000);
    let unlistenClose: (() => void) | undefined;
    if (isTauri)
      void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
        unlistenClose = await getCurrentWindow().onCloseRequested((e) => {
          e.preventDefault();
          void requestClose();
        });
      });
    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("contextmenu", noMenu);
      window.clearInterval(poll);
      unlistenClose?.();
    };
  }, []);

  return (
    <div className="app">
      <Ambient />
      <Toolbar />
      {project && (
        <div className="workspace">
          {showNavigator && (
            <>
              <Navigator width={nav.size} />
              <Resizer axis="x" onDrag={nav.drag} onEnd={nav.end} />
            </>
          )}
          <main className="center">
            <EditorArea />
            {showDebug && <Resizer axis="y" onDrag={(d) => debug.drag(-d)} onEnd={debug.end} />}
            <DebugArea height={debug.size} visible={showDebug} />
          </main>
          {showInspector && (
            <>
              <Resizer axis="x" onDrag={(d) => insp.drag(-d)} onEnd={insp.end} />
              <Inspector width={insp.size} />
            </>
          )}
        </div>
      )}
      {!project && settingsLoaded && <Welcome />}
      {sheet === "newProject" && <NewProjectSheet />}
      {sheet === "devices" && <DevicesSheet />}
      {sheet === "settings" && <SettingsSheet />}
      {sheet === "quickOpen" && project && <QuickOpen />}
      {sheet === "commands" && <QuickOpen commandMode />}
      {sheet === "project" && project && <ProjectSettingsSheet />}
      {sheet === "library" && project && <LibrarySheet />}
      {sheet === "update" && <UpdateSheet />}
      <Hud />
      <Toasts />
    </div>
  );
}
