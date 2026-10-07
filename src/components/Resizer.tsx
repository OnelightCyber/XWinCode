import { useRef, useState } from "react";

interface Props {
  axis: "x" | "y";
  onDrag: (delta: number) => void;
  onEnd?: () => void;
}

export function Resizer({ axis, onDrag, onEnd }: Props) {
  const start = useRef(0);
  const [dragging, setDragging] = useState(false);

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = axis === "x" ? e.clientX : e.clientY;
    setDragging(true);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
  };
  const move = (e: React.PointerEvent) => {
    if (dragging) onDrag((axis === "x" ? e.clientX : e.clientY) - start.current);
  };
  const up = () => {
    if (!dragging) return;
    setDragging(false);
    document.body.style.cursor = "";
    onEnd?.();
  };

  return (
    <div
      className={`resizer-${axis}${dragging ? " dragging" : ""}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}

export function usePanelSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`xwc.size.${key}`));
      return v >= min ? v : initial;
    } catch {
      return initial;
    }
  });
  const clamped = Math.round(Math.max(min, Math.min(max, size)));
  const base = useRef<number | null>(null);
  const drag = (delta: number) => {
    if (base.current === null) base.current = clamped;
    setSize(Math.max(min, Math.min(max, base.current + delta)));
  };
  const end = () => {
    base.current = null;
    setSize((s) => {
      const v = Math.round(Math.max(min, Math.min(max, s)));
      try {
        localStorage.setItem(`xwc.size.${key}`, String(v));
      } catch {}
      return v;
    });
  };
  return { size: clamped, drag, end };
}
