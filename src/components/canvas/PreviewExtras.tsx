import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { cssColor } from "../../lib/preview/colors";
import { sfSymbol } from "../../lib/preview/sf";
import type { ColorSpec, Mod, ViewNode } from "../../lib/preview/types";

export interface DrawEnv {
  dark: boolean;
  tint: string;
  measure?: (key: string, width: number, height: number) => void;
}

type Cmd = (string | number)[];

interface Plot {
  label: string;
  kind: "n" | "s" | "d";
  v: number | string;
}

interface Op {
  op: "fill" | "stroke" | "text";
  cmds?: Cmd[];
  color?: ColorSpec;
  width?: number;
  cap?: string;
  dash?: number[];
  opacity?: number;
  text?: string;
  x?: number;
  y?: number;
  size?: number;
  weight?: string;
}

const PALETTE = ["blue", "green", "orange", "purple", "red", "cyan", "yellow", "pink", "indigo", "mint"];

function useBox(report?: (width: number, height: number) => void): [RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const latest = useRef(report);
  latest.current = report;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox((old) => (old.w === w && old.h === h ? old : { w, h }));
      if (w > 0 && h > 0) latest.current?.(w, h);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, box];
}

function reporter(node: ViewNode, env: DrawEnv): ((w: number, h: number) => void) | undefined {
  const key = node.props.measure;
  const measure = env.measure;
  return typeof key === "string" && measure ? (w, h) => measure(key, w, h) : undefined;
}

const pathData = (cmds: Cmd[] | undefined) => (cmds ?? []).map((c) => c.join(" ")).join(" ");

const lastMod = <K extends Mod["m"]>(node: ViewNode, kind: K) => node.mods?.filter((m): m is Extract<Mod, { m: K }> => m.m === kind).pop();

export function Measured({ node, env, className, style, children }: { node: ViewNode; env: DrawEnv; className: string; style?: CSSProperties; children: ReactNode }) {
  const [ref] = useBox(reporter(node, env));
  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}

