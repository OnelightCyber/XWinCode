import type { Closure, Stmt, TypeDecl } from "./parser";
import type { ColorSpec, FontSpec, ViewNode } from "./types";

export class Dbl {
  constructor(readonly v: number) {}
}

export interface EvArg {
  label: string | null;
  value: V;
}

export interface Slot {
  get(): V;
  set(v: V): void;
}

export type V =
  | null
  | boolean
  | number
  | string
  | Dbl
  | V[]
  | { t: "dict"; m: Map<string, [V, V]> }
  | { t: "tuple"; items: V[]; labels: (string | null)[] }
  | { t: "range"; lo: number; hi: number }
  | { t: "sym"; name: string; type?: string; args?: EvArg[] }
  | { t: "color"; spec: ColorSpec }
  | { t: "font"; spec: FontSpec }
  | { t: "views"; nodes: ViewNode[] }
  | { t: "binding"; get: () => V; set: (v: V) => void }
  | { t: "closure"; fn: Closure | { params: string[]; body: Stmt[] }; env: unknown; owner?: unknown }
  | { t: "fn"; name: string; call: (args: EvArg[], trailing: V[]) => V }
  | { t: "rec"; type: TypeDecl; fields: Map<string, V> }
  | { t: "obj"; type: TypeDecl; fields: Map<string, V>; uid: number }
  | { t: "type"; name: string }
  | { t: "date"; ms: number }
  | { t: "keypath"; path: string[] }
  | { t: "opaque"; name: string };

export type Obj<T extends string> = Extract<V, { t: T }>;

export function isT<T extends string>(v: V, t: T): v is Obj<T> {
  return v !== null && typeof v === "object" && !(v instanceof Dbl) && !Array.isArray(v) && (v as { t: string }).t === t;
}

export const num = (v: V): number => (typeof v === "number" ? v : v instanceof Dbl ? v.v : typeof v === "boolean" ? (v ? 1 : 0) : Number(v) || 0);

export const isNum = (v: V): boolean => typeof v === "number" || v instanceof Dbl;

export function views(nodes: ViewNode[]): V {
  return { t: "views", nodes };
}

export function nodesOf(v: V): ViewNode[] | null {
  if (isT(v, "views")) return v.nodes;
  return null;
}

export function truthy(v: V): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "boolean") return v;
  if (isT(v, "opaque")) return false;
  return true;
}

export function swiftDouble(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "nan" : v > 0 ? "inf" : "-inf";
  if (Number.isInteger(v) && Math.abs(v) < 1e16) return `${v}.0`;
  return String(v);
}

export function describe(v: V, nested = false): string {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return nested ? `"${v}"` : v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (v instanceof Dbl) return swiftDouble(v.v);
  if (Array.isArray(v)) return `[${v.map((x) => describe(x, true)).join(", ")}]`;
  switch (v.t) {
    case "sym":
      return v.name;
    case "range":
      return `${v.lo}..<${v.hi}`;
    case "tuple":
      return `(${v.items.map((x, i) => (v.labels[i] ? `${v.labels[i]}: ` : "") + describe(x, true)).join(", ")})`;
    case "rec":
    case "obj":
      return `${v.type.name}(${[...v.fields].map(([k, x]) => `${k}: ${describe(x, true)}`).join(", ")})`;
    case "date":
      return new Date(v.ms).toLocaleString();
    case "dict":
      return `[${[...v.m.values()].map(([k, x]) => `${describe(k, true)}: ${describe(x, true)}`).join(", ")}]`;
    case "color":
      return "Color";
    case "font":
      return "Font";
    case "opaque":
      return "—";
    default:
      return "";
  }
}

export function keyOf(v: V): string {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "string") return `s:${v}`;
  if (typeof v === "number") return `n:${v}`;
  if (v instanceof Dbl) return `n:${v.v}`;
  if (typeof v === "boolean") return `b:${v}`;
  if (Array.isArray(v)) return `a:[${v.map(keyOf).join(",")}]`;
  switch (v.t) {
    case "sym":
      return `e:${v.type ?? ""}.${v.name}${v.args ? `(${v.args.map((a) => keyOf(a.value)).join(",")})` : ""}`;
    case "rec":
      return `r:${v.type.name}{${[...v.fields].map(([k, x]) => `${k}=${keyOf(x)}`).join(",")}}`;
    case "obj":
      return `o:${v.uid}`;
    case "tuple":
      return `t:(${v.items.map(keyOf).join(",")})`;
    case "range":
      return `g:${v.lo}..<${v.hi}`;
    case "date":
      return `d:${v.ms}`;
    default:
      return `x:${v.t}`;
  }
}

