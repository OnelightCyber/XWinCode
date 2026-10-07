import { create } from "zustand";
import { t, tn, type TKey } from "../i18n";
import { askTrust, confirmAsk, saveChoice } from "./dialogs";
import { relativeTime } from "./format";
import { api, errorMessage } from "./ipc";
import { formatModel, startLsp, stopLsp } from "./lsp";
import { allDocs, createDoc, disposeAll, disposeDoc, getDoc, isDirty, markSaved } from "./models";
import { basename, dirname, join, normalize, samePath } from "./paths";
import { findUpdate, installUpdate, type UpdateInfo } from "./updater";
import type {
  BuildAction,
  Configuration,
  Destination,
  Device,
  DeviceLine,
  Diagnostic,
  Entry,
  InstallRecord,
  LogLine,
  ProjectInfo,
  Settings,
  TaskState,
  TaskTarget,
  ToolComponent,
} from "./types";

export type Sheet = null | "newProject" | "devices" | "settings" | "quickOpen" | "commands" | "project" | "library" | "update";

export interface TerminalTab {
  key: number;
  shell: "powershell" | "cmd" | "wsl";
  title: string;
}
export type NavTab = "project" | "search" | "issues";
export type SettingsTab = "general" | "appearance" | "editor" | "terminal" | "build" | "devices" | "tools" | "shortcuts" | "about";
export type WslState = "idle" | "starting" | "ready" | "error";
export type DebugTab = "console" | "device" | number;
export type DeviceLogState = "off" | "starting" | "live" | "error" | "missing";
export type UpdateState = "idle" | "checking" | "none" | "available" | "downloading" | "error";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
  action?: ToastAction;
}

interface Reveal {
  path: string;
  line: number;
  column: number;
  nonce: number;
}

const MAX_LOG = 20000;
const MAX_DEVICE_LOG = 20000;
const MISSING_TOOLS = "XWC_MISSING_TOOLS";

interface State {
  settings: Settings | null;
  project: ProjectInfo | null;
  trusted: boolean;
  dirs: Record<string, Entry[]>;
  expanded: Record<string, boolean>;
  selected: string | null;
  tabs: string[];
  active: string | null;
  dirtyTick: number;
  cursor: { line: number; column: number; selection: number };
  reveal: Reveal | null;

  task: TaskState | null;
  log: LogLine[];
  diagnostics: Diagnostic[];

  devices: Device[];
  devicesError: string | null;
  destination: Destination;
  configuration: Configuration;

  navigator: boolean;
  debugArea: boolean;
  inspector: boolean;
  navTab: NavTab;
  sheet: Sheet;
  settingsTab: SettingsTab;
  toolchain: ToolComponent[] | null;
  toolchainLoading: boolean;
  toasts: Toast[];
  vibrancy: boolean;
  terminals: TerminalTab[];
  debugTab: DebugTab;
  hud: { kind: "success" | "error"; text: string; nonce: number } | null;
  wsl: WslState;
  wslBootMs: number | null;
  wslError: string | null;

  deviceLog: DeviceLine[];
  deviceLogState: DeviceLogState;
  deviceLogError: string | null;
  deviceLogSession: number | null;
  deviceLogUdid: string | null;
  deviceLogFilter: "app" | "all";

  installs: InstallRecord[];

  update: UpdateInfo | null;
  updateState: UpdateState;
  updateProgress: number | null;
  updateError: string | null;
}