export function PathView({ node, env }: { node: ViewNode; env: DrawEnv }) {
  const [ref] = useBox(reporter(node, env));
  const box = node.props.box as [number, number] | undefined;
  const cmds = node.props.cmds as Cmd[] | undefined;
  const d = useMemo(() => pathData(cmds), [cmds]);
  const fill = lastMod(node, "fill");
  const stroke = lastMod(node, "stroke");
  const trim = lastMod(node, "trim");
  const length = trim ? Math.max(0, trim.to - trim.from) : 1;
  return (
    <div ref={ref} className="pv-path">
      <svg viewBox={box ? `0 0 ${Math.max(1, box[0])} ${Math.max(1, box[1])}` : undefined} preserveAspectRatio={box ? "none" : undefined}>
        <path
          d={d}
          fill={fill ? cssColor(fill.color, env.dark, "blue") : stroke ? "none" : "currentColor"}
          stroke={stroke ? cssColor(stroke.color, env.dark, "blue") : "none"}
          strokeWidth={stroke?.width ?? 1}
          strokeLinecap={stroke?.cap === "round" ? "round" : stroke?.cap === "square" ? "square" : "butt"}
          strokeLinejoin="round"
          pathLength={trim ? 1 : undefined}
          strokeDasharray={trim ? `${length} 1` : stroke?.dash?.join(" ")}
          strokeDashoffset={trim ? -trim.from : undefined}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

export function GlassDisc({ className, style, tint, children }: { className: string; style: CSSProperties; tint: string; children: ReactNode }) {
  const [ref, box] = useBox();
  const d = Math.min(box.w, box.h);
  return (
    <div ref={ref} style={{ ...style, isolation: "isolate" }}>
      <div className={className} style={{ position: "absolute", zIndex: -1, width: d, height: d, left: (box.w - d) / 2, top: (box.h - d) / 2, borderRadius: "50%", ["--pv-glass-tint" as string]: tint } as CSSProperties} />
      {children}
    </div>
  );
}

export function CircleView({ node, env }: { node: ViewNode; env: DrawEnv }) {
  const [ref, box] = useBox();
  const fill = lastMod(node, "fill");
  const stroke = lastMod(node, "stroke");
  const trim = lastMod(node, "trim");
  const width = stroke?.width ?? 0;
  const diameter = Math.min(box.w, box.h);
  const r = Math.max(0, diameter / 2 - (stroke?.inset ? width / 2 : 0));
  const around = 2 * Math.PI * r;
  const from = trim ? Math.max(0, Math.min(1, trim.from)) : 0;
  const length = trim ? Math.max(0, Math.min(1, trim.to) - from) : 1;
  return (
    <div ref={ref} className="pv-path round">
      {diameter > 0 && (
        <svg>
          <circle
            cx={box.w / 2}
            cy={box.h / 2}
            r={r}
            fill={fill ? cssColor(fill.color, env.dark, "blue") : stroke ? "none" : "currentColor"}
            stroke={stroke ? cssColor(stroke.color, env.dark, "blue") : "none"}
            strokeWidth={width}
            strokeLinecap={stroke?.cap === "round" ? "round" : stroke?.cap === "square" ? "square" : "butt"}
            strokeDasharray={trim ? `${around * length} ${around}` : stroke?.dash?.join(" ")}
            strokeDashoffset={trim ? -around * from : undefined}
          />
        </svg>
      )}
    </div>
  );
}

export function CanvasView({ node, env }: { node: ViewNode; env: DrawEnv }) {
  const [ref] = useBox(reporter(node, env));
  const box = (node.props.box as [number, number] | undefined) ?? [1, 1];
  const ops = (node.props.ops as Op[] | undefined) ?? [];
  return (
    <div ref={ref} className="pv-path">
      <svg viewBox={`0 0 ${Math.max(1, box[0])} ${Math.max(1, box[1])}`} preserveAspectRatio="none">
        {ops.map((op, i) => {
          const paint = cssColor(op.color, env.dark, "blue") ?? "currentColor";
          if (op.op === "text")
            return (
              <text key={i} x={op.x} y={op.y} fill={op.color ? paint : "currentColor"} fontSize={op.size ?? 17} fontWeight={op.weight === "bold" ? 700 : op.weight === "semibold" ? 600 : undefined} opacity={op.opacity} textAnchor="middle" dominantBaseline="central">
                {op.text}
              </text>
            );
          const d = pathData(op.cmds);
          if (op.op === "fill") return <path key={i} d={d} fill={paint} opacity={op.opacity} />;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={paint}
              strokeWidth={op.width ?? 1}
              strokeLinecap={op.cap === "round" ? "round" : op.cap === "square" ? "square" : "butt"}
              strokeLinejoin="round"
              strokeDasharray={op.dash?.join(" ")}
              opacity={op.opacity}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function GaugeView({ node, env }: { node: ViewNode; env: DrawEnv }) {
  const p = node.props;
  const min = Number(p.min ?? 0);
  const max = Number(p.max ?? 1);
  const ratio = max > min ? Math.max(0, Math.min(1, (Number(p.value ?? 0) - min) / (max - min))) : 0;
  const style = String(p.style ?? "automatic");
  const track = cssColor({ name: "systemFill" }, env.dark) ?? "rgba(120,120,128,0.2)";
  const muted = cssColor({ name: "secondary" }, env.dark);
  if (style.startsWith("accessoryCircular") || style === "circular") {
    const sweep = style === "accessoryCircularCapacity" ? 1 : 0.75;
    const start = style === "accessoryCircularCapacity" ? -90 : 135;
    const r = 24;
    const length = 2 * Math.PI * r;
    return (
      <div className="pv-gauge-ring">
        <svg viewBox="0 0 60 60" width="60" height="60">
          <circle cx="30" cy="30" r={r} fill="none" stroke={track} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${length * sweep} ${length}`} transform={`rotate(${start} 30 30)`} />
          <circle cx="30" cy="30" r={r} fill="none" stroke={env.tint} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${length * sweep * ratio} ${length}`} transform={`rotate(${start} 30 30)`} />
        </svg>
        <span className="pv-gauge-value">{String(p.current ?? p.title ?? "")}</span>
      </div>
    );
  }
  return (
    <div className="pv-gauge">
      {p.title || p.current ? (
        <div className="pv-gauge-head">
          <span className="pv-text">{String(p.title ?? "")}</span>
          <span className="pv-text" style={{ color: muted }}>
            {String(p.current ?? "")}
          </span>
        </div>
      ) : null}
      <div className="pv-gauge-row">
        {p.low ? (
          <span className="pv-text" style={{ color: muted }}>
            {String(p.low)}
          </span>
        ) : null}
        <span className="pv-progress-track" style={{ background: track, flex: 1 }}>
          <span style={{ width: `${ratio * 100}%`, background: env.tint }} />
        </span>
        {p.high ? (
          <span className="pv-text" style={{ color: muted }}>
            {String(p.high)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const PLACEHOLDER_ICON: Record<string, string> = {
  map: "map",
  video: "play.rectangle",
  web: "globe",
  model: "cube",
  camera: "camera",
  picker: "photo.on.rectangle",
  table: "tablecells",
  store: "bag",
};

export const LARGE_PLACEHOLDERS = new Set(["map", "video", "web", "model", "camera", "table"]);

export function Placeholder({ node }: { node: ViewNode }) {
  const kind = String(node.props.kind ?? "");
  const name = String(node.props.name ?? "");
  if (node.props.error) {
    const { icon: Warn } = sfSymbol("exclamationmark.triangle");
    return (
      <div className="pv-issue" title={name}>
        <Warn width="1.05em" height="1.05em" strokeWidth={2.1} />
        <span>{name}</span>
      </div>
    );
  }
  const { icon: Icon } = sfSymbol(PLACEHOLDER_ICON[kind] ?? "questionmark.circle");
  if (LARGE_PLACEHOLDERS.has(kind))
    return (
      <div className={`pv-placeholder ${kind}`}>
        <Icon width="26" height="26" strokeWidth={1.7} />
        <span>{name}</span>
      </div>
    );
  return (
    <div className="pv-unsupported">
      <Icon width="1.05em" height="1.05em" strokeWidth={2.1} />
      <span>{name}</span>
    </div>
  );
}

function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const power = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const scaled = raw / power;
  return (scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10) * power;
}

function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${+(n / 1e3).toFixed(1)}K`;
  return String(+n.toFixed(abs < 10 ? 2 : abs < 100 ? 1 : 0));
}

function smoothPath(points: [number, number][]): string {
  if (points.length < 3) return points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

interface Drawn {
  key: string;
  el: ReactNode;
}

function buildChart(marks: ViewNode[], props: Record<string, unknown>, env: DrawEnv, w: number, h: number): { shapes: Drawn[]; legend: { name: string; color: string }[] } {
  const palette = (props.palette as Record<string, ColorSpec> | undefined) ?? {};
  const seriesNames: string[] = [];
  for (const m of marks) {
    const s = m.props.series as string | undefined;
    if (s !== undefined && !seriesNames.includes(s)) seriesNames.push(s);
  }
  const colorOf = (m: ViewNode, index: number): string => {
    const own = lastMod(m, "foreground");
    if (own) return cssColor(own.color, env.dark, "blue") ?? env.tint;
    const s = m.props.series as string | undefined;
    if (s !== undefined) return cssColor(palette[s] ?? { name: PALETTE[seriesNames.indexOf(s) % PALETTE.length] }, env.dark, "blue") ?? env.tint;
    return index < 0 ? env.tint : (cssColor({ name: PALETTE[index % PALETTE.length] }, env.dark, "blue") ?? env.tint);
  };
  const legend = props.legend === false ? [] : seriesNames.map((name) => ({ name, color: cssColor(palette[name] ?? { name: PALETTE[seriesNames.indexOf(name) % PALETTE.length] }, env.dark, "blue") ?? env.tint }));
  const shapes: Drawn[] = [];
  const muted = cssColor({ name: "secondary" }, env.dark) ?? "gray";
  const grid = cssColor({ name: "separator" }, env.dark) ?? "rgba(120,120,128,0.3)";
  if (w < 8 || h < 8) return { shapes, legend };

  const sectors = marks.filter((m) => m.props.mark === "sector");
  if (sectors.length) {
    const total = sectors.reduce((sum, m) => sum + Math.max(0, Number((m.props.angle as Plot | undefined)?.v ?? 0)), 0) || 1;
    const radius = Math.min(w, h) / 2 - 2;
    const cx = w / 2;
    const cy = h / 2;
    let angle = -Math.PI / 2;
    sectors.forEach((m, i) => {
      const share = (Math.max(0, Number((m.props.angle as Plot | undefined)?.v ?? 0)) / total) * Math.PI * 2;
      const innerSpec = Number(m.props.innerRadius ?? 0);
      const inner = innerSpec < 0 ? radius * -innerSpec : Math.min(innerSpec, radius - 1);
      const inset = Number(m.props.angularInset ?? 0) / Math.max(1, radius);
      const a0 = angle + inset / 2;
      const a1 = angle + Math.max(inset / 2 + 0.001, share - inset / 2);
      angle += share;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const at = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
      const d = inner > 0 ? `M${at(radius, a0)} A${radius} ${radius} 0 ${large} 1 ${at(radius, a1)} L${at(inner, a1)} A${inner} ${inner} 0 ${large} 0 ${at(inner, a0)} Z` : `M${cx} ${cy} L${at(radius, a0)} A${radius} ${radius} 0 ${large} 1 ${at(radius, a1)} Z`;
      shapes.push({ key: `s${i}`, el: <path d={d} fill={colorOf(m, i)} opacity={lastMod(m, "opacity")?.value} /> });
    });
    return { shapes, legend };
  }

  const horizontal = marks.some((m) => m.props.mark === "bar" && (m.props.y as Plot | undefined)?.kind === "s" && (m.props.x as Plot | undefined)?.kind === "n");
  const catKey = horizontal ? "y" : "x";
  const valKey = horizontal ? "x" : "y";
  const cats = marks.map((m) => m.props[catKey] as Plot | undefined).filter((p): p is Plot => !!p);
  const band = marks.some((m) => m.props.mark === "bar") || cats.some((p) => p.kind === "s");
  const catKind = cats[0]?.kind ?? "s";
  let categories: (string | number)[] = [];
  if (band) {
    for (const p of cats) if (!categories.includes(p.v)) categories.push(p.v);
    if (catKind !== "s") categories = categories.slice().sort((a, b) => Number(a) - Number(b));
    const forced = props[horizontal ? "yDomain" : "xDomain"] as (string | number)[] | undefined;
    if (forced && forced.some((x) => typeof x === "string")) categories = forced;
  }
  const numericCats = cats.filter((p) => p.kind !== "s").map((p) => Number(p.v));
  const forcedCat = props[horizontal ? "yDomain" : "xDomain"] as number[] | undefined;
  const catMin = !band && forcedCat && typeof forcedCat[0] === "number" ? forcedCat[0] : Math.min(...numericCats);
  const catMax = !band && forcedCat && typeof forcedCat[1] === "number" ? forcedCat[1] : Math.max(...numericCats);

  const stacks = new Map<string, number>();
  const bars: { m: ViewNode; cat: string | number; from: number; to: number; index: number }[] = [];
  const values: number[] = [];
  marks.forEach((m, index) => {
    const v = m.props[valKey] as Plot | undefined;
    const start = m.props[`${valKey}Start`] as Plot | undefined;
    const end = m.props[`${valKey}End`] as Plot | undefined;
    if (start && end) values.push(Number(start.v), Number(end.v));
    if (!v || v.kind === "s") return;
    const cat = m.props[catKey] as Plot | undefined;
    if (m.props.mark === "bar" && cat) {
      const k = String(cat.v);
      const base = stacks.get(k) ?? 0;
      const top = base + Number(v.v);
      stacks.set(k, top);
      bars.push({ m, cat: cat.v, from: base, to: top, index });
      values.push(base, top);
    } else values.push(Number(v.v));
  });
  const includeZero = marks.some((m) => m.props.mark === "bar" || m.props.mark === "area");
  const forcedVal = props[horizontal ? "xDomain" : "yDomain"] as number[] | undefined;
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  if (includeZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo, 4);
  if (forcedVal && typeof forcedVal[0] === "number" && typeof forcedVal[1] === "number") {
    lo = forcedVal[0];
    hi = forcedVal[1];
  } else {
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
  }
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-6 && ticks.length < 12; t += step) ticks.push(+t.toFixed(10));

  const showVal = props[horizontal ? "xAxis" : "yAxis"] !== false;
  const showCat = props[horizontal ? "yAxis" : "xAxis"] !== false;
  const catLabel = (c: string | number): string => {
    if (catKind === "d") {
      const span = Number(categories[categories.length - 1] ?? catMax) - Number(categories[0] ?? catMin);
      const date = new Date(Number(c));
      return span < 2 * 86400000 ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    return typeof c === "number" ? compact(c) : c;
  };
  const longestCat = band ? Math.max(0, ...categories.map((c) => catLabel(c).length)) : 0;
  const padLeft = horizontal && showCat ? Math.min(w * 0.35, longestCat * 6 + 8) : 2;
  const padRight = !horizontal && showVal ? Math.max(...ticks.map((t) => compact(t).length), 1) * 6 + 8 : 6;
  const padBottom = (horizontal ? showVal : showCat) ? 18 : 4;
  const padTop = 6;
  const plotW = Math.max(4, w - padLeft - padRight);
  const plotH = Math.max(4, h - padTop - padBottom);
  const valPos = (v: number) => (horizontal ? padLeft + ((v - lo) / (hi - lo)) * plotW : padTop + plotH - ((v - lo) / (hi - lo)) * plotH);
  const slot = band ? (horizontal ? plotH : plotW) / Math.max(1, categories.length) : 0;
  const catPos = (c: string | number | undefined): number => {
    if (c === undefined) return horizontal ? padTop + plotH / 2 : padLeft + plotW / 2;
    const origin = horizontal ? padTop : padLeft;
    const length = horizontal ? plotH : plotW;
    if (band) return origin + (Math.max(0, categories.indexOf(c)) + 0.5) * slot;
    return origin + (catMax > catMin ? (Number(c) - catMin) / (catMax - catMin) : 0.5) * length;
  };

  for (const t of ticks) {
    const pos = valPos(t);
    shapes.push({
      key: `g${t}`,
      el: horizontal ? <line x1={pos} x2={pos} y1={padTop} y2={padTop + plotH} stroke={grid} strokeWidth="0.5" /> : <line x1={padLeft} x2={padLeft + plotW} y1={pos} y2={pos} stroke={grid} strokeWidth="0.5" />,
    });
    if (showVal)
      shapes.push({
        key: `t${t}`,
        el: horizontal ? (
          <text x={pos} y={h - 5} fontSize="10" fill={muted} textAnchor="middle">
            {compact(t)}
          </text>
        ) : (
          <text x={w - padRight + 5} y={pos + 3} fontSize="10" fill={muted}>
            {compact(t)}
          </text>
        ),
      });
  }
  if (showCat) {
    const labels = band ? categories : catMax > catMin ? [catMin, (catMin + catMax) / 2, catMax] : [];
    const every = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.floor((horizontal ? plotH : plotW) / (horizontal ? 16 : 44)))));
    labels.forEach((c, i) => {
      if (i % every) return;
      const pos = catPos(c);
      shapes.push({
        key: `c${i}`,
        el: horizontal ? (
          <text x={padLeft - 5} y={pos + 3} fontSize="10" fill={muted} textAnchor="end">
            {catLabel(c)}
          </text>
        ) : (
          <text x={pos} y={h - 5} fontSize="10" fill={muted} textAnchor={!band && i === 0 ? "start" : !band && i === labels.length - 1 ? "end" : "middle"}>
            {catLabel(c)}
          </text>
        ),
      });
    });
  }

  for (const bar of bars) {
    const spec = Number(bar.m.props[horizontal ? "height" : "width"] ?? NaN);
    const thickness = Number.isFinite(spec) ? (spec < 0 ? slot * -spec : spec) : Math.max(1, slot * 0.72);
    const center = catPos(bar.cat);
    const a = valPos(bar.from);
    const b = valPos(bar.to);
    const radius = lastMod(bar.m, "cornerRadius")?.radius ?? Math.min(3, thickness / 4);
    const fill = colorOf(bar.m, -1);
    const opacity = lastMod(bar.m, "opacity")?.value;
    shapes.push({
      key: `b${bar.index}`,
      el: horizontal ? (
        <rect x={Math.min(a, b)} y={center - thickness / 2} width={Math.abs(b - a)} height={thickness} rx={radius} fill={fill} opacity={opacity} />
      ) : (
        <rect x={center - thickness / 2} y={Math.min(a, b)} width={thickness} height={Math.abs(b - a)} rx={radius} fill={fill} opacity={opacity} />
      ),
    });
  }

  const groups = new Map<string, { kind: string; first: ViewNode; points: [number, number][] }>();
  marks.forEach((m, index) => {
    const kind = String(m.props.mark);
    const cat = m.props[catKey] as Plot | undefined;
    const val = m.props[valKey] as Plot | undefined;
    const opacity = lastMod(m, "opacity")?.value;
    if (kind === "rule") {
      const stroke = colorOf(m, -1);
      const style = lastMod(m, "lineStyle");
      const common = { stroke, strokeWidth: style?.width ?? 1, strokeDasharray: style?.dash?.join(" "), opacity };
      if (val && val.kind !== "s") {
        const pos = valPos(Number(val.v));
        shapes.push({ key: `r${index}`, el: horizontal ? <line x1={pos} x2={pos} y1={padTop} y2={padTop + plotH} {...common} /> : <line x1={padLeft} x2={padLeft + plotW} y1={pos} y2={pos} {...common} /> });
      } else if (cat) {
        const pos = catPos(cat.v);
        shapes.push({ key: `r${index}`, el: horizontal ? <line x1={padLeft} x2={padLeft + plotW} y1={pos} y2={pos} {...common} /> : <line x1={pos} x2={pos} y1={padTop} y2={padTop + plotH} {...common} /> });
      }
      return;
    }
    if (kind === "rectangle") {
      const x0 = m.props.xStart as Plot | undefined;
      const x1 = m.props.xEnd as Plot | undefined;
      const y0 = m.props.yStart as Plot | undefined;
      const y1 = m.props.yEnd as Plot | undefined;
      const left = x0 ? (horizontal ? valPos(Number(x0.v)) : catPos(x0.v)) : padLeft;
      const right = x1 ? (horizontal ? valPos(Number(x1.v)) : catPos(x1.v)) : padLeft + plotW;
      const top = y1 ? (horizontal ? catPos(y1.v) : valPos(Number(y1.v))) : padTop;
      const bottom = y0 ? (horizontal ? catPos(y0.v) : valPos(Number(y0.v))) : padTop + plotH;
      shapes.push({ key: `q${index}`, el: <rect x={Math.min(left, right)} y={Math.min(top, bottom)} width={Math.abs(right - left)} height={Math.abs(bottom - top)} fill={colorOf(m, -1)} opacity={opacity ?? 0.25} /> });
      return;
    }
    if (!val || val.kind === "s" || kind === "bar") return;
    const c = catPos(cat?.v);
    const v = valPos(Number(val.v));
    const xy: [number, number] = horizontal ? [v, c] : [c, v];
    if (kind === "point") {
      shapes.push({ key: `p${index}`, el: <circle cx={xy[0]} cy={xy[1]} r="3.5" fill={colorOf(m, -1)} opacity={opacity} /> });
      return;
    }
    const id = `${kind}|${String(m.props.series ?? "")}`;
    const group = groups.get(id);
    if (group) group.points.push(xy);
    else groups.set(id, { kind, first: m, points: [xy] });
  });
  let n = 0;
  for (const [id, group] of groups) {
    const stroke = colorOf(group.first, -1);
    const smooth = group.first.props.smooth === true;
    const line = smooth ? smoothPath(group.points) : group.points.map((p, i) => `${i ? "L" : "M"}${p[0]} ${p[1]}`).join(" ");
    const opacity = lastMod(group.first, "opacity")?.value;
    if (group.kind === "area") {
      const base = valPos(Math.max(lo, Math.min(hi, 0)));
      const firstPoint = group.points[0];
      const lastPoint = group.points[group.points.length - 1];
      const close = horizontal ? ` L${base} ${lastPoint[1]} L${base} ${firstPoint[1]} Z` : ` L${lastPoint[0]} ${base} L${firstPoint[0]} ${base} Z`;
      shapes.push({ key: `a${n++}${id}`, el: <path d={line + close} fill={stroke} opacity={opacity ?? 0.9} /> });
    } else {
      const style = lastMod(group.first, "lineStyle");
      shapes.push({ key: `l${n++}${id}`, el: <path d={line} fill="none" stroke={stroke} strokeWidth={style?.width ?? 2} strokeDasharray={style?.dash?.join(" ")} strokeLinejoin="round" strokeLinecap="round" opacity={opacity} /> });
    }
  }
  return { shapes, legend };
}

export function ChartView({ node, env }: { node: ViewNode; env: DrawEnv }) {
  const [ref, box] = useBox();
  const marks = node.children;
  const props = node.props;
  const { shapes, legend } = useMemo(() => buildChart(marks ?? [], props, env, box.w, box.h), [marks, props, env, box.w, box.h]);
  return (
    <div className="pv-chart">
      <div ref={ref} className="pv-chart-plot">
        <svg width={box.w} height={box.h}>
          {shapes.map((s) => (
            <g key={s.key}>{s.el}</g>
          ))}
        </svg>
      </div>
      {legend.length > 1 && (
        <div className="pv-chart-legend">
          {legend.map((l) => (
            <span key={l.name}>
              <i style={{ background: l.color }} />
              {l.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
