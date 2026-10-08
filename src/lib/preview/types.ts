export type ColorSpec = { name: string; opacity?: number } | { rgba: [number, number, number, number]; dark?: [number, number, number, number] };

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
  | { m: "stroke"; color: ColorSpec; width: number }
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
  | { m: "transition"; kind: string; edge?: string };

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

export interface PreviewTarget {
  key: string;
  label: string;
}
