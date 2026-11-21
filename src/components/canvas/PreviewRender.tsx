import { Fragment, memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { cssColor, cssPaint } from "../../lib/preview/colors";
import { sfSymbol } from "../../lib/preview/sf";
import type { AnimCurve, ColorSpec, FontSpec, Mod, PreviewEvent, ShapeSpec, TextStyle, ViewNode, Weight } from "../../lib/preview/types";
import { CanvasView, ChartView, CircleView, GaugeView, GlassDisc, LARGE_PLACEHOLDERS, Measured, PathView, Placeholder } from "./PreviewExtras";

export interface RenderEnv {
  dark: boolean;
  tint: string;
  buttonStyle: string;
  controlSize: string;
  listStyle: string;
  listBg?: boolean;
  pickerStyle: string;
  textFieldStyle: string;
  disabled: boolean;
  inList: boolean;
  lineLimit?: number;
  assets: Record<string, { url: string; scale: number; png?: string }>;
  entering?: Set<string>;
  dispatch: (ev: PreviewEvent) => void;
  push?: (nodes: ViewNode[], title: string) => void;
  measure?: (key: string, width: number, height: number) => void;
}

const STYLES: Record<TextStyle, [number, number, number]> = {
  largeTitle: [34, 41, 400],
  title: [28, 34, 400],
  title2: [22, 28, 400],
  title3: [20, 25, 400],
  headline: [17, 22, 600],
  subheadline: [15, 20, 400],
  body: [17, 22, 400],
  callout: [16, 21, 400],
  footnote: [13, 18, 400],
  caption: [12, 16, 400],
  caption2: [11, 13, 400],
};

const WEIGHTS: Record<Weight, number> = {
  ultraLight: 100,
  thin: 200,
  light: 300,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  heavy: 800,
  black: 900,
};

const ALIGN: Record<string, string> = { leading: "flex-start", top: "flex-start", center: "center", trailing: "flex-end", bottom: "flex-end" };

function fontCss(f: FontSpec): CSSProperties {
  const out: CSSProperties = {};
  if (f.style) {
    const [size, line, weight] = STYLES[f.style];
    out.fontSize = `calc(${size}px * var(--pv-type, 1))`;
    out.lineHeight = `calc(${line}px * var(--pv-type, 1))`;
    out.fontWeight = weight;
  }
  if (f.size !== undefined) {
    out.fontSize = f.size;
    out.lineHeight = 1.2;
  }
  if (f.weight) out.fontWeight = WEIGHTS[f.weight];
  if (f.italic) out.fontStyle = "italic";
  if (f.design === "monospaced") out.fontFamily = "var(--pv-mono)";
  if (f.design === "serif") out.fontFamily = "Georgia, 'Times New Roman', serif";
  if (f.design === "rounded") out.fontFamily = "var(--pv-rounded)";
  if (f.custom) out.fontFamily = `"${f.custom.replace(/"/g, "")}", var(--pv-font)`;
  return out;
}

export function curveCss(c: AnimCurve): { duration: number; easing: string } {
  const springy = ["spring", "interactiveSpring", "interpolatingSpring", "bouncy", "snappy", "smooth", "default"].includes(c.kind);
  const duration = c.duration ?? (springy ? 0.5 : 0.35);
  const easing =
    c.kind === "linear"
      ? "linear"
      : c.kind === "easeIn"
        ? "cubic-bezier(0.42, 0, 1, 1)"
        : c.kind === "easeOut"
          ? "cubic-bezier(0, 0, 0.58, 1)"
          : c.kind === "easeInOut"
            ? "cubic-bezier(0.42, 0, 0.58, 1)"
            : c.kind === "bouncy" || (c.bounce ?? 0) > 0.15
              ? "cubic-bezier(0.34, 1.45, 0.64, 1)"
              : "cubic-bezier(0.2, 0.8, 0.2, 1)";
  return { duration, easing };
}

const color = (c: ColorSpec | undefined, env: RenderEnv) => cssColor(c, env.dark, "blue");
const paint = (c: ColorSpec | undefined, env: RenderEnv) => cssPaint(c, env.dark, "blue");

interface Expand {
  x: boolean;
  y: boolean;
  cx?: boolean;
  cy?: boolean;
}

function edgeMasks(mods: Mod[], steps: Expand[], edge: number): number[] {
  const out = new Array<number>(mods.length + 1).fill(0);
  out[mods.length] = edge;
  for (let i = mods.length - 1; i >= 0 && out[i + 1]; i--) {
    let mask = out[i + 1];
    const mod = mods[i];
    switch (mod.m) {
      case "padding":
        if (mod.top > 0) mask &= ~1;
        if (mod.bottom > 0) mask &= ~2;
        break;
      case "frame":
        if (!steps[i].y) {
          const a = mod.alignment ?? "center";
          mask &= (/^top|Top/.test(a) ? 1 : 0) | (/^bottom|Bottom/.test(a) ? 2 : 0);
        }
        break;
      case "inset":
        if (mod.edge === "top") mask &= ~1;
        else if (mod.edge === "bottom") mask &= ~2;
        break;
      case "ignoresSafeArea":
      case "offset":
      case "position":
      case "scale":
      case "rotation":
      case "aspect":
      case "clip":
      case "cornerRadius":
      case "glass":
        mask = 0;
        break;
    }
    out[i] = mask;
  }
  return out;
}

type FrameMod = Extract<Mod, { m: "frame" }>;

function aspectBox(n: ViewNode, at: number, ex: Expand): CSSProperties | null {
  const m = n.mods?.[at];
  if (!m || m.m !== "aspect" || m.ratio === undefined || !(m.ratio > 0) || n.type === "Image" || !ex.x || !ex.y) return null;
  const next = n.mods?.slice(at + 1).find((x): x is FrameMod => x.m === "frame");
  const w = next?.width;
  const h = next?.height;
  if (w !== undefined && h !== undefined) {
    const fit = m.mode === "fill" ? Math.max(w, h * m.ratio) : Math.min(w, h * m.ratio);
    return { width: fit, height: fit / m.ratio, flex: "0 0 auto" };
  }
  if (h !== undefined) return { width: h * m.ratio, height: h, flex: "0 0 auto" };
  if (w !== undefined) return { width: w, height: w / m.ratio, flex: "0 0 auto" };
  return { aspectRatio: String(m.ratio), alignSelf: "stretch", flex: "0 0 auto" };
}

function afterMod(n: ViewNode, at: number, ex: Expand): Expand {
  const m = n.mods?.[at];
  if (!m) return ex;
  if (m.m === "frame") {
    let out = ex;
    if (m.width !== undefined) out = { ...out, x: false, cx: false };
    else if (m.maxWidth === "inf") out = { ...out, x: true, cx: false };
    else if (typeof m.maxWidth === "number") out = { ...out, x: true, cx: true };
    if (m.height !== undefined) out = { ...out, y: false, cy: false };
    else if (m.maxHeight === "inf") out = { ...out, y: true, cy: false };
    else if (typeof m.maxHeight === "number") out = { ...out, y: true, cy: true };
    return out;
  }
  if (m.m === "aspect") {
    const box = aspectBox(n, at, ex);
    if (box) return { x: box.width === undefined, y: false };
  }
  return ex;
}

export function expands(n: ViewNode): Expand {
  let ex = intrinsic(n);
  const count = n.mods?.length ?? 0;
  for (let i = 0; i < count; i++) ex = afterMod(n, i, ex);
  return ex;
}

function intrinsic(n: ViewNode): Expand {
  let base: Expand;
  switch (n.type) {
    case "ScrollView":
      base = { x: true, y: n.props.axis !== "horizontal" };
      break;
    case "Button":
    case "NavigationLink": {
      const kids = (n.label ?? []).map(expands);
      base = { x: kids.some((k) => k.x && !k.cx), y: kids.some((k) => k.y && !k.cy) };
      break;
    }
    case "Color":
    case "Rectangle":
    case "RoundedRectangle":
    case "Capsule":
    case "Ellipse":
    case "Circle":
    case "List":
    case "Form":
    case "NavigationStack":
    case "TabView":
    case "SplitView":
    case "Chart":
    case "Canvas":
    case "Path":
      base = { x: true, y: true };
      break;
    case "Gauge":
      base = { x: !/^(accessoryCircular|circular)/.test(String(n.props.style ?? "")), y: false };
      break;
    case "Unsupported":
      base = LARGE_PLACEHOLDERS.has(String(n.props.kind ?? "")) && !n.props.error ? { x: true, y: true } : { x: false, y: false };
      break;
    case "TextField":
    case "SecureField":
    case "Slider":
    case "Toggle":
    case "ProgressView":
    case "Stepper":
      base = { x: true, y: false };
      break;
    case "Picker":
      base = { x: n.mods?.some((m) => m.m === "pickerStyle" && m.value === "segmented") ?? false, y: false };
      break;
    case "Divider":
      base = { x: true, y: false };
      break;
    case "VStack":
    case "LazyVStack":
    case "HStack":
    case "LazyHStack":
    case "ZStack":
    case "Group":
    case "LazyVGrid":
    case "Section": {
      const kids = (n.children ?? []).map(expands);
      const spacerY = (n.type === "VStack" || n.type === "LazyVStack") && (n.children ?? []).some((c) => c.type === "Spacer");
      const spacerX = (n.type === "HStack" || n.type === "LazyHStack") && (n.children ?? []).some((c) => c.type === "Spacer");
      base = n.props.geometry ? { x: true, y: true } : { x: spacerX || kids.some((k) => k.x && !k.cx) || n.type === "LazyVGrid", y: spacerY || kids.some((k) => k.y && !k.cy) };
      break;
    }
    default:
      base = { x: false, y: false };
  }
  if (n.mods?.some((m) => m.m === "aspect") && n.mods.some((m) => m.m === "resizable")) base = { x: true, y: true };
  return base;
}

function shapeRadius(s: ShapeSpec | undefined): string | number | undefined {
  if (!s) return undefined;
  switch (s.shape) {
    case "roundedRect":
      return s.radius;
    case "capsule":
      return 9999;
    case "circle":
    case "ellipse":
      return "50%";
    default:
      return 0;
  }
}

function envAfter(env: RenderEnv, mods: Mod[] | undefined): RenderEnv {
  let out = env;
  for (const m of mods ?? []) {
    switch (m.m) {
      case "tint":
        out = { ...out, tint: color(m.color, out) ?? out.tint };
        break;
      case "buttonStyle":
        out = { ...out, buttonStyle: m.value };
        break;
      case "controlSize":
        out = { ...out, controlSize: m.value };
        break;
      case "listStyle":
        out = { ...out, listStyle: m.value };
        break;
      case "scrollBg":
        out = { ...out, listBg: !m.hidden };
        break;
      case "pickerStyle":
        out = { ...out, pickerStyle: m.value };
        break;
      case "textFieldStyle":
        out = { ...out, textFieldStyle: m.value };
        break;
      case "disabled":
        out = { ...out, disabled: true };
        break;
      case "lineLimit":
        out = { ...out, lineLimit: m.value };
        break;
      case "scheme":
        out = { ...out, dark: m.value === "dark" };
        break;
    }
  }
  return out;
}

function inheritedCss(mods: Mod[] | undefined, env: RenderEnv): CSSProperties {
  let css: CSSProperties = {};
  for (const m of mods ?? []) {
    switch (m.m) {
      case "font":
        css = { ...css, ...fontCss(m.font) };
        break;
      case "bold":
        css.fontWeight = 700;
        break;
      case "italic":
        css.fontStyle = "italic";
        break;
      case "fontWeight":
        css.fontWeight = WEIGHTS[m.weight];
        break;
      case "fontDesign":
        css = { ...css, ...fontCss({ design: m.design }) };
        break;
      case "monospaced":
        css.fontFamily = "var(--pv-mono)";
        break;
      case "underline":
        css.textDecoration = "underline";
        break;
      case "strikethrough":
        css.textDecoration = "line-through";
        break;
      case "textCase":
        css.textTransform = m.value;
        break;
      case "lineSpacing":
        css.lineHeight = `calc(1.29em + ${m.value}px)`;
        break;
      case "foreground":
        css.color = color(m.color, env);
        break;
      case "align":
        css.textAlign = m.value === "leading" ? "left" : m.value === "trailing" ? "right" : "center";
        break;
      case "scheme":
        css.color = m.value === "dark" ? "#fff" : "#000";
        break;
    }
  }
  return css;
}

const WRAPPERS = new Set(["padding", "frame", "background", "overlay", "clip", "cornerRadius", "border", "shadow", "opacity", "offset", "rotation", "scale", "hidden", "onTap", "ignoresSafeArea", "inset", "glass", "effect", "position", "badge", "aspect"]);

const EFFECTS: Record<Extract<Mod, { m: "effect" }>["kind"], (v: number) => string> = {
  blur: (v) => `blur(${v}px)`,
  brightness: (v) => `brightness(${1 + v})`,
  contrast: (v) => `contrast(${v})`,
  saturation: (v) => `saturate(${v})`,
  grayscale: (v) => `grayscale(${v})`,
  hueRotation: (v) => `hue-rotate(${v}deg)`,
  colorInvert: () => "invert(1)",
};

export const Node = memo(function PreviewNode({ node, env, axis, edge = 0 }: { node: ViewNode; env: RenderEnv; axis: "x" | "y" | "z" | "none"; edge?: number }) {
  const inner = useMemo(() => envAfter(env, node.mods), [env, node.mods]);
  const grouped = useMemo(() => {
    if (node.type !== "Group") return null;
    const extra = node.mods ?? [];
    return (node.children ?? []).map((c) => (extra.length ? { ...c, mods: [...(c.mods ?? []), ...extra] } : c));
  }, [node]);
  if (grouped) {
    if (!grouped.length) return null;
    return (
      <>
        {grouped.map((c, i) => (
          <Node key={c.id} node={c} env={env} axis={axis} edge={axis === "y" ? (i === 0 ? edge & 1 : 0) | (i === grouped.length - 1 ? edge & 2 : 0) : edge} />
        ))}
      </>
    );
  }
  const mods = node.mods ?? [];
  const steps: Expand[] = [intrinsic(node)];
  for (let i = 0; i < mods.length; i++) steps.push(afterMod(node, i, steps[i]));
  const masks = edgeMasks(mods, steps, edge);
  let ex = steps[0];
  let el: ReactNode = <Base node={node} env={inner} ex={ex} edge={masks[0]} />;
  const inherited = inheritedCss(node.mods, inner);
  if (Object.keys(inherited).length) el = <div style={{ display: "contents", ...inherited }}>{el}</div>;
  let wrapped = false;
  let rigid = false;
  let capX: number | undefined;
  let capY: number | undefined;
  for (let i = 0; i < mods.length; i++) {
    const m = mods[i];
    if (m.m === "frame") {
      if (m.width !== undefined || m.maxWidth === "inf") capX = undefined;
      else if (typeof m.maxWidth === "number") capX = m.maxWidth;
      if (m.height !== undefined || m.maxHeight === "inf") capY = undefined;
      else if (typeof m.maxHeight === "number") capY = m.maxHeight;
    } else if (m.m === "padding") {
      if (capX !== undefined) capX += m.leading + m.trailing;
      if (capY !== undefined) capY += m.top + m.bottom;
    }
    const box = m.m === "aspect" ? aspectBox(node, i, ex) : null;
    if (WRAPPERS.has(m.m) && (m.m !== "aspect" || box)) {
      wrapped = true;
      el = (
        <Wrap mod={m} env={inner} ex={ex} box={box} edge={masks[i + 1]}>
          {el}
        </Wrap>
      );
    }
    if (m.m === "frame") rigid = m.width !== undefined ? true : m.maxWidth === "inf" ? false : rigid;
    if (box) rigid = box.width !== undefined;
    ex = steps[i + 1];
  }
  if (wrapped && env.inList && !ex.x) el = <div className="pv-lead">{el}</div>;
  const outer: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, boxSizing: "border-box" };
  if (axis === "y") {
    if (ex.y) outer.flex = node.type === "Spacer" ? "1 1 0" : "1 1 auto";
    else outer.flex = "0 0 auto";
    if (ex.x) outer.alignSelf = "stretch";
  } else if (axis === "x") {
    if (ex.x) outer.flex = node.type === "Spacer" ? "1 1 0" : "1 1 auto";
    else outer.flex = rigid ? "0 0 auto" : "0 1 auto";
    if (ex.y) outer.alignSelf = "stretch";
  } else if (axis === "z") {
    if (ex.x) outer.justifySelf = "stretch";
    if (ex.y) outer.alignSelf = "stretch";
  }
  if (capX !== undefined && ex.x) {
    if (axis === "x") outer.flex = `0 1 ${capX}px`;
    else {
      outer.width = capX;
      outer.maxWidth = "100%";
      if (axis === "y") outer.alignSelf = undefined;
      else outer.justifySelf = undefined;
    }
  }
  if (capY !== undefined && ex.y) {
    if (axis === "y") outer.flex = `0 1 ${capY}px`;
    else {
      outer.height = capY;
      outer.maxHeight = "100%";
      outer.alignSelf = undefined;
    }
  }
  if (node.type === "Spacer") {
    const min = Number(node.props.minLength ?? 8);
    if (axis === "y") outer.minHeight = min;
    if (axis === "x") outer.minWidth = min;
    if (axis === "x" || axis === "y") outer.flex = "1 1 0";
  }
  const span = node.mods?.find((m) => m.m === "gridSpan") as Extract<Mod, { m: "gridSpan" }> | undefined;
  if (span) outer.gridColumn = `span ${span.value}`;
  const animation = node.mods?.find((m) => m.m === "animation") as Extract<Mod, { m: "animation" }> | undefined;
  if (animation) {
    const { duration, easing } = curveCss(animation.curve);
    (outer as Record<string, string>)["--pv-anim-dur"] = `${duration}s`;
    (outer as Record<string, string>)["--pv-anim-ease"] = easing;
  }
  let enter = "";
  if (env.entering?.has(node.id)) {
    const tr = node.mods?.find((m) => m.m === "transition") as Extract<Mod, { m: "transition" }> | undefined;
    const kind = tr ? tr.kind : "opacity";
    enter = ` pv-enter pv-enter-${kind}${tr?.edge ? `-${tr.edge}` : ""}`;
  }
  return (
    <div className={`pv-n pv-${node.type}${enter}${animation ? " pv-anim" : ""}`} data-pv={node.id} style={outer}>
      {el}
    </div>
  );
});

