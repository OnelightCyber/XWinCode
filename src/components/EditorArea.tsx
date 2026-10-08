import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleX, Smartphone, TriangleAlert, X } from "lucide-react";
import { keys, t } from "../i18n";
import { editorFontFamily } from "../lib/fonts";
import { openExternal } from "../lib/links";
import { lspStatus, onLspStatus, startLsp, type LspStatus } from "../lib/lsp";
import { monaco } from "../lib/monaco";
import { allDocs, getDoc, isDirty, setModelOptions } from "../lib/models";
import { basename, relative, samePath } from "../lib/paths";
import { useStore } from "../lib/store";
import { breakpointsFor, currentLocation, setBreakpointsFor, toggleBreakpoint, useDebug } from "../lib/debugger";
import { KIND_BADGE, symbolAt, symbolsFor, type Sym } from "../lib/symbols";
import type { Diagnostic } from "../lib/types";
import { AppGlyph } from "./AppGlyph";
import { FileIcon } from "./FileIcon";
import { useMenu, type MenuEntry } from "./Menu";
import { Resizer, usePanelSize } from "./Resizer";

const Canvas = lazy(() => import("./canvas/Canvas"));

const decorationIds = new WeakMap<monaco.editor.ITextModel, string[]>();

monaco.editor.registerLinkOpener({
  open(resource) {
    if (resource.scheme === "http" || resource.scheme === "https" || resource.scheme === "mailto") {
      void openExternal(resource.toString(true));
      return true;
    }
    return resource.scheme !== "file" || !!resource.authority;
  },
});

monaco.editor.registerEditorOpener({
  openCodeEditor(_source, resource, selectionOrPosition) {
    if (resource.scheme !== "file" || resource.authority) return false;
    let at = { line: 1, column: 1 };
    if (selectionOrPosition && "startLineNumber" in selectionOrPosition)
      at = { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn };
    else if (selectionOrPosition) at = { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column };
    void useStore.getState().openFile(resource.fsPath, at);
    return true;
  },
});

function applyDiagnostics(diagnostics: Diagnostic[]) {
  for (const doc of allDocs()) {
    const mine = diagnostics.filter((d) => d.file && samePath(d.file, doc.path) && d.line > 0);
    const lines = doc.model.getLineCount();
    monaco.editor.setModelMarkers(
      doc.model,
      "swiftc",
      mine.map((d) => {
        const line = Math.min(d.line, lines);
        const col = Math.max(1, d.column);
        const end = doc.model.getWordAtPosition({ lineNumber: line, column: col })?.endColumn ?? doc.model.getLineMaxColumn(line);
        return {
          severity:
            d.severity === "error" ? monaco.MarkerSeverity.Error : d.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
          message: d.message,
          startLineNumber: line,
          startColumn: col,
          endLineNumber: line,
          endColumn: Math.max(end, col + 1),
          source: "swiftc",
        };
      }),
    );
    const perLine = new Map<number, Diagnostic>();
    for (const d of mine) {
      const prev = perLine.get(d.line);
      if (!prev || (prev.severity !== "error" && d.severity === "error")) perLine.set(d.line, d);
    }
    const decos: monaco.editor.IModelDeltaDecoration[] = [...perLine.values()]
      .filter((d) => d.severity !== "note")
      .map((d) => {
        const line = Math.min(d.line, lines);
        return {
          range: new monaco.Range(line, 1, line, doc.model.getLineMaxColumn(line)),
          options: {
            isWholeLine: true,
            className: d.severity === "error" ? "line-error" : "line-warning",
            glyphMarginClassName: d.severity === "error" ? "glyph-error" : "glyph-warning",
            glyphMarginHoverMessage: { value: d.message },
            after: { content: d.message, inlineClassName: `inline-issue ${d.severity}` },
          },
        };
      });
    decorationIds.set(doc.model, doc.model.deltaDecorations(decorationIds.get(doc.model) ?? [], decos));
  }
}

