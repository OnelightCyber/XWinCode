import type { ColorSpec, ViewNode } from "./types";
import { Dbl, isNum, isT, num, type EvArg, type V } from "./values";

export type PathCmd = (string | number)[];

export interface DrawOp {
  op: "fill" | "stroke" | "text";
  cmds?: PathCmd[];
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

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const KAPPA = 0.5522847498;

const arg = (args: EvArg[], label: string | null, index = 0): V | undefined => (label !== null ? args.find((a) => a.label === label)?.value : args.filter((a) => a.label === null)[index]?.value);

const dbl = (n: number): V => new Dbl(n);

export function point(x: number, y: number): V {
  return { t: "tuple", items: [dbl(x), dbl(y)], labels: ["x", "y"] };
}

export function size(width: number, height: number): V {
  return { t: "tuple", items: [dbl(width), dbl(height)], labels: ["width", "height"] };
}

export function rect(x: number, y: number, width: number, height: number): V {
  return { t: "tuple", items: [dbl(x), dbl(y), dbl(width), dbl(height)], labels: ["x", "y", "width", "height"] };
}

function field(v: V, label: string): number | undefined {
  if (!isT(v, "tuple")) return undefined;
  const i = v.labels.indexOf(label);
  return i < 0 ? undefined : num(v.items[i]);
}

export function pointOf(v: V | undefined): { x: number; y: number } {
  if (v === undefined || v === null) return { x: 0, y: 0 };
  if (isT(v, "tuple")) {
    const x = field(v, "x");
    const y = field(v, "y");
    if (x !== undefined && y !== undefined) return { x, y };
    if (v.items.length >= 2) return { x: num(v.items[0]), y: num(v.items[1]) };
  }
  return { x: 0, y: 0 };
}

export function sizeOf(v: V | undefined): { width: number; height: number } {
  if (v === undefined || v === null) return { width: 0, height: 0 };
  if (isNum(v)) return { width: num(v), height: num(v) };
  if (isT(v, "tuple")) {
    const width = field(v, "width");
    const height = field(v, "height");
    if (width !== undefined && height !== undefined) return { width, height };
    if (v.items.length >= 2) return { width: num(v.items[0]), height: num(v.items[1]) };
  }
  return { width: 0, height: 0 };
}

export function isRect(v: V): boolean {
  return isT(v, "tuple") && v.labels.length === 4 && v.labels[2] === "width";
}

export function rectOf(v: V | undefined): { x: number; y: number; width: number; height: number } {
  if (v === undefined || v === null || !isT(v, "tuple")) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: field(v, "x") ?? 0, y: field(v, "y") ?? 0, width: field(v, "width") ?? 0, height: field(v, "height") ?? 0 };
}

export function makeRect(args: EvArg[]): V {
  const origin = arg(args, "origin");
  const sz = arg(args, "size");
  if (origin !== undefined || sz !== undefined) {
    const o = pointOf(origin);
    const s = sizeOf(sz);
    return rect(o.x, o.y, s.width, s.height);
  }
  return rect(num(arg(args, "x") ?? 0), num(arg(args, "y") ?? 0), num(arg(args, "width") ?? 0), num(arg(args, "height") ?? 0));
}

export function radians(v: V | undefined): number {
  if (v === undefined || v === null) return 0;
  if (isNum(v)) return num(v);
  if (isT(v, "sym")) {
    const a = num(v.args?.[0]?.value ?? 0);
    if (v.name === "degrees") return (a * Math.PI) / 180;
    if (v.name === "radians") return a;
  }
  return 0;
}

