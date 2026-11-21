import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  CaseSensitive,
  ChevronRight,
  CircleX,
  Columns2,
  Copy,
  File,
  FilePlus,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GitBranch,
  Info,
  LayoutTemplate,
  ListFilter,
  Pencil,
  RefreshCw,
  Regex,
  Replace,
  Search,
  Settings2,
  Trash2,
  TriangleAlert,
  WholeWord,
} from "lucide-react";
import { keys, locale, t, tn } from "../i18n";
import { confirmAsk } from "../lib/dialogs";
import { api, errorMessage, isTauri } from "../lib/ipc";
import { getDoc } from "../lib/models";
import { basename, dirname, extname, join, relative, samePath } from "../lib/paths";
import { useStore } from "../lib/store";
import type { Diagnostic, Entry, GitFileStatus, SearchHit, SearchOptions } from "../lib/types";
import { AppGlyph } from "./AppGlyph";
import { FileIcon } from "./FileIcon";
import { useMenu, type MenuEntry } from "./Menu";
import { GIT_LETTER, SourceControl } from "./SourceControl";
import { revealInExplorer } from "./Welcome";

const INDENT = 14;

type Template = "swift" | "view" | "model" | "empty";

const TEMPLATE_LINE: Record<Template, number> = { swift: 10, view: 12, model: 12, empty: 1 };

function typeName(file: string): string {
  const stem = file.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  const safe = /^\p{N}/u.test(stem) ? `_${stem}` : stem;
  return safe ? safe[0].toUpperCase() + safe.slice(1) : "Untitled";
}

function fileTemplate(kind: Template, file: string, project: string): string {
  if (kind === "empty" || extname(file) !== "swift") return "";
  const date = new Date().toLocaleDateString(locale());
  const head = `//\n//  ${file}\n//  ${project}\n//\n//  ${t("tpl.createdOn", { date })}\n//\n\n`;
  const name = typeName(file);
  if (kind === "view") return `${head}import SwiftUI\n\nstruct ${name}: View {\n    var body: some View {\n        Text("${name}")\n    }\n}\n\n#Preview {\n    ${name}()\n}\n`;
  if (kind === "model") return `${head}import Observation\n\n@Observable\nfinal class ${name} {\n\n}\n`;
  return `${head}import Foundation\n\n`;
}

function untitled(kind: Template): string {
  if (kind === "view") return t("nav.untitledView");
  if (kind === "model") return t("nav.untitledModel");
  if (kind === "empty") return t("nav.untitledEmpty");
  return t("nav.untitledFile");
}

interface Pending {
  kind: "file" | "folder" | "rename";
  dir: string;
  target?: string;
  template?: Template;
}

interface Press {
  path: string;
  name: string;
  isDir: boolean;
  x: number;
  y: number;
}

interface Drag {
  path: string;
  name: string;
  isDir: boolean;
  over: string | null;
}

function InlineInput({ initial, depth, onDone }: { initial: string; depth: number; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);
  return (
    <div className="tree-row" style={{ paddingLeft: 6 + depth * INDENT + 19 }}>
      <input
        ref={ref}
        className="rename"
        defaultValue={initial}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(e.currentTarget.value.trim() || null);
          if (e.key === "Escape") finish(null);
          e.stopPropagation();
        }}
        onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
      />
    </div>
  );
}

function dropDir(x: number, y: number, moving: string | null): string | null {
  const dir = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]")?.dataset.drop;
  if (!dir) return null;
  if (moving && (samePath(dir, dirname(moving)) || samePath(dir, moving) || dir.toLowerCase().startsWith(`${moving.toLowerCase()}\\`))) return null;
  return dir;
}

async function moveInto(from: string, dir: string) {
  const st = useStore.getState();
  try {
    const to = await api.movePath(from, dir);
    if (samePath(to, from)) return;
    st.toggleDir(dir, true);
    st.pathRenamed(from, to);
  } catch (e) {
    st.toast("error", errorMessage(e));
  }
}

