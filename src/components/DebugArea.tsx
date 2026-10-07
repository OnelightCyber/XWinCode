import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CornerDownLeft, ListFilter, Pause, Play, Plus, Smartphone, SquareTerminal, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { keys, t } from "../i18n";
import { api, errorMessage } from "../lib/ipc";
import { relative, wslToWindows } from "../lib/paths";
import { useStore } from "../lib/store";
import type { LogLine } from "../lib/types";
import { Seg } from "./Controls";
import { DeviceConsole } from "./DeviceConsole";
import { useMenu } from "./Menu";
import { TerminalView } from "./Terminal";

const LINE_H = 18;
const LOCATED = /^(.+?):(\d+):(\d+): (error|warning|note): /;

function lineClass(l: LogLine): string {
  const sev = l.severity ?? (/(^|: )error: /.test(l.text) ? "error" : /(^|: )warning: /.test(l.text) ? "warning" : undefined);
  return `log-line ${l.stream}${sev ? ` ${sev}` : ""}${LOCATED.test(l.text) ? " clickable" : ""}`;
}

function prettify(text: string, root: string | undefined): string {
  const m = LOCATED.exec(text);
  if (!m || !root) return text;
  return relative(root, wslToWindows(m[1])) + text.slice(m[1].length);
}

function Console({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 300 });
  const pinned = useRef(true);
  const openFile = useStore((s) => s.openFile);
  const root = useStore((s) => s.project?.root);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = ref.current!;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < LINE_H * 2;
    setScroll({ top: el.scrollTop, height: el.clientHeight });
  };

  const first = Math.max(0, Math.floor(scroll.top / LINE_H) - 20);
  const last = Math.min(lines.length, Math.ceil((scroll.top + scroll.height) / LINE_H) + 20);
  const visible = lines.slice(first, last);

  const click = (l: LogLine) => {
    const m = LOCATED.exec(l.text);
    if (m) void openFile(wslToWindows(m[1]), { line: +m[2], column: +m[3] });
  };

  return (
    <div className="console" ref={ref} onScroll={onScroll}>
      <div style={{ height: first * LINE_H }} />
      {visible.map((l) => (
        <div key={l.id} className={lineClass(l)} onClick={() => click(l)} title={LOCATED.test(l.text) ? t("debug.openInEditor") : undefined}>
          {prettify(l.text, root) || " "}
        </div>
      ))}
      <div style={{ height: (lines.length - last) * LINE_H }} />
    </div>
  );
}