export function rectMember(v: V, name: string, args: EvArg[] | undefined): V | undefined {
  if (!isT(v, "tuple")) return undefined;
  if (isRect(v)) {
    const r = rectOf(v);
    switch (name) {
      case "minX":
        return dbl(r.x);
      case "midX":
        return dbl(r.x + r.width / 2);
      case "maxX":
        return dbl(r.x + r.width);
      case "minY":
        return dbl(r.y);
      case "midY":
        return dbl(r.y + r.height / 2);
      case "maxY":
        return dbl(r.y + r.height);
      case "size":
        return size(r.width, r.height);
      case "origin":
        return point(r.x, r.y);
      case "center":
        return point(r.x + r.width / 2, r.y + r.height / 2);
      case "isEmpty":
        return r.width <= 0 || r.height <= 0;
      case "insetBy": {
        const dx = num(arg(args ?? [], "dx") ?? 0);
        const dy = num(arg(args ?? [], "dy") ?? 0);
        return rect(r.x + dx, r.y + dy, Math.max(0, r.width - dx * 2), Math.max(0, r.height - dy * 2));
      }
      case "offsetBy":
        return rect(r.x + num(arg(args ?? [], "dx") ?? 0), r.y + num(arg(args ?? [], "dy") ?? 0), r.width, r.height);
      case "inset": {
        const by = arg(args ?? [], "by");
        const all = isNum(by ?? null) ? num(by ?? 0) : 0;
        return rect(r.x + all, r.y + all, Math.max(0, r.width - all * 2), Math.max(0, r.height - all * 2));
      }
      case "contains": {
        const p = pointOf(arg(args ?? [], null));
        return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
      }
    }
    return undefined;
  }
  if (v.labels.length === 2 && v.labels[0] === "width") {
    const s = sizeOf(v);
    if (name === "applying" || name === "size") return v;
    if (name === "minDimension") return dbl(Math.min(s.width, s.height));
  }
  if (v.labels.length === 2 && v.labels[0] === "x") {
    const p = pointOf(v);
    if (name === "applying") return v;
    if (name === "distance") {
      const o = pointOf(arg(args ?? [], "to") ?? arg(args ?? [], null));
      return dbl(Math.hypot(p.x - o.x, p.y - o.y));
    }
  }
  return undefined;
}

function arcCmds(cx: number, cy: number, r: number, start: number, end: number, clockwise: boolean, connect: boolean | null): PathCmd[] {
  let delta = end - start;
  const full = Math.PI * 2;
  if (!clockwise) {
    while (delta < 0) delta += full;
    if (delta > full) delta = full;
  } else {
    while (delta > 0) delta -= full;
    if (delta < -full) delta = -full;
  }
  const out: PathCmd[] = [];
  const sx = cx + r * Math.cos(start);
  const sy = cy + r * Math.sin(start);
  if (connect !== null) out.push([connect ? "L" : "M", sx, sy]);
  const steps = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const d = delta / steps;
  const k = (4 / 3) * Math.tan(d / 4);
  let a = start;
  for (let i = 0; i < steps; i++) {
    const b = a + d;
    const x1 = cx + r * Math.cos(a);
    const y1 = cy + r * Math.sin(a);
    const x2 = cx + r * Math.cos(b);
    const y2 = cy + r * Math.sin(b);
    out.push(["C", x1 - k * r * Math.sin(a), y1 + k * r * Math.cos(a), x2 + k * r * Math.sin(b), y2 - k * r * Math.cos(b), x2, y2]);
    a = b;
  }
  return out;
}

