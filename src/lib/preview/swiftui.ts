import type { AnimCurve, ColorSpec, FontSpec, GradientSpec, Length, Mod, ShapeSpec, TextStyle, ViewNode, Weight } from "./types";
import { pointOf, radians } from "./geometry";

type Rgba = [number, number, number, number];
let assetColors: Record<string, { light: Rgba; dark?: Rgba }> = {};

export function setAssetColors(colors: Record<string, { light: Rgba; dark?: Rgba }>) {
  assetColors = colors;
}

export function animCurve(v: V | undefined): AnimCurve | null {
  if (v === undefined) return { kind: "default" };
  if (v === null) return null;
  if (isT(v, "sym")) {
    const args = v.args ?? [];
    const duration = arg(args, "duration") ?? arg(args, "response");
    const bounce = arg(args, "bounce") ?? arg(args, "extraBounce");
    return { kind: v.name, duration: duration === undefined ? undefined : num(duration), bounce: bounce === undefined ? undefined : num(bounce) };
  }
  return { kind: "default" };
}
import { Dbl, describe, isNum, isT, jsonOf, nodesOf, num, rangeEnd, type EvArg, type V } from "./values";

export type Handler =
  | { kind: "tap"; run: () => void }
  | { kind: "set"; run: (value: unknown) => void }
  | { kind: "step"; inc: () => void; dec: () => void };

export interface Ctx {
  call(fn: V, args: V[]): V;
  build(fn: V | undefined, args?: V[]): ViewNode[];
  scheme: "light" | "dark";
  size: { width: number; height: number };
  wide: boolean;
  note(feature: string): void;
  format(v: V, style: V | undefined): string;
}

export const HANDLER = Symbol("handler");

type WithHandler = { [HANDLER]?: Handler };

export function attach<T extends object>(target: T, h: Handler): T {
  (target as WithHandler)[HANDLER] = h;
  return target;
}

export function handlerOf(target: object): Handler | undefined {
  return (target as WithHandler)[HANDLER];
}

const TEXT_STYLES = new Set<TextStyle>([
  "largeTitle",
  "title",
  "title2",
  "title3",
  "headline",
  "subheadline",
  "body",
  "callout",
  "footnote",
  "caption",
  "caption2",
]);

const WEIGHTS = new Set<Weight>(["ultraLight", "thin", "light", "regular", "medium", "semibold", "bold", "heavy", "black"]);

const COLORS = new Set([
  "primary",
  "secondary",
  "red",
  "orange",
  "yellow",
  "green",
  "mint",
  "teal",
  "cyan",
  "blue",
  "indigo",
  "purple",
  "pink",
  "brown",
  "gray",
  "black",
  "white",
  "clear",
  "accentColor",
  "systemBackground",
  "secondarySystemBackground",
  "tertiarySystemBackground",
  "systemGroupedBackground",
  "secondarySystemGroupedBackground",
  "label",
  "secondaryLabel",
  "tertiaryLabel",
  "separator",
  "systemFill",
]);

const SYSTEM_GRAYS: Record<string, [string, string]> = {
  systemGray2: ["#AEAEB2", "#636366"],
  systemGray3: ["#C7C7CC", "#48484A"],
  systemGray4: ["#D1D1D6", "#3A3A3C"],
  systemGray5: ["#E5E5EA", "#2C2C2E"],
};

const MATERIALS = new Set(["ultraThinMaterial", "thinMaterial", "regularMaterial", "thickMaterial", "ultraThickMaterial", "bar"]);

