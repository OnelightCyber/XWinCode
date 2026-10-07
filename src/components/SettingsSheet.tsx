import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Code,
  Download,
  ExternalLink,
  FolderOpen,
  GitBranch,
  Hammer,
  Info,
  Keyboard,
  Monitor,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  Smartphone,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import logo from "../assets/logo.svg";
import { keys, LANGUAGES, t, tn, type TKey } from "../i18n";
import { commands } from "../lib/commands";
import { pickFile, pickFolder } from "../lib/dialogs";
import { EDITOR_FONTS, editorFontFamily } from "../lib/fonts";
import { useAppVersion } from "../lib/format";
import { api, errorMessage } from "../lib/ipc";
import { openExternal } from "../lib/links";
import { useStore, type SettingsTab } from "../lib/store";
import type { Settings, ToolComponent } from "../lib/types";
import { Seg, Select, Slider, Switch } from "./Controls";
import { installIphoneTools } from "./DeviceConsole";

const REPO = "https://github.com/OnelightCyber/XWinCode";

const openUrl = openExternal;

const update = (patch: Partial<Settings>) => void useStore.getState().updateSettings(patch);

function Group({ title, children, footer }: { title?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="set-group">
      {title && <h3>{title}</h3>}
      <div className="set-card">{children}</div>
      {footer && <div className="set-foot">{footer}</div>}
    </div>
  );
}

