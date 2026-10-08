import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToDot, ArrowUpFromDot, ChevronDown, ChevronRight, CornerDownLeft, ListFilter, Pause, Play, Plus, RedoDot, Smartphone, Square, SquareTerminal, Terminal as TerminalIcon, Trash2, X } from "lucide-react";
import { keys, t } from "../i18n";
import { api, errorMessage } from "../lib/ipc";
import { relative, wslToWindows } from "../lib/paths";
import { debugContinue, debugPause, debugStepIn, debugStepOut, debugStepOver, selectFrame, stopDebugging, toggleVar, useDebug, type DebugVar } from "../lib/debugger";
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

  const debugStatus = useDebug((s) => s.status);
  const debugReason = useDebug((s) => s.reason);
  const debugging = debugStatus !== "off";
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
        {debugging && (
          <div className="dbg-controls">
            {debugStatus === "paused" ? (
              <button className="icon-btn" title={`${t("debug.continue")} (F5)`} onClick={debugContinue}>
                <Play size={13} fill="currentColor" />
              </button>
            ) : (
              <button className="icon-btn" title={t("debug.pause")} disabled={debugStatus !== "running"} onClick={debugPause}>
                <Pause size={13} fill="currentColor" />
              </button>
            )}
            <button className="icon-btn" title={`${t("debug.stepOver")} (F10)`} disabled={debugStatus !== "paused"} onClick={debugStepOver}>
              <RedoDot size={14} />
            </button>
            <button className="icon-btn" title={`${t("debug.stepIn")} (F11)`} disabled={debugStatus !== "paused"} onClick={debugStepIn}>
              <ArrowDownToDot size={14} />
            </button>
            <button className="icon-btn" title={`${t("debug.stepOut")} (${keys("Shift")}+F11)`} disabled={debugStatus !== "paused"} onClick={debugStepOut}>
              <ArrowUpFromDot size={14} />
            </button>
            <button className="icon-btn" title={`${t("debug.stopDebug")} (${keys("Shift")}+F5)`} onClick={() => void stopDebugging()}>
              <Square size={11} fill="currentColor" />
            </button>
            <span className={`dbg-status ${debugStatus}`}>{t(`debug.status.${debugStatus}` as Parameters<typeof t>[0])}{debugStatus === "paused" && debugReason ? ` · ${debugReason}` : ""}</span>
          </div>
        )}
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
        {debugging && debugStatus !== "building" && <DebugSidebar />}
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

function VarRows({ vars, depth }: { vars: DebugVar[]; depth: number }) {
  const open = useDebug((s) => s.open);
  const all = useDebug((s) => s.vars);
  return (
    <>
      {vars.map((v, i) => (
        <div key={`${v.name}:${i}`}>
          <button className="dbg-var" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => v.ref > 0 && toggleVar(v.ref)}>
            <span className="dbg-chev">{v.ref > 0 ? open[v.ref] ? <ChevronDown size={11} /> : <ChevronRight size={11} /> : null}</span>
            <span className="dbg-name">{v.name}</span>
            {v.type && <span className="dbg-type">{v.type}</span>}
            <span className="dbg-value" title={v.value}>
              {v.value}
            </span>
          </button>
          {v.ref > 0 && open[v.ref] && all[v.ref] && <VarRows vars={all[v.ref]} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

function DebugSidebar() {
  const status = useDebug((s) => s.status);
  const frames = useDebug((s) => s.frames);
  const frame = useDebug((s) => s.frame);
  const scopes = useDebug((s) => s.scopes);
  const vars = useDebug((s) => s.vars);
  const open = useDebug((s) => s.open);
  return (
    <div className="dbg-side">
      {status !== "paused" ? (
        <div className="dbg-empty">{t(`debug.status.${status}` as Parameters<typeof t>[0])}</div>
      ) : (
        <>
          <div className="dbg-head">{t("debug.variables")}</div>
          <div className="dbg-vars">
            {scopes.map((s) => (
              <div key={s.ref}>
                <button className="dbg-var scope" onClick={() => toggleVar(s.ref)}>
                  <span className="dbg-chev">{open[s.ref] ? <ChevronDown size={11} /> : <ChevronRight size={11} />}</span>
                  <span className="dbg-name">{s.name}</span>
                </button>
                {open[s.ref] && (vars[s.ref]?.length ? <VarRows vars={vars[s.ref]} depth={1} /> : vars[s.ref] ? <div className="dbg-none">{t("debug.noVariables")}</div> : null)}
              </div>
            ))}
          </div>
          <div className="dbg-head">{t("debug.callStack")}</div>
          <div className="dbg-frames">
            {frames.map((f, i) => {
              const user = !!f.path && /\.swift$/i.test(f.path);
              const file = f.path ? (f.path.split(/[\\/]/).pop() ?? "").split("`")[0] : "";
              return (
                <button key={f.id} className={`dbg-frame${i === frame ? " on" : ""}${user ? "" : " sys"}`} onClick={() => void selectFrame(i)} title={f.path ?? ""}>
                  <span className="dbg-fn">{f.name}</span>
                  {user && (
                    <span className="dbg-loc">
                      {file}:{f.line}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
