import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";
import { keys } from "../i18n";

export type MenuEntry =
  | {
      type: "item";
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      detail?: string;
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    }
  | { type: "submenu"; label: string; icon?: ReactNode; disabled?: boolean; checked?: boolean; entries: MenuEntry[] }
  | { type: "separator" }
  | { type: "title"; label: string };

interface PanelProps {
  x: number;
  y: number;
  entries: MenuEntry[];
  minWidth?: number;
  anchor?: DOMRect;
  onClose: () => void;
  onBack?: () => void;
  focusFirst?: boolean;
}

const selectable = (e: MenuEntry) => (e.type === "item" || e.type === "submenu") && !e.disabled;

function MenuPanel({ x, y, entries, minWidth, anchor, onClose, onBack, focusFirst }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(() => (focusFirst ? entries.findIndex(selectable) : -1));
  const [sub, setSub] = useState<{ index: number; rect: DOMRect; keyboard: boolean } | null>(null);
  const hoverTimer = useRef(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (anchor) {
      left = anchor.right + 2;
      if (left + r.width > vw - 6) left = anchor.left - r.width - 2;
      top = anchor.top - 5;
    }
    setPos({
      left: Math.max(6, Math.min(left, vw - r.width - 6)),
      top: Math.max(6, Math.min(top, vh - r.height - 6)),
    });
  }, [x, y, anchor]);

  const openSub = useCallback((index: number, keyboard: boolean) => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (el) setSub({ index, rect: el.getBoundingClientRect(), keyboard });
  }, []);

  const choose = useCallback(
    (index: number, keyboard = false) => {
      const e = entries[index];
      if (!e || !selectable(e)) return;
      if (e.type === "submenu") return openSub(index, keyboard);
      if (e.type === "item") {
        onClose();
        e.onSelect();
      }
    },
    [entries, onClose, openSub],
  );

  useEffect(() => {
    if (sub) return;
    const key = (e: KeyboardEvent) => {
      const move = (dir: 1 | -1) => {
        const n = entries.length;
        let i = active;
        for (let step = 0; step < n; step++) {
          i = (i + dir + n) % n;
          if (selectable(entries[i])) break;
        }
        setActive(i);
      };
      let handled = true;
      if (e.key === "ArrowDown") move(1);
      else if (e.key === "ArrowUp") move(-1);
      else if (e.key === "ArrowRight" && entries[active]?.type === "submenu") openSub(active, true);
      else if (e.key === "ArrowLeft" && onBack) onBack();
      else if (e.key === "Enter" || e.key === " ") choose(active, true);
      else if (e.key === "Escape") (onBack ?? onClose)();
      else if (e.key === "Tab") onClose();
      else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [sub, active, entries, choose, onBack, onClose, openSub]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const hasChecks = entries.some((e) => (e.type === "item" || e.type === "submenu") && e.checked !== undefined);
  const subEntry = sub ? entries[sub.index] : null;

  return (
    <>
      {createPortal(
        <div
          className="menu glass"
          ref={ref}
          role="menu"
          style={{ left: pos?.left ?? x, top: pos?.top ?? y, minWidth, visibility: pos ? "visible" : "hidden" }}
          onContextMenu={(e) => e.preventDefault()}
          onMouseLeave={() => {
            window.clearTimeout(hoverTimer.current);
            if (!sub) setActive(-1);
          }}
        >
          {entries.map((e, i) => {
            if (e.type === "separator") return <div key={i} className="menu-sep" />;
            if (e.type === "title")
              return (
                <div key={i} className="menu-title">
                  {e.label}
                </div>
              );
            const isSub = e.type === "submenu";
            const on = active === i || sub?.index === i;
            return (
              <div
                key={i}
                data-index={i}
                role="menuitem"
                className={`menu-item${on ? " active" : ""}${e.disabled ? " disabled" : ""}${!isSub && e.danger ? " danger" : ""}`}
                onMouseEnter={() => {
                  if (e.disabled) return;
                  setActive(i);
                  window.clearTimeout(hoverTimer.current);
                  hoverTimer.current = window.setTimeout(
                    () => {
                      if (isSub) openSub(i, false);
                      else setSub(null);
                    },
                    isSub ? 90 : 160,
                  );
                }}
                onClick={() => choose(i)}
              >
                {hasChecks && <span className="check">{e.checked && <Check size={13} strokeWidth={2.4} />}</span>}
                {e.icon && <span className="menu-icon">{e.icon}</span>}
                <span className="label">{e.label}</span>
                {!isSub && e.detail && <span className="shortcut">{e.detail}</span>}
                {!isSub && e.shortcut && <span className="shortcut">{keys(e.shortcut)}</span>}
                {isSub && <ChevronRight size={13} className="sub-chev" />}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
      {sub && subEntry?.type === "submenu" && (
        <MenuPanel
          key={sub.index}
          x={0}
          y={0}
          anchor={sub.rect}
          entries={subEntry.entries}
          minWidth={200}
          focusFirst={sub.keyboard}
          onClose={onClose}
          onBack={() => {
            setActive(sub.index);
            setSub(null);
          }}
        />
      )}
    </>
  );
}

interface MenuProps {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose: () => void;
  minWidth?: number;
}

export function Menu({ x, y, entries, onClose, minWidth }: MenuProps) {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.(".menu")) onClose();
    };
    window.addEventListener("mousedown", down, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", down, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);
  return <MenuPanel x={x} y={y} entries={entries} minWidth={minWidth} onClose={onClose} />;
}

interface OpenMenu {
  x: number;
  y: number;
  entries: MenuEntry[];
  minWidth?: number;
}

export function useMenu() {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const closedAt = useRef(0);
  const close = useCallback(() => {
    closedAt.current = performance.now();
    setMenu(null);
  }, []);
  const toggle = useCallback((m: OpenMenu) => {
    if (performance.now() - closedAt.current > 250) setMenu(m);
  }, []);
  const node = menu ? <Menu {...menu} onClose={close} /> : null;
  return { open: setMenu, toggle, close, node, isOpen: menu !== null };
}