function ellipseCmds(x: number, y: number, w: number, h: number): PathCmd[] {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
    ["C", cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
    ["C", cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
    ["C", cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ["Z"],
  ];
}

function roundedCmds(x: number, y: number, w: number, h: number, radius: number): PathCmd[] {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r === 0) return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
  const k = r * KAPPA;
  return [
    ["M", x + r, y],
    ["L", x + w - r, y],
    ["C", x + w - r + k, y, x + w, y + r - k, x + w, y + r],
    ["L", x + w, y + h - r],
    ["C", x + w, y + h - r + k, x + w - r + k, y + h, x + w - r, y + h],
    ["L", x + r, y + h],
    ["C", x + r - k, y + h, x, y + h - r + k, x, y + h - r],
    ["L", x, y + r],
    ["C", x, y + r - k, x + r - k, y, x + r, y],
    ["Z"],
  ];
}

function apply(m: Matrix, cmds: PathCmd[]): PathCmd[] {
  if (m === IDENTITY) return cmds;
  return cmds.map((c) => {
    const out: PathCmd = [c[0]];
    for (let i = 1; i + 1 < c.length; i += 2) {
      const x = Number(c[i]);
      const y = Number(c[i + 1]);
      out.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    }
    return out;
  });
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function bounds(cmds: PathCmd[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cmds) {
    for (let i = 1; i + 1 < c.length; i += 2) {
      minX = Math.min(minX, Number(c[i]));
      maxX = Math.max(maxX, Number(c[i]));
      minY = Math.min(minY, Number(c[i + 1]));
      maxY = Math.max(maxY, Number(c[i + 1]));
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pathOf(v: V | undefined): PathCmd[] | null {
  if (v === undefined || v === null || !isT(v, "host") || v.kind !== "Path") return null;
  return v.data as PathCmd[];
}

function last(cmds: PathCmd[]): { x: number; y: number } | null {
  for (let i = cmds.length - 1; i >= 0; i--) {
    const c = cmds[i];
    if (c.length >= 3) return { x: Number(c[c.length - 2]), y: Number(c[c.length - 1]) };
  }
  return null;
}

export function makePath(initial: PathCmd[] = []): V {
  const cmds: PathCmd[] = initial.map((c) => c.slice());
  const self: Extract<V, { t: "host" }> = {
    t: "host",
    kind: "Path",
    data: cmds,
    copy: () => makePath(cmds),
    get: (name) => {
      switch (name) {
        case "isEmpty":
          return cmds.length === 0;
        case "boundingRect": {
          const b = bounds(cmds);
          return rect(b.x, b.y, b.width, b.height);
        }
        case "currentPoint": {
          const p = last(cmds);
          return p ? point(p.x, p.y) : null;
        }
        case "cgPath":
          return self;
      }
      return undefined;
    },
    call: (name, args) => {
      const first = arg(args, null);
      switch (name) {
        case "move": {
          const p = pointOf(arg(args, "to") ?? first);
          cmds.push(["M", p.x, p.y]);
          return null;
        }
        case "addLine": {
          const p = pointOf(arg(args, "to") ?? first);
          cmds.push([cmds.length ? "L" : "M", p.x, p.y]);
          return null;
        }
        case "addLines": {
          const list = Array.isArray(first) ? first : [];
          list.forEach((item, i) => {
            const p = pointOf(item);
            cmds.push([i === 0 ? "M" : "L", p.x, p.y]);
          });
          return null;
        }
        case "addQuadCurve": {
          const p = pointOf(arg(args, "to"));
          const c = pointOf(arg(args, "control"));
          cmds.push(["Q", c.x, c.y, p.x, p.y]);
          return null;
        }
        case "addCurve": {
          const p = pointOf(arg(args, "to"));
          const c1 = pointOf(arg(args, "control1"));
          const c2 = pointOf(arg(args, "control2"));
          cmds.push(["C", c1.x, c1.y, c2.x, c2.y, p.x, p.y]);
          return null;
        }
        case "addArc": {
          const center = arg(args, "center");
          if (center === undefined) return null;
          const c = pointOf(center);
          const delta = arg(args, "delta");
          const start = radians(arg(args, "startAngle"));
          const end = delta !== undefined ? start + radians(delta) : radians(arg(args, "endAngle"));
          const clockwise = delta !== undefined ? radians(delta) < 0 : arg(args, "clockwise") === true;
          cmds.push(...arcCmds(c.x, c.y, num(arg(args, "radius") ?? 0), start, end, clockwise, cmds.length > 0));
          return null;
        }
        case "addRelativeArc": {
          const c = pointOf(arg(args, "center"));
          const start = radians(arg(args, "startAngle"));
          const delta = radians(arg(args, "delta"));
          cmds.push(...arcCmds(c.x, c.y, num(arg(args, "radius") ?? 0), start, start + delta, delta < 0, cmds.length > 0));
          return null;
        }
        case "addRect": {
          const r = rectOf(first);
          cmds.push(...roundedCmds(r.x, r.y, r.width, r.height, 0));
          return null;
        }
        case "addRects": {
          for (const item of Array.isArray(first) ? first : []) {
            const r = rectOf(item);
            cmds.push(...roundedCmds(r.x, r.y, r.width, r.height, 0));
          }
          return null;
        }
        case "addRoundedRect": {
          const r = rectOf(arg(args, "in") ?? first);
          const corner = arg(args, "cornerSize");
          const radius = corner !== undefined ? sizeOf(corner).width : num(arg(args, "cornerRadius") ?? 0);
          cmds.push(...roundedCmds(r.x, r.y, r.width, r.height, radius));
          return null;
        }
        case "addEllipse": {
          const r = rectOf(arg(args, "in") ?? first);
          cmds.push(...ellipseCmds(r.x, r.y, r.width, r.height));
          return null;
        }
        case "addPath": {
          const other = pathOf(first);
          if (other) cmds.push(...other.map((c) => c.slice()));
          return null;
        }
        case "closeSubpath":
          cmds.push(["Z"]);
          return null;
        case "offsetBy": {
          const dx = num(arg(args, "dx") ?? 0);
          const dy = num(arg(args, "dy") ?? 0);
          return makePath(apply([1, 0, 0, 1, dx, dy], cmds));
        }
        case "applying":
        case "strokedPath":
        case "trimmedPath":
        case "path":
          return makePath(cmds);
        case "contains":
          return false;
      }
      return undefined;
    },
  };
  return self;
}

export function pathFrom(args: EvArg[]): V | null {
  const first = arg(args, null);
  const ellipse = arg(args, "ellipseIn");
  if (ellipse !== undefined) {
    const r = rectOf(ellipse);
    return makePath(ellipseCmds(r.x, r.y, r.width, r.height));
  }
  const rounded = arg(args, "roundedRect");
  if (rounded !== undefined) {
    const r = rectOf(rounded);
    const corner = arg(args, "cornerSize");
    const radius = corner !== undefined ? sizeOf(corner).width : num(arg(args, "cornerRadius") ?? 0);
    return makePath(roundedCmds(r.x, r.y, r.width, r.height, radius));
  }
  if (first !== undefined && first !== null) {
    const existing = pathOf(first);
    if (existing) return makePath(existing);
    if (isRect(first)) {
      const r = rectOf(first);
      return makePath(roundedCmds(r.x, r.y, r.width, r.height, 0));
    }
    return null;
  }
  return makePath();
}

export function hostNodes(v: V): ViewNode[] | null {
  const cmds = pathOf(v);
  if (cmds) return [{ id: "", type: "Path", props: { cmds: cmds.map((c) => c.slice()) } }];
  return null;
}

export function builtinShapePath(name: string, args: EvArg[], inRect: V | undefined): V | null {
  const r = rectOf(inRect);
  switch (name) {
    case "Rectangle":
      return makePath(roundedCmds(r.x, r.y, r.width, r.height, 0));
    case "RoundedRectangle":
      return makePath(roundedCmds(r.x, r.y, r.width, r.height, num(arg(args, "cornerRadius") ?? 8)));
    case "Capsule":
      return makePath(roundedCmds(r.x, r.y, r.width, r.height, Math.min(r.width, r.height) / 2));
    case "Ellipse":
      return makePath(ellipseCmds(r.x, r.y, r.width, r.height));
    case "Circle": {
      const d = Math.min(r.width, r.height);
      return makePath(ellipseCmds(r.x + (r.width - d) / 2, r.y + (r.height - d) / 2, d, d));
    }
  }
  return null;
}

export interface Painter {
  color(v: V | undefined): ColorSpec | null;
  text(v: V | undefined): { text: string; size?: number; weight?: string; color?: ColorSpec } | null;
  run(fn: V, args: V[]): void;
}

interface ContextState {
  matrix: Matrix;
  opacity: number;
}

export function makeContext(ops: DrawOp[], painter: Painter, state: ContextState = { matrix: IDENTITY, opacity: 1 }): V {
  const shade = (v: V | undefined): ColorSpec => {
    if (v !== undefined && v !== null && isT(v, "sym") && v.args?.length) {
      const inner = v.args[0].value;
      const c = painter.color(Array.isArray(inner) ? inner[0] : isT(inner, "sym") && inner.name === "gradient" ? (inner.args?.[0]?.value as V) : inner);
      if (c) return c;
    }
    return painter.color(v) ?? { name: "primary" };
  };
  const self: Extract<V, { t: "host" }> = {
    t: "host",
    kind: "GraphicsContext",
    copy: () => makeContext(ops, painter, { matrix: state.matrix, opacity: state.opacity }),
    get: (name) => {
      if (name === "opacity") return dbl(state.opacity);
      if (name === "transform") return null;
      if (name === "environment") return null;
      return undefined;
    },
    call: (name, args, trailing) => {
      const first = arg(args, null);
      switch (name) {
        case "set:opacity":
          state.opacity = num(first ?? 1);
          return null;
        case "set:blendMode":
        case "set:transform":
          return null;
        case "fill": {
          const cmds = pathOf(first);
          if (cmds) ops.push({ op: "fill", cmds: apply(state.matrix, cmds), color: shade(arg(args, "with")), opacity: state.opacity });
          return null;
        }
        case "stroke": {
          const cmds = pathOf(first);
          if (!cmds) return null;
          const style = arg(args, "style");
          const fromStyle = style !== undefined && isT(style, "tuple") ? style : null;
          const width = num(arg(args, "lineWidth") ?? (fromStyle ? fromStyle.items[fromStyle.labels.indexOf("lineWidth")] : 1) ?? 1);
          const scale = Math.sqrt(Math.abs(state.matrix[0] * state.matrix[3] - state.matrix[1] * state.matrix[2]));
          const cap = fromStyle ? fromStyle.items[fromStyle.labels.indexOf("lineCap")] : undefined;
          const dash = fromStyle ? fromStyle.items[fromStyle.labels.indexOf("dash")] : undefined;
          ops.push({
            op: "stroke",
            cmds: apply(state.matrix, cmds),
            color: shade(arg(args, "with")),
            width: width * (scale || 1),
            opacity: state.opacity,
            cap: cap !== undefined && cap !== null && isT(cap, "sym") ? cap.name : undefined,
            dash: Array.isArray(dash) ? dash.map((d) => num(d)) : undefined,
          });
          return null;
        }
        case "draw": {
          const info = painter.text(first);
          if (!info) return null;
          const at = arg(args, "at");
          const inRect = arg(args, "in");
          const p = at !== undefined ? pointOf(at) : inRect !== undefined ? { x: rectOf(inRect).x + rectOf(inRect).width / 2, y: rectOf(inRect).y + rectOf(inRect).height / 2 } : { x: 0, y: 0 };
          const m = state.matrix;
          ops.push({ op: "text", text: info.text, x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5], color: info.color, size: info.size, weight: info.weight, opacity: state.opacity });
          return null;
        }
        case "resolve":
        case "resolveSymbol":
          return first ?? null;
        case "translateBy":
          state.matrix = multiply(state.matrix, [1, 0, 0, 1, num(arg(args, "x") ?? 0), num(arg(args, "y") ?? 0)]);
          return null;
        case "scaleBy":
          state.matrix = multiply(state.matrix, [num(arg(args, "x") ?? 1), 0, 0, num(arg(args, "y") ?? 1), 0, 0]);
          return null;
        case "rotate": {
          const a = radians(arg(args, "by") ?? first);
          state.matrix = multiply(state.matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
          return null;
        }
        case "concatenate":
        case "clip":
        case "clipToLayer":
        case "addFilter":
        case "withCGContext":
          return null;
        case "drawLayer": {
          const fn = trailing[0] ?? arg(args, "content");
          if (fn !== undefined) painter.run(fn, [makeContext(ops, painter, { matrix: state.matrix, opacity: state.opacity })]);
          return null;
        }
      }
      return undefined;
    },
  };
  return self;
}

export function strokeStyle(args: EvArg[]): V {
  const dash = arg(args, "dash");
  return {
    t: "tuple",
    items: [arg(args, "lineWidth") ?? dbl(1), arg(args, "lineCap") ?? null, arg(args, "lineJoin") ?? null, dash ?? null],
    labels: ["lineWidth", "lineCap", "lineJoin", "dash"],
  };
}