interface Actions {
  init(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  openProject(path: string): Promise<void>;
  setProject(info: ProjectInfo): Promise<void>;
  ensureTrusted(): Promise<boolean>;
  closeProject(): Promise<boolean>;
  loadDir(path: string): Promise<void>;
  toggleDir(path: string, open?: boolean): void;
  refreshTree(): Promise<void>;
  select(path: string | null): void;
  openFile(path: string, at?: { line: number; column?: number }): Promise<void>;
  closeTab(path: string): Promise<void>;
  setActive(path: string): void;
  touchDirty(): void;
  save(path?: string, options?: { format?: boolean }): Promise<void>;
  saveAll(): Promise<void>;
  build(action: BuildAction): Promise<void>;
  stop(): Promise<void>;
  refreshDevices(): Promise<void>;
  setDestination(d: Destination): void;
  setConfiguration(c: Configuration): void;
  toggle(panel: "navigator" | "debugArea" | "inspector"): void;
  setNavTab(tab: NavTab): void;
  openSheet(s: Sheet, tab?: SettingsTab): void;
  checkToolchain(): Promise<void>;
  toast(kind: Toast["kind"], text: string, action?: ToastAction): void;
  dismissToast(id: number): void;
  setCursor(c: State["cursor"]): void;
  clearLog(): void;
  pushLog(lines: Omit<LogLine, "id">[]): void;
  addDiagnostic(d: Diagnostic): void;
  setTask(task: TaskState | null): void;
  pathRenamed(from: string, to: string): void;
  pathDeleted(path: string): void;
  addTerminal(shell?: TerminalTab["shell"]): void;
  closeTerminal(key: number): void;
  renameTerminal(key: number, title: string): void;
  setDebugTab(tab: DebugTab): void;
  showHud(kind: "success" | "error", text: string): void;
  runTask(label: string, action: TaskState["action"], start: () => Promise<number>, target?: TaskTarget): Promise<void>;
  warmWsl(): Promise<void>;

  startDeviceLog(udid?: string): Promise<void>;
  stopDeviceLog(): Promise<void>;
  clearDeviceLog(): void;
  setDeviceLogFilter(filter: "app" | "all"): void;
  appendDeviceLog(session: number, lines: string[]): void;
  endDeviceLog(session: number): void;

  refreshInstalls(): Promise<void>;
  recordInstall(target: TaskTarget, appPath: string | null): Promise<void>;
  reinstall(record: InstallRecord): Promise<void>;

  checkForUpdate(manual: boolean): Promise<void>;
  installUpdate(): Promise<void>;
}

export type Store = State & Actions;

let logId = 0;
let deviceLineId = 0;
let terminalKey = 0;
let toastId = 0;
const k = (p: string) => p.toLowerCase();
const remindedInstalls = new Set<string>();
let trustFlow: Promise<boolean> | null = null;

function defaultDestination(project: ProjectInfo, devices: Device[]): Destination {
  if (project.kind !== "iosApp") return { kind: "local" };
  const d = devices[0];
  return d ? { kind: "device", udid: d.udid, name: d.name } : { kind: "anyIos" };
}

function mainFile(project: ProjectInfo, entries: string[]): string | undefined {
  const prefs = ["ContentView.swift", "main.swift", `${project.name}.swift`, "Package.swift"];
  for (const p of prefs) {
    const hit = entries.find((e) => basename(e).toLowerCase() === p.toLowerCase());
    if (hit) return hit;
  }
  return undefined;
}

const SYSLOG = /^(\w{3}\s+\d+\s+[\d:]+)\s+\S+\s+([^\s[(]+)(?:\([^)]*\))?\[\d+\]\s+<(\w+)>:\s?(.*)$/;

function parseDeviceLine(raw: string): DeviceLine {
  const id = ++deviceLineId;
  const m = SYSLOG.exec(raw);
  if (!m) {
    const level = /^(error|ERROR)\b|^\[?err/i.test(raw) ? "error" : "info";
    return { id, time: "", process: "", level, message: raw };
  }
  const tag = m[3].toLowerCase();
  const level = tag === "error" || tag === "fault" ? "error" : tag === "warning" ? "warning" : tag === "debug" ? "debug" : "info";
  return { id, time: m[1].split(/\s+/).pop() ?? m[1], process: m[2], level, message: m[4] };
}

export const useStore = create<Store>((set, get) => ({
  settings: null,
  project: null,
  trusted: false,
  dirs: {},
  expanded: {},
  selected: null,
  tabs: [],
  active: null,
  dirtyTick: 0,
  cursor: { line: 1, column: 1, selection: 0 },
  reveal: null,

  task: null,
  log: [],
  diagnostics: [],

  devices: [],
  devicesError: null,
  destination: { kind: "local" },
  configuration: "debug",

  navigator: true,
  debugArea: true,
  inspector: true,
  navTab: "project",
  sheet: null,
  settingsTab: "general",
  toolchain: null,
  toolchainLoading: false,
  toasts: [],
  vibrancy: false,
  terminals: [],
  debugTab: "console",
  hud: null,
  wsl: "idle",
  wslBootMs: null,
  wslError: null,

  deviceLog: [],
  deviceLogState: "off",
  deviceLogError: null,
  deviceLogSession: null,
  deviceLogUdid: null,
  deviceLogFilter: "app",

  installs: [],

  update: null,
  updateState: "idle",
  updateProgress: null,
  updateError: null,

  async init() {
    const settings = await api.getSettings();
    set({ settings, configuration: settings.defaultConfiguration ?? "debug" });
    try {
      set({ vibrancy: await api.vibrancySupported() });
    } catch {
      set({ vibrancy: false });
    }
    void get().refreshDevices();
    void get().refreshInstalls();
    if (settings.warmWsl) void get().warmWsl();
    if (settings.autoUpdate) window.setTimeout(() => void get().checkForUpdate(false), 8000);
    const last = settings.recentProjects[0];
    if (settings.reopenLastProject && last) void get().openProject(last.path);
  },

  async warmWsl() {
    if (get().wsl === "starting") return;
    set({ wsl: "starting", wslError: null });
    try {
      const ms = await api.wslWarmup();
      set({ wsl: "ready", wslBootMs: ms });
    } catch (e) {
      set({ wsl: "error", wslError: errorMessage(e) });
    }
  },

  async updateSettings(patch) {
    const current = get().settings;
    if (!current) return;
    const next = { ...current, ...patch };
    set({ settings: next });
    if (patch.material !== undefined && patch.material !== current.material) {
      try {
        set({ vibrancy: await api.setWindowMaterial(patch.material) });
      } catch {
        set({ vibrancy: false });
      }
    }
    if (patch.uiScale !== undefined && patch.uiScale !== current.uiScale) void api.setUiScale(patch.uiScale).catch(() => undefined);
    try {
      await api.saveSettings(next);
    } catch (e) {
      get().toast("error", errorMessage(e));
    }
  },

  async openProject(path) {
    try {
      const info = await api.openProject(path);
      await get().setProject(info);
    } catch (e) {
      get().toast("error", errorMessage(e));
    }
  },

  async setProject(info) {
    if (get().project && !(await get().closeProject())) return;
    const root = info.root;
    const trusted = await api.projectTrusted(root).catch(() => false);
    set({
      project: info,
      trusted,
      dirs: {},
      expanded: { [k(root)]: true },
      tabs: [],
      active: null,
      selected: null,
      diagnostics: [],
      log: [],
      task: null,
      destination: defaultDestination(info, get().devices),
      configuration: get().settings?.defaultConfiguration ?? "debug",
    });
    await get().loadDir(root);
    if (trusted) {
      const booting = info.kind === "iosApp" && get().wsl !== "ready";
      void startLsp(info, booting ? t("lsp.wslBooting") : undefined);
    }
    const sources = get().dirs[k(root)]?.find((e) => e.isDir && e.name === "Sources");
    if (sources) {
      get().toggleDir(sources.path, true);
      await get().loadDir(sources.path);
      const first = get().dirs[k(sources.path)]?.find((e) => e.isDir);
      if (first) {
        get().toggleDir(first.path, true);
        await get().loadDir(first.path);
      }
    }
    const files = await api.listFiles(root).catch(() => [] as string[]);
    const main = mainFile(info, files);
    if (main) await get().openFile(main);
    const s = await api.getSettings().catch(() => null);
    if (s) set({ settings: s });
    document.title = `${info.name} — XWinCode`;
    if (!trusted) void get().ensureTrusted();
  },

  ensureTrusted() {
    const project = get().project;
    if (!project) return Promise.resolve(false);
    if (get().trusted) return Promise.resolve(true);
    trustFlow ??= (async () => {
      if (!(await askTrust(project.name))) return false;
      try {
        await api.trustProject(project.root);
      } catch (e) {
        get().toast("error", errorMessage(e));
        return false;
      }
      if (get().project?.root !== project.root) return false;
      set({ trusted: true });
      const booting = project.kind === "iosApp" && get().wsl !== "ready";
      void startLsp(project, booting ? t("lsp.wslBooting") : undefined);
      return true;
    })().finally(() => {
      trustFlow = null;
    });
    return trustFlow;
  },

  async closeProject() {
    const dirty = get().tabs.filter((p) => isDirty(p));
    if (dirty.length) {
      if (get().settings?.autoSave) {
        await get().saveAll();
      } else if (!(await confirmAsk(tn("dialog.closeUnsaved", dirty.length), t("dialog.close")))) {
        return false;
      }
    }
    if (get().task?.status === "running") await api.stopTask().catch(() => undefined);
    if (get().deviceLogState === "live" || get().deviceLogState === "starting") await get().stopDeviceLog();
    disposeAll();
    void stopLsp();
    set({ project: null, trusted: false, tabs: [], active: null, dirs: {}, expanded: {}, diagnostics: [], log: [], task: null, deviceLog: [] });
    document.title = "XWinCode";
    return true;
  },

  async loadDir(path) {
    try {
      const entries = await api.readDir(path);
      set((s) => ({ dirs: { ...s.dirs, [k(path)]: entries } }));
    } catch (e) {
      get().toast("error", errorMessage(e));
    }
  },

  toggleDir(path, open) {
    const isOpen = get().expanded[k(path)];
    const next = open ?? !isOpen;
    set((s) => ({ expanded: { ...s.expanded, [k(path)]: next } }));
    if (next && !get().dirs[k(path)]) void get().loadDir(path);
  },

  async refreshTree() {
    const { expanded, project } = get();
    if (!project) return;
    const open = Object.entries(expanded)
      .filter(([, v]) => v)
      .map(([p]) => p);
    await Promise.all(open.map((p) => get().loadDir(p)));
  },

  select(path) {
    set({ selected: path });
  },

  async openFile(rawPath, at) {
    const path = normalize(rawPath);
    const { tabs } = get();
    if (!getDoc(path)) {
      try {
        const content = await api.readTextFile(path);
        createDoc(path, content);
      } catch (e) {
        get().toast("error", t("toast.fileError", { name: basename(path), error: errorMessage(e) }));
        return;
      }
    }
    const nextTabs = tabs.some((p) => samePath(p, path)) ? tabs : [...tabs, path];
    set({ tabs: nextTabs, active: path, selected: path });
    if (at) set({ reveal: { path, line: at.line, column: at.column ?? 1, nonce: Date.now() } });
  },

  async closeTab(path) {
    if (isDirty(path)) {
      const choice = get().settings?.autoSave ? "save" : await saveChoice(basename(path));
      if (choice === "cancel") return;
      if (choice === "save") await get().save(path);
    }
    const { tabs, active } = get();
    const idx = tabs.findIndex((p) => samePath(p, path));
    const nextTabs = tabs.filter((p) => !samePath(p, path));
    let nextActive = active;
    if (active && samePath(active, path)) nextActive = nextTabs[Math.min(idx, nextTabs.length - 1)] ?? null;
    disposeDoc(path);
    set({ tabs: nextTabs, active: nextActive });
  },

  setActive(path) {
    set({ active: path, selected: path });
  },

  touchDirty() {
    set((s) => ({ dirtyTick: s.dirtyTick + 1 }));
  },

  async save(path, options) {
    const target = path ?? get().active;
    if (!target) return;
    const doc = getDoc(target);
    if (!doc) return;
    const prefs = get().settings;
    if (options?.format && prefs?.formatOnSave && /\.swift$/i.test(target)) {
      await formatModel(doc.model, { tabSize: prefs.tabSize ?? 4, insertSpaces: prefs.insertSpaces ?? true }).catch(() => false);
    }
    try {
      await api.writeTextFile(target, doc.model.getValue());
      markSaved(target);
      get().touchDirty();
    } catch (e) {
      get().toast("error", t("toast.saveFailed", { error: errorMessage(e) }));
    }
  },

  async saveAll() {
    await Promise.all(allDocs().filter((d) => isDirty(d.path)).map((d) => get().save(d.path)));
  },

  async build(action) {
    const { project, configuration, destination } = get();
    if (!project) return;
    if (!(await get().ensureTrusted())) {
      get().toast("info", t("trust.buildBlocked"));
      return;
    }
    await get().saveAll();
    const prefs = get().settings;
    set({ diagnostics: [], ...(prefs?.autoShowDebug !== false ? { debugArea: true, debugTab: "console" as const } : {}) });
    if (prefs?.clearConsoleOnBuild) set({ log: [] });
    get().pushLog([{ stream: "system", text: `▸ ${new Date().toLocaleTimeString()} — ${actionLabel(action)}` }]);
    const target: TaskTarget = {
      root: project.root,
      ios: project.kind === "iosApp",
      udid: destination.kind === "device" ? destination.udid : undefined,
      deviceName: destination.kind === "device" ? destination.name : undefined,
    };
    set({ task: { id: -1, label: actionLabel(action), command: "", action, status: "running", startedAt: Date.now(), target } });
    try {
      const id = await api.startBuild({ root: project.root, action, configuration, destination });
      const current = get().task;
      if (current && current.id === -1) set({ task: { ...current, id } });
    } catch (e) {
      const msg = errorMessage(e);
      get().pushLog([{ stream: "system", text: msg, severity: "error" }]);
      set({ task: { id: -2, label: actionLabel(action), command: "", action, status: "failed", startedAt: Date.now(), durationMs: 0, target } });
      get().toast("error", msg);
    }
  },

  async stop() {
    await api.stopTask().catch(() => undefined);
  },

  async refreshDevices() {
    try {
      const devices = await api.listDevices();
      const { destination, project } = get();
      let nextDest = destination;
      if (project?.kind === "iosApp") {
        if (destination.kind === "device" && !devices.some((d) => d.udid === destination.udid)) {
          nextDest = defaultDestination(project, devices);
        } else if (destination.kind === "anyIos" && devices.length) {
          nextDest = defaultDestination(project, devices);
        }
      }
      set({ devices, devicesError: null, destination: nextDest });
      remindExpiringInstalls();
    } catch (e) {
      set({ devices: [], devicesError: errorMessage(e) });
    }
  },

  setDestination(d) {
    set({ destination: d });
  },
  setConfiguration(c) {
    set({ configuration: c });
  },
  toggle(panel) {
    set((s) => ({ [panel]: !s[panel] }) as Partial<State>);
  },
  setNavTab(tab) {
    set({ navTab: tab, navigator: true });
  },
  openSheet(s, tab) {
    set({ sheet: s, ...(tab ? { settingsTab: tab } : {}) });
  },

  async checkToolchain() {
    set({ toolchainLoading: true });
    try {
      const toolchain = await api.checkToolchain();
      set({ toolchain });
    } catch (e) {
      get().toast("error", errorMessage(e));
    } finally {
      set({ toolchainLoading: false });
    }
  },

  toast(kind, text, action) {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text, action }] }));
    setTimeout(() => get().dismissToast(id), action ? 12000 : kind === "error" ? 7000 : 3500);
  },
  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },

  setCursor(c) {
    set({ cursor: c });
  },
  clearLog() {
    set({ log: [] });
  },
  pushLog(lines) {
    set((s) => {
      const rows = lines.flatMap((l) => l.text.split(/\r?\n/).map((text) => ({ ...l, text, id: ++logId })));
      const next = s.log.slice();
      for (const row of rows) {
        const label = progressLabel(row.text);
        const last = next[next.length - 1];
        if (label && last && progressLabel(last.text) === label) next[next.length - 1] = { ...row, id: last.id };
        else next.push(row);
      }
      return { log: next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next };
    });
  },
  addDiagnostic(d) {
    set((s) => {
      const dup = s.diagnostics.some((x) => x.file === d.file && x.line === d.line && x.column === d.column && x.message === d.message);
      return dup ? s : { diagnostics: [...s.diagnostics, d] };
    });
  },
  setTask(task) {
    set({ task });
  },

  pathRenamed(from, to) {
    const { tabs, active } = get();
    const doc = getDoc(from);
    if (doc) {
      const content = doc.model.getValue();
      disposeDoc(from);
      createDoc(to, content);
    }
    set({
      tabs: tabs.map((p) => (samePath(p, from) ? to : p)),
      active: active && samePath(active, from) ? to : active,
      selected: to,
    });
    void get().loadDir(dirname(from));
    void get().loadDir(dirname(to));
  },

  addTerminal(shell) {
    const key = ++terminalKey;
    const pref = get().settings?.terminalShell ?? "auto";
    const kind = shell ?? (pref !== "auto" ? pref : get().project?.kind === "iosApp" ? "wsl" : "powershell");
    const title = kind === "wsl" ? "WSL" : kind === "cmd" ? t("term.cmd") : "PowerShell";
    set((s) => ({ terminals: [...s.terminals, { key, shell: kind, title }], debugTab: key, debugArea: true }));
  },
  closeTerminal(key) {
    set((s) => {
      const terminals = s.terminals.filter((x) => x.key !== key);
      const debugTab = s.debugTab === key ? (terminals[terminals.length - 1]?.key ?? "console") : s.debugTab;
      return { terminals, debugTab };
    });
  },
  renameTerminal(key, title) {
    set((s) => ({ terminals: s.terminals.map((x) => (x.key === key ? { ...x, title } : x)) }));
  },
  setDebugTab(tab) {
    set({ debugTab: tab, debugArea: true });
    if (tab === "device" && get().deviceLogState === "off" && get().devices.length) void get().startDeviceLog();
  },
  showHud(kind, text) {
    set({ hud: { kind, text, nonce: Date.now() } });
  },
  async runTask(label, action, start, target) {
    set({ debugArea: true, debugTab: "console" });
    get().pushLog([{ stream: "system", text: `▸ ${new Date().toLocaleTimeString()} — ${label}` }]);
    set({ task: { id: -1, label, command: "", action, status: "running", startedAt: Date.now(), target } });
    try {
      const id = await start();
      const current = get().task;
      if (current && current.id === -1) set({ task: { ...current, id } });
    } catch (e) {
      const msg = errorMessage(e);
      get().pushLog([{ stream: "system", text: msg, severity: "error" }]);
      set({ task: { id: -2, label, command: "", action, status: "failed", startedAt: Date.now(), durationMs: 0, target } });
      get().toast("error", msg);
    }
  },

  pathDeleted(path) {
    const lower = path.toLowerCase();
    const { tabs, active } = get();
    const gone = tabs.filter((p) => p.toLowerCase() === lower || p.toLowerCase().startsWith(lower + "\\"));
    gone.forEach(disposeDoc);
    const nextTabs = tabs.filter((p) => !gone.includes(p));
    set({ tabs: nextTabs, active: active && gone.includes(active) ? (nextTabs[0] ?? null) : active, selected: null });
    void get().loadDir(dirname(path));
  },

  async startDeviceLog(udid) {
    const s = get();
    const wanted = udid ?? (s.destination.kind === "device" ? s.destination.udid : undefined);
    const device = s.devices.find((d) => d.udid === wanted) ?? s.devices[0];
    if (!device) {
      set({ deviceLogState: "error", deviceLogError: t("devlog.noDevice") });
      return;
    }
    const process = s.deviceLogFilter === "app" && s.project?.kind === "iosApp" ? s.project.name.replace(/-/g, "_") : null;
    set({ deviceLogState: "starting", deviceLogError: null, deviceLogUdid: device.udid, deviceLogSession: null });
    try {
      const session = await api.deviceLogStart(device.udid, process);
      set((st) => (st.deviceLogState === "starting" ? { deviceLogSession: session, deviceLogState: "live" } : { deviceLogSession: session }));
    } catch (e) {
      set({ deviceLogState: "error", deviceLogError: errorMessage(e) });
    }
  },

  async stopDeviceLog() {
    set({ deviceLogState: "off", deviceLogSession: null });
    await api.deviceLogStop().catch(() => undefined);
  },

  clearDeviceLog() {
    set({ deviceLog: [] });
  },

  setDeviceLogFilter(filter) {
    set({ deviceLogFilter: filter });
    const state = get().deviceLogState;
    if (state === "live" || state === "starting") void get().startDeviceLog(get().deviceLogUdid ?? undefined);
  },

  appendDeviceLog(session, lines) {
    const s = get();
    if (s.deviceLogSession !== null && s.deviceLogSession !== session) return;
    const missing = lines.find((l) => l.startsWith(MISSING_TOOLS));
    if (missing) {
      set({ deviceLogState: "missing", deviceLogError: missing.replace(/^XWC_MISSING_TOOLS:\s*/, "") });
      return;
    }
    const parsed = lines.map(parseDeviceLine);
    set((st) => {
      const next = st.deviceLog.concat(parsed);
      return {
        deviceLog: next.length > MAX_DEVICE_LOG ? next.slice(next.length - MAX_DEVICE_LOG) : next,
        ...(st.deviceLogState === "starting" ? { deviceLogState: "live" as const } : {}),
      };
    });
  },

  endDeviceLog(session) {
    const s = get();
    if (s.deviceLogSession !== null && s.deviceLogSession !== session) return;
    if (s.deviceLogState === "live" || s.deviceLogState === "starting") set({ deviceLogState: "off", deviceLogSession: null });
  },

  async refreshInstalls() {
    try {
      set({ installs: await api.listInstalls() });
      remindExpiringInstalls();
    } catch {
      set({ installs: [] });
    }
  },

  async recordInstall(target, appPath) {
    if (!target.udid) return;
    try {
      await api.recordInstall(target.udid, target.deviceName ?? "", target.root, appPath);
      await get().refreshInstalls();
    } catch (e) {
      console.debug("record install", errorMessage(e));
    }
  },

  async reinstall(record) {
    if (!record.projectRoot) return;
    const device = get().devices.find((d) => d.udid === record.udid);
    if (!device) {
      get().toast("error", t("installs.connectFirst", { device: record.deviceName }));
      return;
    }
    const root = record.projectRoot;
    get().openSheet(null);
    await get().runTask(
      t("installs.reinstalling", { app: record.appName }),
      "run",
      () => api.startBuild({ root, action: "run", configuration: "debug", destination: { kind: "device", udid: device.udid, name: device.name } }),
      { root, ios: true, udid: device.udid, deviceName: device.name },
    );
  },

  async checkForUpdate(manual) {
    const state = get().updateState;
    if (state === "checking" || state === "downloading") return;
    set({ updateState: "checking", updateError: null });
    try {
      const info = await findUpdate();
      if (info) {
        set({ update: info, updateState: "available" });
        if (manual) set({ sheet: "update" });
        else get().toast("info", t("update.available", { version: info.version }), { label: t("update.see"), run: () => get().openSheet("update") });
      } else {
        set({ updateState: "none" });
        if (manual) get().toast("success", t("update.upToDate"));
      }
    } catch (e) {
      set({ updateState: "error", updateError: errorMessage(e) });
      if (manual) get().toast("error", t("update.checkFailed", { error: errorMessage(e) }));
    }
  },

  async installUpdate() {
    await get().saveAll();
    set({ updateState: "downloading", updateProgress: 0, updateError: null });
    try {
      await installUpdate((p) => set({ updateProgress: p }));
    } catch (e) {
      set({ updateState: "error", updateError: errorMessage(e) });
      get().toast("error", t("update.installFailed", { error: errorMessage(e) }));
    }
  },
}));

