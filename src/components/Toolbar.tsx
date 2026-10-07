import { useEffect, useState } from "react";
import {
  ChevronDown,
  CircleX,
  Copy,
  Minus,
  Monitor,
  PanelLeft,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Smartphone,
  Square,
  TabletSmartphone,
  TriangleAlert,
  X,
} from "lucide-react";
import logo from "../assets/logo.svg";
import { keys, t, type TKey } from "../i18n";
import { appWindow, requestClose } from "../lib/appWindow";
import { commands } from "../lib/commands";
import { clockTime } from "../lib/format";
import { isTauri } from "../lib/ipc";
import { destinationLabel, resultLabel, useStore } from "../lib/store";
import { AppGlyph } from "./AppGlyph";
import { useMenu, type MenuEntry } from "./Menu";

export { requestClose };

const tip = (label: string, shortcut?: string) => (shortcut ? `${label} (${keys(shortcut)})` : label);

function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void appWindow().then(async (w) => {
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => unlisten?.();
  }, []);
  if (!isTauri) return null;
  return (
    <div className="win-controls">
      <button className="win-btn" title={t("win.minimize")} onClick={() => void appWindow().then((w) => w.minimize())}>
        <Minus size={15} strokeWidth={1.4} />
      </button>
      <button className="win-btn" title={maximized ? t("win.restore") : t("win.maximize")} onClick={() => void appWindow().then((w) => w.toggleMaximize())}>
        {maximized ? <Copy size={12} strokeWidth={1.4} style={{ transform: "scaleX(-1)" }} /> : <Square size={12} strokeWidth={1.4} />}
      </button>
      <button className="win-btn close" title={t("common.close")} onClick={() => void requestClose()}>
        <X size={16} strokeWidth={1.4} />
      </button>
    </div>
  );
}

const XTOOL_STEPS: Record<string, TKey> = {
  "Unpacking app": "step.unpacking",
  "Logging in": "step.loggingIn",
  "Preparing device": "step.preparingDevice",
  Provisioning: "step.provisioning",
  Signing: "step.signing",
  Packaging: "step.packaging",
  Connecting: "step.connecting",
  Installing: "step.installing",
  Verifying: "step.verifying",
  "Extracting XIP": "step.extractingXip",
};

function prettyStep(line: string | undefined): string | null {
  if (!line) return null;
  let m = /Compiling \S+ (.+)$/.exec(line);
  if (m) return t("step.compiling", { file: m[1] });
  m = /Linking (.+)$/.exec(line);
  if (m) return t("step.linking", { file: m[1] });
  m = /^\[([A-Za-z ]+)\]\s+(\d+)%/.exec(line);
  if (m) {
    const key = XTOOL_STEPS[m[1]];
    return t("step.percent", { step: key ? t(key) : m[1], percent: m[2] });
  }
  if (/^Planning/.test(line)) return t("step.planning");
  if (/Waiting for device/.test(line)) return t("step.waitingDevice");
  return null;
}

