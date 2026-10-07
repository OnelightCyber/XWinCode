import { useEffect, useMemo, useRef, useState } from "react";
import { Braces, LayoutTemplate, Search, Wand2, X } from "lucide-react";
import { t } from "../i18n";
import { LIBRARY, previewSnippet, type LibraryCategory, type LibraryItem } from "../lib/library";
import { useStore } from "../lib/store";
import { Seg } from "./Controls";

const ICONS: Record<LibraryCategory, React.ReactNode> = {
  views: <LayoutTemplate size={15} />,
  modifiers: <Wand2 size={15} />,
  code: <Braces size={15} />,
};

export function insertSnippet(snippet: string): boolean {
  const { active, toast } = useStore.getState();
  if (!active) {
    toast("info", t("lib.noEditor"));
    return false;
  }
  window.dispatchEvent(new CustomEvent("xwc:insert-snippet", { detail: snippet }));
  return true;
}

export function LibrarySheet() {
  const openSheet = useStore((s) => s.openSheet);
  const [category, setCategory] = useState<LibraryCategory>("views");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => openSheet(null);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? LIBRARY : LIBRARY.filter((i) => i.category === category);
    return q ? pool.filter((i) => `${i.name} ${t(i.desc)}`.toLowerCase().includes(q)) : pool;
  }, [category, query]);

  useEffect(() => setIndex(0), [category, query]);
  useEffect(() => {
    listRef.current?.querySelector(".lib-item.on")?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const current: LibraryItem | undefined = items[Math.min(index, items.length - 1)];
  const insert = (it: LibraryItem | undefined) => {
    if (it && insertSnippet(it.snippet)) close();
  };

  return (
    <div className="scrim library-scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="sheet library"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setIndex((i) => Math.min(items.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            insert(current);
          }
        }}
      >
        <div className="lib-head">
          <div className="field">
            <Search size={14} />
            <input autoFocus placeholder={t("lib.search")} value={query} onChange={(e) => setQuery(e.target.value)} />
            {query && (
              <button className="field-clear" onClick={() => setQuery("")} title={t("common.clear")}>
                <X size={12} />
              </button>
            )}
          </div>
          <Seg
            small
            value={category}
            options={[
              { value: "views", label: t("lib.cat.views") },
              { value: "modifiers", label: t("lib.cat.modifiers") },
              { value: "code", label: t("lib.cat.code") },
            ]}
            onChange={(v) => {
              setQuery("");
              setCategory(v);
            }}
          />
        </div>
        <div className="lib-body">
          <div className="lib-list" ref={listRef}>
            {items.map((it, i) => (
              <div
                key={it.id}
                className={`lib-item${i === index ? " on" : ""}`}
                onMouseDown={() => setIndex(i)}
                onDoubleClick={() => insert(it)}
              >
                <span className="lib-ic">{ICONS[it.category]}</span>
                <div className="lib-meta">
                  <div className="lib-name">{it.name}</div>
                  <div className="lib-desc ellipsis">{t(it.desc)}</div>
                </div>
              </div>
            ))}
            {items.length === 0 && <div className="empty-hint">{t("lib.empty")}</div>}
          </div>
          {current && (
            <div className="lib-detail">
              <div className="lib-detail-head">
                <span className="lib-ic big">{ICONS[current.category]}</span>
                <div>
                  <div className="lib-detail-name">{current.name}</div>
                  <div className="lib-detail-desc">{t(current.desc)}</div>
                </div>
              </div>
              <pre className="lib-code">{previewSnippet(current.snippet)}</pre>
              <div className="row">
                <span className="faint" style={{ fontSize: 11.5 }}>
                  {t("lib.hint")}
                </span>
                <span className="grow" />
                <button className="btn small primary" onClick={() => insert(current)}>
                  {t("lib.insert")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