function Wrap({ mod, env, ex, box, edge, children }: { mod: Mod; env: RenderEnv; ex: Expand; box: CSSProperties | null; edge: number; children: ReactNode }) {
  const plain: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxSizing: "border-box", position: "relative", minWidth: 0, minHeight: 0 };
  const base: CSSProperties = { ...plain };
  if (ex.x) base.alignSelf = "stretch";
  if (ex.y) base.flex = "1 1 auto";
  switch (mod.m) {
    case "padding":
      return <div style={{ ...base, padding: `${mod.top}px ${mod.trailing}px ${mod.bottom}px ${mod.leading}px` }}>{children}</div>;
    case "aspect":
      return <div style={{ ...plain, ...box }}>{children}</div>;
    case "frame": {
      const s: CSSProperties = { ...plain };
      if (mod.width !== undefined) s.width = mod.width;
      else if (mod.maxWidth === "inf") s.alignSelf = "stretch";
      else if (typeof mod.maxWidth === "number") {
        s.maxWidth = mod.maxWidth;
        s.width = "100%";
      } else if (ex.x) s.alignSelf = "stretch";
      if (mod.height !== undefined) {
        s.height = mod.height;
        s.flexShrink = 0;
      } else if (mod.maxHeight === "inf") s.flex = "1 1 auto";
      else if (typeof mod.maxHeight === "number") {
        s.maxHeight = mod.maxHeight;
        s.flex = "1 1 auto";
      } else if (ex.y) s.flex = "1 1 auto";
      if (mod.minWidth !== undefined) s.minWidth = mod.minWidth;
      if (mod.minHeight !== undefined) s.minHeight = mod.minHeight;
      const a = mod.alignment ?? "center";
      s.alignItems = /leading|Leading/.test(a) ? "flex-start" : /trailing|Trailing/.test(a) ? "flex-end" : "center";
      s.justifyContent = /^top|Top/.test(a) ? "flex-start" : /^bottom|Bottom/.test(a) ? "flex-end" : "center";
      return <div style={s}>{children}</div>;
    }
    case "background": {
      const radius = shapeRadius(mod.shape);
      if (mod.view) {
        return (
          <div style={{ ...base, isolation: "isolate" }}>
            <div className="pv-zstack pv-under" style={{ borderRadius: radius, overflow: radius !== undefined ? "hidden" : undefined }}>
              {mod.view.map((v) => (
                <Node key={v.id} node={v} env={env} axis="z" />
              ))}
            </div>
            {children}
          </div>
        );
      }
      const round = mod.shape?.shape === "circle";
      const bleed = mod.shape ? "" : `${edge & 1 ? " pv-fill-top" : ""}${edge & 2 ? " pv-fill-bottom" : ""}`;
      if (mod.material) {
        return (
          <div className={`pv-material${bleed}`} style={{ ...base, borderRadius: round ? undefined : radius, clipPath: round ? "circle(closest-side)" : undefined, background: env.dark ? "rgba(40,40,44,0.72)" : "rgba(246,246,248,0.72)", backdropFilter: "blur(20px) saturate(180%)" }}>
            {children}
          </div>
        );
      }
      if (round && mod.color?.gradient) return <div style={{ ...base, background: paint(mod.color, env), clipPath: "circle(closest-side)" }}>{children}</div>;
      if (round) return <div style={{ ...base, background: `radial-gradient(circle closest-side, ${color(mod.color, env) ?? "transparent"} calc(100% - 0.5px), transparent 100%)` }}>{children}</div>;
      return (
        <div className={bleed.trim() || undefined} style={{ ...base, background: paint(mod.color, env), borderRadius: radius }}>
          {children}
        </div>
      );
    }
    case "overlay": {
      const a = mod.alignment ?? "center";
      return (
        <div style={base}>
          {children}
          <div className="pv-zstack pv-over" style={{ justifyItems: /leading|Leading/.test(a) ? "start" : /trailing|Trailing/.test(a) ? "end" : "center", alignItems: /^top|Top/.test(a) ? "start" : /^bottom|Bottom/.test(a) ? "end" : "center" }}>
            {mod.view.map((v) => (
              <Node key={v.id} node={v} env={env} axis="z" />
            ))}
          </div>
        </div>
      );
    }
    case "clip":
      if (mod.shape.shape === "circle") return <div style={{ ...base, clipPath: "circle(closest-side)" }}>{children}</div>;
      return <div style={{ ...base, borderRadius: shapeRadius(mod.shape), overflow: "hidden" }}>{children}</div>;
    case "cornerRadius":
      return <div style={{ ...base, borderRadius: mod.radius, overflow: "hidden" }}>{children}</div>;
    case "border":
      return <div style={{ ...base, boxShadow: `inset 0 0 0 ${mod.width}px ${color(mod.color, env)}` }}>{children}</div>;
    case "shadow":
      return <div style={{ ...base, filter: `drop-shadow(${mod.x}px ${mod.y}px ${mod.radius}px ${color(mod.color ?? { rgba: [0, 0, 0, 0.33] }, env)})` }}>{children}</div>;
    case "opacity":
      return <div style={{ ...base, opacity: mod.value }}>{children}</div>;
    case "offset":
      return <div style={{ ...base, transform: `translate(${mod.x}px, ${mod.y}px)` }}>{children}</div>;
    case "rotation":
      return <div style={{ ...base, transform: `rotate(${mod.degrees}deg)` }}>{children}</div>;
    case "scale":
      return <div style={{ ...base, transform: `scale(${mod.value})` }}>{children}</div>;
    case "hidden":
      return <div style={{ ...base, visibility: "hidden" }}>{children}</div>;
    case "ignoresSafeArea":
      return <div className="pv-bleed" style={base}>{children}</div>;
    case "onTap":
      return (
        <div className="pv-tap" style={{ ...base, cursor: "pointer" }} onClick={(e) => (e.stopPropagation(), env.dispatch({ id: mod.event, kind: "tap" }))}>
          {children}
        </div>
      );
    case "glass": {
      const glass = `pv-glass${env.dark ? " dark" : ""}${mod.clear ? " clear" : ""}`;
      const tinted = color(mod.tint, env) ?? "transparent";
      if (mod.shape?.shape === "circle")
        return (
          <GlassDisc className={glass} style={base} tint={tinted}>
            {children}
          </GlassDisc>
        );
      return (
        <div className={glass} style={{ ...base, borderRadius: shapeRadius(mod.shape) ?? 9999, ["--pv-glass-tint" as string]: tinted } as CSSProperties}>
          {children}
        </div>
      );
    }
    case "effect":
      return <div style={{ ...base, filter: EFFECTS[mod.kind](mod.value) }}>{children}</div>;
    case "position":
      return <div style={{ position: "absolute", left: mod.x, top: mod.y, transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center" }}>{children}</div>;
    case "badge":
      return (
        <div style={base}>
          {children}
          <span className="pv-badge">{mod.text}</span>
        </div>
      );
    case "inset": {
      const vertical = mod.edge === "top" || mod.edge === "bottom";
      const before = mod.edge === "top" || mod.edge === "leading";
      const bar = (
        <div className="pv-inset" style={{ flexDirection: vertical ? "column" : "row" }}>
          {mod.view.map((v) => (
            <Node key={v.id} node={v} env={env} axis={vertical ? "y" : "x"} edge={mod.edge === "bottom" ? edge & 2 : mod.edge === "top" ? edge & 1 : 0} />
          ))}
        </div>
      );
      return (
        <div style={{ ...base, flexDirection: vertical ? "column" : "row", alignItems: "stretch", justifyContent: "flex-start" }}>
          {before && bar}
          <div style={{ flex: (vertical ? ex.y : ex.x) ? "1 1 auto" : "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 0, minWidth: 0 }}>{children}</div>
          {!before && bar}
        </div>
      );
    }
  }
  return <>{children}</>;
}

function Kids({ nodes, env, axis, edge = 0, spread, rest = 0 }: { nodes?: ViewNode[]; env: RenderEnv; axis: "x" | "y" | "z" | "none"; edge?: number; spread?: boolean; rest?: number }) {
  const list = nodes ?? [];
  const last = list.length - 1;
  return (
    <>
      {list.map((c, i) => (
        <Node key={c.id} node={c} env={env} axis={axis} edge={!edge ? 0 : spread ? (i === 0 ? edge & 1 : 0) | (i === last ? edge & 2 : 0) : expands(c).y ? edge : edge & rest} />
      ))}
    </>
  );
}

function Symbol({ name, mods, style }: { name: string; mods?: Mod[]; style?: CSSProperties }) {
  const { icon: Icon, fill } = sfSymbol(name);
  const scale = mods?.find((m) => m.m === "imageScale");
  const k = scale && scale.m === "imageScale" ? (scale.value === "small" ? 0.75 : scale.value === "large" ? 1.3 : 1) : 1;
  const resizable = mods?.some((m) => m.m === "resizable");
  const size = resizable ? "100%" : `${1.05 * k}em`;
  return <Icon className="pv-sym" width={size} height={size} strokeWidth={2.1} fill={fill ? "currentColor" : "none"} style={{ flex: "none", ...style }} />;
}

function textOf(nodes: ViewNode[] | undefined): string {
  return (nodes ?? []).map((n) => String(n.props.text ?? n.props.title ?? textOf(n.children) ?? "")).join(" ");
}

function Base({ node, env, ex, edge }: { node: ViewNode; env: RenderEnv; ex: Expand; edge: number }) {
  const p = node.props;
  switch (node.type) {
    case "Text": {
      const clamp = env.lineLimit;
      return (
        <span className="pv-text" style={clamp ? { display: "-webkit-box", WebkitLineClamp: clamp, WebkitBoxOrient: "vertical", overflow: "hidden" } : undefined}>
          {String(p.text ?? "")}
        </span>
      );
    }
    case "Image": {
      if (p.system) return <Symbol name={String(p.system)} mods={node.mods} />;
      const asset = env.assets[String(p.name ?? "")];
      const src = (p.src as string | undefined) ?? asset?.url;
      const scale = typeof p.scale === "number" ? p.scale : (asset?.scale ?? 1);
      const resizable = node.mods?.some((m) => m.m === "resizable");
      const aspect = node.mods?.find((m) => m.m === "aspect") as Extract<Mod, { m: "aspect" }> | undefined;
      if (src)
        return (
          <img
            className="pv-img"
            src={src}
            alt=""
            style={resizable ? { width: "100%", height: "100%", objectFit: aspect?.mode === "fill" ? "cover" : "contain" } : scale > 1 ? { zoom: 1 / scale } : undefined}
          />
        );
      return (
        <div className="pv-img-ph" style={resizable ? { width: "100%", height: "100%", minHeight: 44 } : undefined}>
          <Symbol name="photo" />
        </div>
      );
    }
    case "Label": {
      const showIcon = p.labelStyle !== "titleOnly";
      const showTitle = p.labelStyle !== "iconOnly";
      const icon = node.children?.length ? <Kids nodes={node.children} env={env} axis="x" /> : p.system ? <Symbol name={String(p.system)} style={env.inList ? { color: env.tint } : undefined} /> : null;
      return (
        <span className="pv-label">
          {showIcon ? icon : null}
          {showTitle ? node.label?.length ? <Kids nodes={node.label} env={env} axis="x" /> : <span className="pv-text">{String(p.title ?? "")}</span> : null}
        </span>
      );
    }
    case "Button":
      return <ButtonView node={node} env={env} ex={ex} />;
    case "NavigationLink":
      return (
        <button className={`pv-navlink${env.inList ? " in-list" : ""}`} style={{ color: env.inList ? "inherit" : env.tint }} onClick={() => env.push?.(node.children ?? [], String(p.title ?? textOf(node.label)))}>
          <span className="pv-row-label">{node.label?.length ? <Kids nodes={node.label} env={{ ...env, inList: false }} axis="x" /> : <span className="pv-text">{String(p.title ?? "")}</span>}</span>
          {env.inList && <Symbol name="chevron.right" style={{ color: color({ name: "tertiaryLabel" }, env), fontSize: 13 }} />}
        </button>
      );
    case "Toggle":
      return (
        <div className="pv-toggle-row">
          <span className="pv-row-label">{node.label?.length ? <Kids nodes={node.label} env={env} axis="x" /> : <span className="pv-text">{String(p.title ?? "")}</span>}</span>
          <button
            className={`pv-switch${p.isOn ? " on" : ""}`}
            style={p.isOn ? { background: env.tint === cssColor({ name: "blue" }, env.dark) ? cssColor({ name: "green" }, env.dark) : env.tint } : undefined}
            disabled={env.disabled}
            onClick={() => node.event && env.dispatch({ id: node.event, kind: "set", value: !p.isOn })}
          >
            <i />
          </button>
        </div>
      );
    case "Slider": {
      const min = Number(p.min ?? 0);
      const max = Number(p.max ?? 1);
      const value = Number(p.value ?? 0);
      const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
      return (
        <input
          className="pv-slider"
          type="range"
          min={min}
          max={max}
          step={p.step === undefined || p.step === null ? (max - min) / 1000 : Number(p.step)}
          value={value}
          disabled={env.disabled}
          style={{ background: `linear-gradient(to right, ${env.tint} ${pct}%, ${cssColor({ name: "systemFill" }, env.dark)} ${pct}%)` }}
          onChange={(e) => node.event && env.dispatch({ id: node.event, kind: "set", value: Number(e.target.value) })}
        />
      );
    }
    case "Stepper":
      return (
        <div className="pv-toggle-row">
          <span className="pv-row-label">{node.label?.length ? <Kids nodes={node.label} env={env} axis="x" /> : <span className="pv-text">{String(p.title ?? "")}</span>}</span>
          <span className="pv-stepper">
            <button onClick={() => node.event && env.dispatch({ id: node.event, kind: "decrement" })}>−</button>
            <i />
            <button onClick={() => node.event && env.dispatch({ id: node.event, kind: "increment" })}>+</button>
          </span>
        </div>
      );
    case "TextField":
    case "SecureField":
      return (
        <input
          className={`pv-field ${env.textFieldStyle === "roundedBorder" ? "rounded" : ""}`}
          type={node.type === "SecureField" ? "password" : "text"}
          value={String(p.text ?? "")}
          placeholder={String(p.placeholder ?? "")}
          disabled={env.disabled}
          onChange={(e) => node.event && env.dispatch({ id: node.event, kind: "set", value: e.target.value })}
        />
      );
    case "Picker":
      return <PickerView node={node} env={env} />;
    case "ProgressView":
      if (p.value === undefined || p.value === null)
        return (
          <span className="pv-spinner">
            {Array.from({ length: 8 }, (_v, i) => (
              <i key={i} style={{ transform: `rotate(${i * 45}deg)`, opacity: 0.25 + i * 0.09 }} />
            ))}
          </span>
        );
      return (
        <div className="pv-progress">
          {p.title ? <span className="pv-text">{String(p.title)}</span> : null}
          <span className="pv-progress-track" style={{ background: cssColor({ name: "systemFill" }, env.dark) }}>
            <span style={{ width: `${Math.max(0, Math.min(1, Number(p.value) / Number(p.total ?? 1))) * 100}%`, background: env.tint }} />
          </span>
        </div>
      );
    case "Link":
      return <span className="pv-text" style={{ color: env.tint }}>{String(p.title ?? "")}</span>;
    case "Spacer":
      return null;
    case "Divider":
      return <div className="pv-divider" style={{ background: cssColor({ name: "separator" }, env.dark) }} />;
    case "Color":
      return <div className="pv-color" style={{ background: paint(p.color as ColorSpec, env) }} />;
    case "Rectangle":
    case "RoundedRectangle":
    case "Capsule":
    case "Circle":
    case "Ellipse":
      return <ShapeView node={node} env={env} />;
    case "VStack":
    case "LazyVStack":
      return (
        <div className="pv-stack" style={{ flexDirection: "column", alignItems: ALIGN[String(p.alignment ?? "center")] ?? "center", gap: p.spacing === undefined || p.spacing === null ? 8 : Number(p.spacing), flex: ex.y ? "1 1 auto" : undefined, alignSelf: ex.x ? "stretch" : undefined }}>
          <Kids nodes={node.children} env={env} axis="y" edge={edge} spread />
        </div>
      );
    case "HStack":
    case "LazyHStack": {
      const a = String(p.alignment ?? "center");
      return (
        <div className="pv-stack" style={{ flexDirection: "row", alignItems: a.includes("Baseline") ? "baseline" : (ALIGN[a] ?? "center"), gap: p.spacing === undefined || p.spacing === null ? 8 : Number(p.spacing), flex: ex.y ? "1 1 auto" : undefined, alignSelf: ex.x ? "stretch" : undefined }}>
          <Kids nodes={node.children} env={env} axis="x" edge={edge} />
        </div>
      );
    }
    case "ZStack": {
      const a = String(p.alignment ?? "center");
      const style: CSSProperties = {
        justifyItems: /leading|Leading/.test(a) ? "start" : /trailing|Trailing/.test(a) ? "end" : "center",
        alignItems: /^top|Top/.test(a) ? "start" : /^bottom|Bottom/.test(a) ? "end" : "center",
        flex: ex.y ? "1 1 auto" : undefined,
        alignSelf: ex.x ? "stretch" : undefined,
      };
      if (typeof p.measure === "string")
        return (
          <Measured node={node} env={env} className={p.geometry ? "pv-zstack pv-geo" : "pv-zstack"} style={style}>
            <Kids nodes={node.children} env={env} axis="z" />
          </Measured>
        );
      return (
        <div className="pv-zstack" style={style}>
          <Kids nodes={node.children} env={env} axis="z" edge={edge} rest={(/^top|Top/.test(a) ? 1 : 0) | (/^bottom|Bottom/.test(a) ? 2 : 0)} />
        </div>
      );
    }
    case "Path":
      return <PathView node={node} env={env} />;
    case "Canvas":
      return <CanvasView node={node} env={env} />;
    case "Chart":
      return <ChartView node={node} env={env} />;
    case "Gauge":
      return <GaugeView node={node} env={env} />;
    case "SplitView":
      return (
        <div className="pv-split" style={{ borderColor: cssColor({ name: "separator" }, env.dark) }}>
          {(node.children ?? []).map((c) => (
            <div key={c.id} className={`pv-split-col ${String(c.props.column ?? "detail")}`}>
              <Node node={c} env={env} axis="y" />
            </div>
          ))}
        </div>
      );
    case "ToolbarItem":
      return <Kids nodes={node.children} env={env} axis="x" />;
    case "LazyVGrid":
      return (
        <div className="pv-grid" style={{ gridTemplateColumns: `repeat(${Number(p.columns ?? 2)}, minmax(0, 1fr))`, gap: p.spacing === undefined || p.spacing === null ? 8 : Number(p.spacing) }}>
          <Kids nodes={node.children} env={env} axis="z" />
        </div>
      );
    case "ScrollView":
      return (
        <div className={`pv-scroll ${p.axis === "horizontal" ? "h" : "v"}`}>
          <div className="pv-scroll-content">
            <Kids nodes={node.children} env={env} axis={p.axis === "horizontal" ? "x" : "y"} />
          </div>
        </div>
      );
    case "List":
    case "Form":
      return <ListView node={node} env={env} />;
    case "Section":
      return (
        <div className="pv-stack" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          {p.header ? <span className="pv-text pv-section-header">{String(p.header)}</span> : null}
          <Kids nodes={node.label} env={env} axis="y" />
          <Kids nodes={node.children} env={env} axis="y" />
        </div>
      );
    case "NavigationStack":
      return <NavStack node={node} env={env} edge={edge} />;
    case "TabView":
      return <TabsView node={node} env={env} edge={edge} />;
    case "Unsupported":
      return <Placeholder node={node} />;
  }
  if (node.children?.length)
    return (
      <div className="pv-stack" style={{ flexDirection: "column", alignItems: "center", gap: 8 }}>
        <Kids nodes={node.children} env={env} axis="y" edge={edge} spread />
      </div>
    );
  return null;
}

function ButtonView({ node, env, ex }: { node: ViewNode; env: RenderEnv; ex: Expand }) {
  const p = node.props;
  const fill: CSSProperties = { alignSelf: ex.x ? "stretch" : undefined, flex: ex.y ? "1 1 auto" : undefined };
  const destructive = p.role === "destructive";
  const tint = destructive ? (cssColor({ name: "red" }, env.dark) ?? env.tint) : env.tint;
  const content = node.label?.length ? <Kids nodes={node.label} env={{ ...env, inList: false }} axis="x" /> : <span className="pv-text">{String(p.title ?? "")}</span>;
  const style = env.buttonStyle;
  const size = env.controlSize;
  const pad = size === "mini" ? "3px 9px" : size === "small" ? "5px 11px" : size === "large" ? "12px 20px" : size === "extraLarge" ? "15px 24px" : "7px 14px";
  const click = () => !env.disabled && node.event && env.dispatch({ id: node.event, kind: "tap" });
  if (style === "custom")
    return (
      <button className="pv-btn bare" style={fill} onClick={click} disabled={env.disabled}>
        {content}
      </button>
    );
  if (style === "glass" || style === "glassProminent")
    return (
      <button
        className={`pv-btn pv-glass${env.dark ? " dark" : ""}`}
        style={{ ...fill, padding: pad, borderRadius: 9999, color: style === "glassProminent" ? "#fff" : "inherit", fontWeight: style === "glassProminent" ? 600 : undefined, ["--pv-glass-tint" as string]: style === "glassProminent" ? tint : "transparent", ["--pv-glass-mix" as string]: style === "glassProminent" ? "88%" : "0%" } as CSSProperties}
        onClick={click}
        disabled={env.disabled}
      >
        {content}
      </button>
    );
  if (style === "borderedProminent")
    return (
      <button className="pv-btn" style={{ ...fill, background: tint, color: "#fff", padding: pad, borderRadius: 9999, fontWeight: 600 }} onClick={click} disabled={env.disabled}>
        {content}
      </button>
    );
  if (style === "bordered")
    return (
      <button className="pv-btn" style={{ ...fill, background: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint, padding: pad, borderRadius: 9999 }} onClick={click} disabled={env.disabled}>
        {content}
      </button>
    );
  return (
    <button className={`pv-btn plain${env.inList ? " in-list" : ""}`} style={{ ...fill, color: style === "plain" ? "inherit" : tint }} onClick={click} disabled={env.disabled}>
      {content}
    </button>
  );
}

function PickerView({ node, env }: { node: ViewNode; env: RenderEnv }) {
  const p = node.props;
  const options = (p.options as { tag: unknown; label: ViewNode[] }[] | undefined) ?? [];
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.tag === p.selection);
  const pick = (tag: unknown) => {
    setOpen(false);
    if (node.event) env.dispatch({ id: node.event, kind: "set", value: tag });
  };
  if (env.pickerStyle === "segmented")
    return (
      <div className="pv-segmented" style={{ background: cssColor({ name: "systemFill" }, env.dark) }}>
        {options.map((o, i) => (
          <button key={i} className={o.tag === p.selection ? "on" : ""} onClick={() => pick(o.tag)}>
            {textOf(o.label)}
          </button>
        ))}
      </div>
    );
  if (env.pickerStyle === "inline" || env.pickerStyle === "wheel")
    return (
      <div className="pv-stack" style={{ flexDirection: "column", alignItems: "stretch", gap: 0, alignSelf: "stretch" }}>
        {options.map((o, i) => (
          <button key={i} className="pv-option" onClick={() => pick(o.tag)}>
            <span>{textOf(o.label)}</span>
            {o.tag === p.selection && <Symbol name="checkmark" style={{ color: env.tint }} />}
          </button>
        ))}
      </div>
    );
  return (
    <div className="pv-toggle-row pv-menu-picker">
      {p.title ? <span className="pv-row-label">{String(p.title)}</span> : null}
      <button className="pv-menu-btn" style={{ color: env.inList ? color({ name: "secondary" }, env) : env.tint }} onClick={() => setOpen(!open)}>
        <span>{selected ? textOf(selected.label) : ""}</span>
        <Symbol name="chevron.up.chevron.down" style={{ fontSize: 12 }} />
      </button>
      {open && (
        <div className="pv-menu" style={{ background: env.dark ? "rgba(44,44,46,0.97)" : "rgba(255,255,255,0.97)" }}>
          {options.map((o, i) => (
            <button key={i} onClick={() => pick(o.tag)}>
              <span className="pv-check">{o.tag === p.selection ? <Symbol name="checkmark" /> : null}</span>
              <span>{textOf(o.label)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShapeView({ node, env }: { node: ViewNode; env: RenderEnv }) {
  const fill = node.mods?.filter((m) => m.m === "fill").pop() as Extract<Mod, { m: "fill" }> | undefined;
  const stroke = node.mods?.filter((m) => m.m === "stroke").pop() as Extract<Mod, { m: "stroke" }> | undefined;
  const fillCss = stroke && !fill ? "transparent" : (paint(fill?.color, env) ?? "currentColor");
  const plainDisc = node.type === "Circle" && !!fill?.color.gradient && !stroke && !node.mods?.some((m) => m.m === "trim");
  if (plainDisc) return <div className="pv-shape" style={{ background: fillCss, clipPath: "circle(closest-side)" }} />;
  if (node.type === "Circle") return <CircleView node={node} env={env} />;
  const radius =
    node.type === "Circle" || node.type === "Ellipse" ? "50%" : node.type === "Capsule" ? 9999 : node.type === "RoundedRectangle" ? Number(node.props.radius ?? 8) : 0;
  if (stroke?.color.gradient && !fill)
    return (
      <div
        className="pv-shape pv-ring"
        style={{
          borderRadius: radius,
          border: `${stroke.width}px solid transparent`,
          background: `${paint(stroke.color, env)} border-box`,
        }}
      />
    );
  return (
    <div
      className="pv-shape"
      style={{
        background: fillCss,
        borderRadius: radius,
        boxShadow: stroke ? `inset 0 0 0 ${stroke.width}px ${color(stroke.color, env)}` : undefined,
      }}
    />
  );
}

function rowsOf(nodes: ViewNode[]): { header?: ViewNode; rows: ViewNode[] }[] {
  const out: { header?: ViewNode; rows: ViewNode[] }[] = [];
  let loose: ViewNode[] = [];
  const flush = () => {
    if (loose.length) out.push({ rows: loose });
    loose = [];
  };
  for (const n of nodes) {
    if (n.type === "Section") {
      flush();
      out.push({ header: n, rows: n.children ?? [] });
    } else if (n.type === "Group" && !n.mods?.length) loose.push(...(n.children ?? []));
    else loose.push(n);
  }
  flush();
  return out;
}

function ListView({ node, env }: { node: ViewNode; env: RenderEnv }) {
  const plain = env.listStyle === "plain";
  const sections = rowsOf(node.children ?? []);
  const rowEnv = useMemo<RenderEnv>(() => ({ ...env, inList: true, buttonStyle: env.buttonStyle }), [env]);
  const card = plain ? "transparent" : cssColor({ name: "secondarySystemGroupedBackground" }, env.dark);
  const backdrop = env.listBg === false ? "transparent" : plain ? cssColor({ name: "systemBackground" }, env.dark) : cssColor({ name: "systemGroupedBackground" }, env.dark);
  const rowMod = <K extends Mod["m"]>(r: ViewNode, kind: K) => r.mods?.filter((m): m is Extract<Mod, { m: K }> => m.m === kind).pop();
  const bare = (r: ViewNode | undefined) => !!r && rowMod(r, "rowSep")?.hidden === true;
  return (
    <div className={`pv-list${plain ? " plain" : ""}`} style={{ background: backdrop }}>
      {sections.map((s, i) => (
        <div key={i} className="pv-list-section">
          {(s.header?.props.header || s.header?.label?.length) && (
            <div className="pv-list-header" style={{ color: cssColor({ name: "secondary" }, env.dark) }}>
              {s.header?.label?.length ? <Kids nodes={s.header.label} env={env} axis="x" /> : String(s.header?.props.header ?? "")}
            </div>
          )}
          <div className="pv-list-card" style={{ background: s.rows.some((r) => rowMod(r, "rowBg")) ? "transparent" : card }}>
            {s.rows.map((r, j) => {
              const bg = rowMod(r, "rowBg");
              const insets = rowMod(r, "rowInsets");
              const style: CSSProperties = {};
              if (bg) style.background = bg.view ? "transparent" : (color(bg.color, env) ?? card);
              else if (s.rows.some((x) => rowMod(x, "rowBg"))) style.background = card;
              if (bg?.view) {
                style.position = "relative";
                style.isolation = "isolate";
              }
              if (insets) style.padding = `${insets.top}px ${insets.trailing}px ${insets.bottom}px ${insets.leading}px`;
              return (
                <Fragment key={r.id}>
                  {j > 0 && !bare(r) && !bare(s.rows[j - 1]) && <div className="pv-sep" style={{ background: cssColor({ name: "separator" }, env.dark) }} />}
                  <div className="pv-row" style={style}>
                    {bg?.view && (
                      <div className="pv-zstack pv-under">
                        {bg.view.map((v) => (
                          <Node key={v.id} node={v} env={env} axis="z" />
                        ))}
                      </div>
                    )}
                    <Node node={r} env={rowEnv} axis="x" />
                  </div>
                </Fragment>
              );
            })}
          </div>
          {s.header?.props.footer ? (
            <div className="pv-list-footer" style={{ color: cssColor({ name: "secondary" }, env.dark) }}>
              {String(s.header.props.footer)}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function pageMods<K extends Mod["m"]>(nodes: ViewNode[] | undefined, kind: K, out: Extract<Mod, { m: K }>[] = []): Extract<Mod, { m: K }>[] {
  for (const n of nodes ?? []) {
    for (const m of n.mods ?? []) if (m.m === kind) out.push(m as Extract<Mod, { m: K }>);
    if (n.type === "NavigationStack" || n.type === "TabView" || n.type === "SplitView") continue;
    pageMods(n.type === "NavigationLink" ? n.label : [...(n.children ?? []), ...(n.label ?? [])], kind, out);
  }
  return out;
}

function findTitle(nodes: ViewNode[] | undefined): { title: string; mode?: string } | null {
  const m = pageMods(nodes, "navTitle")[0];
  return m ? { title: m.title, mode: m.mode } : null;
}

type BarItem = Extract<Mod, { m: "toolbar" }>["items"][number];

function BarItems({ items, env }: { items: BarItem[]; env: RenderEnv }) {
  return (
    <>
      {items.map((item, i) =>
        item.view.length === 1 && item.view[0].type === "Spacer" ? (
          <span key={i} className="pv-bar-gap" />
        ) : (
          <div key={i} className={`pv-bar-item pv-glass${env.dark ? " dark" : ""}`}>
            <Kids nodes={item.view} env={env} axis="x" />
          </div>
        ),
      )}
    </>
  );
}

function NavStack({ node, env, edge }: { node: ViewNode; env: RenderEnv; edge: number }) {
  const [stack, setStack] = useState<{ nodes: ViewNode[]; title: string }[]>([]);
  const top = stack[stack.length - 1];
  const page = top ? top.nodes : (node.children ?? []);
  const title = findTitle(page);
  const pageEnv = useMemo<RenderEnv>(() => ({ ...env, push: (nodes, t) => setStack((s) => [...s, { nodes, title: t }]) }), [env]);
  const barEnv = useMemo<RenderEnv>(() => ({ ...env, inList: false, buttonStyle: "plain" }), [env]);
  const items = pageMods(page, "toolbar").flatMap((m) => m.items);
  const leading = items.filter((i) => /[lL]eading|cancellation|^navigation$/.test(i.placement));
  const bottom = items.filter((i) => /bottomBar|status/.test(i.placement));
  const principal = items.filter((i) => i.placement === "principal");
  const trailing = items.filter((i) => !leading.includes(i) && !bottom.includes(i) && !principal.includes(i) && i.placement !== "keyboard");
  const search = pageMods(page, "search")[0];
  const inline = title?.mode === "inline" || !!top;
  const showBar = inline || !!top || leading.length > 0 || trailing.length > 0 || principal.length > 0;
  const large = !inline && !!title?.title;
  const insets = { "--pv-nav-top": `${(showBar ? 44 : 0) + (large ? 51 : 0) + (search ? 46 : 0)}px`, "--pv-nav-bottom": bottom.length ? "52px" : "0px" } as CSSProperties;
  const previous = stack.length > 1 ? (findTitle(stack[stack.length - 2].nodes)?.title ?? stack[stack.length - 2].title) : (findTitle(node.children)?.title ?? "Back");
  return (
    <div className="pv-nav">
      {showBar && (
        <div className="pv-navbar">
          <div className="pv-bar-side">
            {top && (
              <button className="pv-back" style={{ color: env.tint }} onClick={() => setStack((s) => s.slice(0, -1))}>
                <Symbol name="chevron.left" style={{ fontSize: 20 }} />
                <span>{previous}</span>
              </button>
            )}
            <BarItems items={leading} env={barEnv} />
          </div>
          <div className="pv-bar-center">{principal.length ? <Kids nodes={principal.flatMap((i) => i.view)} env={barEnv} axis="x" /> : inline ? <span className="pv-navbar-title">{title?.title ?? ""}</span> : null}</div>
          <div className="pv-bar-side end">
            <BarItems items={trailing} env={barEnv} />
          </div>
        </div>
      )}
      <div className="pv-nav-content" style={insets}>
        {large ? <div className="pv-large-title">{title.title}</div> : null}
        {search && (
          <div className="pv-search" style={{ background: cssColor({ name: "systemFill" }, env.dark), color: cssColor({ name: "secondary" }, env.dark) }}>
            <Symbol name="magnifyingglass" />
            <span>{search.prompt}</span>
          </div>
        )}
        <div className="pv-nav-page">
          <Kids nodes={page} env={pageEnv} axis="y" edge={(edge & 2) | 1} />
        </div>
      </div>
      {bottom.length > 0 && (
        <div className="pv-bottombar">
          <BarItems items={bottom} env={barEnv} />
        </div>
      )}
    </div>
  );
}

function TabsView({ node, env, edge }: { node: ViewNode; env: RenderEnv; edge: number }) {
  const [index, setIndex] = useState(0);
  const tabs = node.children ?? [];
  const current = tabs[Math.min(index, tabs.length - 1)];
  const accessory = node.mods?.find((m) => m.m === "accessory") as Extract<Mod, { m: "accessory" }> | undefined;
  const shown = useMemo(() => (current ? { ...current, mods: current.mods?.filter((m) => m.m !== "tabItem") } : null), [current]);
  return (
    <div className="pv-tabs">
      <div className="pv-tab-content" style={{ paddingBottom: accessory ? 126 : 70, "--pv-tab-bottom": accessory ? "126px" : "70px" } as CSSProperties}>
        {shown ? <Node node={shown} env={env} axis="y" edge={expands(shown).y ? (edge & 1) | 2 : 0} /> : null}
      </div>
      {accessory && (
        <div className={`pv-accessory pv-glass${env.dark ? " dark" : ""}`}>
          <Kids nodes={accessory.view} env={env} axis="x" />
        </div>
      )}
      <div className="pv-tabbar" style={{ background: env.dark ? "rgba(30,30,32,0.78)" : "rgba(250,250,252,0.82)" }}>
        {tabs.map((t, i) => {
          const item = t.mods?.find((m) => m.m === "tabItem") as Extract<Mod, { m: "tabItem" }> | undefined;
          const label = item?.label ?? [];
          const lbl = label.find((l) => l.type === "Label");
          const img = label.find((l) => l.type === "Image");
          const txt = label.find((l) => l.type === "Text");
          const icon = lbl?.children?.find((c) => c.type === "Image");
          const system = String(lbl?.props.system ?? icon?.props.system ?? img?.props.system ?? "circle");
          const title = String(lbl?.props.title ?? (lbl?.label?.length ? textOf(lbl.label) : undefined) ?? txt?.props.text ?? "");
          return (
            <button key={t.id} className={`pv-tab${i === index ? " on" : ""}`} style={{ color: i === index ? env.tint : cssColor({ name: "secondary" }, env.dark) }} onClick={() => setIndex(i)}>
              <Symbol name={i === index && !system.endsWith(".fill") ? `${system}.fill` : system} style={{ fontSize: 22 }} />
              <span>{title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