async function importInto(sources: string[], dir: string) {
  const st = useStore.getState();
  try {
    const made = await api.importPaths(sources, dir);
    st.toggleDir(dir, true);
    await st.loadDir(dir);
    if (made.length) {
      st.select(made[0]);
      st.toast("success", tn("nav.imported", made.length));
    }
  } catch (e) {
    st.toast("error", errorMessage(e));
  }
  st.scheduleGit();
}

function FileTree() {
  const project = useStore((s) => s.project)!;
  const dirs = useStore((s) => s.dirs);
  const expanded = useStore((s) => s.expanded);
  const selected = useStore((s) => s.selected);
  const diagnostics = useStore((s) => s.diagnostics);
  const gitFiles = useStore((s) => s.git?.files);
  const { toggleDir, openFile, select, loadDir, toast, pathRenamed, pathDeleted, openSheet, scheduleGit } = useStore.getState();
  const [pending, setPending] = useState<Pending | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [incoming, setIncoming] = useState<string | null>(null);
  const press = useRef<Press | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const dragged = useRef(false);
  const menu = useMenu();

  const changes = useMemo(() => {
    const files = new Map<string, GitFileStatus>();
    const folders = new Set<string>();
    const root = project.root.toLowerCase();
    for (const f of gitFiles ?? []) {
      files.set(f.path.toLowerCase(), f.status);
      for (let dir = dirname(f.path); dir.length > root.length && dir.toLowerCase().startsWith(root); dir = dirname(dir)) folders.add(dir.toLowerCase());
    }
    return { files, folders };
  }, [gitFiles, project.root]);

  const issuesByFile = useMemo(() => {
    const m = new Map<string, { e: number; w: number }>();
    for (const d of diagnostics) {
      if (!d.file) continue;
      const key = d.file.toLowerCase();
      const v = m.get(key) ?? { e: 0, w: 0 };
      if (d.severity === "error") v.e++;
      else if (d.severity === "warning") v.w++;
      m.set(key, v);
    }
    return m;
  }, [diagnostics]);

  const rows = useMemo(() => {
    const out: { entry: Entry; depth: number }[] = [];
    const walk = (dir: string, depth: number) => {
      for (const e of dirs[dir.toLowerCase()] ?? []) {
        out.push({ entry: e, depth });
        if (e.isDir && expanded[e.path.toLowerCase()]) walk(e.path, depth + 1);
      }
    };
    walk(project.root, 1);
    return out;
  }, [dirs, expanded, project.root]);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const p = press.current;
      if (!p) return;
      if (!dragged.current && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 6) return;
      dragged.current = true;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (ghost.current) ghost.current.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 12}px)`;
      const over = dropDir(e.clientX, e.clientY, p.path);
      setDrag((old) => (old && old.path === p.path && old.over === over ? old : { path: p.path, name: p.name, isDir: p.isDir, over }));
    };
    const up = (e: MouseEvent) => {
      const p = press.current;
      press.current = null;
      if (!p || !dragged.current) return;
      const target = dropDir(e.clientX, e.clientY, p.path);
      setDrag(null);
      window.setTimeout(() => {
        dragged.current = false;
      }, 0);
      if (target) void moveInto(p.path, target);
    };
    const cancel = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !press.current) return;
      press.current = null;
      dragged.current = false;
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", cancel);
    };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      const off = await getCurrentWebview().onDragDropEvent((e) => {
        const st = useStore.getState();
        if (st.sheet || !st.project) return;
        const at = (pos: { x: number; y: number }) => dropDir(pos.x / window.devicePixelRatio, pos.y / window.devicePixelRatio, null);
        if (e.payload.type === "enter" || e.payload.type === "over") setIncoming(at(e.payload.position));
        else if (e.payload.type === "leave") setIncoming(null);
        else if (e.payload.type === "drop") {
          const dir = at(e.payload.position);
          setIncoming(null);
          if (dir && e.payload.paths.length) void importInto(e.payload.paths, dir);
        }
      });
      if (alive) unlisten = off;
      else off();
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  const finishPending = async (value: string | null) => {
    const p = pending;
    setPending(null);
    if (!p || !value) return;
    try {
      if (p.kind === "rename" && p.target) {
        if (value === basename(p.target)) return;
        const to = join(dirname(p.target), value);
        await api.renamePath(p.target, to);
        pathRenamed(p.target, to);
      } else if (p.kind === "folder") {
        await api.createDir(join(p.dir, value));
        await loadDir(p.dir);
      } else {
        const template = p.template ?? "swift";
        const name = extname(value) || template === "empty" ? value : `${value}.swift`;
        const path = join(p.dir, name);
        if (await api.pathExists(path)) throw t("nav.fileExists");
        await api.writeTextFile(path, fileTemplate(template, name, project.name));
        await loadDir(p.dir);
        await openFile(path, { line: extname(name) === "swift" ? TEMPLATE_LINE[template] : 1, column: template === "view" ? 15 : 1 });
      }
    } catch (e) {
      toast("error", errorMessage(e));
    }
    scheduleGit();
  };

  const remove = async (path: string) => {
    const ok = await confirmAsk(t("nav.trashConfirm", { name: basename(path) }), t("nav.trash"));
    if (!ok) return;
    try {
      await api.deletePath(path);
      pathDeleted(path);
    } catch (e) {
      toast("error", errorMessage(e));
    }
    scheduleGit();
  };

  const duplicate = async (path: string) => {
    try {
      const copy = await api.duplicatePath(path);
      await loadDir(dirname(path));
      select(copy);
      setPending({ kind: "rename", dir: dirname(copy), target: copy });
    } catch (e) {
      toast("error", errorMessage(e));
    }
    scheduleGit();
  };

  const startNew = (kind: "file" | "folder", dir: string, template: Template = "swift") => {
    toggleDir(dir, true);
    setPending({ kind, dir, template });
  };

  const newFileEntries = (dir: string): MenuEntry[] => [
    ...(project.kind === "iosApp" ? [{ type: "item", label: t("nav.newView"), icon: <LayoutTemplate size={14} />, onSelect: () => startNew("file", dir, "view") } as MenuEntry] : []),
    { type: "item", label: t("nav.newSwift"), icon: <FilePlus size={14} />, shortcut: "Ctrl+N", onSelect: () => startNew("file", dir) },
    { type: "item", label: t("nav.newModel"), icon: <Box size={14} />, onSelect: () => startNew("file", dir, "model") },
    { type: "item", label: t("nav.newEmpty"), icon: <File size={14} />, onSelect: () => startNew("file", dir, "empty") },
  ];

  const contextFor = (e: React.MouseEvent, entry: Entry | null) => {
    e.preventDefault();
    e.stopPropagation();
    const dir = entry ? (entry.isDir ? entry.path : dirname(entry.path)) : project.root;
    if (entry) select(entry.path);
    const items: MenuEntry[] = [
      { type: "submenu", label: t("nav.newFile"), icon: <FilePlus size={14} />, entries: newFileEntries(dir) },
      { type: "item", label: t("nav.newFolder"), icon: <FolderPlus size={14} />, onSelect: () => startNew("folder", dir) },
      { type: "separator" },
    ];
    if (entry) {
      items.push(
        { type: "item", label: t("nav.rename"), icon: <Pencil size={14} />, shortcut: "Enter", onSelect: () => setPending({ kind: "rename", dir, target: entry.path }) },
        ...(entry.isDir ? [] : [{ type: "item", label: t("nav.openBeside"), icon: <Columns2 size={14} />, onSelect: () => void useStore.getState().openBeside(entry.path) } as MenuEntry]),
        { type: "item", label: t("nav.duplicate"), icon: <Copy size={14} />, shortcut: "Ctrl+D", onSelect: () => void duplicate(entry.path) },
        { type: "item", label: t("ctx.showInExplorer"), icon: <FolderOpen size={14} />, onSelect: () => void revealInExplorer(entry.path) },
        { type: "separator" },
        { type: "item", label: t("nav.trash"), icon: <Trash2 size={14} />, shortcut: "Del", danger: true, onSelect: () => void remove(entry.path) },
      );
    } else {
      items.push(
        { type: "item", label: t("ctx.showInExplorer"), icon: <FolderOpen size={14} />, onSelect: () => void revealInExplorer(project.root) },
        { type: "item", label: t("common.refresh"), icon: <RefreshCw size={14} />, onSelect: () => void useStore.getState().refreshTree() },
      );
      if (project.kind === "iosApp")
        items.push({ type: "separator" }, { type: "item", label: t("cmd.projectSettings"), icon: <Settings2 size={14} />, onSelect: () => openSheet("project") });
    }
    menu.open({ x: e.clientX, y: e.clientY, entries: items });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (pending) return;
    const idx = rows.findIndex((r) => selected && samePath(r.entry.path, selected));
    const cur = rows[idx];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) select(next.entry.path);
    } else if (cur && e.key === "ArrowRight" && cur.entry.isDir) {
      toggleDir(cur.entry.path, true);
    } else if (cur && e.key === "ArrowLeft") {
      if (cur.entry.isDir && expanded[cur.entry.path.toLowerCase()]) toggleDir(cur.entry.path, false);
      else select(dirname(cur.entry.path));
    } else if (cur && e.key === "Enter") {
      e.preventDefault();
      setPending({ kind: "rename", dir: dirname(cur.entry.path), target: cur.entry.path });
    } else if (cur && e.key === "Delete") {
      void remove(cur.entry.path);
    } else if (cur && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      e.stopPropagation();
      void duplicate(cur.entry.path);
    } else if (cur && e.key === " " && !cur.entry.isDir) {
      e.preventDefault();
      void openFile(cur.entry.path);
    }
  };

  useEffect(() => {
    const h = () => startNew("file", selected ? (rows.find((r) => samePath(r.entry.path, selected))?.entry.isDir ? selected : dirname(selected)) : project.root);
    window.addEventListener("xwc:new-file", h);
    return () => window.removeEventListener("xwc:new-file", h);
  });

  const target = drag?.over ?? incoming;

  const renderDir = (dir: string, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    if (pending && pending.kind !== "rename" && samePath(pending.dir, dir)) {
      out.push(<InlineInput key="__new" initial={pending.kind === "file" ? untitled(pending.template ?? "swift") : t("nav.newFolderName")} depth={depth} onDone={finishPending} />);
    }
    for (const e of dirs[dir.toLowerCase()] ?? []) {
      const open = !!expanded[e.path.toLowerCase()];
      if (pending?.kind === "rename" && pending.target && samePath(pending.target, e.path)) {
        out.push(<InlineInput key={e.path} initial={e.name} depth={depth} onDone={finishPending} />);
      } else {
        const issues = issuesByFile.get(e.path.toLowerCase());
        const change = e.isDir ? undefined : changes.files.get(e.path.toLowerCase());
        const receiving = e.isDir && !!target && samePath(target, e.path);
        out.push(
          <div
            key={e.path}
            data-drop={e.isDir ? e.path : dir}
            className={`tree-row${selected && samePath(selected, e.path) ? " selected" : ""}${receiving ? " drop-target" : ""}${drag && samePath(drag.path, e.path) ? " dragging" : ""}`}
            style={{ paddingLeft: 6 + depth * INDENT }}
            onMouseDown={(ev) => {
              select(e.path);
              if (ev.button === 0 && !pending) press.current = { path: e.path, name: e.name, isDir: e.isDir, x: ev.clientX, y: ev.clientY };
            }}
            onClick={(ev) => {
              if (dragged.current) return;
              if (e.isDir) toggleDir(e.path);
              else if (ev.altKey) void useStore.getState().openBeside(e.path);
              else void openFile(e.path);
            }}
            onContextMenu={(ev) => contextFor(ev, e)}
          >
            <span className={`twist${open ? " open" : ""}`}>{e.isDir && <ChevronRight size={12} />}</span>
            <FileIcon path={e.path} isDir={e.isDir} open={open} />
            <span className="name">{e.name}</span>
            {issues && (issues.e > 0 || issues.w > 0) && (
              <span className="issue-count" style={{ color: issues.e ? "var(--red)" : "var(--yellow)" }}>
                {issues.e || issues.w}
              </span>
            )}
            {change && <span className={`git-badge s-${change}`}>{GIT_LETTER[change]}</span>}
            {e.isDir && changes.folders.has(e.path.toLowerCase()) && <span className="git-dot" />}
          </div>,
        );
      }
      if (e.isDir && open) out.push(...renderDir(e.path, depth + 1));
    }
    return out;
  };

  const rootOpen = !!expanded[project.root.toLowerCase()];
  const rootReceiving = !!target && samePath(target, project.root);
  return (
    <div tabIndex={0} data-drop={project.root} className={`file-tree${rootReceiving ? " drop-root" : ""}`} onKeyDown={onKeyDown} onContextMenu={(e) => contextFor(e, null)}>
      <div
        data-drop={project.root}
        className={`tree-row root${selected && samePath(selected, project.root) ? " selected" : ""}${rootReceiving ? " drop-target" : ""}`}
        style={{ paddingLeft: 6 }}
        onMouseDown={() => select(project.root)}
        onClick={() => toggleDir(project.root)}
      >
        <span className={`twist${rootOpen ? " open" : ""}`}>
          <ChevronRight size={12} />
        </span>
        <AppGlyph kind={project.kind} size={16} />
        <span className="name">{project.name}</span>
      </div>
      {rootOpen && renderDir(project.root, 1)}
      {drag && (
        <div ref={ghost} className="drag-ghost" style={{ transform: `translate(${pointer.current.x + 14}px, ${pointer.current.y + 12}px)` }}>
          <FileIcon path={drag.path} isDir={drag.isDir} size={13} />
          {drag.name}
        </div>
      )}
      {menu.node}
    </div>
  );
}

function FilteredFiles({ filter }: { filter: string }) {
  const project = useStore((s) => s.project)!;
  const openFile = useStore((s) => s.openFile);
  const [files, setFiles] = useState<string[]>([]);
  useEffect(() => {
    void api.listFiles(project.root).then(setFiles).catch(() => setFiles([]));
  }, [project.root]);
  const q = filter.toLowerCase();
  const hits = files.filter((f) => basename(f).toLowerCase().includes(q)).slice(0, 300);
  if (!hits.length) return <div className="empty-hint">{t("nav.noFilesMatch")}</div>;
  return (
    <>
      {hits.map((f) => (
        <div key={f} className="tree-row" style={{ paddingLeft: 8 }} onClick={() => void openFile(f)}>
          <FileIcon path={f} />
          <span className="name">{basename(f)}</span>
          <span className="faint ellipsis" style={{ fontSize: 11 }}>
            {dirname(relative(project.root, f))}
          </span>
        </div>
      ))}
    </>
  );
}

const WORD_SEPARATORS = "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?";

function searchPattern(query: string, options: SearchOptions, flags: string): RegExp | null {
  const core = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(options.wholeWord ? `\\b(?:${core})\\b` : core, flags + (options.caseSensitive ? "" : "i"));
  } catch {
    return null;
  }
}

function SearchPanel() {
  const project = useStore((s) => s.project)!;
  const openFile = useStore((s) => s.openFile);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [replaceMode, setReplaceMode] = useState(false);
  const [caseSensitive, setCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const options = useMemo<SearchOptions>(() => ({ caseSensitive, wholeWord, regex }), [caseSensitive, wholeWord, regex]);
  const marker = useMemo(() => (query ? searchPattern(query, options, "") : null), [query, options]);

  useEffect(() => {
    const focus = () => input.current?.focus();
    focus();
    window.addEventListener("xwc:focus-search", focus);
    return () => window.removeEventListener("xwc:focus-search", focus);
  }, []);

  const run = async () => {
    if (!query.trim()) return setHits(null);
    setBusy(true);
    try {
      setHits(await api.searchProject(project.root, query, options));
    } catch (e) {
      setHits(null);
      useStore.getState().toast("error", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const grouped = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of hits ?? []) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m.entries()];
  }, [hits]);

  const replaceIn = async (paths: string[]) => {
    if (!query || !paths.length) return;
    const { toast, touchDirty } = useStore.getState();
    const ok = await confirmAsk(
      t("search.confirmReplace", { query, replacement, files: tn("search.files", paths.length) }),
      t("search.replaceAll"),
    );
    if (!ok) return;
    let total = 0;
    try {
      for (const path of paths) {
        const doc = getDoc(path);
        if (doc) {
          const matches = doc.model.findMatches(query, false, regex, caseSensitive, wholeWord ? WORD_SEPARATORS : null, false);
          const single = regex ? searchPattern(query, options, "") : null;
          if (matches.length) {
            doc.model.pushEditOperations(
              [],
              matches.map((m) => ({ range: m.range, text: single ? doc.model.getValueInRange(m.range).replace(single, replacement) : replacement })),
              () => null,
            );
            total += matches.length;
          }
        } else {
          total += await api.replaceInFile(path, query, replacement, options);
        }
      }
      touchDirty();
      toast("success", tn("search.replaced", total));
    } catch (e) {
      toast("error", errorMessage(e));
    }
    await run();
  };

  const highlight = (text: string) => {
    const found = marker?.exec(text);
    if (!found || !found[0]) return text;
    const i = found.index;
    const hit = found[0];
    return (
      <>
        {text.slice(0, i)}
        {replaceMode && replacement !== "" ? (
          <>
            <del>{hit}</del>
            <ins>{regex && marker ? hit.replace(marker, replacement) : replacement}</ins>
          </>
        ) : (
          <mark>{hit}</mark>
        )}
        {text.slice(i + hit.length)}
      </>
    );
  };

  return (
    <>
      <div className="search-box">
        <div className="row" style={{ gap: 6 }}>
          <div className="field">
            <Search size={13} />
            <input ref={input} placeholder={t("search.placeholder")} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void run()} />
          </div>
          <button className={`icon-btn${replaceMode ? " on" : ""}`} title={t("search.toggleReplace")} onClick={() => setReplaceMode(!replaceMode)}>
            <Replace size={14} />
          </button>
        </div>
        <div className="row search-options">
          <button className={`icon-btn${caseSensitive ? " on" : ""}`} title={t("search.caseSensitive")} onClick={() => setCase(!caseSensitive)}>
            <CaseSensitive size={15} />
          </button>
          <button className={`icon-btn${wholeWord ? " on" : ""}`} title={t("search.wholeWord")} onClick={() => setWholeWord(!wholeWord)}>
            <WholeWord size={15} />
          </button>
          <button className={`icon-btn${regex ? " on" : ""}`} title={t("search.regex")} onClick={() => setRegex(!regex)}>
            <Regex size={14} />
          </button>
        </div>
        {replaceMode && (
          <div className="row" style={{ gap: 6 }}>
            <div className="field">
              <Replace size={13} />
              <input placeholder={t("search.replacePlaceholder")} value={replacement} onChange={(e) => setReplacement(e.target.value)} />
            </div>
            <button className="btn small" disabled={!grouped.length} onClick={() => void replaceIn(grouped.map(([p]) => p))}>
              {t("search.replaceAll")}
            </button>
          </div>
        )}
      </div>
      {busy && <div className="empty-hint">{t("search.searching")}</div>}
      {!busy && hits && (
        <div className="faint" style={{ fontSize: 11, padding: "0 6px 6px" }}>
          {tn("search.results", hits.length)} · {tn("search.files", grouped.length)}
        </div>
      )}
      {!busy &&
        grouped.map(([path, list]) => (
          <div key={path}>
            <div className="search-hit-file">
              <FileIcon path={path} size={13} />
              <span className="ellipsis">{basename(path)}</span>
              {replaceMode && (
                <button className="icon-btn file-replace" title={t("search.replaceInFile")} onClick={() => void replaceIn([path])}>
                  <Replace size={12} />
                </button>
              )}
              <span className="faint" style={{ marginLeft: replaceMode ? 0 : "auto", fontWeight: 500 }}>
                {list.length}
              </span>
            </div>
            {list.map((h) => (
              <div key={`${h.line}:${h.column}`} className="search-hit" onClick={() => void openFile(h.path, { line: h.line, column: h.column })}>
                {highlight(h.text)}
              </div>
            ))}
          </div>
        ))}
    </>
  );
}

export function IssueIcon({ severity, size = 13 }: { severity: Diagnostic["severity"]; size?: number }) {
  if (severity === "error") return <CircleX size={size} color="var(--red)" style={{ flex: "none", marginTop: 1 }} />;
  if (severity === "warning") return <TriangleAlert size={size} color="var(--yellow)" style={{ flex: "none", marginTop: 1 }} />;
  return <Info size={size} color="var(--text-3)" style={{ flex: "none", marginTop: 1 }} />;
}

function IssuesPanel() {
  const diagnostics = useStore((s) => s.diagnostics);
  const project = useStore((s) => s.project)!;
  const openFile = useStore((s) => s.openFile);
  const sorted = [...diagnostics].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  if (!sorted.length)
    return (
      <div className="empty-hint">
        {t("issues.none")}
        <br />
        {t("issues.buildHint")}{" "}
        {keys("Ctrl+B")
          .split("+")
          .map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
      </div>
    );
  return (
    <>
      {sorted.map((d, i) => (
        <div key={i} className="issue" onClick={() => d.file && void openFile(d.file, { line: d.line, column: d.column })}>
          <IssueIcon severity={d.severity} />
          <div style={{ minWidth: 0 }}>
            <div className="msg">{d.message}</div>
            {d.file && (
              <div className="loc">
                {relative(project.root, d.file)}:{d.line}
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export function Navigator({ width }: { width: number }) {
  const tab = useStore((s) => s.navTab);
  const setNavTab = useStore((s) => s.setNavTab);
  const project = useStore((s) => s.project);
  const errors = useStore((s) => s.diagnostics.filter((d) => d.severity === "error").length);
  const pendingChanges = useStore((s) => s.git?.files.length ?? 0);
  const [filter, setFilter] = useState("");

  return (
    <aside className="navigator glass" style={{ width }}>
      <div className="nav-tabs">
        <button className={`icon-btn${tab === "project" ? " on" : ""}`} title={`${t("nav.projectTab")} (${keys("Ctrl+1")})`} onClick={() => setNavTab("project")}>
          <FolderTree size={16} />
        </button>
        <button className={`icon-btn${tab === "git" ? " on" : ""}`} title={`${t("nav.gitTab")} (${keys("Ctrl+2")})`} onClick={() => setNavTab("git")}>
          <GitBranch size={16} />
          {pendingChanges > 0 && <span className="dot quiet">{pendingChanges > 99 ? "99+" : pendingChanges}</span>}
        </button>
        <button className={`icon-btn${tab === "search" ? " on" : ""}`} title={`${t("nav.searchTab")} (${keys("Ctrl+Shift+F")})`} onClick={() => setNavTab("search")}>
          <Search size={16} />
        </button>
        <button className={`icon-btn${tab === "issues" ? " on" : ""}`} title={`${t("nav.issuesTab")} (${keys("Ctrl+5")})`} onClick={() => setNavTab("issues")}>
          <TriangleAlert size={16} />
          {errors > 0 && <span className="dot">{errors}</span>}
        </button>
      </div>
      <div className="nav-body">
        {!project ? (
          <div className="empty-hint">{t("nav.noProject")}</div>
        ) : tab === "project" ? (
          filter ? (
            <FilteredFiles filter={filter} />
          ) : (
            <FileTree />
          )
        ) : tab === "git" ? (
          <SourceControl />
        ) : tab === "search" ? (
          <SearchPanel />
        ) : (
          <IssuesPanel />
        )}
      </div>
      {project && tab === "project" && (
        <div className="nav-footer">
          <button className="icon-btn" title={`${t("cmd.newFile")} (${keys("Ctrl+N")})`} onClick={() => window.dispatchEvent(new Event("xwc:new-file"))}>
            <FilePlus size={15} />
          </button>
          <div className="field">
            <ListFilter size={13} />
            <input placeholder={t("common.filter")} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      )}
    </aside>
  );
}
