import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { keys, t } from "../i18n";
import { commands } from "../lib/commands";
import { api } from "../lib/ipc";
import { basename, dirname, relative } from "../lib/paths";
import { useStore } from "../lib/store";
import { KIND_BADGE, type SymbolKind } from "../lib/symbols";
import type { ProjectSymbol } from "../lib/types";
import { FileIcon } from "./FileIcon";

type Result = { path: string; hits: number[]; symbol?: ProjectSymbol };

function badgeKind(kind: string): SymbolKind {
  return kind in KIND_BADGE ? (kind as SymbolKind) : "other";
}

function fuzzy(query: string, text: string): { score: number; hits: number[] } | null {
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  const hits: number[] = [];
  let at = 0;
  for (const ch of q) {
    const found = s.indexOf(ch, at);
    if (found < 0) return null;
    hits.push(found);
    at = found + 1;
  }
  const spread = hits.length ? hits[hits.length - 1] - hits[0] : 0;
  const prefix = s.startsWith(q) ? -50 : 0;
  return { score: spread + hits[0] + prefix + text.length * 0.1, hits };
}

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  const set = new Set(hits);
  return (
    <>
      {[...text].map((c, i) => (set.has(i) ? <b key={i}>{c}</b> : <span key={i}>{c}</span>))}
    </>
  );
}

export function QuickOpen({ commandMode = false }: { commandMode?: boolean }) {
  const project = useStore((s) => s.project);
  const { openSheet, openFile } = useStore.getState();
  const [files, setFiles] = useState<string[]>([]);
  const [symbols, setSymbols] = useState<ProjectSymbol[]>([]);
  const [query, setQuery] = useState(commandMode ? ">" : "");
  const isCommands = query.startsWith(">");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => openSheet(null);

  useEffect(() => {
    if (!project) return;
    void api.listFiles(project.root).then(setFiles);
    if (!commandMode)
      void api
        .projectSymbols(project.root)
        .then(setSymbols)
        .catch(() => setSymbols([]));
  }, [project, commandMode]);

  const commandResults = useMemo(() => {
    if (!isCommands) return [];
    const q = query.slice(1).trim();
    return Object.values(commands)
      .filter((c) => !c.needsProject || project)
      .map((c) => ({ c, m: q ? fuzzy(q, c.label) : { score: 0, hits: [] as number[] } }))
      .filter((r) => r.m)
      .sort((a, b) => a.m!.score - b.m!.score)
      .map((r) => ({ c: r.c, hits: r.m!.hits }));
  }, [isCommands, query, project]);

  const results = useMemo<Result[]>(() => {
    if (!project || isCommands) return [];
    if (!query) return files.slice(0, 50).map((f) => ({ path: f, hits: [] }));
    const byFile = files
      .map((f) => ({ path: f, m: fuzzy(query, basename(f)) }))
      .filter((r) => r.m)
      .sort((a, b) => a.m!.score - b.m!.score)
      .slice(0, 30)
      .map((r) => ({ path: r.path, hits: r.m!.hits }));
    const bySymbol = symbols
      .map((s) => ({ s, m: fuzzy(query, s.name) }))
      .filter((r) => r.m)
      .sort((a, b) => a.m!.score - b.m!.score)
      .slice(0, 40)
      .map((r) => ({ path: r.s.path, hits: r.m!.hits, symbol: r.s }));
    return [...byFile, ...bySymbol];
  }, [files, symbols, query, project, isCommands]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const count = isCommands ? commandResults.length : results.length;
  const choose = (i: number) => {
    if (isCommands) {
      const c = commandResults[i]?.c;
      if (!c) return;
      close();
      c.run();
      return;
    }
    const picked = results[i];
    if (!picked) return;
    close();
    void openFile(picked.path, picked.symbol ? { line: picked.symbol.line } : undefined);
  };

  return (
    <div className="scrim" style={{ background: "rgba(0,0,0,0.12)" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet quick">
        <div className="quick-input">
          <Search size={20} className="faint" />
          <input
            autoFocus
            placeholder={t("quick.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(count - 1, i + 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              }
              if (e.key === "Enter") choose(index);
            }}
          />
        </div>
        <div className="quick-list" ref={listRef}>
          {commandResults.map((r, i) => (
            <div key={r.c.id} className={`quick-item${i === index ? " on" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => choose(i)}>
              <span className="group">{r.c.group}</span>
              <span>
                <Highlight text={r.c.label} hits={r.hits} />
              </span>
              {r.c.shortcut && <span className="shortcut">{keys(r.c.shortcut)}</span>}
            </div>
          ))}
          {results.map((r, i) => (
            <div key={r.symbol ? `${r.path}:${r.symbol.line}:${r.symbol.name}` : r.path} className={`quick-item${i === index ? " on" : ""}`} onMouseEnter={() => setIndex(i)} onClick={() => choose(i)}>
              {r.symbol ? <span className={`sym-badge k-${badgeKind(r.symbol.kind)}`}>{KIND_BADGE[badgeKind(r.symbol.kind)]}</span> : <FileIcon path={r.path} size={16} />}
              <span>
                <Highlight text={r.symbol ? r.symbol.name : basename(r.path)} hits={r.hits} />
              </span>
              <span className="muted ellipsis" style={{ fontSize: 11.5, marginLeft: "auto" }}>
                {r.symbol ? `${basename(r.path)}:${r.symbol.line}` : project && dirname(relative(project.root, r.path))}
              </span>
            </div>
          ))}
          {count === 0 && <div className="empty-hint">{isCommands ? t("quick.noCommands") : t("quick.noFiles")}</div>}
        </div>
      </div>
    </div>
  );
}