function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  useStore((s) => s.dirtyTick);
  const { setActive, closeTab } = useStore.getState();
  return (
    <div className="tabbar">
      {tabs.map((p) => {
        const dirty = isDirty(p);
        const on = !!active && samePath(active, p);
        return (
          <div
            key={p}
            className={`tab${on ? " active" : ""}${dirty ? " dirty" : ""}`}
            title={p}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void closeTab(p);
              } else setActive(p);
            }}
          >
            <FileIcon path={p} size={13} />
            <span className="label">{basename(p)}</span>
            <button
              className="x"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(p);
              }}
              title={`${t("common.close")} (${keys("Ctrl+W")})`}
            >
              <span className="dirty-dot" />
              <X size={12} className="close-icon" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function LspChip() {
  const [st, setSt] = useState<LspStatus>(lspStatus());
  const trusted = useStore((s) => s.trusted);
  useEffect(() => {
    const off = onLspStatus(setSt);
    return () => void off();
  }, []);
  if (!trusted)
    return (
      <button className="chip restricted" title={t("trust.chipHint")} style={{ marginLeft: 10 }} onClick={() => void useStore.getState().ensureTrusted()}>
        <span className="d" />
        {t("trust.restricted")}
      </button>
    );
  if (st.state === "off") return null;
  const label =
    st.state === "ready"
      ? `${t("lsp.ready")}${st.mode === "wsl" ? " · WSL" : ""}`
      : st.state === "starting"
        ? st.detail
          ? `${t("lsp.ready")} · ${st.detail}`
          : t("lsp.starting")
        : t("lsp.unavailable");
  const retry = () => {
    const project = useStore.getState().project;
    if (project) void startLsp(project);
  };
  return (
    <button
      className={`chip ${st.state}`}
      title={st.state === "error" ? `${st.message}\n${t("lsp.retryHint")}` : t("lsp.liveHint")}
      style={{ marginLeft: 10 }}
      disabled={st.state !== "error"}
      onClick={retry}
    >
      <span className="d" />
      {label}
    </button>
  );
}