function remindExpiringInstalls() {
  const { installs, devices, toast, reinstall } = useStore.getState();
  const now = Date.now();
  for (const r of installs) {
    if (!r.expiresAt) continue;
    const left = Date.parse(r.expiresAt) - now;
    const key = `${r.udid}:${r.bundleId}`;
    if (left > 2 * 86400000 || remindedInstalls.has(key)) continue;
    const connected = devices.some((d) => d.udid === r.udid);
    if (!connected && left > 0) continue;
    remindedInstalls.add(key);
    const text =
      left <= 0
        ? t("installs.expired", { app: r.appName, device: r.deviceName })
        : t("installs.expiresSoon", { app: r.appName, device: r.deviceName, when: relativeTime(r.expiresAt) });
    toast("info", text, connected && r.projectRoot ? { label: t("installs.reinstall"), run: () => void reinstall(r) } : undefined);
  }
}

function progressLabel(text: string): string | null {
  const m = /^\[([^\]]+)\]\s+\d+\s?%/.exec(text) ?? /^([A-Za-z][\w ]*)\.\.\.\s*\d+\s?%\s*$/.exec(text);
  return m ? m[1] : null;
}

const ACTION_KEYS: Record<TaskState["action"], TKey> = {
  build: "action.build",
  run: "action.run",
  test: "action.test",
  clean: "action.clean",
  archive: "action.archive",
  install: "action.install",
  setup: "action.setup",
};

