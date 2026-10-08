import { Fragment, memo, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { cssColor } from "../../lib/preview/colors";
import { sfSymbol } from "../../lib/preview/sf";
import type { AnimCurve, ColorSpec, FontSpec, Mod, PreviewEvent, ShapeSpec, TextStyle, ViewNode, Weight } from "../../lib/preview/types";

export interface RenderEnv {
  dark: boolean;
  tint: string;
  buttonStyle: string;
  controlSize: string;
  listStyle: string;
  pickerStyle: string;
  textFieldStyle: string;
  disabled: boolean;
  inList: boolean;
  lineLimit?: number;
  assets: Record<string, { url: string; scale: number; png?: string }>;
  entering?: Set<string>;
  dispatch: (ev: PreviewEvent) => void;
  push?: (nodes: ViewNode[], title: string) => void;
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

interface Expand {
  x: boolean;
  y: boolean;
}

function frameMod(n: ViewNode): Extract<Mod, { m: "frame" }> | undefined {
  return n.mods?.filter((m): m is Extract<Mod, { m: "frame" }> => m.m === "frame").pop();
}

export function expands(n: ViewNode): Expand {
  const f = frameMod(n);
  let base: Expand;
  switch (n.type) {
    case "Color":
    case "Rectangle":
    case "RoundedRectangle":
    case "Capsule":
    case "Ellipse":
    case "Circle":
    case "ScrollView":
    case "List":
    case "Form":
    case "NavigationStack":
    case "TabView":
      base = { x: true, y: true };
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
      base = { x: spacerX || kids.some((k) => k.x) || n.type === "LazyVGrid", y: spacerY || kids.some((k) => k.y) };
      break;
    }
    default:
      base = { x: false, y: false };
  }
  if (n.mods?.some((m) => m.m === "aspect") && n.mods.some((m) => m.m === "resizable")) base = { x: true, y: true };
  if (f) {
    if (f.width !== undefined) base = { ...base, x: false };
    if (f.height !== undefined) base = { ...base, y: false };
    if (f.maxWidth === "inf") base = { ...base, x: true };
    if (f.maxHeight === "inf") base = { ...base, y: true };
  }
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

const WRAPPERS = new Set(["padding", "frame", "background", "overlay", "clip", "cornerRadius", "border", "shadow", "opacity", "offset", "rotation", "scale", "hidden", "onTap", "ignoresSafeArea"]);

export const Node = memo(function PreviewNode({ node, env, axis }: { node: ViewNode; env: RenderEnv; axis: "x" | "y" | "z" | "none" }) {
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
        {grouped.map((c) => (
          <Node key={c.id} node={c} env={env} axis={axis} />
        ))}
      </>
    );
  }
  const ex = expands(node);
  let el: ReactNode = <Base node={node} env={inner} ex={ex} />;
  const inherited = inheritedCss(node.mods, inner);
  if (Object.keys(inherited).length) el = <div style={{ display: "contents", ...inherited }}>{el}</div>;
  const mods = (node.mods ?? []).filter((m) => WRAPPERS.has(m.m));
  for (const m of mods) el = <Wrap mod={m} env={inner} ex={ex}>{el}</Wrap>;
  const outer: CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, boxSizing: "border-box" };
  if (axis === "y") {
    if (ex.y) outer.flex = node.type === "Spacer" ? "1 1 0" : "1 1 auto";
    else outer.flex = "0 0 auto";
    if (ex.x) outer.alignSelf = "stretch";
  } else if (axis === "x") {
    if (ex.x) outer.flex = node.type === "Spacer" ? "1 1 0" : "1 1 auto";
    else outer.flex = "0 1 auto";
    if (ex.y) outer.alignSelf = "stretch";
  } else if (axis === "z") {
    if (ex.x) outer.justifySelf = "stretch";
    if (ex.y) outer.alignSelf = "stretch";
  }
  if (node.type === "Spacer") {
    const min = Number(node.props.minLength ?? 8);
    if (axis === "y") outer.minHeight = min;
    if (axis === "x") outer.minWidth = min;
  }
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

function Wrap({ mod, env, ex, children }: { mod: Mod; env: RenderEnv; ex: Expand; children: ReactNode }) {
  const base: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", boxSizing: "border-box", position: "relative", minWidth: 0 };
  if (ex.x) base.alignSelf = "stretch";
  if (ex.y) base.flex = "1 1 auto";
  const fill: CSSProperties = ex.x || ex.y ? { flex: ex.y ? "1 1 auto" : undefined, alignSelf: ex.x ? "stretch" : undefined } : {};
  switch (mod.m) {
    case "padding":
      return <div style={{ ...base, padding: `${mod.top}px ${mod.trailing}px ${mod.bottom}px ${mod.leading}px` }}>{children}</div>;
    case "frame": {
      const s: CSSProperties = { ...base };
      if (mod.width !== undefined) s.width = mod.width;
      if (mod.height !== undefined) s.height = mod.height;
      if (mod.minWidth !== undefined) s.minWidth = mod.minWidth;
      if (mod.minHeight !== undefined) s.minHeight = mod.minHeight;
      if (typeof mod.maxWidth === "number") s.maxWidth = mod.maxWidth;
      if (typeof mod.maxHeight === "number") s.maxHeight = mod.maxHeight;
      if (mod.maxWidth === "inf") s.alignSelf = "stretch";
      if (mod.maxHeight === "inf") s.flex = "1 1 auto";
      const a = mod.alignment ?? "center";
      const h = /leading|Leading/.test(a) ? "flex-start" : /trailing|Trailing/.test(a) ? "flex-end" : "center";
      const v = /^top|top/.test(a) ? "flex-start" : /bottom|Bottom/.test(a) ? "flex-end" : "center";
      s.alignItems = h;
      s.justifyContent = v;
      if (mod.width !== undefined || mod.height !== undefined) s.flexShrink = 0;
      return <div style={s}>{children}</div>;
    }
    case "background": {
      const radius = shapeRadius(mod.shape);
      if (mod.view) {
        return (
          <div style={{ ...base, display: "grid" }}>
            <div style={{ gridArea: "1 / 1", display: "flex", flexDirection: "column", alignItems: "stretch", justifyContent: "stretch", borderRadius: radius, overflow: radius !== undefined ? "hidden" : undefined }}>
              {mod.view.map((v) => (
                <Node key={v.id} node={v} env={env} axis="y" />
              ))}
            </div>
            <div style={{ gridArea: "1 / 1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", ...fill }}>{children}</div>
          </div>
        );
      }
      if (mod.material) {
        return (
          <div className="pv-material" style={{ ...base, borderRadius: radius, background: env.dark ? "rgba(40,40,44,0.72)" : "rgba(246,246,248,0.72)", backdropFilter: "blur(20px) saturate(180%)" }}>
            {children}
          </div>
        );
      }
      return <div style={{ ...base, background: color(mod.color, env), borderRadius: radius }}>{children}</div>;
    }
    case "overlay": {
      const a = mod.alignment ?? "center";
      return (
        <div style={{ ...base, display: "grid" }}>
          <div style={{ gridArea: "1 / 1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", ...fill }}>{children}</div>
          <div
            style={{
              gridArea: "1 / 1",
              display: "flex",
              flexDirection: "column",
              alignItems: /leading|Leading/.test(a) ? "flex-start" : /trailing|Trailing/.test(a) ? "flex-end" : "center",
              justifyContent: /top|Top/.test(a) ? "flex-start" : /bottom|Bottom/.test(a) ? "flex-end" : "center",
              pointerEvents: "none",
            }}
          >
            {mod.view.map((v) => (
              <Node key={v.id} node={v} env={env} axis="z" />
            ))}
          </div>
        </div>
      );
    }
    case "clip":
      return <div style={{ ...base, borderRadius: shapeRadius(mod.shape), overflow: "hidden", aspectRatio: mod.shape.shape === "circle" ? "1" : undefined }}>{children}</div>;
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
      return <div style={{ ...base, margin: "calc(var(--pv-safe-top) * -1) calc(var(--pv-safe-right, 0px) * -1) calc(var(--pv-safe-bottom) * -1) calc(var(--pv-safe-left, 0px) * -1)", padding: "var(--pv-safe-top) var(--pv-safe-right, 0px) var(--pv-safe-bottom) var(--pv-safe-left, 0px)" }}>{children}</div>;
    case "onTap":
      return (
        <div style={{ ...base, cursor: "pointer" }} onClick={(e) => (e.stopPropagation(), env.dispatch({ id: mod.event, kind: "tap" }))}>
          {children}
        </div>
      );
  }
  return <>{children}</>;
}

function Kids({ nodes, env, axis }: { nodes?: ViewNode[]; env: RenderEnv; axis: "x" | "y" | "z" | "none" }) {
  return (
    <>
      {(nodes ?? []).map((c) => (
        <Node key={c.id} node={c} env={env} axis={axis} />
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

function Base({ node, env, ex }: { node: ViewNode; env: RenderEnv; ex: Expand }) {
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
    case "Label":
      return (
        <span className="pv-label">
          {node.label?.length ? (
            <>
              {node.children?.length ? <Kids nodes={node.children} env={env} axis="x" /> : p.system ? <Symbol name={String(p.system)} style={env.inList ? { color: env.tint } : undefined} /> : null}
              <Kids nodes={node.label} env={env} axis="x" />
            </>
          ) : (
            <>
              {p.system ? <Symbol name={String(p.system)} style={env.inList ? { color: env.tint } : undefined} /> : null}
              <span className="pv-text">{String(p.title ?? "")}</span>
            </>
          )}
        </span>
      );
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
      return <div className="pv-color" style={{ background: color(p.color as ColorSpec, env) }} />;
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
          <Kids nodes={node.children} env={env} axis="y" />
        </div>
      );
    case "HStack":
    case "LazyHStack": {
      const a = String(p.alignment ?? "center");
      return (
        <div className="pv-stack" style={{ flexDirection: "row", alignItems: a.includes("Baseline") ? "baseline" : (ALIGN[a] ?? "center"), gap: p.spacing === undefined || p.spacing === null ? 8 : Number(p.spacing), flex: ex.y ? "1 1 auto" : undefined, alignSelf: ex.x ? "stretch" : undefined }}>
          <Kids nodes={node.children} env={env} axis="x" />
        </div>
      );
    }
    case "ZStack": {
      const a = String(p.alignment ?? "center");
      return (
        <div
          className="pv-zstack"
          style={{
            justifyItems: /leading|Leading/.test(a) ? "start" : /trailing|Trailing/.test(a) ? "end" : "center",
            alignItems: /^top|Top/.test(a) ? "start" : /^bottom|Bottom/.test(a) ? "end" : "center",
            flex: ex.y ? "1 1 auto" : undefined,
            alignSelf: ex.x ? "stretch" : undefined,
          }}
        >
          <Kids nodes={node.children} env={env} axis="z" />
        </div>
      );
    }
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
      return <NavStack node={node} env={env} />;
    case "TabView":
      return <TabsView node={node} env={env} />;
    case "Unsupported":
      return (
        <div className="pv-unsupported">
          <Symbol name="questionmark.circle" />
          <span>{String(p.name ?? "")}</span>
        </div>
      );
  }
  if (node.children?.length)
    return (
      <div className="pv-stack" style={{ flexDirection: "column", alignItems: "center", gap: 8 }}>
        <Kids nodes={node.children} env={env} axis="y" />
      </div>
    );
  return null;
}

function ButtonView({ node, env }: { node: ViewNode; env: RenderEnv; ex: Expand }) {
  const p = node.props;
  const destructive = p.role === "destructive";
  const tint = destructive ? (cssColor({ name: "red" }, env.dark) ?? env.tint) : env.tint;
  const content = node.label?.length ? <Kids nodes={node.label} env={{ ...env, inList: false }} axis="x" /> : <span className="pv-text">{String(p.title ?? "")}</span>;
  const style = env.buttonStyle;
  const size = env.controlSize;
  const pad = size === "mini" ? "3px 9px" : size === "small" ? "5px 11px" : size === "large" ? "12px 20px" : size === "extraLarge" ? "15px 24px" : "7px 14px";
  const click = () => !env.disabled && node.event && env.dispatch({ id: node.event, kind: "tap" });
  if (style === "borderedProminent")
    return (
      <button className="pv-btn" style={{ background: tint, color: "#fff", padding: pad, borderRadius: 9999, fontWeight: 600 }} onClick={click} disabled={env.disabled}>
        {content}
      </button>
    );
  if (style === "bordered")
    return (
      <button className="pv-btn" style={{ background: `color-mix(in srgb, ${tint} 16%, transparent)`, color: tint, padding: pad, borderRadius: 9999 }} onClick={click} disabled={env.disabled}>
        {content}
      </button>
    );
  return (
    <button className={`pv-btn plain${env.inList ? " in-list" : ""}`} style={{ color: style === "plain" ? "inherit" : tint }} onClick={click} disabled={env.disabled}>
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
  const trim = node.mods?.filter((m) => m.m === "trim").pop() as Extract<Mod, { m: "trim" }> | undefined;
  const fillCss = stroke && !fill ? "transparent" : (color(fill?.color, env) ?? "currentColor");
  if (node.type === "Circle" && (stroke || trim)) {
    const w = stroke?.width ?? 1;
    const len = trim ? Math.max(0, trim.to - trim.from) : 1;
    return (
      <svg className="pv-shape" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">
        <circle
          cx="50"
          cy="50"
          r={50 - w / 2}
          fill={fillCss === "transparent" ? "none" : fillCss}
          stroke={stroke ? color(stroke.color, env) : "none"}
          strokeWidth={w}
          pathLength={1}
          strokeDasharray={trim ? `${len} 1` : undefined}
          strokeDashoffset={trim ? -trim.from : undefined}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          transform="rotate(0 50 50)"
        />
      </svg>
    );
  }
  const radius =
    node.type === "Circle" || node.type === "Ellipse" ? "50%" : node.type === "Capsule" ? 9999 : node.type === "RoundedRectangle" ? Number(node.props.radius ?? 8) : 0;
  return (
    <div
      className="pv-shape"
      style={{
        background: fillCss,
        borderRadius: radius,
        aspectRatio: node.type === "Circle" ? "1" : undefined,
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
  return (
    <div className={`pv-list${plain ? " plain" : ""}`} style={{ background: plain ? cssColor({ name: "systemBackground" }, env.dark) : cssColor({ name: "systemGroupedBackground" }, env.dark) }}>
      {sections.map((s, i) => (
        <div key={i} className="pv-list-section">
          {(s.header?.props.header || s.header?.label?.length) && (
            <div className="pv-list-header" style={{ color: cssColor({ name: "secondary" }, env.dark) }}>
              {s.header?.label?.length ? <Kids nodes={s.header.label} env={env} axis="x" /> : String(s.header?.props.header ?? "")}
            </div>
          )}
          <div className="pv-list-card" style={{ background: plain ? "transparent" : cssColor({ name: "secondarySystemGroupedBackground" }, env.dark) }}>
            {s.rows.map((r, j) => (
              <Fragment key={r.id}>
                {j > 0 && <div className="pv-sep" style={{ background: cssColor({ name: "separator" }, env.dark) }} />}
                <div className="pv-row">
                  <Node node={r} env={rowEnv} axis="x" />
                </div>
              </Fragment>
            ))}
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

function findTitle(nodes: ViewNode[] | undefined): { title: string; mode?: string } | null {
  for (const n of nodes ?? []) {
    const m = n.mods?.find((x) => x.m === "navTitle") as Extract<Mod, { m: "navTitle" }> | undefined;
    if (m) return { title: m.title, mode: m.mode };
    if (n.type === "NavigationStack" || n.type === "TabView") continue;
    const deep = findTitle([...(n.children ?? []), ...(n.label ?? [])]);
    if (deep) return deep;
  }
  return null;
}

function NavStack({ node, env }: { node: ViewNode; env: RenderEnv }) {
  const [stack, setStack] = useState<{ nodes: ViewNode[]; title: string }[]>([]);
  const top = stack[stack.length - 1];
  const page = top ? top.nodes : (node.children ?? []);
  const title = findTitle(page);
  const pageEnv = useMemo<RenderEnv>(() => ({ ...env, push: (nodes, t) => setStack((s) => [...s, { nodes, title: t }]) }), [env]);
  const inline = title?.mode === "inline" || !!top;
  const previous = stack.length > 1 ? (findTitle(stack[stack.length - 2].nodes)?.title ?? stack[stack.length - 2].title) : (findTitle(node.children)?.title ?? "Back");
  return (
    <div className="pv-nav">
      {(inline || top) && (
        <div className="pv-navbar">
          {top && (
            <button className="pv-back" style={{ color: env.tint }} onClick={() => setStack((s) => s.slice(0, -1))}>
              <Symbol name="chevron.left" style={{ fontSize: 20 }} />
              <span>{previous}</span>
            </button>
          )}
          <span className="pv-navbar-title">{title?.title ?? ""}</span>
        </div>
      )}
      <div className="pv-nav-content">
        {!inline && title?.title ? <div className="pv-large-title">{title.title}</div> : null}
        <div className="pv-nav-page">
          <Kids nodes={page} env={pageEnv} axis="y" />
        </div>
      </div>
    </div>
  );
}

function TabsView({ node, env }: { node: ViewNode; env: RenderEnv }) {
  const [index, setIndex] = useState(0);
  const tabs = node.children ?? [];
  const current = tabs[Math.min(index, tabs.length - 1)];
  return (
    <div className="pv-tabs">
      <div className="pv-tab-content">{current ? <Node node={{ ...current, mods: current.mods?.filter((m) => m.m !== "tabItem") }} env={env} axis="y" /> : null}</div>
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