function hexRgba(hex: string, alpha = 1): [number, number, number, number] {
  let h = hex.replace(/^#/, "").trim();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16) || 0;
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : alpha;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

export function namedColor(name: string, scheme: "light" | "dark"): ColorSpec | null {
  if (name === "tint" || name === "accent") return { name: "accentColor" };
  if (COLORS.has(name)) return { name };
  if (name === "systemGray6") return { name: "secondarySystemBackground" };
  if (name === "systemGray") return { name: "gray" };
  if (SYSTEM_GRAYS[name]) return { rgba: hexRgba(SYSTEM_GRAYS[name][scheme === "dark" ? 1 : 0]) };
  if (name === "darkGray") return { rgba: [0.333, 0.333, 0.333, 1] };
  if (name === "lightGray") return { rgba: [0.667, 0.667, 0.667, 1] };
  const stripped = name.replace(/^system/, "");
  const lower = stripped.charAt(0).toLowerCase() + stripped.slice(1);
  if (COLORS.has(lower)) return { name: lower };
  return null;
}

function hsb(h: number, s: number, b: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = b * (1 - s);
  const q = b * (1 - f * s);
  const t = b * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [b, t, p];
    case 1:
      return [q, b, p];
    case 2:
      return [p, b, t];
    case 3:
      return [p, q, b];
    case 4:
      return [t, p, b];
    default:
      return [b, p, q];
  }
}

export function arg(args: EvArg[], label: string | null, index = 0): V | undefined {
  if (label !== null) return args.find((a) => a.label === label)?.value;
  return args.filter((a) => a.label === null)[index]?.value;
}

const UNIT_POINTS: Record<string, [number, number]> = {
  top: [0.5, 0],
  bottom: [0.5, 1],
  leading: [0, 0.5],
  trailing: [1, 0.5],
  center: [0.5, 0.5],
  topLeading: [0, 0],
  topTrailing: [1, 0],
  bottomLeading: [0, 1],
  bottomTrailing: [1, 1],
  zero: [0, 0],
};

function unitPoint(v: V | undefined): [number, number] | undefined {
  if (v === undefined || v === null) return undefined;
  if (isT(v, "sym")) {
    if (UNIT_POINTS[v.name]) return UNIT_POINTS[v.name];
    if (v.args?.length) return [num(v.args.find((a) => a.label === "x")?.value ?? 0), num(v.args.find((a) => a.label === "y")?.value ?? 0)];
    return undefined;
  }
  if (isT(v, "tuple")) {
    const p = pointOf(v);
    return [p.x, p.y];
  }
  return undefined;
}

export function gradientOf(name: string, args: EvArg[], scheme: "light" | "dark"): ColorSpec | null {
  const kind = /^(linear|Linear)/.test(name) ? "linear" : /^(radial|Radial|elliptical|Elliptical)/.test(name) ? "radial" : /^(angular|Angular|conic)/.test(name) ? "angular" : "linear";
  const pick = (l: string) => args.find((a) => a.label === l)?.value;
  let source = pick("colors") ?? pick("stops") ?? pick("gradient") ?? args.find((a) => a.label === null)?.value;
  if (source !== undefined && isT(source, "sym") && source.args) source = source.args.find((a) => a.label === "colors" || a.label === "stops")?.value ?? source.args[0]?.value;
  if (!Array.isArray(source)) return null;
  const stops: { color: ColorSpec; at?: number }[] = [];
  for (const item of source) {
    const parts = isT(item, "sym") && item.args?.some((a) => a.label === "color") ? item.args : isT(item, "tuple") && item.labels.includes("color") ? item.items.map((value, i) => ({ label: item.labels[i], value })) : null;
    const color = toColor(parts ? parts.find((a) => a.label === "color")?.value : item, scheme);
    if (!color) continue;
    const location = parts?.find((a) => a.label === "location")?.value;
    stops.push(location === undefined ? { color } : { color, at: Math.min(1, Math.max(0, num(location))) });
  }
  if (!stops.length) return null;
  const gradient: GradientSpec = { kind, stops };
  if (kind === "linear") {
    gradient.from = unitPoint(pick("startPoint")) ?? [0.5, 0];
    gradient.to = unitPoint(pick("endPoint")) ?? [0.5, 1];
  } else {
    gradient.center = unitPoint(pick("center")) ?? [0.5, 0.5];
    if (kind === "radial") {
      gradient.r0 = num(pick("startRadius") ?? 0);
      const end = pick("endRadius");
      if (end !== undefined) gradient.r1 = num(end);
    } else {
      const start = pick("startAngle") ?? pick("angle");
      const end = pick("endAngle");
      if (start !== undefined) gradient.a0 = (radians(start) * 180) / Math.PI;
      if (end !== undefined) gradient.a1 = (radians(end) * 180) / Math.PI;
    }
  }
  const { gradient: _, ...head } = stops[0].color;
  return { ...head, gradient } as ColorSpec;
}

export function toColor(v: V | undefined, scheme: "light" | "dark"): ColorSpec | null {
  if (v === undefined || v === null) return null;
  if (isT(v, "color")) return v.spec;
  if (isT(v, "sym")) {
    if (v.name === "opacity") return null;
    if (/[gG]radient$/.test(v.name)) return gradientOf(v.name, v.args ?? [], scheme);
    return namedColor(v.name, scheme);
  }
  if (Array.isArray(v)) return v.length ? toColor(v[0], scheme) : null;
  const nodes = nodesOf(v);
  if (nodes?.length === 1) {
    const n = nodes[0];
    if (n.type === "Color") return n.props.color as ColorSpec;
  }
  return null;
}

export function makeColor(name: string, args: EvArg[], scheme: "light" | "dark"): ColorSpec | null {
  const first = arg(args, null);
  if (args.length === 0) return namedColor(name, scheme);
  if (arg(args, "red") !== undefined) {
    const a = arg(args, "opacity") ?? arg(args, "alpha");
    return { rgba: [num(arg(args, "red") ?? 0), num(arg(args, "green") ?? 0), num(arg(args, "blue") ?? 0), a === undefined ? 1 : num(a)] };
  }
  if (arg(args, "white") !== undefined) {
    const w = num(arg(args, "white") ?? 0);
    const a = arg(args, "opacity");
    return { rgba: [w, w, w, a === undefined ? 1 : num(a)] };
  }
  if (arg(args, "hue") !== undefined) {
    const [r, g, b] = hsb(num(arg(args, "hue") ?? 0), num(arg(args, "saturation") ?? 0), num(arg(args, "brightness") ?? 0));
    const a = arg(args, "opacity");
    return { rgba: [r, g, b, a === undefined ? 1 : num(a)] };
  }
  const hex = arg(args, "hex") ?? (typeof first === "string" && /^#?[0-9a-fA-F]{6,8}$/.test(first) ? first : undefined);
  if (typeof hex === "string") return { rgba: hexRgba(hex) };
  if (typeof hex === "number") return { rgba: hexRgba(hex.toString(16).padStart(6, "0")) };
  const ui = arg(args, "uiColor") ?? arg(args, "nsColor") ?? first;
  if (isT(ui ?? null, "sym")) return namedColor((ui as { name: string }).name, scheme);
  if (isT(ui ?? null, "color")) return (ui as { spec: ColorSpec }).spec;
  if (typeof first === "string") {
    const asset = assetColors[first];
    if (asset) return asset.dark ? { rgba: asset.light, dark: asset.dark } : { rgba: asset.light };
    return first === "AccentColor" ? { name: "accentColor" } : { name: "gray" };
  }
  return { name: "gray" };
}

export function withOpacity(c: ColorSpec, o: number): ColorSpec {
  if ("rgba" in c) {
    const out: ColorSpec = { rgba: [c.rgba[0], c.rgba[1], c.rgba[2], c.rgba[3] * o] };
    if (c.dark) out.dark = [c.dark[0], c.dark[1], c.dark[2], c.dark[3] * o];
    return out;
  }
  return { name: c.name, opacity: (c.opacity ?? 1) * o };
}

export function toFont(v: V | undefined): FontSpec | null {
  if (v === undefined || v === null) return null;
  if (isT(v, "font")) return v.spec;
  if (isT(v, "sym")) {
    if (TEXT_STYLES.has(v.name as TextStyle)) return { style: v.name as TextStyle };
    if (v.name === "system" || v.name === "custom") return fontCall(v.name, v.args ?? []);
  }
  return null;
}

export function fontCall(name: string, args: EvArg[]): FontSpec {
  const spec: FontSpec = {};
  const first = arg(args, null);
  if (name === "custom") {
    const size = arg(args, "size") ?? arg(args, "fixedSize");
    if (size !== undefined) spec.size = num(size);
    if (typeof first === "string") spec.custom = first;
    return spec;
  }
  if (isNum(first ?? null)) spec.size = num(first ?? 0);
  const size = arg(args, "size");
  if (size !== undefined) spec.size = num(size);
  if (isT(first ?? null, "sym") && TEXT_STYLES.has((first as { name: TextStyle }).name)) spec.style = (first as { name: TextStyle }).name;
  const weight = arg(args, "weight");
  if (isT(weight ?? null, "sym") && WEIGHTS.has((weight as { name: Weight }).name)) spec.weight = (weight as { name: Weight }).name;
  const design = arg(args, "design");
  if (isT(design ?? null, "sym")) spec.design = (design as { name: string }).name as FontSpec["design"];
  return spec;
}

export function fontMethod(spec: FontSpec, method: string, args: EvArg[]): FontSpec {
  const out = { ...spec };
  switch (method) {
    case "bold":
      out.weight = "bold";
      break;
    case "italic":
      out.italic = true;
      break;
    case "weight": {
      const w = arg(args, null);
      if (isT(w ?? null, "sym")) out.weight = (w as { name: Weight }).name;
      break;
    }
    case "monospaced":
    case "monospacedDigit":
      out.design = method === "monospaced" ? "monospaced" : out.design;
      break;
    case "smallCaps":
    case "leading":
    case "width":
      break;
  }
  return out;
}

export function toNumber(v: V | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (isNum(v)) return num(v);
  if (isT(v, "sym") && v.name === "infinity") return Infinity;
  return undefined;
}

export function toLength(v: V | undefined): Length | undefined {
  const n = toNumber(v);
  if (n === undefined) return undefined;
  return Number.isFinite(n) ? n : "inf";
}

export function symName(v: V | undefined, fallback: string): string {
  if (isT(v ?? null, "sym")) return (v as { name: string }).name;
  if (typeof v === "string") return v;
  return fallback;
}

export function toShape(v: V | undefined): ShapeSpec | null {
  if (v === undefined || v === null) return null;
  if (isT(v, "sym")) {
    switch (v.name) {
      case "rect": {
        const r = toNumber(arg(v.args ?? [], "cornerRadius"));
        return r ? { shape: "roundedRect", radius: r } : { shape: "rect" };
      }
      case "circle":
        return { shape: "circle" };
      case "capsule":
        return { shape: "capsule" };
      case "ellipse":
        return { shape: "ellipse" };
      case "roundedRectangle":
        return { shape: "roundedRect", radius: toNumber(arg(v.args ?? [], "cornerRadius")) ?? 8 };
    }
    return null;
  }
  const nodes = nodesOf(v);
  if (nodes?.length === 1) return shapeOfNode(nodes[0]);
  return null;
}

export function shapeOfNode(n: ViewNode): ShapeSpec | null {
  switch (n.type) {
    case "Rectangle":
      return { shape: "rect" };
    case "RoundedRectangle":
      return { shape: "roundedRect", radius: Number(n.props.radius ?? 8) };
    case "Circle":
      return { shape: "circle" };
    case "Capsule":
      return { shape: "capsule" };
    case "Ellipse":
      return { shape: "ellipse" };
  }
  return null;
}

export function edges(v: V | undefined): Set<"top" | "leading" | "bottom" | "trailing"> {
  const all = new Set<"top" | "leading" | "bottom" | "trailing">(["top", "leading", "bottom", "trailing"]);
  if (v === undefined) return all;
  const list = Array.isArray(v) ? v : [v];
  const out = new Set<"top" | "leading" | "bottom" | "trailing">();
  for (const e of list) {
    const name = symName(e, "all");
    if (name === "all") return all;
    if (name === "horizontal") {
      out.add("leading");
      out.add("trailing");
    } else if (name === "vertical") {
      out.add("top");
      out.add("bottom");
    } else if (name === "top" || name === "bottom" || name === "leading" || name === "trailing") out.add(name);
  }
  return out;
}

function text(v: V | undefined): string {
  if (v === undefined || v === null) return "";
  const nodes = nodesOf(v);
  if (nodes) return nodes.map((n) => String(n.props.text ?? n.props.title ?? "")).join("");
  return describe(v);
}

function node(type: string, props: Record<string, unknown> = {}, extra: Partial<ViewNode> = {}): ViewNode {
  return { id: "", type, props, ...extra };
}

function bindingOf(v: V | undefined): Extract<V, { t: "binding" }> | null {
  return isT(v ?? null, "binding") ? (v as Extract<V, { t: "binding" }>) : null;
}

function rangeOf(v: V | undefined): { min: number; max: number } | null {
  if (v === undefined || v === null) return null;
  if (isT(v, "range")) return { min: v.lo, max: v.closed ? v.hi : v.hi - 1 };
  if (isT(v, "tuple") && v.items.length === 2) return { min: num(v.items[0]), max: num(v.items[1]) };
  if (Array.isArray(v) && v.length === 2) return { min: num(v[0]), max: num(v[1]) };
  return null;
}

const SHAPES = new Set(["Rectangle", "RoundedRectangle", "Circle", "Capsule", "Ellipse", "UnevenRoundedRectangle", "ContainerRelativeShape"]);

const PASSTHROUGH = new Set(["Group", "AnyView", "ViewThatFits", "VStackLayout", "HStackLayout", "ZStackLayout", "GlassEffectContainer", "TabSection", "EquatableView", "PhaseAnimator", "KeyframeAnimator"]);

const UNSUPPORTED: Record<string, string> = {
  Map: "map",
  MapReader: "map",
  VideoPlayer: "video",
  WebView: "web",
  SceneView: "model",
  SpriteView: "model",
  RealityView: "model",
  Model3D: "model",
  PhotosPicker: "picker",
  CameraView: "camera",
  SignInWithAppleButton: "button",
  PasteButton: "button",
  MultiDatePicker: "picker",
  Table: "table",
  StoreView: "store",
  SubscriptionStoreView: "store",
  ProductView: "store",
};

const MARKS = new Set(["BarMark", "LineMark", "AreaMark", "PointMark", "RuleMark", "RectangleMark", "SectorMark"]);

function plot(v: V | undefined): { label: string; kind: "n" | "s" | "d"; v: number | string } | undefined {
  if (v === undefined || v === null) return undefined;
  let label = "";
  let value: V = v;
  if (isT(v, "sym") && v.name === "value" && v.args?.length) {
    label = describe(v.args[0].value);
    value = v.args[1]?.value ?? null;
  }
  if (value === null) return undefined;
  if (isNum(value)) return { label, kind: "n", v: num(value) };
  if (isT(value, "date")) return { label, kind: "d", v: value.ms };
  return { label, kind: "s", v: describe(value) };
}

function extent(v: V | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (isNum(v)) return num(v);
  if (isT(v, "sym") && v.args?.length && isNum(v.args[0].value)) return v.name === "ratio" ? -num(v.args[0].value) : num(v.args[0].value);
  return undefined;
}

export function isViewName(name: string): boolean {
  return VIEW_NAMES.has(name);
}

const VIEW_NAMES = new Set([
  "Text",
  "Image",
  "Label",
  "Button",
  "Toggle",
  "Slider",
  "Stepper",
  "TextField",
  "SecureField",
  "TextEditor",
  "Picker",
  "DatePicker",
  "ColorPicker",
  "ProgressView",
  "Link",
  "Spacer",
  "Divider",
  "VStack",
  "HStack",
  "ZStack",
  "LazyVStack",
  "LazyHStack",
  "LazyVGrid",
  "LazyHGrid",
  "Grid",
  "GridRow",
  "ScrollView",
  "List",
  "Form",
  "Section",
  "NavigationStack",
  "NavigationView",
  "NavigationSplitView",
  "NavigationLink",
  "TabView",
  "Tab",
  "Menu",
  "ShareLink",
  "DisclosureGroup",
  "GeometryReader",
  "EmptyView",
  "AsyncImage",
  "ContentUnavailableView",
  "LinearGradient",
  "RadialGradient",
  "AngularGradient",
  "ControlGroup",
  "GroupBox",
  "LabeledContent",
  "ScrollViewReader",
  "ToolbarItem",
  "ToolbarItemGroup",
  "ToolbarSpacer",
  "Chart",
  "Gauge",
  "EditButton",
  "RenameButton",
  ...MARKS,
  ...SHAPES,
  ...PASSTHROUGH,
  ...Object.keys(UNSUPPORTED),
]);

export function makeView(name: string, args: EvArg[], trailing: V[], ctx: Ctx): ViewNode[] | null {
  const first = arg(args, null);
  const content = () => ctx.build(trailing[0] ?? arg(args, "content"));
  const labeled = (label: string) => args.find((a) => a.label === label)?.value;
  if (PASSTHROUGH.has(name)) {
    if (name === "AnyView" || name === "EquatableView") return nodesOf(first ?? labeled("content") ?? null) ?? content();
    if (name === "ViewThatFits") return content().slice(0, 1);
    if (name === "PhaseAnimator" || name === "KeyframeAnimator") {
      const phases = Array.isArray(first) ? first : [];
      const start = labeled("initialValue") ?? phases[0] ?? null;
      return [node("Group", {}, { children: ctx.build(trailing[0] ?? labeled("content"), name === "PhaseAnimator" ? [start] : [null, start]) })];
    }
    return [node("Group", {}, { children: content() })];
  }
  if (UNSUPPORTED[name]) {
    ctx.note(name);
    return [node("Unsupported", { name, kind: UNSUPPORTED[name] })];
  }
  if (MARKS.has(name)) {
    const props: Record<string, unknown> = { mark: name.replace(/Mark$/, "").toLowerCase() };
    for (const key of ["x", "y", "xStart", "xEnd", "yStart", "yEnd", "angle"]) {
      const p = plot(labeled(key));
      if (p) props[key] = p;
    }
    const series = plot(labeled("series"));
    if (series) props.series = String(series.v);
    for (const key of ["width", "height", "innerRadius", "outerRadius", "angularInset"]) {
      const e = extent(labeled(key));
      if (e !== undefined) props[key] = e;
    }
    return [node("Mark", props)];
  }
  if (SHAPES.has(name)) {
    if (name === "RoundedRectangle" || name === "UnevenRoundedRectangle") {
      const r = toNumber(labeled("cornerRadius")) ?? toNumber(labeled("topLeadingRadius")) ?? 8;
      return [node("RoundedRectangle", { radius: r })];
    }
    return [node(name === "ContainerRelativeShape" ? "Rectangle" : name)];
  }
  switch (name) {
    case "Text": {
      const v = first ?? labeled("verbatim") ?? labeled("timerInterval");
      const style = labeled("format") ?? labeled("style");
      if (v !== undefined && v !== null && (style !== undefined || isT(v, "date")) && (isNum(v) || isT(v, "date"))) return [node("Text", { text: ctx.format(v, style) })];
      if (v !== undefined && v !== null && isT(v, "range")) return [node("Text", { text: `${v.lo} – ${v.hi}` })];
      return [node("Text", { text: text(v) })];
    }
    case "ToolbarItem":
    case "ToolbarItemGroup":
      return [node("ToolbarItem", { placement: symName(labeled("placement"), "automatic") }, { children: content() })];
    case "ToolbarSpacer":
      return [node("ToolbarItem", { placement: symName(labeled("placement"), "automatic") }, { children: [node("Spacer")] })];
    case "EditButton":
    case "RenameButton":
      return [node("Button", { title: name === "EditButton" ? "Edit" : "Rename" })];
    case "Chart": {
      const marks = first !== undefined && first !== null && trailing[0] !== undefined ? forEachRows(first, trailing[0], ctx) : content();
      return [node("Chart", {}, { children: flattenGroups(marks).filter((m) => m.type === "Mark") })];
    }
    case "Gauge": {
      const r = rangeOf(labeled("in")) ?? { min: 0, max: 1 };
      const part = (label: string) => {
        const fn = labeled(label);
        return fn === undefined ? undefined : text({ t: "views", nodes: ctx.build(fn) });
      };
      const title = trailing[0] !== undefined ? text({ t: "views", nodes: ctx.build(trailing[0]) }) : part("label");
      return [node("Gauge", { value: num(labeled("value") ?? first ?? 0), min: r.min, max: r.max, title, current: part("currentValueLabel"), low: part("minimumValueLabel"), high: part("maximumValueLabel") })];
    }
    case "Image": {
      const system = labeled("systemName");
      if (system !== undefined) return [node("Image", { system: describe(system) })];
      if (typeof first === "string") return [node("Image", { name: first })];
      return [node("Image", { system: "photo" })];
    }
    case "AsyncImage":
      return [node("Image", { system: "photo" }, { mods: [{ m: "foreground", color: { name: "secondary" } }] })];
    case "Label": {
      const system = labeled("systemImage") ?? labeled("image");
      if (first !== undefined) return [node("Label", { title: text(first), system: system === undefined ? undefined : describe(system) })];
      const title = ctx.build(trailing[0] ?? labeled("title"));
      const icon = ctx.build(trailing[1] ?? labeled("icon"));
      return [node("Label", {}, { label: title, children: icon })];
    }
    case "Button":
    case "Menu":
    case "ShareLink": {
      const role = labeled("role");
      const titleArg = first !== undefined && !isT(first, "closure") ? first : undefined;
      const action = labeled("action") ?? labeled("primaryAction") ?? (titleArg !== undefined || labeled("label") === undefined ? trailing[0] : trailing[0]);
      let label: ViewNode[] | undefined;
      const labelFn = labeled("label") ?? (labeled("action") !== undefined ? trailing[0] : trailing.length > 1 ? trailing[1] : undefined);
      if (titleArg === undefined && labelFn !== undefined) label = ctx.build(labelFn);
      const system = labeled("systemImage");
      const props: Record<string, unknown> = {};
      if (titleArg !== undefined) props.title = text(titleArg);
      if (name === "ShareLink" && props.title === undefined && !label) props.title = "Share";
      if (role !== undefined) props.role = symName(role, "");
      if (system !== undefined && label === undefined) {
        label = [node("Label", { title: String(props.title ?? ""), system: describe(system) })];
        delete props.title;
      }
      const n = node("Button", props, label ? { label } : {});
      const fn = name === "Button" ? (titleArg !== undefined || labeled("action") !== undefined ? (labeled("action") ?? trailing[0]) : action) : undefined;
      if (fn !== undefined && (isT(fn, "closure") || isT(fn, "fn"))) attach(n, { kind: "tap", run: () => void ctx.call(fn, []) });
      return [n];
    }
    case "Toggle": {
      const b = bindingOf(labeled("isOn"));
      const label = first === undefined ? ctx.build(trailing[0]) : undefined;
      const n = node("Toggle", { isOn: !!b?.get(), title: first === undefined ? undefined : text(first) }, label?.length ? { label } : {});
      if (b) attach(n, { kind: "set", run: (v) => b.set(!!v) });
      return [n];
    }
    case "Slider": {
      const b = bindingOf(labeled("value"));
      const r = rangeOf(labeled("in")) ?? { min: 0, max: 1 };
      const step = toNumber(labeled("step"));
      const n = node("Slider", { value: num(b?.get() ?? 0), min: r.min, max: r.max, step });
      if (b) attach(n, { kind: "set", run: (v) => b.set(new Dbl(Number(v))) });
      return [n];
    }
    case "Stepper": {
      const b = bindingOf(labeled("value"));
      const r = rangeOf(labeled("in"));
      const step = toNumber(labeled("step")) ?? 1;
      const label = first === undefined ? ctx.build(trailing[0] ?? labeled("label")) : undefined;
      const n = node(
        "Stepper",
        { value: b ? num(b.get()) : 0, title: first === undefined ? undefined : text(first), min: r?.min, max: r?.max, step },
        label?.length ? { label } : {},
      );
      const inc = labeled("onIncrement");
      const dec = labeled("onDecrement");
      const clamp = (x: number) => (r ? Math.min(r.max, Math.max(r.min, x)) : x);
      attach(n, {
        kind: "step",
        inc: () => {
          if (inc !== undefined) ctx.call(inc, []);
          else if (b) b.set(retype(b.get(), clamp(num(b.get()) + step)));
        },
        dec: () => {
          if (dec !== undefined) ctx.call(dec, []);
          else if (b) b.set(retype(b.get(), clamp(num(b.get()) - step)));
        },
      });
      return [n];
    }
    case "TextField":
    case "SecureField":
    case "TextEditor": {
      const b = bindingOf(labeled("text") ?? labeled("value"));
      const type = name === "TextEditor" ? "TextField" : name;
      const n = node(type, { text: b ? describe(b.get()) : "", placeholder: text(first ?? "") });
      if (b) {
        const numeric = isNum(b.get());
        attach(n, {
          kind: "set",
          run: (v) => {
            if (!numeric) return b.set(String(v));
            const parsed = Number(String(v).replace(",", "."));
            if (Number.isFinite(parsed)) b.set(retype(b.get(), parsed));
          },
        });
      }
      return [n];
    }
    case "Picker": {
      const b = bindingOf(labeled("selection"));
      const items = ctx.build(trailing[0] ?? labeled("content"));
      const options = flattenGroups(items).map((item) => {
        const tagMod = item.mods?.find((m) => m.m === "tag") as Extract<Mod, { m: "tag" }> | undefined;
        const mods = item.mods?.filter((m) => m.m !== "tag");
        return { tag: tagMod?.value ?? null, label: [{ ...item, mods }] };
      });
      const current = b ? jsonOf(b.get()) : null;
      const n = node("Picker", { title: text(first ?? ""), selection: current, options });
      if (b) {
        const original = b.get();
        attach(n, {
          kind: "set",
          run: (v) => {
            const source = items.find((it) => (it.mods?.find((m) => m.m === "tag") as Extract<Mod, { m: "tag" }> | undefined)?.value === v);
            const raw = source ? (source as ViewNode & { __tag?: V }).__tag : undefined;
            b.set(raw !== undefined ? raw : isNum(original) ? retype(original, Number(v)) : (v as V));
          },
        });
      }
      return [n];
    }
    case "DatePicker":
    case "ColorPicker": {
      const selection = bindingOf(labeled("selection"))?.get();
      const shown = name === "ColorPicker" ? "●" : selection !== undefined && selection !== null && isT(selection, "date") ? ctx.format(selection, { t: "sym", name: "__parts", args: [{ label: "date", value: { t: "sym", name: "abbreviated" } }, { label: "time", value: { t: "sym", name: "omitted" } }] }) : "1 Jan 2026";
      const tint = name === "ColorPicker" && selection !== undefined ? toColor(selection ?? undefined, ctx.scheme) : null;
      const title = first !== undefined ? [node("Text", { text: text(first) })] : ctx.build(trailing[0] ?? labeled("label"));
      return [node("HStack", { alignment: "center" }, { children: [...title, node("Spacer"), node("Text", { text: shown }, { mods: [{ m: "foreground", color: tint ?? { name: "accentColor" } }] })] })];
    }
    case "ProgressView": {
      const value = labeled("value");
      const total = labeled("total");
      return [node("ProgressView", { value: value === undefined ? undefined : num(value), total: total === undefined ? 1 : num(total), title: first === undefined ? undefined : text(first) })];
    }
    case "Link":
      return [node("Link", { title: text(first ?? ""), url: describe(labeled("destination") ?? "") })];
    case "Spacer":
      return [node("Spacer", { minLength: toNumber(labeled("minLength")) })];
    case "Divider":
      return [node("Divider")];
    case "EmptyView":
      return [];
    case "VStack":
    case "LazyVStack":
    case "Grid":
      return [node(name === "LazyVStack" ? "LazyVStack" : "VStack", { alignment: symName(labeled("alignment"), "center"), spacing: toNumber(labeled("spacing") ?? labeled("verticalSpacing")) }, { children: content() })];
    case "HStack":
    case "LazyHStack":
    case "GridRow":
      return [node(name === "LazyHStack" ? "LazyHStack" : "HStack", { alignment: symName(labeled("alignment"), "center"), spacing: toNumber(labeled("spacing")) }, { children: content() })];
    case "ZStack":
      return [node("ZStack", { alignment: symName(labeled("alignment"), "center") }, { children: content() })];
    case "LazyVGrid":
    case "LazyHGrid": {
      const cols = labeled("columns") ?? labeled("rows");
      const count = Array.isArray(cols) ? Math.max(1, cols.length) : 2;
      return [node("LazyVGrid", { columns: count, spacing: toNumber(labeled("spacing")) }, { children: content() })];
    }
    case "ScrollView":
    case "ScrollViewReader": {
      const axis = symName(first, "vertical");
      return [node("ScrollView", { axis: axis === "horizontal" ? "horizontal" : "vertical" }, { children: name === "ScrollViewReader" ? ctx.build(trailing[0], [null]) : content() })];
    }
    case "List":
    case "Form": {
      if (first !== undefined && (trailing[0] !== undefined || labeled("rowContent") !== undefined) && !isT(first, "binding")) {
        const rows = forEachRows(first, trailing[0] ?? labeled("rowContent"), ctx);
        return [node(name, {}, { children: rows })];
      }
      if (isT(first ?? null, "binding") && trailing[0] !== undefined) {
        return [node(name, {}, { children: forEachRows(first as V, trailing[0], ctx) })];
      }
      return [node(name, {}, { children: content() })];
    }
    case "Section": {
      const headerFn = labeled("header");
      const footerFn = labeled("footer");
      const props: Record<string, unknown> = {};
      let label: ViewNode[] | undefined;
      if (typeof first === "string" || nodesOf(first ?? null)) props.header = text(first);
      if (headerFn !== undefined) {
        if (typeof headerFn === "string") props.header = headerFn;
        else label = isT(headerFn, "closure") ? ctx.build(headerFn) : (nodesOf(headerFn) ?? undefined);
      }
      if (footerFn !== undefined) props.footer = isT(footerFn, "closure") ? text({ t: "views", nodes: ctx.build(footerFn) }) : text(footerFn);
      const named = (l: string) => trailing.length > 1 ? undefined : l;
      void named;
      return [node("Section", props, { children: ctx.build(trailing[0] ?? labeled("content")), ...(label ? { label } : {}) })];
    }
    case "NavigationStack":
    case "NavigationView":
      return [node("NavigationStack", {}, { children: content() })];
    case "NavigationSplitView": {
      const sidebar = ctx.build(trailing[0] ?? labeled("sidebar"));
      if (!ctx.wide) return [node("NavigationStack", {}, { children: sidebar })];
      const detail = ctx.build(labeled("detail"));
      const middle = ctx.build(labeled("content"));
      const columns = [node("NavigationStack", { column: "sidebar" }, { children: sidebar })];
      if (middle.length) columns.push(node("NavigationStack", { column: "content" }, { children: middle }));
      columns.push(node("NavigationStack", { column: "detail" }, { children: detail }));
      return [node("SplitView", {}, { children: columns })];
    }
    case "NavigationLink": {
      const dest = labeled("destination");
      const destNodes = dest === undefined ? [] : isT(dest, "closure") ? ctx.build(dest) : (nodesOf(dest) ?? []);
      let label: ViewNode[] | undefined;
      const props: Record<string, unknown> = {};
      if (first !== undefined && !isT(first, "closure") && labeled("value") === undefined) props.title = text(first);
      if (dest !== undefined) {
        if (props.title === undefined && trailing[0] !== undefined) label = ctx.build(trailing[0]);
      } else if (trailing.length >= 2) {
        destNodes.push(...ctx.build(trailing[0]));
        label = ctx.build(trailing[1]);
      } else if (trailing[0] !== undefined) {
        if (props.title !== undefined) destNodes.push(...ctx.build(trailing[0]));
        else label = ctx.build(trailing[0]);
      }
      if (labeled("label") !== undefined) label = ctx.build(labeled("label"));
      return [node("NavigationLink", props, { children: destNodes, ...(label ? { label } : {}) })];
    }
    case "TabView":
      return [node("TabView", {}, { children: content() })];
    case "Tab": {
      const title = text(first ?? "");
      const system = labeled("systemImage");
      const body = content();
      const tab = node("Group", {}, { children: body, mods: [{ m: "tabItem", label: [node("Label", { title, system: system === undefined ? undefined : describe(system) })] }] });
      return [tab];
    }
    case "DisclosureGroup":
    case "GroupBox":
    case "ControlGroup": {
      const title = first !== undefined ? text(first) : undefined;
      const body = content();
      const header = title !== undefined ? [node("Text", { text: title }, { mods: [{ m: "font", font: { style: "headline" } }] })] : [];
      return [node("VStack", { alignment: "leading", spacing: 8 }, { children: [...header, ...body], mods: name === "GroupBox" ? [{ m: "padding", top: 12, leading: 12, bottom: 12, trailing: 12 }, { m: "background", color: { name: "secondarySystemBackground" }, shape: { shape: "roundedRect", radius: 10 } }] : [] })];
    }
    case "LabeledContent": {
      const value = labeled("value") ?? arg(args, null, 1);
      const label = first !== undefined ? [node("Text", { text: text(first) })] : ctx.build(labeled("label"));
      const trailingView = trailing[0] !== undefined ? ctx.build(trailing[0]) : [node("Text", { text: text(value ?? "") }, { mods: [{ m: "foreground", color: { name: "secondary" } }] })];
      return [node("HStack", { alignment: "center" }, { children: [...label, node("Spacer"), ...trailingView] })];
    }
    case "ContentUnavailableView": {
      const system = labeled("systemImage");
      const desc = labeled("description");
      const children: ViewNode[] = [];
      if (first === undefined && trailing[0] !== undefined) {
        const head = ctx.build(trailing[0]).map((n) => ({ ...n, mods: [...(n.mods ?? []), { m: "font" as const, font: { style: "title2" as const, weight: "bold" as const } }] }));
        const detail = ctx.build(desc).map((n) => ({ ...n, mods: [...(n.mods ?? []), { m: "foreground" as const, color: { name: "secondary" } }, { m: "align" as const, value: "center" as const }] }));
        return [node("VStack", { alignment: "center", spacing: 12 }, { children: [...head, ...detail, ...ctx.build(labeled("actions"))], mods: [{ m: "padding", top: 16, leading: 16, bottom: 16, trailing: 16 }, { m: "frame", maxWidth: "inf", maxHeight: "inf" }] })];
      }
      if (system !== undefined) children.push(node("Image", { system: describe(system) }, { mods: [{ m: "font", font: { size: 48 } }, { m: "foreground", color: { name: "secondary" } }] }));
      children.push(node("Text", { text: text(first ?? "") }, { mods: [{ m: "font", font: { style: "title2", weight: "bold" } }] }));
      if (desc !== undefined) children.push(node("Text", { text: text(desc) }, { mods: [{ m: "foreground", color: { name: "secondary" } }, { m: "align", value: "center" }] }));
      return [node("VStack", { alignment: "center", spacing: 12 }, { children, mods: [{ m: "padding", top: 16, leading: 16, bottom: 16, trailing: 16 }, { m: "frame", maxWidth: "inf", maxHeight: "inf" }] })];
    }
    case "LinearGradient":
    case "RadialGradient":
    case "AngularGradient": {
      return [node("Color", { color: gradientOf(name, args, ctx.scheme) ?? { name: "accentColor" } })];
    }
  }
  return null;
}

function flattenGroups(nodes: ViewNode[]): ViewNode[] {
  return nodes.flatMap((n) => (n.type === "Group" && !n.mods?.length ? flattenGroups(n.children ?? []) : [n]));
}

export function retype(original: V, value: number): V {
  return original instanceof Dbl ? new Dbl(value) : Math.round(value);
}

export function forEachRows(data: V, fn: V | undefined, ctx: Ctx): ViewNode[] {
  const out: ViewNode[] = [];
  const items = sequence(data);
  for (const item of items.slice(0, 500)) out.push(...ctx.build(fn, [item]));
  if (items.length > 500) ctx.note("ForEach: first 500 rows");
  return out;
}

export function sequence(v: V): V[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  if (isT(v, "range")) {
    const out: V[] = [];
    const end = rangeEnd(v);
    for (let i = Number.isFinite(v.lo) ? v.lo : 0; i < end && out.length < 100000; i++) out.push(i);
    return out;
  }
  if (isT(v, "binding")) {
    const arr = v.get();
    if (!Array.isArray(arr)) return [];
    return arr.map((_x, i) => ({
      t: "binding" as const,
      get: () => {
        const cur = v.get();
        return Array.isArray(cur) ? cur[i] : null;
      },
      set: (x: V) => {
        const cur = v.get();
        if (!Array.isArray(cur)) return;
        const next = cur.slice();
        next[i] = x;
        v.set(next);
      },
    }));
  }
  if (isT(v, "dict")) return [...v.m.values()].map(([k, x]) => ({ t: "tuple", items: [k, x], labels: ["key", "value"] }));
  if (typeof v === "string") return [...v];
  if (isT(v, "tuple")) return v.items;
  return [];
}

const IGNORED = new Set([
  "contentTransition",
  "matchedGeometryEffect",
  "id",
  "zIndex",
  "accessibilityLabel",
  "accessibilityHint",
  "accessibilityIdentifier",
  "accessibilityHidden",
  "accessibilityElement",
  "accessibilityAddTraits",
  "accessibilityValue",
  "help",
  "contextMenu",
  "swipeActions",
  "refreshable",
  "keyboardType",
  "textInputAutocapitalization",
  "autocapitalization",
  "autocorrectionDisabled",
  "disableAutocorrection",
  "submitLabel",
  "focused",
  "onSubmit",
  "onAppear",
  "onDisappear",
  "task",
  "onChange",
  "onReceive",
  "sheet",
  "fullScreenCover",
  "popover",
  "alert",
  "confirmationDialog",
  "toolbarBackground",
  "toolbarColorScheme",
  "toolbarRole",
  "navigationDestination",
  "navigationBarBackButtonHidden",
  "navigationBarHidden",
  "toolbarTitleDisplayMode",
  "environment",
  "environmentObject",
  "modelContainer",
  "symbolRenderingMode",
  "symbolEffect",
  "symbolVariant",
  "labelStyle",
  "toggleStyle",
  "datePickerStyle",
  "progressViewStyle",
  "gaugeStyle",
  "menuStyle",
  "tabViewStyle",
  "indexViewStyle",
  "listSectionSeparator",
  "scrollIndicators",
  "scrollDismissesKeyboard",
  "scrollTargetBehavior",
  "scrollTargetLayout",
  "scrollPosition",
  "safeAreaPadding",
  "statusBarHidden",
  "persistentSystemOverlays",
  "allowsHitTesting",
  "contentShape",
  "fixedSize",
  "layoutPriority",
  "minimumScaleFactor",
  "truncationMode",
  "allowsTightening",
  "kerning",
  "tracking",
  "baselineOffset",
  "dynamicTypeSize",
  "sensoryFeedback",
  "interactiveDismissDisabled",
  "presentationDetents",
  "presentationDragIndicator",
  "tabItemBadge",
  "redacted",
  "unredacted",
  "privacySensitive",
  "drawingGroup",
  "compositingGroup",
  "blendMode",
  "mask",
  "geometryGroup",
  "coordinateSpace",
  "onLongPressGesture",
  "gesture",
  "simultaneousGesture",
  "highPriorityGesture",
  "draggable",
  "dropDestination",
  "onDrag",
  "onDrop",
  "onHover",
  "hoverEffect",
  "preferredColorSchemeIfAvailable",
  "defaultScrollAnchor",
  "containerRelativeFrame",
  "visualEffect",
  "listItemTint",
  "headerProminence",
  "monospacedDigit",
  "multilineTextAlignmentIfAvailable",
  "colorMultiply",
  "luminanceToAlpha",
  "flipsForRightToLeftLayoutDirection",
  "imageScaleIfAvailable",
  "foregroundStyleIfAvailable",
  "lineHeight",
  "dynamicTypeSizeIfAvailable",
  "scrollTransition",
  "chartXAxis",
  "chartYAxis",
  "chartYScale",
  "chartXScale",
  "chartLegend",
  "chartForegroundStyleScale",
  "chartPlotStyle",
  "interpolationMethod",
  "foregroundStyleBy",
  "symbolSize",
  "annotation",
  "presentationBackground",
  "presentationCornerRadius",
  "scrollClipDisabled",
  "scrollBounceBehavior",
  "onGeometryChange",
  "onScrollGeometryChange",
  "phaseAnimator",
  "keyframeAnimator",
  "springLoadingBehavior",
  "focusable",
  "focusEffectDisabled",
  "defersSystemGestures",
  "onContinuousHover",
  "onKeyPress",
  "fileImporter",
  "fileExporter",
  "photosPicker",
  "inspector",
  "navigationSplitViewStyle",
  "navigationSplitViewColumnWidth",
  "tableStyle",
  "buttonBorderShape",
  "listRowSpacing",
  "listSectionSpacing",
  "contentMargins",
  "safeAreaPaddingIfAvailable",
  "textSelection",
  "privacySensitiveIfAvailable",
  "scenePadding",
  "frameIfAvailable",
]);

const BUTTON_STYLES = new Set(["borderedProminent", "bordered", "plain", "borderless", "automatic", "glass", "glassProminent", "custom"]);

const SILENT =
  /^(on[A-Z]|accessibility|scroll[A-Z]|presentation[A-Z]|toolbar[A-Z]|navigation[A-Z]|search[A-Z]|focus|keyboard|submit|writingTools|symbol[A-Z]|list[A-Z]|chart[A-Z]|map[A-Z]|glassEffect[A-Z]|sensory|default[A-Z]|interactive|widget|activity|handles|userActivity|defers|persistent|statusBar|grid[A-Z]|alignmentGuide|fontWidth|deleteDisabled|moveDisabled|selectionDisabled|labelsHidden|menu[A-Z]|tabBar[A-Z]|tabView[A-Z]|matched|backgroundExtension|typesetting|invalidatable|popoverTip|tip[A-Z]|textContentType|textInput|speech|dialog[A-Z]|fileDialog|inspector[A-Z]|window[A-Z]|commands|handGesture|digitalCrown|privacy|redacted|transaction|transformEffect|projectionEffect|layoutValue|safeArea[A-Z]|containerValue|preference|anchorPreference|backgroundPreferenceValue|overlayPreferenceValue|coordinateSpace|sectionActions|springLoading|dropDestination|draggable|itemProvider|exportable|importable|copyable|cuttable|pasteDestination)/;

function relabel(n: ViewNode, style: string): ViewNode {
  if (n.type === "Label") return { ...n, props: { ...n.props, labelStyle: style } };
  if (!n.children?.length && !n.label?.length) return n;
  return { ...n, children: n.children?.map((c) => relabel(c, style)), label: n.label?.map((c) => relabel(c, style)) };
}

function setProp(nodes: ViewNode[], type: string, key: string, value: unknown): ViewNode[] {
  return nodes.map((n) => (n.type === type ? { ...n, props: { ...n.props, [key]: value } } : n));
}

function degreesOf(v: V | undefined): number {
  if (v === undefined || v === null) return 0;
  if (isNum(v)) return num(v);
  if (isT(v, "sym")) {
    const a = num(v.args?.[0]?.value ?? 0);
    return v.name === "radians" ? (a * 180) / Math.PI : a;
  }
  return 0;
}

export function applyMod(nodes: ViewNode[], name: string, args: EvArg[], trailing: V[], ctx: Ctx): ViewNode[] | null {
  const first = arg(args, null);
  const labeled = (label: string) => args.find((a) => a.label === label)?.value;
  const push = (mod: Mod) => nodes.map((n) => ({ ...n, mods: [...(n.mods ?? []), mod] }));
  switch (name) {
    case "toolbar": {
      const fn = trailing[0] ?? labeled("content");
      if (fn === undefined || !isT(fn, "closure")) return nodes;
      const items = flattenGroups(ctx.build(fn)).map((n) => (n.type === "ToolbarItem" ? { placement: String(n.props.placement ?? "automatic"), view: n.children ?? [] } : { placement: "automatic", view: [n] }));
      return items.length ? push({ m: "toolbar", items }) : nodes;
    }
    case "safeAreaInset": {
      const edge = symName(labeled("edge"), "bottom");
      const view = ctx.build(trailing[0] ?? labeled("content"));
      if (!view.length) return nodes;
      return push({ m: "inset", edge: edge === "top" || edge === "leading" || edge === "trailing" ? edge : "bottom", view });
    }
    case "tabViewBottomAccessory": {
      const view = ctx.build(trailing[0] ?? labeled("content"));
      return view.length ? push({ m: "accessory", view }) : nodes;
    }
    case "glassEffect": {
      const mod: Extract<Mod, { m: "glass" }> = { m: "glass" };
      const shape = toShape(labeled("in"));
      if (shape) mod.shape = shape;
      if (first !== undefined && first !== null && isT(first, "sym")) {
        if (first.name === "clear") mod.clear = true;
        if (first.name === "identity") return nodes;
        for (const part of first.args ?? []) {
          if (part.label === "interactive") mod.interactive = true;
          if (part.label === "tint" && isT(part.value, "sym")) {
            const tint = toColor(part.value.args?.[0]?.value, ctx.scheme);
            if (tint) mod.tint = tint;
          }
        }
      }
      return push(mod);
    }
    case "blur":
      return push({ m: "effect", kind: "blur", value: num(labeled("radius") ?? first ?? 0) });
    case "brightness":
    case "contrast":
    case "saturation":
    case "grayscale":
      return push({ m: "effect", kind: name, value: num(first ?? 0) });
    case "hueRotation":
      return push({ m: "effect", kind: "hueRotation", value: degreesOf(first) });
    case "colorInvert":
      return push({ m: "effect", kind: "colorInvert", value: 1 });
    case "clipped":
      return push({ m: "clip", shape: { shape: "rect" } });
    case "position": {
      if (first !== undefined && first !== null && isT(first, "tuple")) return push({ m: "position", x: num(first.items[0] ?? 0), y: num(first.items[1] ?? 0) });
      return push({ m: "position", x: num(labeled("x") ?? 0), y: num(labeled("y") ?? 0) });
    }
    case "gridCellColumns":
      return push({ m: "gridSpan", value: Math.max(1, num(first ?? 1)) });
    case "badge": {
      if (first === undefined || first === null) return nodes;
      const label = isNum(first) ? (num(first) > 0 ? String(num(first)) : "") : text(first);
      return label ? push({ m: "badge", text: label }) : nodes;
    }
    case "searchable":
      return push({ m: "search", prompt: text(labeled("prompt") ?? "Search") });
    case "colorScheme": {
      const v = symName(first, "");
      return v === "dark" || v === "light" ? push({ m: "scheme", value: v }) : nodes;
    }
    case "containerBackground": {
      if (trailing[0] !== undefined) return push({ m: "background", view: ctx.build(trailing[0]) });
      const color = toColor(first, ctx.scheme);
      return color ? push({ m: "background", color }) : nodes;
    }
    case "labelStyle":
      return nodes.map((n) => relabel(n, symName(first, "automatic")));
    case "gaugeStyle":
      return setProp(nodes, "Gauge", "style", symName(first, "automatic"));
    case "progressViewStyle":
      return setProp(nodes, "ProgressView", "style", symName(first, "automatic"));
    case "interpolationMethod":
      return setProp(nodes, "Mark", "smooth", !["linear", "stepStart", "stepEnd", "stepCenter"].includes(symName(first, "linear")));
    case "lineStyle": {
      const width = first !== undefined && first !== null && isT(first, "tuple") ? num(first.items[first.labels.indexOf("lineWidth")] ?? 2) : 2;
      const dash = first !== undefined && first !== null && isT(first, "tuple") ? first.items[first.labels.indexOf("dash")] : undefined;
      return push({ m: "lineStyle", width, ...(Array.isArray(dash) ? { dash: dash.map((d) => num(d)) } : {}) });
    }
    case "chartYScale":
    case "chartXScale": {
      const domain = labeled("domain");
      if (domain === undefined || domain === null) return nodes;
      const key = name === "chartYScale" ? "yDomain" : "xDomain";
      if (isT(domain, "range")) return setProp(nodes, "Chart", key, [domain.lo, domain.hi]);
      if (Array.isArray(domain)) return setProp(nodes, "Chart", key, domain.map((d) => (isNum(d) ? num(d) : describe(d))));
      return nodes;
    }
    case "chartXAxis":
    case "chartYAxis":
      return symName(first, "") === "hidden" ? setProp(nodes, "Chart", name === "chartXAxis" ? "xAxis" : "yAxis", false) : nodes;
    case "chartLegend":
      return symName(first, "") === "hidden" ? setProp(nodes, "Chart", "legend", false) : nodes;
    case "chartForegroundStyleScale": {
      if (first === undefined || first === null) return nodes;
      const palette: Record<string, ColorSpec> = {};
      if (isT(first, "dict")) {
        for (const [key, value] of first.m.values()) {
          const c = toColor(value, ctx.scheme);
          if (c) palette[describe(key)] = c;
        }
      }
      return Object.keys(palette).length ? setProp(nodes, "Chart", "palette", palette) : nodes;
    }
    case "padding": {
      if (isT(first ?? null, "tuple")) {
        const t = first as Extract<V, { t: "tuple" }>;
        const get = (l: string) => num(t.items[t.labels.indexOf(l)] ?? 0);
        return push({ m: "padding", top: get("top"), leading: get("leading"), bottom: get("bottom"), trailing: get("trailing") });
      }
      const amountArg = isNum(first ?? null) ? first : arg(args, null, 1);
      const edgeArg = isNum(first ?? null) ? undefined : first;
      const amount = amountArg === undefined ? 16 : num(amountArg);
      const set = edges(edgeArg);
      return push({
        m: "padding",
        top: set.has("top") ? amount : 0,
        leading: set.has("leading") ? amount : 0,
        bottom: set.has("bottom") ? amount : 0,
        trailing: set.has("trailing") ? amount : 0,
      });
    }
    case "frame": {
      const mod: Extract<Mod, { m: "frame" }> = { m: "frame" };
      const w = toNumber(labeled("width"));
      const h = toNumber(labeled("height"));
      if (w !== undefined && Number.isFinite(w)) mod.width = w;
      if (h !== undefined && Number.isFinite(h)) mod.height = h;
      const minW = toNumber(labeled("minWidth"));
      const minH = toNumber(labeled("minHeight"));
      if (minW !== undefined) mod.minWidth = minW;
      if (minH !== undefined) mod.minHeight = minH;
      const maxW = toLength(labeled("maxWidth"));
      const maxH = toLength(labeled("maxHeight"));
      if (maxW !== undefined) mod.maxWidth = maxW;
      if (maxH !== undefined) mod.maxHeight = maxH;
      const al = labeled("alignment");
      if (al !== undefined) mod.alignment = symName(al, "center");
      return push(mod);
    }
    case "font": {
      const f = toFont(first);
      return f ? push({ m: "font", font: f }) : nodes;
    }
    case "bold":
      return first === false ? nodes : push({ m: "bold" });
    case "italic":
      return first === false ? nodes : push({ m: "italic" });
    case "fontWeight": {
      const w = symName(first, "regular") as Weight;
      return WEIGHTS.has(w) ? push({ m: "fontWeight", weight: w }) : nodes;
    }
    case "fontDesign":
      return push({ m: "fontDesign", design: symName(first, "default") as NonNullable<FontSpec["design"]> });
    case "monospaced":
      return push({ m: "monospaced" });
    case "underline":
      return first === false ? nodes : push({ m: "underline" });
    case "strikethrough":
      return first === false ? nodes : push({ m: "strikethrough" });
    case "textCase": {
      const v = symName(first, "");
      return v === "uppercase" || v === "lowercase" ? push({ m: "textCase", value: v }) : nodes;
    }
    case "lineSpacing":
      return push({ m: "lineSpacing", value: num(first ?? 0) });
    case "foregroundStyle":
    case "foregroundColor": {
      const by = plot(labeled("by"));
      if (by) return setProp(nodes, "Mark", "series", String(by.v));
      const c = toColor(first, ctx.scheme);
      return c ? push({ m: "foreground", color: c }) : nodes;
    }
    case "tint":
    case "accentColor": {
      const c = toColor(first, ctx.scheme);
      return c ? push({ m: "tint", color: c }) : nodes;
    }
    case "background":
    case "backgroundStyle": {
      if (trailing[0] !== undefined) return push({ m: "background", view: ctx.build(trailing[0]) });
      if (first === undefined) return push({ m: "background", color: { name: "systemBackground" } });
      if (isT(first, "sym") && MATERIALS.has(first.name)) return push({ m: "background", material: first.name.replace(/Material$/, ""), shape: toShape(labeled("in")) ?? undefined });
      const color = toColor(first, ctx.scheme);
      const shape = toShape(labeled("in"));
      if (color) return push({ m: "background", color, shape: shape ?? undefined });
      const v = nodesOf(first);
      if (v) return push({ m: "background", view: v });
      return nodes;
    }
    case "overlay": {
      const al = labeled("alignment");
      const tinted = trailing[0] === undefined && !nodesOf(first ?? null) ? toColor(first, ctx.scheme) : null;
      const v = trailing[0] !== undefined ? ctx.build(trailing[0]) : tinted ? [node("Color", { color: tinted })] : (nodesOf(first ?? null) ?? []);
      if (!v.length) return nodes;
      return push({ m: "overlay", view: v, alignment: al === undefined ? undefined : symName(al, "center") });
    }
    case "clipShape":
    case "containerShape": {
      const s = toShape(first);
      return s ? push({ m: "clip", shape: s }) : nodes;
    }
    case "cornerRadius":
      return push({ m: "cornerRadius", radius: num(first ?? 0) });
    case "border": {
      const c = toColor(first, ctx.scheme) ?? { name: "primary" };
      return push({ m: "border", color: c, width: num(labeled("width") ?? 1) });
    }
    case "shadow": {
      const c = toColor(labeled("color"), ctx.scheme);
      return push({
        m: "shadow",
        radius: num(labeled("radius") ?? 0),
        x: num(labeled("x") ?? 0),
        y: num(labeled("y") ?? 0),
        ...(c ? { color: c } : {}),
      });
    }
    case "opacity":
      return push({ m: "opacity", value: num(first ?? 1) });
    case "animation": {
      const curve = animCurve(first);
      if (!curve) return nodes;
      const value = labeled("value");
      return push({ m: "animation", curve, value: value === undefined ? undefined : describe(value) });
    }
    case "transition": {
      if (!isT(first ?? null, "sym")) return push({ m: "transition", kind: "opacity" });
      const t = first as Extract<V, { t: "sym" }>;
      const edge = arg(t.args ?? [], "edge") ?? arg(t.args ?? [], "from");
      return push({ m: "transition", kind: t.name, edge: isT(edge ?? null, "sym") ? (edge as { name: string }).name : undefined });
    }
    case "offset": {
      if (isT(first ?? null, "tuple")) {
        const t = first as Extract<V, { t: "tuple" }>;
        return push({ m: "offset", x: num(t.items[t.labels.indexOf("width")] ?? 0), y: num(t.items[t.labels.indexOf("height")] ?? 0) });
      }
      return push({ m: "offset", x: num(labeled("x") ?? 0), y: num(labeled("y") ?? 0) });
    }
    case "rotationEffect":
    case "rotation3DEffect": {
      let degrees = 0;
      if (isT(first ?? null, "sym")) {
        const s = first as Extract<V, { t: "sym" }>;
        const a = num(s.args?.[0]?.value ?? 0);
        degrees = s.name === "radians" ? (a * 180) / Math.PI : a;
      } else if (isNum(first ?? null)) degrees = num(first ?? 0);
      return push({ m: "rotation", degrees });
    }
    case "scaleEffect":
      return push({ m: "scale", value: num(first ?? labeled("x") ?? 1) });
    case "multilineTextAlignment": {
      const v = symName(first, "leading") as "leading" | "center" | "trailing";
      return push({ m: "align", value: v });
    }
    case "lineLimit": {
      if (first === null) return nodes;
      if (first !== undefined && isT(first, "range")) return push({ m: "lineLimit", value: first.closed ? first.hi : first.hi - 1 });
      return isNum(first ?? null) ? push({ m: "lineLimit", value: num(first ?? 1) }) : nodes;
    }
    case "buttonStyle": {
      const v = symName(first, "automatic");
      return push({ m: "buttonStyle", value: BUTTON_STYLES.has(v) ? v : "automatic" });
    }
    case "controlSize":
      return push({ m: "controlSize", value: symName(first, "regular") });
    case "navigationTitle":
      return push({ m: "navTitle", title: text(first ?? "") });
    case "navigationBarTitleDisplayMode":
      return nodes.map((n) => ({
        ...n,
        mods: (n.mods ?? []).map((m) => (m.m === "navTitle" ? { ...m, mode: symName(first, "automatic") } : m)),
      }));
    case "ignoresSafeArea":
    case "edgesIgnoringSafeArea":
      return push({ m: "ignoresSafeArea" });
    case "preferredColorScheme": {
      const v = symName(first, "");
      return v === "dark" || v === "light" ? push({ m: "scheme", value: v }) : nodes;
    }
    case "fill": {
      const c = toColor(first, ctx.scheme) ?? { name: "primary" };
      return push({ m: "fill", color: c });
    }
    case "stroke":
    case "strokeBorder": {
      const c = toColor(first, ctx.scheme) ?? { name: "primary" };
      const style = labeled("style") ?? (first !== undefined && first !== null && isT(first, "tuple") ? first : undefined);
      const part = (label: string) => (style !== undefined && style !== null && isT(style, "tuple") && style.labels.includes(label) ? style.items[style.labels.indexOf(label)] : undefined);
      const cap = part("lineCap");
      const dash = part("dash");
      return push({
        m: "stroke",
        color: c,
        width: num(labeled("lineWidth") ?? part("lineWidth") ?? 1),
        ...(cap !== undefined && cap !== null && isT(cap, "sym") ? { cap: cap.name } : {}),
        ...(Array.isArray(dash) && dash.length ? { dash: dash.map((d) => num(d)) } : {}),
        ...(name === "strokeBorder" ? { inset: true } : {}),
      });
    }
    case "trim":
      return push({ m: "trim", from: num(labeled("from") ?? 0), to: num(labeled("to") ?? 1) });
    case "resizable":
      return push({ m: "resizable" });
    case "scaledToFit":
      return push({ m: "aspect", mode: "fit" });
    case "scaledToFill":
      return push({ m: "aspect", mode: "fill" });
    case "aspectRatio": {
      const mode = symName(labeled("contentMode"), "fit") === "fill" ? "fill" : "fit";
      const ratio = toNumber(first);
      return push({ m: "aspect", mode, ...(ratio !== undefined ? { ratio } : {}) });
    }
    case "imageScale": {
      const v = symName(first, "medium") as "small" | "medium" | "large";
      return push({ m: "imageScale", value: v });
    }
    case "disabled":
      return first === false ? nodes : push({ m: "disabled" });
    case "hidden":
      return push({ m: "hidden" });
    case "tag": {
      const value = jsonOf(first ?? null);
      return nodes.map((n) => {
        const out = { ...n, mods: [...(n.mods ?? []), { m: "tag" as const, value: value ?? "" }] };
        Object.defineProperty(out, "__tag", { value: first ?? null, enumerable: false });
        return out;
      });
    }
    case "tabItem":
      return push({ m: "tabItem", label: ctx.build(trailing[0] ?? first) });
    case "listStyle":
      return push({ m: "listStyle", value: symName(first, "automatic") });
    case "scrollContentBackground":
      return push({ m: "scrollBg", hidden: symName(first, "automatic") === "hidden" });
    case "listRowSeparator":
      return push({ m: "rowSep", hidden: symName(first, "automatic") === "hidden" });
    case "listRowBackground": {
      if (first === undefined || first === null) return nodes;
      const color = toColor(first, ctx.scheme);
      if (color) return push({ m: "rowBg", color });
      const v = nodesOf(first);
      return v ? push({ m: "rowBg", view: v }) : nodes;
    }
    case "listRowInsets": {
      if (!isT(first ?? null, "tuple")) return nodes;
      const t = first as Extract<V, { t: "tuple" }>;
      const get = (l: string) => num(t.items[t.labels.indexOf(l)] ?? 0);
      return push({ m: "rowInsets", top: get("top"), leading: get("leading"), bottom: get("bottom"), trailing: get("trailing") });
    }
    case "pickerStyle":
      return push({ m: "pickerStyle", value: symName(first, "automatic") });
    case "textFieldStyle":
      return push({ m: "textFieldStyle", value: symName(first, "automatic") });
    case "onTapGesture": {
      const fn = trailing[0] ?? labeled("perform");
      if (fn === undefined) return nodes;
      return nodes.map((n) => {
        const mod = attach({ m: "onTap" as const, event: "" }, { kind: "tap", run: () => void ctx.call(fn, []) });
        return { ...n, mods: [...(n.mods ?? []), mod] };
      });
    }
  }
  if (IGNORED.has(name) || SILENT.test(name)) return nodes;
  return null;
}