export function actionLabel(action: TaskState["action"]): string {
  return t(ACTION_KEYS[action]);
}

const RESULT_KEYS: Record<TaskState["action"], Record<"ok" | "failed" | "stopped", TKey>> = {
  build: { ok: "result.build.ok", failed: "result.build.failed", stopped: "result.build.stopped" },
  run: { ok: "result.run.ok", failed: "result.run.failed", stopped: "result.run.stopped" },
  test: { ok: "result.test.ok", failed: "result.test.failed", stopped: "result.test.stopped" },
  clean: { ok: "result.clean.ok", failed: "result.clean.failed", stopped: "result.clean.stopped" },
  archive: { ok: "result.archive.ok", failed: "result.archive.failed", stopped: "result.archive.stopped" },
  install: { ok: "result.install.ok", failed: "result.install.failed", stopped: "result.install.stopped" },
  setup: { ok: "result.setup.ok", failed: "result.setup.failed", stopped: "result.setup.stopped" },
};

export function resultLabel(action: TaskState["action"], outcome: "ok" | "failed" | "stopped"): string {
  return t(RESULT_KEYS[action][outcome]);
}

export function destinationLabel(d: Destination): string {
  switch (d.kind) {
    case "local":
      return t("dest.local");
    case "anyIos":
      return t("dest.anyIos");
    case "device":
      return d.name;
  }
}

export { join };