export function DebugArea({ height, visible }: { height: number; visible: boolean }) {
  const log = useStore((s) => s.log);
  const running = useStore((s) => s.task?.status === "running");
  const terminals = useStore((s) => s.terminals);
  const debugTab = useStore((s) => s.debugTab);
  const root = useStore((s) => s.project?.root ?? null);
  const ios = useStore((s) => s.project?.kind === "iosApp");
  const deviceState = useStore((s) => s.deviceLogState);
  const deviceFilter = useStore((s) => s.deviceLogFilter);
  const { clearLog, toggle, pushLog, addTerminal, closeTerminal, renameTerminal, setDebugTab, startDeviceLog, stopDeviceLog, clearDeviceLog, setDeviceLogFilter } =
    useStore.getState();
  const [mode, setMode] = useState<"all" | "issues">("all");
  const [filter, setFilter] = useState("");
  const [deviceText, setDeviceText] = useState("");
  const [input, setInput] = useState("");
  const menu = useMenu();

  const lines = useMemo(() => {
    let out = log;
    if (mode === "issues") out = out.filter((l) => /error: |warning: /.test(l.text) || l.severity);
    if (filter) {
      const q = filter.toLowerCase();
      out = out.filter((l) => l.text.toLowerCase().includes(q));
    }
    return out;
  }, [log, mode, filter]);

  const send = async () => {
    const text = input;
    setInput("");
    pushLog([{ stream: "stdout", text: `› ${text}` }]);
    try {
      await api.sendTaskInput(text);
    } catch (e) {
      pushLog([{ stream: "system", text: errorMessage(e), severity: "error" }]);
    }
  };

  const shellMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu.toggle({
      x: r.left,
      y: r.top - 132,
      entries: [
        { type: "title", label: t("cmd.newTerminal") },
        { type: "item", label: "PowerShell", icon: <TerminalIcon size={14} />, onSelect: () => addTerminal("powershell") },
        { type: "item", label: t("term.cmd"), icon: <TerminalIcon size={14} />, onSelect: () => addTerminal("cmd") },
        { type: "item", label: t("debug.wslShell"), icon: <TerminalIcon size={14} />, onSelect: () => addTerminal("wsl") },
      ],
    });
  };

  const onConsole = debugTab === "console";
  const onDevice = debugTab === "device";
  const liveDevice = deviceState === "live" || deviceState === "starting";

  return (
    <section className="debug" style={{ height, display: visible ? "flex" : "none" }}>
      <div className="debug-bar">
        <button className="icon-btn" title={`${t("debug.hide")} (${keys("Ctrl+Shift+Y")})`} onClick={() => toggle("debugArea")}>
          <ChevronDown size={15} />
        </button>
        <div className="dtabs">
          <button className={`dtab${onConsole ? " on" : ""}`} onClick={() => setDebugTab("console")}>
            <SquareTerminal size={13} /> {t("debug.console")}
            {running && <span className="live-dot" />}
          </button>
          {ios && (
            <button className={`dtab${onDevice ? " on" : ""}`} onClick={() => setDebugTab("device")} title={`${t("cmd.deviceConsole")} (${keys("Ctrl+Shift+C")})`}>
              <Smartphone size={13} /> iPhone
              {deviceState === "live" && <span className="live-dot" />}
            </button>
          )}
          {terminals.map((term) => (
            <button key={term.key} className={`dtab${debugTab === term.key ? " on" : ""}`} onClick={() => setDebugTab(term.key)}>
              <TerminalIcon size={13} /> {term.title}
              <span
                className="dtab-x"
                title={t("debug.closeTerminal")}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTerminal(term.key);
                }}
              >
                <X size={11} />
              </span>
            </button>
          ))}
          <button className="icon-btn" title={`${t("cmd.newTerminal")} (${keys("Ctrl+Shift+T")}) — ${t("debug.rightClickShell")}`} onClick={() => addTerminal()} onContextMenu={shellMenu}>
            <Plus size={14} />
          </button>
          <button className="icon-btn" title={t("debug.chooseShell")} style={{ width: 18, marginLeft: -4 }} onClick={shellMenu}>
            <ChevronDown size={11} />
          </button>
        </div>
        <span className="grow" />
        {onConsole && (
          <>
            <Seg
              small
              value={mode}
              options={[
                { value: "all", label: t("debug.all") },
                { value: "issues", label: t("nav.issuesTab") },
              ]}
              onChange={setMode}
            />
            <div className="field" style={{ maxWidth: 200, height: 26 }}>
              <ListFilter size={12} />
              <input placeholder={t("common.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <button className="icon-btn" title={t("debug.clear")} onClick={clearLog}>
              <Trash2 size={14} />
            </button>
          </>
        )}
        {onDevice && (
          <>
            <Seg
              small
              value={deviceFilter}
              options={[
                { value: "app", label: t("devlog.myApp") },
                { value: "all", label: t("devlog.everything") },
              ]}
              onChange={setDeviceLogFilter}
            />
            <div className="field" style={{ maxWidth: 200, height: 26 }}>
              <ListFilter size={12} />
              <input placeholder={t("common.filter")} value={deviceText} onChange={(e) => setDeviceText(e.target.value)} />
            </div>
            <button
              className="icon-btn"
              title={liveDevice ? t("devlog.pause") : t("devlog.start")}
              onClick={() => void (liveDevice ? stopDeviceLog() : startDeviceLog())}
            >
              {liveDevice ? <Pause size={14} /> : <Play size={13} />}
            </button>
            <button className="icon-btn" title={t("debug.clear")} onClick={clearDeviceLog}>
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
      <div className="debug-body">
        <div className="debug-pane" style={{ display: onConsole ? "flex" : "none" }}>
          {lines.length ? <Console lines={lines} /> : <div className="debug-empty">{log.length ? t("debug.noMatch") : t("debug.empty")}</div>}
          {running && (
            <div className="stdin">
              <CornerDownLeft size={13} className="faint" />
              <input placeholder={t("debug.stdin")} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void send()} />
            </div>
          )}
        </div>
        {ios && (
          <div className="debug-pane" style={{ display: onDevice ? "flex" : "none" }}>
            <DeviceConsole filter={deviceText} />
          </div>
        )}
        {terminals.map((term) => (
          <TerminalView key={term.key} tab={term} cwd={root} visible={visible && debugTab === term.key} onTitle={renameTerminal} onExit={() => undefined} />
        ))}
      </div>
      {menu.node}
    </section>
  );
}