function Activity() {
  const project = useStore((s) => s.project);
  const task = useStore((s) => s.task);
  const errors = useStore((s) => s.diagnostics.filter((d) => d.severity === "error").length);
  const warnings = useStore((s) => s.diagnostics.filter((d) => d.severity === "warning").length);
  const wslBooting = useStore((s) => s.wsl === "starting");
  const lastLine = useStore((s) => {
    if (s.task?.status !== "running") return undefined;
    for (let i = s.log.length - 1; i >= Math.max(0, s.log.length - 30); i--) {
      const p = prettyStep(s.log[i].text);
      if (p) return p;
    }
    return undefined;
  });
  const progressKey = useStore((s) => {
    if (s.task?.status !== "running") return "";
    for (let i = s.log.length - 1; i >= Math.max(0, s.log.length - 60); i--) {
      const m = /^\[(\d+)\/(\d+)\]/.exec(s.log[i].text);
      if (m && +m[2] > 1) return `${m[1]}/${m[2]}`;
      const p = /^\[[A-Za-z ]+\]\s+(\d+)%/.exec(s.log[i].text);
      if (p) return `${p[1]}/100`;
    }
    return "";
  });
  const progress = progressKey ? { n: +progressKey.split("/")[0], total: +progressKey.split("/")[1] } : null;
  const setNavTab = useStore((s) => s.setNavTab);
  const running = task?.status === "running";

  let status: React.ReactNode;
  if (!project) status = <span className="faint">{t("activity.tagline")}</span>;
  else if (running)
    status = (
      <>
        <b>{task.label}</b>
        {lastLine ? ` — ${lastLine}` : "…"}
      </>
    );
  else if (task) {
    const outcome = task.status === "succeeded" ? "ok" : task.status === "cancelled" ? "stopped" : "failed";
    status = (
      <>
        <b className={task.status === "failed" ? "failed" : undefined}>{resultLabel(task.action, outcome)}</b>
        <span className="faint">
          {" "}
          · {clockTime(task.startedAt + (task.durationMs ?? 0))}
          {task.durationMs ? ` · ${(task.durationMs / 1000).toFixed(1)} s` : ""}
        </span>
      </>
    );
  } else if (wslBooting && project.kind === "iosApp") status = <span className="faint">{t("activity.wslBooting")}</span>;
  else status = <span className="faint">{t("common.ready")}</span>;

  return (
    <div className="activity glass lg">
      {project ? (
        <span className="proj">
          <AppGlyph kind={project.kind} size={18} />
          <span className="ellipsis">{project.name}</span>
        </span>
      ) : (
        <span className="proj">XWinCode</span>
      )}
      <span className="sep" />
      {(running || (wslBooting && project?.kind === "iosApp" && !task)) && <span className="spinner" />}
      <span className="status ellipsis">{status}</span>
      {(errors > 0 || warnings > 0) && (
        <button className="issues" onClick={() => setNavTab("issues")} title={t("tb.showIssues")}>
          {errors > 0 && (
            <span className="badge err">
              <CircleX size={13} />
              {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="badge warn">
              <TriangleAlert size={13} />
              {warnings}
            </span>
          )}
        </button>
      )}
      {progress && progress.total !== 100 && (
        <span className="counter">
          {progress.n}/{progress.total}
        </span>
      )}
      {running &&
        (progress ? (
          <span className="progress determinate" style={{ ["--p" as string]: `${Math.round((progress.n / progress.total) * 100)}%` }} />
        ) : (
          <span className="progress" />
        ))}
    </div>
  );
}

function AppMenu() {
  const menu = useMenu();
  const open = (e: React.MouseEvent) => {
    const s = useStore.getState();
    const has = !!s.project;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const item = (id: string, extra?: Partial<Extract<MenuEntry, { type: "item" }>>): MenuEntry => {
      const c = commands[id];
      return { type: "item", label: c.label, shortcut: c.shortcut, disabled: c.needsProject && !has, onSelect: c.run, ...extra };
    };
    const sep: MenuEntry = { type: "separator" };
    const recents: MenuEntry[] = (s.settings?.recentProjects ?? []).slice(0, 10).map((p) => ({
      type: "item",
      label: p.name,
      icon: <AppGlyph kind={p.kind} size={16} />,
      onSelect: () => void useStore.getState().openProject(p.path),
    }));
    menu.toggle({
      x: r.left,
      y: r.bottom + 8,
      minWidth: 250,
      entries: [
        item("about"),
        item("checkUpdates"),
        sep,
        {
          type: "submenu",
          label: t("group.file"),
          entries: [
            item("newProject"),
            item("newFile"),
            item("openProject"),
            { type: "submenu", label: t("menu.recent"), disabled: recents.length === 0, entries: recents },
            item("quickOpen"),
            sep,
            item("save"),
            item("saveAll"),
            sep,
            item("projectSettings", { disabled: s.project?.kind !== "iosApp" }),
            sep,
            item("closeTab"),
            item("closeProject"),
          ],
        },
        {
          type: "submenu",
          label: t("group.product"),
          entries: [item("build"), item("run"), item("test"), item("archive"), sep, item("clean"), sep, item("stop", { disabled: s.task?.status !== "running" })],
        },
        {
          type: "submenu",
          label: t("group.view"),
          entries: [
            item("toggleNavigator", { label: t("menu.navigator"), checked: s.navigator }),
            item("toggleDebug", { label: t("menu.debugArea"), checked: s.debugArea }),
            item("toggleInspector", { label: t("menu.inspector"), checked: s.inspector }),
            sep,
            item("library"),
            item("findInProject"),
            item("commandPalette"),
          ],
        },
        { type: "submenu", label: t("group.window"), entries: [item("devices"), item("deviceConsole"), item("newTerminal")] },
        sep,
        item("settings"),
        item("tools"),
        item("shortcuts"),
        sep,
        item("quit"),
      ],
    });
  };
  return (
    <>
      <button className={`app-btn${menu.isOpen ? " open" : ""}`} title={t("tb.appMenu")} onClick={open}>
        <img src={logo} alt="" draggable={false} />
      </button>
      {menu.node}
    </>
  );
}

function RunControls() {
  const hasProject = useStore((s) => !!s.project);
  const running = useStore((s) => s.task?.status === "running");
  const build = useStore((s) => s.build);
  const stop = useStore((s) => s.stop);
  if (!hasProject && !running) return null;
  return (
    <div className="tb-group glass lg">
      <button className={`tb-btn run${running ? " busy" : ""}`} title={tip(t("cmd.run"), "Ctrl+R")} disabled={!hasProject} onClick={() => void build("run")}>
        <Play size={14} fill="currentColor" />
      </button>
      <button className="tb-btn stop" title={tip(t("cmd.stop"), "Ctrl+.")} disabled={!running} onClick={() => void stop()}>
        <Square size={12} fill="currentColor" />
      </button>
    </div>
  );
}

function Scheme() {
  const project = useStore((s) => s.project);
  const destination = useStore((s) => s.destination);
  const configuration = useStore((s) => s.configuration);
  const menu = useMenu();
  if (!project) return null;
  const ios = project.kind === "iosApp";

  const open = (e: React.MouseEvent) => {
    const s = useStore.getState();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const d = s.destination;
    const entries: MenuEntry[] = [];
    if (ios) {
      entries.push({ type: "title", label: t("scheme.iosDevices") });
      if (s.devices.length === 0)
        entries.push({ type: "item", label: s.devicesError ? t("scheme.serviceDown") : t("scheme.noIphone"), disabled: true, onSelect: () => {} });
      for (const dev of s.devices)
        entries.push({
          type: "item",
          label: `${dev.name}${dev.osVersion ? ` (iOS ${dev.osVersion})` : ""}`,
          icon: <Smartphone size={14} />,
          checked: d.kind === "device" && d.udid === dev.udid,
          onSelect: () => s.setDestination({ kind: "device", udid: dev.udid, name: dev.name }),
        });
      entries.push({ type: "separator" });
      entries.push({
        type: "item",
        label: t("dest.anyIos"),
        icon: <TabletSmartphone size={14} />,
        checked: d.kind === "anyIos",
        onSelect: () => s.setDestination({ kind: "anyIos" }),
      });
    } else {
      entries.push({ type: "title", label: "Windows" });
      entries.push({ type: "item", label: t("scheme.thisPc"), icon: <Monitor size={14} />, checked: true, onSelect: () => s.setDestination({ kind: "local" }) });
    }
    entries.push(
      { type: "separator" },
      { type: "title", label: t("scheme.configuration") },
      { type: "item", label: "Debug", checked: s.configuration === "debug", onSelect: () => s.setConfiguration("debug") },
      { type: "item", label: "Release", checked: s.configuration === "release", onSelect: () => s.setConfiguration("release") },
      { type: "separator" },
      { type: "item", label: t("scheme.refresh"), icon: <RefreshCw size={14} />, onSelect: () => void s.refreshDevices() },
      { type: "item", label: t("scheme.manage"), shortcut: "Ctrl+Shift+2", onSelect: () => s.openSheet("devices") },
    );
    if (ios) entries.push({ type: "item", label: t("cmd.projectSettings"), icon: <Settings2 size={14} />, onSelect: () => s.openSheet("project") });
    menu.toggle({ x: r.left, y: r.bottom + 8, entries, minWidth: Math.max(260, r.width) });
  };

  const destIcon =
    destination.kind === "device" ? <Smartphone size={14} /> : destination.kind === "anyIos" ? <TabletSmartphone size={14} /> : <Monitor size={14} />;
  return (
    <div className="tb-group glass lg">
      <button className={`tb-btn scheme${menu.isOpen ? " open" : ""}`} onClick={open} title={t("tb.scheme")}>
        <AppGlyph kind={project.kind} size={18} />
        <span className="ellipsis name">{project.name}</span>
        <span className="slash">/</span>
        {destIcon}
        <span className="ellipsis">{destinationLabel(destination)}</span>
        {configuration === "release" && <span className="tag">Release</span>}
        <ChevronDown size={13} className="chev" />
      </button>
      {menu.node}
    </div>
  );
}

function RightControls() {
  const deviceCount = useStore((s) => s.devices.length);
  const inspector = useStore((s) => s.inspector);
  const hasProject = useStore((s) => !!s.project);
  const { openSheet, toggle } = useStore.getState();
  return (
    <div className="tb-group glass lg">
      {hasProject && (
        <button className="tb-btn" title={tip(t("cmd.library"), "Ctrl+Shift+L")} onClick={() => openSheet("library")}>
          <Plus size={16} />
        </button>
      )}
      <button className="tb-btn" title={tip(t("cmd.devices"), "Ctrl+Shift+2")} onClick={() => openSheet("devices")}>
        <Smartphone size={15} />
        {deviceCount > 0 && <span className="count">{deviceCount}</span>}
      </button>
      {hasProject && (
        <button className={`tb-btn toggle${inspector ? " on" : ""}`} title={tip(t("menu.inspector"), "Ctrl+Alt+0")} onClick={() => toggle("inspector")}>
          <PanelRight size={16} />
        </button>
      )}
    </div>
  );
}

export function Toolbar() {
  const hasProject = useStore((s) => !!s.project);
  const navigator = useStore((s) => s.navigator);
  const toggle = useStore((s) => s.toggle);
  return (
    <div className="toolbar">
      <div className="drag" data-tauri-drag-region />
      <AppMenu />
      {hasProject && (
        <div className="tb-group glass lg">
          <button className={`tb-btn toggle${navigator ? " on" : ""}`} title={tip(t("menu.navigator"), "Ctrl+0")} onClick={() => toggle("navigator")}>
            <PanelLeft size={16} />
          </button>
        </div>
      )}
      <RunControls />
      <Scheme />
      <Activity />
      <RightControls />
      <WindowControls />
    </div>
  );
}
