import type { ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import { useMenu } from "./Menu";

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <button role="switch" aria-checked={on} disabled={disabled} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)} />;
}

interface SegOption<T> {
  value: T;
  label: ReactNode;
  title?: string;
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  small,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  small?: boolean;
}) {
  const index = options.findIndex((o) => o.value === value);
  return (
    <div className={`seg${small ? " small" : ""}`} style={{ ["--n" as string]: options.length, ["--i" as string]: Math.max(0, index) }}>
      {index >= 0 && <span className="seg-thumb" />}
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? "on" : ""} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  width,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  width?: number;
}) {
  const menu = useMenu();
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        className={`select${menu.isOpen ? " open" : ""}`}
        style={{ width }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          menu.toggle({
            x: r.left,
            y: r.bottom + 4,
            minWidth: r.width,
            entries: options.map((o) => ({ type: "item", label: o.label, checked: o.value === value, onSelect: () => onChange(o.value) })),
          });
        }}
      >
        <span className="ellipsis">{current?.label ?? "—"}</span>
        <ChevronsUpDown size={13} className="faint" />
      </button>
      {menu.node}
    </>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--p" as string]: `${p}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">{format ? format(value) : value}</span>
    </div>
  );
}