function useSymbols(active: string | null) {
  const dirtyTick = useStore((s) => s.dirtyTick);
  const [symbols, setSymbols] = useState<Sym[]>([]);
  useEffect(() => {
    const doc = active ? getDoc(active) : undefined;
    if (!doc) {
      setSymbols([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void symbolsFor(doc.model).then((list) => {
        if (!cancelled) setSymbols(list);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, dirtyTick]);
  return symbols;
}

function SymbolBadge({ sym }: { sym: Sym }) {
  return <span className={`sym-badge k-${sym.kind}`}>{KIND_BADGE[sym.kind]}</span>;
}

function SymbolCrumb({ active }: { active: string }) {
  const symbols = useSymbols(active);
  const line = useStore((s) => s.cursor.line);
  const menu = useMenu();
  const current = symbolAt(symbols, line);
  const open = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const entries: MenuEntry[] = symbols.length
      ? symbols.map((s) => ({
          type: "item",
          label: s.name,
          checked: s === current,
          icon: (
            <span style={{ marginLeft: s.depth * 12 }}>
              <SymbolBadge sym={s} />
            </span>
          ),
          onSelect: () => void useStore.getState().openFile(active, { line: s.line, column: s.column }),
        }))
      : [{ type: "item", label: t("jump.noSymbols"), disabled: true, onSelect: () => {} }];
    menu.toggle({ x: r.left, y: r.bottom + 4, entries, minWidth: Math.max(240, r.width) });
  };
  return (
    <span className="row" style={{ gap: 2 }}>
      <ChevronRight size={12} className="faint" />
      <span className="crumb symbol" onClick={open}>
        {current ? (
          <>
            <SymbolBadge sym={current} />
            {current.name}
          </>
        ) : (
          <span className="faint">{t("jump.noSelection")}</span>
        )}
        <ChevronDown size={11} className="faint" />
      </span>
      {menu.node}
    </span>
  );
}

function JumpBar() {
  const project = useStore((s) => s.project)!;
  const active = useStore((s) => s.active);
  const diagnostics = useStore((s) => s.diagnostics);
  const toggleDir = useStore((s) => s.toggleDir);
  if (!active) return null;
  const parts = relative(project.root, active).split("\\");
  const mine = diagnostics.filter((d) => d.file && samePath(d.file, active));
  const e = mine.filter((d) => d.severity === "error").length;
  const w = mine.filter((d) => d.severity === "warning").length;
  return (
    <div className="jumpbar">
      <span className="crumb">
        <AppGlyph kind={project.kind} size={14} />
        {project.name}
      </span>
      {parts.map((part, i) => {
        const path = [project.root, ...parts.slice(0, i + 1)].join("\\");
        const last = i === parts.length - 1;
        return (
          <span key={path} className="row" style={{ gap: 2 }}>
            <ChevronRight size={12} className="faint" />
            <span className="crumb" onClick={() => !last && toggleDir(path, true)}>
              <FileIcon path={path} isDir={!last} size={13} />
              {part}
            </span>
          </span>
        );
      })}
      <SymbolCrumb active={active} />
      <span className="grow" />
      {e > 0 && (
        <span className="badge err">
          <CircleX size={12} />
          {e}
        </span>
      )}
      {w > 0 && (
        <span className="badge warn" style={{ marginLeft: 8 }}>
          <TriangleAlert size={12} />
          {w}
        </span>
      )}
      <LspChip />
      {project.kind === "iosApp" && active.toLowerCase().endsWith(".swift") && <CanvasToggle />}
    </div>
  );
}

function CanvasToggle() {
  const open = useStore((s) => s.canvas);
  return (
    <button className={`icon-btn canvas-toggle${open ? " on" : ""}`} title={`${t("cmd.canvas")} (${keys("Ctrl+Alt+Enter")})`} onClick={() => useStore.getState().toggleCanvas()}>
      <Smartphone size={14} />
    </button>
  );
}

function Shortcut({ value }: { value: string }) {
  return (
    <span>
      {keys(value)
        .split("+")
        .map((k, i) => (
          <kbd key={i}>{k}</kbd>
        ))
        .reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " ", el] : [el]), [])}
    </span>
  );
}

function EmptyEditor() {
  const project = useStore((s) => s.project);
  const rows: [string, string][] = [
    [t("editor.hint.quickOpen"), "Ctrl+P"],
    [t("editor.hint.build"), "Ctrl+B"],
    [t("editor.hint.run"), "Ctrl+R"],
    [t("editor.hint.find"), "Ctrl+Shift+F"],
    [t("editor.hint.library"), "Ctrl+Shift+L"],
    [t("editor.hint.devices"), "Ctrl+Shift+2"],
  ];
  return (
    <div className="editor-empty">
      <div>
        <div className="big">{project ? t("editor.noEditor") : t("editor.noProject")}</div>
        <div className="kbd-list">
          {rows.map(([label, shortcut]) => (
            <span key={label} style={{ display: "contents" }}>
              <span>{label}</span>
              <Shortcut value={shortcut} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EditorArea() {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const current = useRef<string | null>(null);
  const active = useStore((s) => s.active);
  const reveal = useStore((s) => s.reveal);
  const diagnostics = useStore((s) => s.diagnostics);
  const settings = useStore((s) => s.settings);
  const hasTabs = useStore((s) => s.tabs.length > 0);
  const canvasOpen = useStore((s) => s.canvas);
  const iosProject = useStore((s) => s.project?.kind === "iosApp");
  const showCanvas = canvasOpen && iosProject && !!active && active.toLowerCase().endsWith(".swift");
  const canvasSize = usePanelSize("canvas", 460, 320, 960);

  const fontSize = settings?.editorFontSize ?? 13;
  const options = useMemo<monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions>(
    () => ({
      fontFamily: editorFontFamily(settings?.editorFont),
      fontSize,
      lineHeight: Math.round(fontSize * (settings?.editorLineHeight ?? 1.6)),
      fontLigatures: settings?.fontLigatures ?? true,
      minimap: { enabled: settings?.minimap ?? false, renderCharacters: false, scale: 2, showSlider: "mouseover" },
      wordWrap: settings?.wordWrap ? "on" : "off",
      lineNumbers: settings?.lineNumbers === false ? "off" : "on",
      guides: { indentation: settings?.indentGuides ?? true, bracketPairs: false },
      stickyScroll: { enabled: settings?.stickyScroll ?? true },
      cursorSmoothCaretAnimation: settings?.smoothCaret === false ? "off" : "on",
      cursorStyle: settings?.cursorStyle === "block" ? "block" : settings?.cursorStyle === "underline" ? "underline" : "line",
      tabSize: settings?.tabSize ?? 4,
      insertSpaces: settings?.insertSpaces ?? true,
    }),
    [settings, fontSize],
  );

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      model: null,
      automaticLayout: true,
      glyphMargin: true,
      scrollBeyondLastLine: true,
      smoothScrolling: true,
      cursorBlinking: "smooth",
      renderLineHighlight: "all",
      roundedSelection: true,
      padding: { top: 10, bottom: 10 },
      bracketPairColorization: { enabled: false },
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
      overviewRulerLanes: 2,
      fixedOverflowWidgets: true,
      ...options,
    });
    editor.current = ed;
    void document.fonts.ready.then(() => monaco.editor.remeasureFonts());

    let dirtyTimer = 0;
    let saveTimer = 0;
    const sub1 = ed.onDidChangeModelContent(() => {
      window.clearTimeout(dirtyTimer);
      dirtyTimer = window.setTimeout(() => useStore.getState().touchDirty(), 60);
      const st = useStore.getState();
      if (st.settings?.autoSave) {
        window.clearTimeout(saveTimer);
        const path = current.current;
        saveTimer = window.setTimeout(() => path && void st.save(path), 1200);
      }
    });
    const sub2 = ed.onDidChangeCursorSelection((e) => {
      const model = ed.getModel();
      const sel = model ? model.getValueInRange(e.selection).length : 0;
      useStore.getState().setCursor({ line: e.selection.positionLineNumber, column: e.selection.positionColumn, selection: sel });
    });
    const onInsert = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      if (!ed.getModel() || !text) return;
      ed.focus();
      const snippets = ed.getContribution("snippetController2") as unknown as { insert(template: string): void } | null;
      if (snippets) snippets.insert(text);
      else ed.trigger("library", "type", { text });
    };
    window.addEventListener("xwc:insert-snippet", onInsert);
    return () => {
      window.removeEventListener("xwc:insert-snippet", onInsert);
      sub1.dispose();
      sub2.dispose();
      ed.dispose();
      editor.current = null;
    };
  }, []);

  useEffect(() => {
    editor.current?.updateOptions(options);
    setModelOptions({ tabSize: options.tabSize, insertSpaces: options.insertSpaces });
    void document.fonts.load(`${options.fontSize}px ${options.fontFamily}`).then(() => monaco.editor.remeasureFonts());
  }, [options]);

  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const prev = current.current ? getDoc(current.current) : undefined;
    if (prev) prev.viewState = ed.saveViewState();
    const next = active ? getDoc(active) : undefined;
    ed.setModel(next?.model ?? null);
    if (next?.viewState) ed.restoreViewState(next.viewState);
    current.current = active;
    if (next) ed.focus();
  }, [active]);

  useEffect(() => {
    const ed = editor.current;
    if (!ed || !reveal || !active || !samePath(reveal.path, active)) return;
    const pos = { lineNumber: reveal.line, column: reveal.column };
    if (reveal.endLine !== undefined) {
      ed.setSelection(new monaco.Selection(reveal.endLine, reveal.endColumn ?? 1, reveal.line, reveal.column));
      ed.revealPositionInCenterIfOutsideViewport(pos, monaco.editor.ScrollType.Smooth);
    } else {
      ed.setPosition(pos);
      ed.revealPositionInCenterIfOutsideViewport(pos, monaco.editor.ScrollType.Smooth);
    }
    ed.focus();
  }, [reveal, active]);

  useEffect(() => {
    applyDiagnostics(diagnostics);
  }, [diagnostics, active]);

  useEffect(() => {
    const ed = editor.current;
    if (!ed) return;
    const points = ed.createDecorationsCollection();
    const here = ed.createDecorationsCollection();
    const hint = ed.createDecorationsCollection();
    const swift = () => {
      const model = ed.getModel();
      const path = model ? allDocs().find((d) => d.model === model)?.path : undefined;
      return path && /\.swift$/i.test(path) ? path : null;
    };
    const render = () => {
      const path = swift();
      const model = ed.getModel();
      if (!path || !model) {
        points.clear();
        here.clear();
        return;
      }
      const lines = breakpointsFor(path).filter((l) => l <= model.getLineCount());
      const loc = currentLocation();
      const at = loc && samePath(loc.path, path) ? loc.line : null;
      points.set(
        lines.map((line) => ({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            glyphMarginClassName: "xwc-bp",
            glyphMarginHoverMessage: { value: t("debug.breakpoint") },
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })),
      );
      here.set(at ? [{ range: new monaco.Range(at, 1, at, 1), options: { isWholeLine: true, className: "xwc-debug-line", glyphMarginClassName: lines.includes(at) ? "xwc-bp xwc-bp-hit" : "xwc-debug-arrow" } }] : []);
      if (at) ed.revealLineInCenterIfOutsideViewport(at, monaco.editor.ScrollType.Smooth);
    };
    render();
    const unsub = useDebug.subscribe(render);
    const onModel = ed.onDidChangeModel(render);
    const onEdit = ed.onDidChangeModelContent(() => {
      const path = swift();
      if (!path) return;
      const moved = points.getRanges().map((r) => r.startLineNumber);
      const saved = breakpointsFor(path);
      if (moved.length !== saved.length || moved.some((l, i) => l !== saved[i])) setBreakpointsFor(path, moved);
    });
    const onDown = ed.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.event.leftButton) return;
      const path = swift();
      const line = e.target.position?.lineNumber;
      if (path && line) toggleBreakpoint(path, line);
    });
    const onMove = ed.onMouseMove((e) => {
      const line = e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && swift() ? e.target.position?.lineNumber : undefined;
      hint.set(line ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: "xwc-bp-hint" } }] : []);
    });
    const onLeave = ed.onMouseLeave(() => hint.clear());
    return () => {
      unsub();
      onModel.dispose();
      onEdit.dispose();
      onDown.dispose();
      onMove.dispose();
      onLeave.dispose();
      points.clear();
      here.clear();
      hint.clear();
    };
  }, []);

  return (
    <>
      {hasTabs && <TabBar />}
      {hasTabs && <JumpBar />}
      <div className="editor-split">
        <div className="editor-host">
          <div ref={host} style={{ position: "absolute", inset: 0, visibility: active ? "visible" : "hidden" }} />
          {!active && <EmptyEditor />}
        </div>
        {showCanvas && active && (
          <>
            <Resizer axis="x" onDrag={(d) => canvasSize.drag(-d)} onEnd={canvasSize.end} />
            <div className="canvas-pane" style={{ width: canvasSize.size }}>
              <Suspense fallback={<div className="canvas-empty">{t("canvas.loading")}</div>}>
                <Canvas path={active} onClose={() => useStore.getState().toggleCanvas(false)} />
              </Suspense>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function focusEditor() {
  (document.querySelector(".editor-host textarea") as HTMLTextAreaElement | null)?.focus();
}