function Row({ label, hint, children, stack }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row${stack ? " stack" : ""}`}>
      <div className="set-label">
        <div className="l">{label}</div>
        {hint && <div className="h">{hint}</div>}
      </div>
      {children !== undefined && <div className="set-control">{children}</div>}
    </div>
  );
}

function CodeSample() {
  return (
    <>
      <span className="tk-com">// {t("set.sampleComment")}</span>
      {"\n"}
      <span className="tk-kw">struct</span> <span className="tk-decl">ContentView</span>: <span className="tk-type">View</span> {"{"}
      {"\n    "}
      <span className="tk-attr">@State</span> <span className="tk-kw">var</span> taps = <span className="tk-num">0</span>
      {"\n    "}
      <span className="tk-kw">var</span> body: <span className="tk-kw">some</span> <span className="tk-type">View</span> {"{"}
      {"\n        "}
      <span className="tk-fn">Text</span>(<span className="tk-str">"Hello!"</span>)
      {"\n    }\n}"}
    </>
  );
}

function General({ s }: { s: Settings }) {
  const [defaultDir, setDefaultDir] = useState("");
  const version = useAppVersion();
  const updateState = useStore((st) => st.updateState);
  const updateInfo = useStore((st) => st.update);
  const checkForUpdate = useStore((st) => st.checkForUpdate);
  useEffect(() => {
    void api.defaultProjectsDir().then(setDefaultDir).catch(() => undefined);
  }, [s.projectsDir]);
  const clearRecents = async () => {
    for (const r of s.recentProjects) await api.removeRecent(r.path).catch(() => undefined);
    useStore.setState({ settings: { ...s, recentProjects: [] } });
  };
  const updateText =
    updateState === "checking"
      ? t("set.update.checking")
      : updateState === "available" && updateInfo
        ? t("update.available", { version: updateInfo.version })
        : updateState === "none"
          ? t("update.upToDate")
          : updateState === "error"
            ? t("set.update.failed")
            : t("set.update.current", { version });
  return (
    <>
      <Group title={t("set.language")}>
        <Row label={t("set.language.label")} hint={t("set.language.hint")}>
          <Select
            value={s.language || "system"}
            width={220}
            options={[{ value: "system", label: t("set.language.system") }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.name }))]}
            onChange={(v) => update({ language: v })}
          />
        </Row>
      </Group>
      <Group title={t("set.files")}>
        <Row label={t("set.autoSave")} hint={t("set.autoSave.hint")}>
          <Switch on={s.autoSave} onChange={(v) => update({ autoSave: v })} />
        </Row>
        <Row label={t("set.reopen")} hint={t("set.reopen.hint")}>
          <Switch on={s.reopenLastProject} onChange={(v) => update({ reopenLastProject: v })} />
        </Row>
      </Group>
      <Group title={t("set.newProjects")}>
        <Row label={t("np.orgId")} hint={t("set.orgId.hint")}>
          <input className="input" style={{ width: 220 }} value={s.organizationId} onChange={(e) => update({ organizationId: e.target.value })} />
        </Row>
        <Row label={t("set.projectsDir")} hint={<span className="mono-path">{s.projectsDir || defaultDir}</span>}>
          <div className="row">
            {s.projectsDir && (
              <button className="btn small ghost" title={t("set.projectsDir.reset")} onClick={() => update({ projectsDir: null })}>
                <RotateCcw size={12} />
              </button>
            )}
            <button
              className="btn small"
              onClick={async () => {
                const dir = await pickFolder(t("set.projectsDir.dialog"), s.projectsDir || defaultDir);
                if (dir) update({ projectsDir: dir });
              }}
            >
              <FolderOpen size={13} /> {t("common.choose")}
            </button>
          </div>
        </Row>
      </Group>
      <Group title={t("set.updates")} footer={t("set.updates.footer")}>
        <Row label={t("set.autoUpdate")} hint={t("set.autoUpdate.hint")}>
          <Switch on={s.autoUpdate} onChange={(v) => update({ autoUpdate: v })} />
        </Row>
        <Row label={t("set.update.status")} hint={updateText}>
          <div className="row">
            {updateState === "available" && (
              <button className="btn small primary" onClick={() => useStore.getState().openSheet("update")}>
                <Download size={13} /> {t("set.update.see")}
              </button>
            )}
            <button className="btn small" disabled={updateState === "checking" || updateState === "downloading"} onClick={() => void checkForUpdate(true)}>
              <RefreshCw size={12} className={updateState === "checking" ? "spin" : ""} /> {t("set.update.check")}
            </button>
          </div>
        </Row>
      </Group>
      <Group title={t("set.history")}>
        <Row label={t("menu.recent")} hint={tn("set.history.count", s.recentProjects.length)}>
          <button className="btn small" disabled={!s.recentProjects.length} onClick={() => void clearRecents()}>
            {t("set.history.clear")}
          </button>
        </Row>
      </Group>
    </>
  );
}

function ThemeCard({ id, label, on }: { id: Settings["theme"]; label: string; on: boolean }) {
  return (
    <button className={`theme-card${on ? " on" : ""}`} onClick={() => update({ theme: id })}>
      <span className={`mini-win ${id}`}>
        <span className="mw-bar">
          <i />
          <i />
          <i />
        </span>
        <span className="mw-body">
          <span className="mw-side" />
          <span className="mw-main">
            <i style={{ width: "62%" }} />
            <i style={{ width: "84%" }} />
            <i style={{ width: "48%" }} />
            <i style={{ width: "70%" }} />
          </span>
        </span>
      </span>
      <span className="theme-label">{label}</span>
    </button>
  );
}

const MATERIALS: { value: Settings["material"]; label: TKey; hint: TKey }[] = [
  { value: "mica", label: "set.material.mica", hint: "set.material.mica.hint" },
  { value: "mica-alt", label: "set.material.micaAlt", hint: "set.material.micaAlt.hint" },
  { value: "acrylic", label: "set.material.acrylic", hint: "set.material.acrylic.hint" },
  { value: "none", label: "set.material.none", hint: "set.material.none.hint" },
];

function Appearance({ s }: { s: Settings }) {
  const vibrancy = useStore((st) => st.vibrancy);
  const material = MATERIALS.find((m) => m.value === s.material) ?? MATERIALS[0];
  return (
    <>
      <Group title={t("set.theme")}>
        <div className="theme-cards">
          <ThemeCard id="system" label={t("set.theme.system")} on={s.theme === "system"} />
          <ThemeCard id="dark" label={t("set.theme.dark")} on={s.theme === "dark"} />
          <ThemeCard id="light" label={t("set.theme.light")} on={s.theme === "light"} />
        </div>
      </Group>
      <Group title={t("set.material")} footer={s.material !== "none" && !vibrancy ? t("set.material.unsupported") : undefined}>
        <Row label={t("set.material.label")} hint={t(material.hint)} stack>
          <Seg value={s.material} options={MATERIALS.map((m) => ({ value: m.value, label: t(m.label) }))} onChange={(v) => update({ material: v })} />
        </Row>
      </Group>
      <Group title={t("set.interface")}>
        <Row label={t("set.uiScale")} hint={t("set.uiScale.hint")}>
          <Seg small value={s.uiScale} options={[90, 100, 110, 125].map((v) => ({ value: v, label: `${v} %` }))} onChange={(v) => update({ uiScale: v })} />
        </Row>
        <Row label={t("set.reduceMotion")} hint={t("set.reduceMotion.hint")}>
          <Switch on={s.reduceMotion} onChange={(v) => update({ reduceMotion: v })} />
        </Row>
      </Group>
    </>
  );
}

function EditorPrefs({ s }: { s: Settings }) {
  return (
    <>
      <Group title={t("set.editorTheme")}>
        <div className="code-cards">
          {(["mono", "xcode"] as const).map((theme) => (
            <button key={theme} className={`code-card${s.editorTheme === theme ? " on" : ""}`} onClick={() => update({ editorTheme: theme })}>
              <pre className={`code-sample code-${theme}`}>
                <CodeSample />
              </pre>
              <span className="theme-label">{theme === "mono" ? t("set.editorTheme.mono") : "Xcode"}</span>
            </button>
          ))}
        </div>
      </Group>
      <Group title={t("set.font")}>
        <Row label={t("set.font.family")}>
          <Select value={s.editorFont} width={190} options={EDITOR_FONTS.map((f) => ({ value: f.value, label: f.label }))} onChange={(v) => update({ editorFont: v })} />
        </Row>
        <Row label={t("set.font.size")}>
          <Slider value={s.editorFontSize} min={10} max={24} onChange={(v) => update({ editorFontSize: v })} format={(v) => `${v} pt`} />
        </Row>
        <Row label={t("set.font.lineHeight")}>
          <Slider value={s.editorLineHeight} min={1.2} max={2} step={0.05} onChange={(v) => update({ editorLineHeight: v })} format={(v) => `× ${v.toFixed(2)}`} />
        </Row>
        <Row label={t("set.font.ligatures")} hint={t("set.font.ligatures.hint")}>
          <Switch on={s.fontLigatures} onChange={(v) => update({ fontLigatures: v })} />
        </Row>
        <pre
          className={`font-preview code-${s.editorTheme}`}
          style={{
            fontFamily: editorFontFamily(s.editorFont),
            fontSize: s.editorFontSize,
            lineHeight: s.editorLineHeight,
            fontVariantLigatures: s.fontLigatures ? "normal" : "none",
          }}
        >
          <CodeSample />
        </pre>
      </Group>
      <Group title={t("set.display")}>
        <Row label={t("set.lineNumbers")}>
          <Switch on={s.lineNumbers} onChange={(v) => update({ lineNumbers: v })} />
        </Row>
        <Row label={t("set.indentGuides")}>
          <Switch on={s.indentGuides} onChange={(v) => update({ indentGuides: v })} />
        </Row>
        <Row label={t("set.stickyScroll")} hint={t("set.stickyScroll.hint")}>
          <Switch on={s.stickyScroll} onChange={(v) => update({ stickyScroll: v })} />
        </Row>
        <Row label={t("set.minimap")}>
          <Switch on={s.minimap} onChange={(v) => update({ minimap: v })} />
        </Row>
        <Row label={t("set.wordWrap")}>
          <Switch on={s.wordWrap} onChange={(v) => update({ wordWrap: v })} />
        </Row>
      </Group>
      <Group title={t("set.typing")}>
        <Row label={t("set.formatOnSave")} hint={t("set.formatOnSave.hint", { keys: keys("Ctrl+S") })}>
          <Switch on={s.formatOnSave} onChange={(v) => update({ formatOnSave: v })} />
        </Row>
        <Row label={t("set.tabSize")}>
          <Seg small value={s.tabSize} options={[2, 4, 8].map((v) => ({ value: v, label: `${v}` }))} onChange={(v) => update({ tabSize: v })} />
        </Row>
        <Row label={t("set.insertSpaces")} hint={t("set.insertSpaces.hint")}>
          <Switch on={s.insertSpaces} onChange={(v) => update({ insertSpaces: v })} />
        </Row>
        <Row label={t("set.cursor")}>
          <Seg
            small
            value={s.cursorStyle}
            options={[
              { value: "line", label: t("set.cursor.line") },
              { value: "block", label: t("set.cursor.block") },
              { value: "underline", label: t("set.cursor.underline") },
            ]}
            onChange={(v) => update({ cursorStyle: v })}
          />
        </Row>
        <Row label={t("set.smoothCaret")} hint={t("set.smoothCaret.hint")}>
          <Switch on={s.smoothCaret} onChange={(v) => update({ smoothCaret: v })} />
        </Row>
      </Group>
    </>
  );
}

function TerminalPrefs({ s }: { s: Settings }) {
  const hasProject = useStore((st) => !!st.project);
  return (
    <>
      <Group title={t("set.shell")}>
        <Row label={t("set.shell.default")} hint={t("set.shell.hint")} stack>
          <Seg
            value={s.terminalShell}
            options={[
              { value: "auto", label: t("dev.auto") },
              { value: "powershell", label: "PowerShell" },
              { value: "cmd", label: t("term.cmd") },
              { value: "wsl", label: "WSL" },
            ]}
            onChange={(v) => update({ terminalShell: v })}
          />
        </Row>
      </Group>
      <Group title={t("set.display")}>
        <Row label={t("set.font.size")}>
          <Slider value={s.terminalFontSize} min={10} max={20} onChange={(v) => update({ terminalFontSize: v })} format={(v) => `${v} pt`} />
        </Row>
        <Row label={t("set.terminalBlink")}>
          <Switch on={s.terminalCursorBlink} onChange={(v) => update({ terminalCursorBlink: v })} />
        </Row>
      </Group>
      <Group>
        <Row label={t("cmd.newTerminal")} hint={hasProject ? t("set.terminal.openHint", { keys: keys("Ctrl+Shift+T") }) : t("set.terminal.needProject")}>
          <button
            className="btn small"
            disabled={!hasProject}
            onClick={() => {
              useStore.getState().openSheet(null);
              useStore.getState().addTerminal();
            }}
          >
            <SquareTerminal size={13} /> {t("common.open")}
          </button>
        </Row>
      </Group>
    </>
  );
}

function BuildPrefs({ s }: { s: Settings }) {
  return (
    <>
      <Group title={t("set.run")}>
        <Row label={t("set.defaultConfiguration")} hint={t("set.defaultConfiguration.hint")}>
          <Seg
            small
            value={s.defaultConfiguration}
            options={[
              { value: "debug", label: "Debug" },
              { value: "release", label: "Release" },
            ]}
            onChange={(v) => {
              update({ defaultConfiguration: v });
              useStore.getState().setConfiguration(v);
            }}
          />
        </Row>
      </Group>
      <Group title={t("debug.console")}>
        <Row label={t("set.autoShowDebug")}>
          <Switch on={s.autoShowDebug} onChange={(v) => update({ autoShowDebug: v })} />
        </Row>
        <Row label={t("set.clearConsole")}>
          <Switch on={s.clearConsoleOnBuild} onChange={(v) => update({ clearConsoleOnBuild: v })} />
        </Row>
        <Row label={t("set.hud")} hint={t("set.hud.hint")}>
          <Switch on={s.showBuildHud} onChange={(v) => update({ showBuildHud: v })} />
        </Row>
      </Group>
    </>
  );
}

function DevicesPrefs({ s }: { s: Settings }) {
  const wsl = useStore((st) => st.wsl);
  const wslBootMs = useStore((st) => st.wslBootMs);
  const wslError = useStore((st) => st.wslError);
  const devices = useStore((st) => st.devices);
  const toolchain = useStore((st) => st.toolchain);
  const [distros, setDistros] = useState<string[]>([]);
  const [bridge, setBridge] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const { warmWsl, openSheet, toast } = useStore.getState();
  const imd = toolchain?.find((c) => c.id === "imobiledevice");

  useEffect(() => {
    void api.listWslDistros().then(setDistros).catch(() => setDistros([]));
  }, []);

  const fix = async (id: string) => {
    try {
      await api.runFixAction(id);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  const testBridge = async () => {
    setTesting(true);
    try {
      const text = await api.wslDeviceCheck();
      setBridge({ ok: !/error/i.test(text), text });
    } catch (e) {
      setBridge({ ok: false, text: errorMessage(e) });
    } finally {
      setTesting(false);
    }
  };

  const wslText =
    wsl === "ready"
      ? wslBootMs !== null
        ? t("set.wsl.readyIn", { seconds: (wslBootMs / 1000).toFixed(1) })
        : t("set.wsl.ready")
      : wsl === "starting"
        ? t("set.wsl.starting")
        : wsl === "error"
          ? (wslError ?? t("set.wsl.unavailable"))
          : t("set.wsl.stopped");

  return (
    <>
      <Group title={t("tool.wsl.name")}>
        <Row label={t("set.wsl.distro")} hint={t("set.wsl.distro.hint")}>
          <Select
            value={s.wslDistro ?? ""}
            width={200}
            options={[{ value: "", label: t("common.default") }, ...distros.map((d) => ({ value: d, label: d }))]}
            onChange={(v) => update({ wslDistro: v || null })}
          />
        </Row>
        <Row label={t("set.wsl.warm")} hint={t("set.wsl.warm.hint")}>
          <Switch on={s.warmWsl} onChange={(v) => update({ warmWsl: v })} />
        </Row>
        <Row
          label={
            <span className="row" style={{ gap: 8 }}>
              <span className={`status-dot ${wsl === "ready" ? "ok" : wsl === "error" ? "missing" : wsl === "starting" ? "checking" : "idle"}`} />
              {t("set.wsl.state")}
            </span>
          }
          hint={wslText}
        >
          <div className="row">
            <button className="btn small" disabled={wsl === "starting"} onClick={() => void warmWsl()}>
              <Play size={12} /> {t("devlog.start")}
            </button>
            <button className="btn small" onClick={() => void fix("wsl-shell")}>
              <SquareTerminal size={13} /> {t("group.terminal")}
            </button>
          </div>
        </Row>
      </Group>
      <Group title="iPhone" footer={t("dev.freeIdNote")}>
        <Row label={t("set.iphone.devices")} hint={devices.length ? devices.map((d) => d.name).join(", ") : t("set.iphone.none")}>
          <button className="btn small" onClick={() => openSheet("devices")}>
            <Smartphone size={13} /> {t("set.iphone.manage")}
          </button>
        </Row>
        <Row label={t("set.iphone.connection")} hint={t("set.iphone.connection.hint")}>
          <Seg
            small
            value={s.iosConnection}
            options={[
              { value: "auto", label: t("dev.auto") },
              { value: "usb", label: "USB" },
              { value: "network", label: "Wi-Fi" },
            ]}
            onChange={(v) => update({ iosConnection: v })}
          />
        </Row>
        <Row label={t("tool.imd.name")} hint={imd ? imd.detail : t("set.iphone.tools.hint")}>
          {imd?.status === "ok" ? (
            <span className="row" style={{ gap: 6 }}>
              <span className="status-dot ok" /> {t("common.ready")}
            </span>
          ) : (
            <button className="btn small" onClick={installIphoneTools}>
              <Download size={13} /> {t("common.install")}
            </button>
          )}
        </Row>
        <Row label={t("dev.bridgeTitle")} hint={t("set.iphone.bridge.hint")}>
          <button className="btn small" disabled={testing} onClick={() => void testBridge()}>
            {testing ? t("dev.testing") : t("set.iphone.test")}
          </button>
        </Row>
        {bridge && <pre className={`set-output${bridge.ok ? "" : " bad"}`}>{bridge.text}</pre>}
        <Row label={t("tool.appleId.name")} hint={t("set.iphone.appleId.hint")}>
          <button className="btn small" onClick={() => void fix("xtool-login")}>
            {t("tool.action.signIn")}…
          </button>
        </Row>
      </Group>
    </>
  );
}

function ToolRow({ c, onAction }: { c: ToolComponent; onAction: (id: string, label: string) => void }) {
  return (
    <div className="tool-row">
      <span className={`status-dot ${c.status}`} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="tool-name">
          {c.name}
          {c.version && <span className="tool-version">{c.version}</span>}
        </div>
        <div className="tool-detail ellipsis" title={c.detail}>
          {c.detail}
        </div>
      </div>
      {c.actions.map((a) => (
        <button key={a.id} className={`btn small${c.status !== "ok" ? " primary" : ""}`} onClick={() => onAction(a.id, a.label)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

function Tools() {
  const toolchain = useStore((s) => s.toolchain);
  const loading = useStore((s) => s.toolchainLoading);

  useEffect(() => {
    const state = useStore.getState();
    if (!state.toolchain && !state.toolchainLoading) void state.checkToolchain();
  }, []);

  const run = async (id: string, label: string) => {
    const { runTask, openSheet, toast } = useStore.getState();
    try {
      if (id === "install-wsl-swift" || id === "install-xtool" || id === "install-imobiledevice") {
        openSheet(null);
        await runTask(label, "setup", () => api.runSetupTask(id));
      } else if (id === "install-sdk") {
        const path = await pickFile(t("dialog.chooseXip"), ["xip"], t("dialog.xcodeArchive"));
        if (!path) return;
        openSheet(null);
        await runTask(t("task.installSdk"), "setup", () => api.installSdk(path));
      } else {
        await api.runFixAction(id);
        if (id !== "open-xcode-download") toast("info", t("toast.windowOpened"));
      }
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  const group = (g: "windows" | "ios") => toolchain?.filter((c) => c.group === g) ?? [];
  const summary = (g: "windows" | "ios") => {
    const items = group(g);
    const todo = items.filter((c) => c.status !== "ok").length;
    return items.length === 0 ? "" : todo === 0 ? t("common.ready") : tn("welcome.toConfigure", todo);
  };

  return (
    <>
      <div className="set-intro">
        <span>{t("set.tools.intro")}</span>
        <button className="btn small" disabled={loading} onClick={() => void useStore.getState().checkToolchain()}>
          <RefreshCw size={12} className={loading ? "spin" : ""} /> {loading ? t("welcome.checking") : t("set.tools.recheck")}
        </button>
      </div>
      {!toolchain && (
        <div className="set-loading">
          <span className="spinner" /> {t("set.tools.scanning")}
        </div>
      )}
      {toolchain && (
        <>
          <Group
            title={
              <>
                <Monitor size={13} /> {t("welcome.windowsApps")} <span className="group-state">{summary("windows")}</span>
              </>
            }
          >
            {group("windows").map((c) => (
              <ToolRow key={c.id} c={c} onAction={run} />
            ))}
          </Group>
          <Group
            title={
              <>
                <Smartphone size={13} /> {t("welcome.iphoneApps")} <span className="group-state">{summary("ios")}</span>
              </>
            }
            footer={t("set.tools.xipNote")}
          >
            {group("ios").map((c) => (
              <ToolRow key={c.id} c={c} onAction={run} />
            ))}
          </Group>
        </>
      )}
    </>
  );
}

function Keys({ shortcut }: { shortcut: string }) {
  return (
    <span className="keys">
      {keys(shortcut)
        .split("+")
        .map((k, i) => (
          <kbd key={i}>{k}</kbd>
        ))}
    </span>
  );
}

function Shortcuts() {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const m = new Map<string, { label: string; shortcut: string }[]>();
    const query = q.trim().toLowerCase();
    for (const c of Object.values(commands)) {
      if (!c.shortcut) continue;
      if (query && !`${c.label} ${keys(c.shortcut)} ${c.group}`.toLowerCase().includes(query)) continue;
      m.set(c.group, [...(m.get(c.group) ?? []), { label: c.label, shortcut: c.shortcut }]);
    }
    return [...m.entries()];
  }, [q]);
  return (
    <>
      <div className="field set-search">
        <Search size={13} />
        <input placeholder={t("set.shortcuts.search")} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {groups.map(([g, list]) => (
        <Group key={g} title={g}>
          {list.map((c) => (
            <Row key={c.label} label={c.label}>
              <Keys shortcut={c.shortcut} />
            </Row>
          ))}
        </Group>
      ))}
      {groups.length === 0 && <div className="set-loading">{t("set.shortcuts.none")}</div>}
      <div className="set-foot" style={{ marginTop: 4 }}>
        {t("set.shortcuts.footer")}
      </div>
    </>
  );
}

const CREDITS: { name: string; what: TKey; url: string }[] = [
  { name: "Swift", what: "credit.swift", url: "https://www.swift.org" },
  { name: "xtool", what: "credit.xtool", url: "https://github.com/xtool-org/xtool" },
  { name: "libimobiledevice", what: "credit.imd", url: "https://libimobiledevice.org" },
  { name: "SourceKit-LSP", what: "credit.sourcekit", url: "https://github.com/swiftlang/sourcekit-lsp" },
  { name: "Tauri", what: "credit.tauri", url: "https://tauri.app" },
  { name: "Monaco Editor", what: "credit.monaco", url: "https://microsoft.github.io/monaco-editor/" },
  { name: "xterm.js", what: "credit.xterm", url: "https://xtermjs.org" },
  { name: "Geist", what: "credit.geist", url: "https://vercel.com/font" },
  { name: "Lucide", what: "credit.lucide", url: "https://lucide.dev" },
];

function About() {
  const version = useAppVersion();
  return (
    <>
      <div className="about-hero">
        <img src={logo} alt="" draggable={false} />
        <div>
          <h2>XWinCode</h2>
          <div className="about-version">{t("welcome.version", { version })}</div>
          <p>{t("set.about.tagline")}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn small primary" onClick={() => void openUrl(REPO)}>
              <GitBranch size={13} /> {t("set.about.source")}
            </button>
            <button className="btn small" onClick={() => void openUrl(`${REPO}/issues`)}>
              {t("set.about.issue")}
            </button>
          </div>
        </div>
      </div>
      <Group title={t("set.about.builtWith")}>
        {CREDITS.map((c) => (
          <Row key={c.name} label={c.name} hint={t(c.what)}>
            <button className="btn small ghost" title={c.url} onClick={() => void openUrl(c.url)}>
              <ExternalLink size={12} />
            </button>
          </Row>
        ))}
      </Group>
      <div className="set-foot">{t("set.about.legal")}</div>
    </>
  );
}

const CATEGORIES: { id: SettingsTab; label: TKey; desc: TKey; icon: ReactNode; keywords: TKey }[] = [
  { id: "general", label: "set.cat.general", desc: "set.cat.general.desc", icon: <Settings2 size={15} />, keywords: "set.cat.general.keys" },
  { id: "appearance", label: "set.cat.appearance", desc: "set.cat.appearance.desc", icon: <Palette size={15} />, keywords: "set.cat.appearance.keys" },
  { id: "editor", label: "set.cat.editor", desc: "set.cat.editor.desc", icon: <Code size={15} />, keywords: "set.cat.editor.keys" },
  { id: "terminal", label: "set.cat.terminal", desc: "set.cat.terminal.desc", icon: <SquareTerminal size={15} />, keywords: "set.cat.terminal.keys" },
  { id: "build", label: "set.cat.build", desc: "set.cat.build.desc", icon: <Hammer size={15} />, keywords: "set.cat.build.keys" },
  { id: "devices", label: "set.cat.devices", desc: "set.cat.devices.desc", icon: <Smartphone size={15} />, keywords: "set.cat.devices.keys" },
  { id: "tools", label: "set.cat.tools", desc: "set.cat.tools.desc", icon: <Wrench size={15} />, keywords: "set.cat.tools.keys" },
  { id: "shortcuts", label: "set.cat.shortcuts", desc: "set.cat.shortcuts.desc", icon: <Keyboard size={15} />, keywords: "set.cat.shortcuts.keys" },
  { id: "about", label: "set.cat.about", desc: "set.cat.about.desc", icon: <Info size={15} />, keywords: "set.cat.about.keys" },
];

export function SettingsSheet() {
  const tab = useStore((s) => s.settingsTab);
  const settings = useStore((s) => s.settings);
  const openSheet = useStore((s) => s.openSheet);
  const version = useAppVersion();
  const [query, setQuery] = useState("");
  const close = () => openSheet(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORIES;
    return CATEGORIES.filter((c) => `${t(c.label)} ${t(c.desc)} ${t(c.keywords)}`.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (shown.length && !shown.some((c) => c.id === tab)) openSheet("settings", shown[0].id);
  }, [shown, tab, openSheet]);

  const cat = CATEGORIES.find((c) => c.id === tab) ?? CATEGORIES[0];
  const body = (s: Settings) => {
    switch (cat.id) {
      case "general":
        return <General s={s} />;
      case "appearance":
        return <Appearance s={s} />;
      case "editor":
        return <EditorPrefs s={s} />;
      case "terminal":
        return <TerminalPrefs s={s} />;
      case "build":
        return <BuildPrefs s={s} />;
      case "devices":
        return <DevicesPrefs s={s} />;
      case "tools":
        return <Tools />;
      case "shortcuts":
        return <Shortcuts />;
      case "about":
        return <About />;
    }
  };

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet settings glass">
        <aside className="settings-side">
          <div className="field">
            <Search size={13} />
            <input placeholder={t("common.search")} value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
            {query && (
              <button className="field-clear" onClick={() => setQuery("")} title={t("common.clear")}>
                <X size={12} />
              </button>
            )}
          </div>
          <nav className="settings-nav">
            {shown.map((c) => (
              <button key={c.id} className={`settings-cat${c.id === cat.id ? " on" : ""}`} onClick={() => openSheet("settings", c.id)}>
                <span className="cat-ic">{c.icon}</span>
                {t(c.label)}
              </button>
            ))}
            {shown.length === 0 && <div className="set-loading">{t("set.noResult")}</div>}
          </nav>
          <div className="settings-side-foot">XWinCode {version}</div>
        </aside>
        <section className="settings-main">
          <header className="settings-head">
            <div>
              <h2>{t(cat.label)}</h2>
              <p>{t(cat.desc)}</p>
            </div>
            <button className="icon-btn close-btn" title={`${t("common.close")} (${keys("Esc")})`} onClick={close}>
              <X size={16} />
            </button>
          </header>
          <div className="settings-body" key={cat.id}>
            {settings && body(settings)}
          </div>
        </section>
      </div>
    </div>
  );
}
