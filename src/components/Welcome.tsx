import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FolderOpen, Monitor, Plus, Search, Smartphone, Wrench, X } from "lucide-react";
import logo from "../assets/logo.svg";
import { keys, t, tn } from "../i18n";
import { api, isTauri } from "../lib/ipc";
import { pickFolder } from "../lib/dialogs";
import { prettyPath, relativeTime, useAppVersion } from "../lib/format";
import { useStore } from "../lib/store";
import { AppGlyph } from "./AppGlyph";
import { useMenu } from "./Menu";

export async function openProjectDialog() {
  const dir = await pickFolder(t("dialog.openPackage"));
  if (dir) await useStore.getState().openProject(dir);
}

export async function revealInExplorer(path: string) {
  if (!isTauri) return;
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  await revealItemInDir(path);
}

function ToolStatus() {
  const toolchain = useStore((s) => s.toolchain);
  const loading = useStore((s) => s.toolchainLoading);
  const openSheet = useStore((s) => s.openSheet);

  useEffect(() => {
    const { toolchain, toolchainLoading, checkToolchain } = useStore.getState();
    if (!toolchain && !toolchainLoading) void checkToolchain();
  }, []);

  const line = (group: "windows" | "ios", icon: React.ReactNode, label: string) => {
    const items = toolchain?.filter((c) => c.group === group) ?? [];
    const missing = items.filter((c) => c.status !== "ok");
    const state = !toolchain ? "checking" : missing.length === 0 ? "ok" : missing.some((c) => c.status === "missing") ? "missing" : "warning";
    const text = !toolchain ? (loading ? t("welcome.checking") : "—") : missing.length === 0 ? t("common.ready") : tn("welcome.toConfigure", missing.length);
    return (
      <button className="tool-status" onClick={() => openSheet("settings", "tools")} title={missing.map((c) => c.name).join(", ") || undefined}>
        {icon}
        <span className="label">{label}</span>
        <span className={`status-dot ${state}`} />
        <span className="text">{text}</span>
        <ArrowRight size={13} className="go" />
      </button>
    );
  };

  return (
    <div className="tool-statuses">
      {line("windows", <Monitor size={14} />, t("welcome.windowsApps"))}
      {line("ios", <Smartphone size={14} />, t("welcome.iphoneApps"))}
    </div>
  );
}

function Action({ icon, title, desc, kbd, onClick }: { icon: React.ReactNode; title: string; desc: string; kbd?: string; onClick: () => void }) {
  return (
    <button className="welcome-action lg" onClick={onClick}>
      <span className="ic">{icon}</span>
      <span className="txt">
        <span className="t">{title}</span>
        <span className="d">{desc}</span>
      </span>
      {kbd && <span className="kbd-hint">{keys(kbd)}</span>}
    </button>
  );
}

export function Welcome() {
  const settings = useStore((s) => s.settings);
  const openSheet = useStore((s) => s.openSheet);
  const openProject = useStore((s) => s.openProject);
  const version = useAppVersion();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const menu = useMenu();

  const recents = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = settings?.recentProjects ?? [];
    return q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) : all;
  }, [settings?.recentProjects, query]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector(".recent.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const forget = async (path: string) => {
    await api.removeRecent(path);
    const s = await api.getSettings();
    useStore.setState({ settings: s });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(recents.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && recents[selected]) {
      void openProject(recents[selected].path);
    }
  };

  return (
    <div className="welcome-stage">
      <div className="welcome glass">
        <section className="welcome-hero">
          <div className="logo-wrap">
            <img src={logo} className="logo" alt="" draggable={false} />
          </div>
          <h1>XWinCode</h1>
          <p className="tagline">{t("welcome.tagline")}</p>
          <span className="version-chip">{t("welcome.version", { version })}</span>
          <div className="welcome-actions">
            <Action icon={<Plus size={17} />} title={t("welcome.newProject")} desc={t("welcome.newProjectDesc")} kbd="Ctrl+Shift+N" onClick={() => openSheet("newProject")} />
            <Action icon={<FolderOpen size={17} />} title={t("welcome.open")} desc={t("welcome.openDesc")} kbd="Ctrl+O" onClick={() => void openProjectDialog()} />
            <Action icon={<Wrench size={17} />} title={t("welcome.tools")} desc={t("welcome.toolsDesc")} onClick={() => openSheet("settings", "tools")} />
          </div>
          <ToolStatus />
        </section>

        <section className="welcome-recents" onKeyDown={onKeyDown}>
          <div className="recents-head">
            <h2>{t("menu.recent")}</h2>
            <div className="field">
              <Search size={13} />
              <input placeholder={t("common.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
              {query && (
                <button className="field-clear" onClick={() => setQuery("")} title={t("common.clear")}>
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="recents-list" ref={listRef} tabIndex={0}>
            {recents.length === 0 && (
              <div className="recents-empty">
                <FolderOpen size={28} strokeWidth={1.5} />
                <div className="t">{query ? t("welcome.noMatch") : t("welcome.noRecents")}</div>
                {!query && <div className="d">{t("welcome.noRecentsHint")}</div>}
              </div>
            )}
            {recents.map((r, i) => (
              <div
                key={r.path}
                className={`recent${i === selected ? " selected" : ""}`}
                onClick={() => setSelected(i)}
                onDoubleClick={() => void openProject(r.path)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSelected(i);
                  menu.open({
                    x: e.clientX,
                    y: e.clientY,
                    entries: [
                      { type: "item", label: t("common.open"), icon: <ArrowRight size={14} />, onSelect: () => void openProject(r.path) },
                      { type: "item", label: t("ctx.showInExplorer"), icon: <FolderOpen size={14} />, onSelect: () => void revealInExplorer(r.path) },
                      { type: "separator" },
                      { type: "item", label: t("welcome.removeRecent"), icon: <X size={14} />, onSelect: () => void forget(r.path) },
                    ],
                  });
                }}
              >
                <AppGlyph kind={r.kind} size={34} />
                <div className="meta">
                  <div className="name ellipsis">{r.name}</div>
                  <div className="path ellipsis" title={r.path}>
                    {prettyPath(r.path)}
                  </div>
                </div>
                <span className="when">{relativeTime(r.openedAt)}</span>
                <button className="open-btn" title={t("common.open")} onClick={() => void openProject(r.path)}>
                  <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      {menu.node}
    </div>
  );
}