export function equals(a: V, b: V): boolean {
  if (isNum(a) && isNum(b)) return num(a) === num(b);
  if (isT(a, "sym") && isT(b, "sym")) return a.name === b.name && keyOf(a) === keyOf({ ...b, type: a.type });
  if (isT(a, "sym") && typeof b === "string") return a.name === b;
  if (typeof a === "string" && isT(b, "sym")) return b.name === a;
  return keyOf(a) === keyOf(b);
}

export function compare(a: V, b: V): number {
  if (isNum(a) && isNum(b)) return num(a) - num(b);
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  if (isT(a, "date") && isT(b, "date")) return a.ms - b.ms;
  return describe(a).localeCompare(describe(b));
}

export function jsonOf(v: V): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean" || typeof v === "number") return v;
  if (v instanceof Dbl) return v.v;
  if (isT(v, "sym")) return v.name;
  return keyOf(v);
}

export function copyValue(v: V): V {
  if (Array.isArray(v)) return v.slice();
  if (isT(v, "rec")) return { t: "rec", type: v.type, fields: new Map(v.fields) };
  if (isT(v, "dict")) return { t: "dict", m: new Map(v.m) };
  return v;
}

export function sprintf(fmt: string, args: V[]): string {
  let i = 0;
  return fmt.replace(/%(-?)(0?)(\d*)(?:\.(\d+))?(l{0,2}|h{0,2})([dfisu@xXeg%])/g, (_m, left, zero, width, prec, _len, conv) => {
    if (conv === "%") return "%";
    const v = args[i++];
    let s: string;
    switch (conv) {
      case "d":
      case "i":
      case "u":
        s = String(Math.trunc(num(v)));
        break;
      case "f":
        s = num(v).toFixed(prec === undefined ? 6 : Number(prec));
        break;
      case "e":
        s = num(v).toExponential(prec === undefined ? 6 : Number(prec));
        break;
      case "g":
        s = String(Number(num(v).toPrecision(prec === undefined ? 6 : Math.max(1, Number(prec)))));
        break;
      case "x":
        s = Math.trunc(num(v)).toString(16);
        break;
      case "X":
        s = Math.trunc(num(v)).toString(16).toUpperCase();
        break;
      default:
        s = describe(v);
    }
    const w = Number(width || 0);
    if (s.length < w) s = left ? s.padEnd(w) : s.padStart(w, zero && !left ? "0" : " ");
    return s;
  });
}

let seed = 1;

export function resetRandom() {
  seed = 1;
}

export function random(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

export function placeholderFor(type: string | null): V {
  const t = (type ?? "").replace(/\s/g, "");
  if (!t) return null;
  if (t.endsWith("?")) return null;
  if (/^(Int|Int\d+|UInt\d*)$/.test(t)) return 0;
  if (/^(Double|CGFloat|Float|Float\d+|TimeInterval)$/.test(t)) return new Dbl(0);
  if (t === "Bool") return false;
  if (t === "String" || t === "Substring" || t === "LocalizedStringKey") return "Text";
  if (t.startsWith("[") && t.includes(":")) return { t: "dict", m: new Map() };
  if (t.startsWith("[") || t.startsWith("Array<") || t.startsWith("Set<")) return [];
  if (t === "Date") return { t: "date", ms: Date.UTC(2026, 0, 1, 9, 41) };
  if (t === "Color") return { t: "color", spec: { name: "accentColor" } };
  if (t === "UUID") return "00000000-0000-0000-0000-000000000000";
  return null;
}

export function coerce(v: V, type: string | null): V {
  if (!type) return v;
  const t = type.replace(/[\s?!]/g, "");
  if (/^(Double|CGFloat|Float|Float\d+|TimeInterval)$/.test(t) && typeof v === "number") return new Dbl(v);
  if (/^(Int|Int\d+|UInt\d*)$/.test(t) && v instanceof Dbl) return Math.trunc(v.v);
  return v;
}
