export interface GradientSpec {
  kind: "linear" | "radial" | "angular";
  stops: { color: ColorSpec; at?: number }[];
  from?: [number, number];
  to?: [number, number];
  center?: [number, number];
  r0?: number;
  r1?: number;
  a0?: number;
  a1?: number;
}

export type ColorSpec = ({ name: string; opacity?: number } | { rgba: [number, number, number, number]; dark?: [number, number, number, number] }) & { gradient?: GradientSpec };

export interface AnimCurve {
  kind: string;
  duration?: number;
  bounce?: number;
}

export type TextStyle =
  | "largeTitle"
  | "title"
  | "title2"
  | "title3"
  | "headline"
  | "subheadline"
  | "body"
  | "callout"
  | "footnote"
  | "caption"
  | "caption2";

export type Weight = "ultraLight" | "thin" | "light" | "regular" | "medium" | "semibold" | "bold" | "heavy" | "black";

export interface FontSpec {
  style?: TextStyle;
  size?: number;
  weight?: Weight;
  design?: "default" | "rounded" | "monospaced" | "serif";
  italic?: boolean;
  custom?: string;
}

export type ShapeSpec =
  | { shape: "rect" }
  | { shape: "roundedRect"; radius: number }
  | { shape: "circle" }
  | { shape: "capsule" }
  | { shape: "ellipse" };

export type Length = number | "inf";

export type Mod =
  | { m: "padding"; top: number; leading: number; bottom: number; trailing: number }
  | {
      m: "frame";
      width?: number;
      height?: number;
      minWidth?: number;
      maxWidth?: Length;
      minHeight?: number;
      maxHeight?: Length;
      alignment?: string;
    }
  | { m: "font"; font: FontSpec }
  | { m: "bold" }
  | { m: "italic" }
  | { m: "fontWeight"; weight: Weight }
  | { m: "fontDesign"; design: NonNullable<FontSpec["design"]> }
  | { m: "monospaced" }
  | { m: "underline" }
  | { m: "strikethrough" }
  | { m: "textCase"; value: "uppercase" | "lowercase" }
  | { m: "lineSpacing"; value: number }
  | { m: "foreground"; color: ColorSpec }
  | { m: "tint"; color: ColorSpec }
  | { m: "background"; color?: ColorSpec; shape?: ShapeSpec; view?: ViewNode[]; material?: string }
  | { m: "overlay"; view: ViewNode[]; alignment?: string }
  | { m: "clip"; shape: ShapeSpec }
  | { m: "cornerRadius"; radius: number }
  | { m: "border"; color: ColorSpec; width: number }
  | { m: "shadow"; radius: number; x: number; y: number; color?: ColorSpec }
  | { m: "opacity"; value: number }
  | { m: "offset"; x: number; y: number }
  | { m: "rotation"; degrees: number }
  | { m: "scale"; value: number }
  | { m: "align"; value: "leading" | "center" | "trailing" }
  | { m: "lineLimit"; value: number }
  | { m: "buttonStyle"; value: string }
  | { m: "controlSize"; value: string }
  | { m: "navTitle"; title: string; mode?: string }
  | { m: "ignoresSafeArea" }
  | { m: "scheme"; value: "light" | "dark" }
  | { m: "fill"; color: ColorSpec }
  | { m: "stroke"; color: ColorSpec; width: number; cap?: string; dash?: number[]; inset?: boolean }
  | { m: "trim"; from: number; to: number }
  | { m: "resizable" }
  | { m: "aspect"; mode: "fit" | "fill"; ratio?: number }
  | { m: "imageScale"; value: "small" | "medium" | "large" }
  | { m: "disabled" }
  | { m: "hidden" }
  | { m: "tag"; value: string | number | boolean }
  | { m: "tabItem"; label: ViewNode[] }
  | { m: "listStyle"; value: string }
  | { m: "pickerStyle"; value: string }
  | { m: "textFieldStyle"; value: string }
  | { m: "onTap"; event: string }
  | { m: "animation"; curve: AnimCurve; value?: string }
  | { m: "transition"; kind: string; edge?: string }
  | { m: "toolbar"; items: { placement: string; view: ViewNode[] }[] }
  | { m: "inset"; edge: "top" | "bottom" | "leading" | "trailing"; view: ViewNode[] }
  | { m: "accessory"; view: ViewNode[] }
  | { m: "mask"; view: ViewNode[] }
  | { m: "glass"; shape?: ShapeSpec; tint?: ColorSpec; clear?: boolean; interactive?: boolean }
  | { m: "effect"; kind: "blur" | "brightness" | "contrast" | "saturation" | "grayscale" | "hueRotation" | "colorInvert"; value: number }
  | { m: "position"; x: number; y: number }
  | { m: "gridSpan"; value: number }
  | { m: "lineStyle"; width: number; dash?: number[] }
  | { m: "badge"; text: string }
  | { m: "search"; prompt: string }
  | { m: "scrollBg"; hidden: boolean }
  | { m: "rowBg"; color?: ColorSpec; view?: ViewNode[] }
  | { m: "rowSep"; hidden: boolean }
  | { m: "rowInsets"; top: number; leading: number; bottom: number; trailing: number };

export function modViews(m: Mod): [string, ViewNode[]][] {
  switch (m.m) {
    case "background":
      return m.view ? [["b", m.view]] : [];
    case "rowBg":
      return m.view ? [["r", m.view]] : [];
    case "overlay":
      return [["v", m.view]];
    case "tabItem":
      return [["t", m.label]];
    case "toolbar":
      return m.items.map((item, k) => [`i${k}x`, item.view] as [string, ViewNode[]]);
    case "inset":
      return [["s", m.view]];
    case "accessory":
      return [["a", m.view]];
    case "mask":
      return [["k", m.view]];
    default:
      return [];
  }
}

export function mapModViews(m: Mod, fn: (n: ViewNode) => ViewNode): Mod {
  switch (m.m) {
    case "background":
    case "rowBg":
      return m.view ? { ...m, view: m.view.map(fn) } : m;
    case "overlay":
    case "inset":
    case "accessory":
    case "mask":
      return { ...m, view: m.view.map(fn) };
    case "tabItem":
      return { ...m, label: m.label.map(fn) };
    case "toolbar":
      return { ...m, items: m.items.map((item) => ({ ...item, view: item.view.map(fn) })) };
    default:
      return m;
  }
}

export interface SrcRange {
  f: string;
  a: number;
  b: number;
}

export interface ViewNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: ViewNode[];
  label?: ViewNode[];
  mods?: Mod[];
  event?: string;
  src?: SrcRange[];
}

export interface PreviewEvent {
  id: string;
  kind: "tap" | "set" | "increment" | "decrement";
  value?: unknown;
}

export interface Diagnostic {
  message: string;
  line: number;
  column: number;
}

export interface Issue {
  kind: "error" | "unsupported" | "skipped";
  message: string;
  file?: string;
  line: number;
  column: number;
}

export interface PreviewTarget {
  key: string;
  label: string;
}
