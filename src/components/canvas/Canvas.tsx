import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ALargeSmall, BatteryFull, Camera, ChevronsUpDown, Circle, LayoutGrid, Maximize, Moon, MousePointer2, RotateCcw, RotateCwSquare, Signal, Smartphone, Sun, Square, SunMoon, Wifi, X, Zap } from "lucide-react";
import { t } from "../../i18n";
import { takeScreenshot } from "../../lib/capture";
import { api, errorMessage, on } from "../../lib/ipc";
import { revealInExplorer } from "../../lib/links";
import { getDoc } from "../../lib/models";
import { monaco } from "../../lib/monaco";
import { cssColor, setAccent } from "../../lib/preview/colors";
import { setAssetColors } from "../../lib/preview/swiftui";
import {
  DEFAULT_DEVICE,
  deviceById,
  deviceForMachine,
  DEVICES,
  estimatePerf,
  FAMILIES,
  frameOf,
  modelName,
  screenOf,
  sizeClasses,
  TYPE_SIZES,
  typeScale,
  type DeviceSpec,
  type Screen,
} from "../../lib/preview/devices";
import { Runtime, type RenderResult } from "../../lib/preview/runtime";
import type { AnimCurve, PreviewEvent, SrcRange, ViewNode } from "../../lib/preview/types";
import { useStore } from "../../lib/store";
import { Select } from "../Controls";
import { useMenu, type MenuEntry } from "../Menu";
import { selectView, useViewSelection } from "../../lib/preview/selection";
import { curveCss, Node, type RenderEnv } from "./PreviewRender";
import { PreviewBoundary } from "./PreviewBoundary";
import "@fontsource-variable/inter";
import "./canvas.css";

let shared: { root: string; rt: Runtime; disk: Map<string, string> } | null = null;

function runtimeFor(root: string) {
  if (!shared || shared.root !== root) shared = { root, rt: new Runtime(), disk: new Map() };
  return shared;
}

function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {}
    },
    [key],
  );
  return [value, set];
}

interface LiveInfo {
  name: string;
  width: number;
  height: number;
  maxFps: number;
}

interface LiveStats {
  fps: number;
  memoryMB: number;
  cpu: number;
  thermal: string;
  lowPower: boolean;
  battery: number;
}

type LiveState = "off" | "connecting" | "waiting" | "live" | "error";

const LIVE_ERRORS: Record<string, string> = {
  gone: "err.previewGone",
  usb: "err.previewUsb",
  closed: "err.previewClosed",
  noAnswer: "err.previewNoAnswer",
  offline: "err.previewOffline",
  tooBig: "err.previewTooBig",
  pairFirst: "err.previewPairFirst",
};

function liveErrorText(e: unknown): string {
  const code = errorMessage(e);
  return code in LIVE_ERRORS ? t(LIVE_ERRORS[code] as Parameters<typeof t>[0]) : code;
}

function appNotOpen(e: unknown): boolean {
  const code = errorMessage(e);
  return code === "closed" || code === "noAnswer";
}

type Assets = Record<string, { url: string; scale: number; png?: string }>;

type Rgba = [number, number, number, number];

interface FontAsset {
  names: string[];
  data: string;
}

function fontsForPhone(list: FontAsset[]): FontAsset[] {
  let budget = 12 * 1024 * 1024;
  return list.filter((f) => {
    if (f.data.length > budget) return false;
    budget -= f.data.length;
    return true;
  });
}

function component(v: unknown): number {
  const s = String(v ?? "0").trim();
  if (/^0x/i.test(s)) return parseInt(s, 16) / 255;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return s.includes(".") || n <= 1 ? n : n / 255;
}

function parseColorset(json: string): { light: Rgba; dark?: Rgba } | null {
  let doc: { colors?: { color?: { components?: Record<string, unknown> }; appearances?: { appearance?: string; value?: string }[] }[] };
  try {
    doc = JSON.parse(json);
  } catch {
    return null;
  }
  let light: Rgba | undefined;
  let dark: Rgba | undefined;
  for (const entry of doc.colors ?? []) {
    const c = entry.color?.components;
    if (!c) continue;
    const rgba: Rgba = c.white !== undefined ? [component(c.white), component(c.white), component(c.white), component(c.alpha ?? 1)] : [component(c.red), component(c.green), component(c.blue), component(c.alpha ?? 1)];
    const isDark = (entry.appearances ?? []).some((a) => a.appearance === "luminosity" && a.value === "dark");
    const isLight = (entry.appearances ?? []).some((a) => a.appearance === "luminosity" && a.value === "light");
    if (isDark) dark = rgba;
    else if (isLight || !light) light = rgba;
  }
  return light ? { light, dark } : null;
}

function fontNames(buf: ArrayBuffer): string[] {
  try {
    const dv = new DataView(buf);
    const tables = dv.getUint16(4);
    for (let i = 0, off = 12; i < tables; i++, off += 16) {
      const tag = String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
      if (tag !== "name") continue;
      const table = dv.getUint32(off + 8);
      const count = dv.getUint16(table + 2);
      const strings = table + dv.getUint16(table + 4);
      const names = new Set<string>();
      for (let r = 0; r < count; r++) {
        const rec = table + 6 + r * 12;
        const platform = dv.getUint16(rec);
        const id = dv.getUint16(rec + 6);
        const len = dv.getUint16(rec + 8);
        const at = strings + dv.getUint16(rec + 10);
        if (![1, 4, 6, 16].includes(id)) continue;
        const bytes = new Uint8Array(buf, at, len);
        let text = "";
        if (platform === 0 || platform === 3) for (let k = 0; k + 1 < bytes.length; k += 2) text += String.fromCharCode((bytes[k] << 8) | bytes[k + 1]);
        else text = String.fromCharCode(...bytes);
        if (text.trim()) names.add(text.trim());
      }
      return [...names];
    }
  } catch {}
  return [];
}

function dataToBuffer(url: string): ArrayBuffer {
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function rasterize(svg: string, scale: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, Math.round((img.naturalWidth || 64) * scale));
      const h = Math.max(1, Math.round((img.naturalHeight || 64) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(undefined);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(undefined);
    img.src = svg;
  });
}

function signature(n: ViewNode, out: Map<ViewNode, string>): string {
  const kids = (n.children ?? []).map((c) => signature(c, out)).join(",");
  const label = (n.label ?? []).map((c) => signature(c, out)).join(",");
  const sig = `${n.id}|${n.type}|${JSON.stringify(n.props)}|${JSON.stringify(n.mods ?? null, (k, v) => (k === "src" ? undefined : v))}|${n.event ?? ""}|[${kids}]|[${label}]`;
  out.set(n, sig);
  return sig;
}

function copySrc(into: ViewNode, from: ViewNode) {
  into.src = from.src;
  into.children?.forEach((c, i) => from.children?.[i] && copySrc(c, from.children[i]));
  into.label?.forEach((c, i) => from.label?.[i] && copySrc(c, from.label[i]));
}

function share(prev: ViewNode | null, next: ViewNode | null): ViewNode | null {
  if (!prev || !next) return next;
  const oldSigs = new Map<ViewNode, string>();
  signature(prev, oldSigs);
  const byId = new Map<string, { node: ViewNode; sig: string }>();
  for (const [node, sig] of oldSigs) byId.set(node.id, { node, sig });
  const newSigs = new Map<ViewNode, string>();
  signature(next, newSigs);
  const walk = (n: ViewNode): ViewNode => {
    const old = byId.get(n.id);
    if (old && old.sig === newSigs.get(n)) {
      copySrc(old.node, n);
      return old.node;
    }
    const children = n.children?.map(walk);
    const label = n.label?.map(walk);
    return { ...n, children, label };
  };
  return walk(next);
}

function treeIds(tree: ViewNode | null): Set<string> {
  const ids = new Set<string>();
  const walk = (n: ViewNode) => {
    ids.add(n.id);
    n.children?.forEach(walk);
    n.label?.forEach(walk);
  };
  if (tree) walk(tree);
  return ids;
}

type VariantMode = "off" | "scheme" | "devices" | "previews" | "type" | "orientation";

interface VariantSpec {
  key: string;
  label: string;
  device: DeviceSpec;
  dark: boolean;
  target: string;
  landscape: boolean;
  typeSize: string;
}

const TYPE_LABELS: Record<string, string> = {
  xSmall: "XS",
  small: "S",
  medium: "M",
  large: "L",
  xLarge: "XL",
  xxLarge: "XXL",
  xxxLarge: "XXXL",
  accessibility1: "AX1",
  accessibility2: "AX2",
  accessibility3: "AX3",
  accessibility4: "AX4",
  accessibility5: "AX5",
};

interface VariantResult extends VariantSpec {
  tree: ViewNode | null;
}

function indexNodes(tree: ViewNode | null): Map<string, ViewNode> {
  const map = new Map<string, ViewNode>();
  const walk = (n: ViewNode) => {
    map.set(n.id, n);
    n.children?.forEach(walk);
    n.label?.forEach(walk);
    for (const m of n.mods ?? []) {
      if ((m.m === "background" && m.view) || m.m === "overlay") m.view?.forEach(walk);
      else if (m.m === "tabItem") m.label.forEach(walk);
    }
  };
  if (tree) walk(tree);
  return map;
}

const sameFile = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function positionIn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      start = i + 1;
    }
  }
  return { line, column: offset - start + 1 };
}

function withAssets(tree: ViewNode | null, assets: Assets): ViewNode | null {
  if (!tree) return tree;
  let budget = 8 * 1024 * 1024;
  const walk = (n: ViewNode): ViewNode => {
    let props = n.props;
    const asset = n.type === "Image" && typeof props.name === "string" && !props.src ? assets[props.name] : undefined;
    const url = asset ? (asset.png ?? asset.url) : undefined;
    if (asset && url && !url.startsWith("data:image/svg") && url.length <= budget) {
      budget -= url.length;
      props = { ...props, src: url, scale: asset.png ? 3 : asset.scale };
    }
    const mods = n.mods?.map((m) =>
      m.m === "background" && m.view ? { ...m, view: m.view.map(walk) } : m.m === "overlay" ? { ...m, view: m.view.map(walk) } : m.m === "tabItem" ? { ...m, label: m.label.map(walk) } : m,
    );
    return { ...n, props, children: n.children?.map(walk), label: n.label?.map(walk), mods, src: undefined };
  };
  return walk(tree);
}

function pickTarget(targets: { key: string; label: string }[], path: string, previous: string | null): string | null {
  if (previous && targets.some((t) => t.key === previous)) return previous;
  const file = path.split(/[\\/]/).pop()?.replace(/\.swift$/, "") ?? "";
  return (
    targets.find((t) => t.key.startsWith("preview:"))?.key ??
    targets.find((t) => t.key === `view:${file}`)?.key ??
    targets.find((t) => t.key.startsWith("view:"))?.key ??
    targets.find((t) => t.key.startsWith("provider:"))?.key ??
    targets[0]?.key ??
    null
  );
}

function screenBackground(tree: ViewNode | null): string {
  let n: ViewNode | null | undefined = tree;
  for (let i = 0; i < 4 && n; i++) {
    if (n.type === "List" || n.type === "Form") return n.mods?.some((m) => m.m === "listStyle" && m.value === "plain") ? "systemBackground" : "systemGroupedBackground";
    if (n.type === "NavigationStack" || n.type === "TabView" || n.type === "Group") n = n.children?.[0];
    else break;
  }
  return "systemBackground";
}

function rootScheme(tree: ViewNode | null): "light" | "dark" | null {
  const m = tree?.mods?.find((x) => x.m === "scheme");
  return m && m.m === "scheme" ? m.value : null;
}

export default function Canvas({ path, onClose }: { path: string; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const devices = useStore((s) => s.devices);
  const tabCount = useStore((s) => s.tabs.length);
  const trusted = useStore((s) => s.trusted);
  const [deviceId, setDeviceId] = usePersisted("xwc.canvas.device", DEFAULT_DEVICE);
  const [schemePref, setSchemePref] = usePersisted<"auto" | "light" | "dark">("xwc.canvas.scheme", "auto");
  const [zoomPref, setZoomPref] = usePersisted<"fit" | "50" | "75" | "100">("xwc.canvas.zoom", "fit");
  const [selectMode, setSelectMode] = usePersisted("xwc.canvas.select", false);
  const [landscape, setLandscape] = usePersisted("xwc.canvas.landscape", false);
  const [typeSize, setTypeSize] = usePersisted("xwc.canvas.type", "large");
  const typeMenu = useMenu();
  const [variantMode, setVariantMode] = usePersisted<VariantMode>("xwc.canvas.variants", "off");
  const [variantResults, setVariantResults] = useState<VariantResult[]>([]);
  const variantMenu = useMenu();
  const [picked, setPicked] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [ready, setReady] = useState(false);
  const [assets, setAssets] = useState<Assets>({});
  const [accent, setAccentColor] = useState<{ light: Rgba; dark?: Rgba } | null>(null);
  const fonts = useRef<FontAsset[]>([]);
  const [motion, setMotion] = useState<{ curve: AnimCurve; entering: Set<string>; nonce: number } | null>(null);
  const prevIds = useRef<Set<string>>(new Set());
  const [live, setLive] = useState<LiveState>("off");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [shooting, setShooting] = useState(false);
  const [rec, setRec] = useState<"off" | "starting" | "on" | "saving">("off");
  const [recSince, setRecSince] = useState(0);
  const [recDone, setRecDone] = useState(0);
  const [liveInfo, setLiveInfo] = useState<LiveInfo | null>(null);
  const [liveStats, setLiveStats] = useState<LiveStats | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef(0);
  const waiting = useRef<{ until: number; timer: number } | null>(null);
  const previewRoot = useRef<string | null>(null);
  const task = useStore((s) => s.task);
  const lastGood = useRef<ViewNode | null>(null);
  const variantTrees = useRef<(ViewNode | null)[]>([]);
  const renderedKey = useRef<string | null>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const lastMessage = useRef("");
  const variantSpecs = useRef<VariantSpec[]>([]);
  const liveCtx = useRef({ live: "off" as LiveState, assets: {} as Assets, schemePref: "auto" as "auto" | "light" | "dark", dark: false, title: "" });
  const { rt, disk } = runtimeFor(project.root);
  const appDark = document.documentElement.dataset.theme !== "light";
  const dark = schemePref === "auto" ? appDark : schemePref === "dark";
  const device = deviceById(deviceId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const files = await api.listFiles(project.root).catch(() => [] as string[]);
      const swift = files.filter((f) => f.toLowerCase().endsWith(".swift") && !/[\\/](\.build|xtool)[\\/]/.test(f)).slice(0, 400);
      await Promise.all(
        swift.map(async (rel) => {
          const full = /^[A-Za-z]:\\/.test(rel) ? rel : `${project.root}\\${rel.replace(/\//g, "\\")}`;
          if (disk.has(full)) return;
          const text = await api.readTextFile(full).catch(() => null);
          if (text !== null) disk.set(full, text);
        }),
      );
      const scaleOf = (f: string) => Number(/@([23])x\.[a-z]+$/i.exec(f)?.[1] ?? 1);
      const rank = (f: string) => [2, 3, 1].indexOf(scaleOf(f));
      const full = (rel: string) => (/^[A-Za-z]:\\/.test(rel) ? rel : `${project.root}\\${rel.replace(/\//g, "\\")}`);
      const colors: Record<string, { light: Rgba; dark?: Rgba }> = {};
      await Promise.all(
        files
          .filter((f) => /\.colorset[\\/]Contents\.json$/i.test(f) && !/[\\/](\.build|xtool)[\\/]/.test(f))
          .slice(0, 200)
          .map(async (rel) => {
            const name = /([^\\/]+)\.colorset[\\/]/.exec(rel)?.[1];
            const text = name ? await api.readTextFile(full(rel)).catch(() => null) : null;
            const color = text ? parseColorset(text) : null;
            if (name && color) colors[name] = color;
          }),
      );
      setAssetColors(colors);
      const accentAsset = colors.AccentColor ?? null;
      setAccent(accentAsset ? cssColor({ rgba: accentAsset.light }, false) ?? null : null, accentAsset ? cssColor({ rgba: accentAsset.dark ?? accentAsset.light }, false) : null);
      if (!cancelled) setAccentColor(accentAsset);
      const fontFiles = files.filter((f) => /\.(ttf|otf)$/i.test(f) && !/[\\/](\.build|xtool)[\\/]/.test(f)).slice(0, 24);
      const loaded: FontAsset[] = [];
      await Promise.all(
        fontFiles.map(async (rel) => {
          const data = await api.readImageDataUrl(full(rel)).catch(() => null);
          if (!data) return;
          const buf = dataToBuffer(data);
          const names = fontNames(buf);
          const base = rel.split(/[\\/]/).pop()?.replace(/\.(ttf|otf)$/i, "");
          if (base) names.push(base);
          for (const name of new Set(names)) {
            try {
              const face = new FontFace(name, buf.slice(0));
              await face.load();
              document.fonts.add(face);
            } catch {}
          }
          loaded.push({ names: [...new Set(names)], data });
        }),
      );
      fonts.current = loaded;
      const images = files
        .filter((f) => /\.imageset[\\/][^\\/]+\.(png|jpe?g|svg)$/i.test(f))
        .sort((a, b) => rank(a) - rank(b))
        .slice(0, 60);
      const chosen = new Map<string, string>();
      for (const rel of images) {
        const name = /([^\\/]+)\.imageset[\\/]/.exec(rel)?.[1];
        if (name && !chosen.has(name)) chosen.set(name, rel);
      }
      const found: Assets = {};
      await Promise.all(
        [...chosen].map(async ([name, rel]) => {
          const fullPath = full(rel);
          const url = await api.readImageDataUrl(fullPath).catch(() => null);
          if (!url) return;
          const svg = url.startsWith("data:image/svg");
          found[name] = { url, scale: scaleOf(rel), png: svg ? await rasterize(url, 3) : undefined };
        }),
      );
      if (!cancelled) {
        setAssets(found);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.root, disk]);

  const sources = useCallback(() => {
    const list: { path: string; src: string }[] = [];
    const seen = new Set<string>();
    const add = (p: string, src: string) => {
      const k = p.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      list.push({ path: p, src });
    };
    const doc = getDoc(path);
    if (doc) add(path, doc.model.getValue());
    for (const p of useStore.getState().tabs) {
      const d = getDoc(p);
      if (d && p.toLowerCase().endsWith(".swift")) add(p, d.model.getValue());
    }
    for (const [p, src] of disk) add(p, src);
    return list;
  }, [path, disk]);

  const primary = useRef({ dark, device, landscape, typeSize });
  primary.current = { dark, device, landscape, typeSize };

  const renderAll = useCallback(
    (key: string) => {
      const run = (d: DeviceSpec, isDark: boolean, k: string, wide: boolean, size: string) => {
        const sc = screenOf(d, wide);
        rt.scheme = isDark ? "dark" : "light";
        rt.size = { width: sc.width - sc.left - sc.right, height: sc.height - sc.top - sc.bottom };
        rt.sizeClass = sizeClasses(d, wide);
        rt.typeSize = size;
        return rt.render(pathRef.current, k);
      };
      const prevVariants = variantTrees.current;
      const extra = variantSpecs.current.map((v, i) => ({ ...v, tree: share(prevVariants[i] ?? null, run(v.device, v.dark, v.target, v.landscape, v.typeSize).tree) }));
      variantTrees.current = extra.map((v) => v.tree);
      const p = primary.current;
      const fresh = run(p.device, p.dark, key, p.landscape, p.typeSize);
      const r = { ...fresh, tree: share(lastGood.current, fresh.tree) };
      if (r.tree) lastGood.current = r.tree;
      prevIds.current = treeIds(r.tree);
      setResult((old) => (old && old.tree === r.tree && JSON.stringify(old.errors) === JSON.stringify(r.errors) && old.notes.join() === r.notes.join() ? old : r));
      setVariantResults((old) => (old.length === extra.length && old.every((v, i) => v.tree === extra[i].tree && v.key === extra[i].key) ? old : extra));
      return r;
    },
    [rt],
  );

  const renderTimer = useRef(0);
  const runRender = useRef<() => void>(() => undefined);
  runRender.current = () => {
    if (!ready) return;
    try {
      rt.setFiles(sources());
      const targets = rt.targets(path);
      const key = pickTarget(targets, path, target);
      if (key !== target) setTarget(key);
      renderedKey.current = key;
      variantSpecs.current = specsFor(variantMode, key, targets, device, dark, landscape, typeSize);
      if (!key) {
        setResult(null);
        setVariantResults([]);
        return;
      }
      renderAll(key);
    } catch (e) {
      setResult({ tree: null, errors: [{ message: e instanceof Error ? e.message : String(e), line: 0, column: 0 }], notes: [], stats: { views: 0, depth: 0, heavy: 0 } });
      setVariantResults([]);
    }
  };
  const scheduleRender = useCallback((delay = 120) => {
    window.clearTimeout(renderTimer.current);
    renderTimer.current = window.setTimeout(() => runRender.current(), delay);
  }, []);
  useEffect(() => () => window.clearTimeout(renderTimer.current), []);

  useEffect(() => {
    scheduleRender(0);
  }, [ready, path, target, dark, device, landscape, typeSize, tabCount, rt, sources, variantMode, renderAll, scheduleRender]);

  useEffect(() => {
    const doc = getDoc(path);
    if (!doc) return;
    const sub = doc.model.onDidChangeContent(() => scheduleRender());
    return () => sub.dispose();
  }, [path, ready, scheduleRender]);

  useEffect(() => {
    const sub = monaco.editor.onDidCreateModel(() => scheduleRender());
    return () => sub.dispose();
  }, [scheduleRender]);

  const sendLive = useCallback((next: ViewNode | null, animation?: AnimCurve | null) => {
    const ctx = liveCtx.current;
    if (ctx.live !== "live") return;
    const scheme = rootScheme(next);
    const isDark = scheme ? scheme === "dark" : ctx.dark;
    const message = JSON.stringify({ type: "render", tree: withAssets(next, ctx.assets), scheme: ctx.schemePref === "auto" ? null : isDark ? "dark" : "light", title: ctx.title, typeSize: primary.current.typeSize, animation: animation ?? null });
    if (message === lastMessage.current) return;
    lastMessage.current = message;
    void api.previewSend(message).catch((e) => {
      setLive("error");
      setLiveError(liveErrorText(e));
    });
  }, []);

  const rerenderNow = useCallback(
    (animation?: AnimCurve | null) => {
      const key = renderedKey.current;
      if (!key) return;
      const before = prevIds.current;
      const r = renderAll(key);
      const after = treeIds(r.tree);
      if (animation) {
        const entering = new Set([...after].filter((id) => !before.has(id)));
        setMotion({ curve: animation, entering, nonce: Date.now() });
      }
      prevIds.current = after;
      sendLive(r.tree ?? lastGood.current, animation);
    },
    [renderAll, sendLive],
  );

  const dispatch = useCallback(
    (ev: PreviewEvent) => {
      if (rt.dispatch(ev)) rerenderNow(rt.takeAnimation());
    },
    [rt, rerenderNow],
  );

  useEffect(() => {
    if (!motion) return;
    const { duration } = curveCss(motion.curve);
    const timer = window.setTimeout(() => setMotion(null), duration * 1000 + 120);
    return () => window.clearTimeout(timer);
  }, [motion]);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStageSize({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tree = result?.tree ?? lastGood.current;
  const nodeIndex = useMemo(() => indexNodes(tree), [tree]);

  useEffect(() => {
    const sel = useViewSelection.getState().sel;
    if (!sel) return;
    const node = nodeIndex.get(sel.id);
    const range = node?.src?.find((r) => sameFile(r.f, sel.path));
    if (range && (range.a !== sel.a || range.b !== sel.b)) selectView({ ...sel, a: range.a, b: range.b });
  }, [nodeIndex]);

  useEffect(() => {
    if (!selectMode) selectView(null);
  }, [selectMode]);

  useEffect(() => () => selectView(null), []);



  const pickNode = useCallback(
    (id: string) => {
      const node = nodeIndex.get(id);
      const range = node?.src?.find((r) => sameFile(r.f, path)) ?? node?.src?.[0];
      if (!range) return;
      setPicked(id);
      selectView({ path: range.f, id, type: node?.type ?? "View", a: range.a, b: range.b });
      const doc = getDoc(range.f);
      let from: { line: number; column: number };
      let to: { line: number; column: number };
      if (doc) {
        const a = doc.model.getPositionAt(range.a);
        const b = doc.model.getPositionAt(range.b);
        from = { line: a.lineNumber, column: a.column };
        to = { line: b.lineNumber, column: b.column };
      } else {
        const text = rt.sourceOf(range.f) ?? "";
        from = positionIn(text, range.a);
        to = positionIn(text, range.b);
      }
      void useStore.getState().openFile(range.f, { line: from.line, column: from.column, endLine: to.line, endColumn: to.column });
    },
    [nodeIndex, path, rt],
  );
  const effectiveDark = rootScheme(tree) ? rootScheme(tree) === "dark" : dark;

  liveCtx.current.live = live;
  liveCtx.current.assets = assets;
  liveCtx.current.schemePref = schemePref;
  liveCtx.current.dark = dark;

  useEffect(() => {
    if (live !== "live") {
      lastMessage.current = "";
      return;
    }
    liveCtx.current.title = result ? (rt.targets(path).find((x) => x.key === target)?.label ?? "") : "";
    sendLive(tree);
  }, [live, tree, effectiveDark, schemePref, assets, rt, path, target, result, sendLive]);

  const handleMessage = useCallback(
    (text: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === "hello") {
        const phoneFonts = fontsForPhone(fonts.current);
        if (phoneFonts.length) void api.previewSend(JSON.stringify({ type: "fonts", fonts: phoneFonts })).catch(() => undefined);
        const machine = typeof msg.machine === "string" ? msg.machine : null;
        const info = {
          name: modelName(machine) ?? String(msg.name ?? "iPhone"),
          width: Number(msg.width ?? 0),
          height: Number(msg.height ?? 0),
          maxFps: Number(msg.maxFps ?? 60),
        };
        setLiveInfo(info);
        const match = deviceForMachine(machine, info.width, info.height);
        if (match) setDeviceId(match.id);
        setLiveError(null);
        setLive("live");
      } else if (msg.type === "stats") {
        setLiveStats({
          fps: Number(msg.fps ?? 0),
          memoryMB: Number(msg.memoryMB ?? 0),
          cpu: Number(msg.cpu ?? 0),
          thermal: String(msg.thermal ?? "nominal"),
          lowPower: !!msg.lowPower,
          battery: Number(msg.battery ?? -1),
        });
      } else if (msg.type === "event") {
        dispatch({ id: String(msg.id), kind: msg.kind as PreviewEvent["kind"], value: msg.value });
      } else if (msg.type === "recording") {
        if (msg.state === "on") {
          setRecSince(Date.now());
          setRec("on");
        } else {
          setRec("off");
          if (msg.state === "error") useStore.getState().toast("error", t("err.recordFailed", { error: String(msg.message ?? "") }));
        }
      }
    },
    [dispatch, setDeviceId],
  );

  useEffect(() => {
    const offs = [
      on<{ session: number; message: string }>("preview://message", (e) => {
        if (e.session === session.current) handleMessage(e.message);
      }),
      on<{ session: number; part: number; parts: number; path: string | null; error: string | null }>("preview://video", (e) => {
        if (e.session !== session.current) return;
        const { toast } = useStore.getState();
        if (e.error) {
          setRec("off");
          toast("error", t("err.recordFailed", { error: e.error }));
        } else if (e.path) {
          const saved = e.path;
          setRec("off");
          toast("success", t("canvas.videoSaved"), { label: t("ctx.showInExplorer"), run: () => void revealInExplorer(saved) });
        } else {
          setRec("saving");
          setRecDone(e.parts ? (e.part + 1) / e.parts : 0);
        }
      }),
      on<{ session: number }>("preview://closed", (e) => {
        if (e.session !== session.current) return;
        session.current = 0;
        setRec("off");
        setLive("off");
        setLiveInfo(null);
        setLiveStats(null);
      }),
    ];
    return () => offs.forEach((off) => void off.then((f) => f()));
  }, [handleMessage]);

  useEffect(() => {
    if (live !== "live") setRec("off");
  }, [live]);

  useEffect(() => {
    if (rec !== "starting" && rec !== "saving") return;
    const timer = window.setTimeout(() => {
      setRec("off");
      useStore.getState().toast("error", t("canvas.recordNoAnswer"));
    }, 30000);
    return () => window.clearTimeout(timer);
  }, [rec, recDone]);

  const toggleRecording = () => {
    if (rec === "on") {
      setRecDone(0);
      setRec("saving");
      void api.previewSend(JSON.stringify({ type: "record", on: false })).catch(() => setRec("off"));
    } else if (rec === "off") {
      setRec("starting");
      void api.previewSend(JSON.stringify({ type: "record", on: true })).catch(() => setRec("off"));
    }
  };

  const stopWaiting = () => {
    if (waiting.current) window.clearTimeout(waiting.current.timer);
    waiting.current = null;
  };

  useEffect(() => {
    return () => {
      if (waiting.current) window.clearTimeout(waiting.current.timer);
      waiting.current = null;
      if (session.current) void api.previewDisconnect().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!task || !waiting.current || !previewRoot.current || task.target?.root !== previewRoot.current) return;
    if (task.status === "failed" || task.status === "cancelled") {
      stopWaiting();
      setLive("off");
    }
  }, [task]);

  const [liveUdid, setLiveUdid] = usePersisted<string | null>("xwc.canvas.liveDevice", null);
  const iphone = devices.find((d) => d.udid === liveUdid) ?? devices.find((d) => d.deviceClass !== "iPad") ?? devices[0];
  const owned = devices
    .map((d) => (d.productType ? deviceForMachine(d.productType, 0, 0) : undefined))
    .filter((d, i, all): d is DeviceSpec => !!d && all.findIndex((x) => x?.id === d.id) === i);

  useEffect(() => {
    if (!iphone?.productType) return;
    let chosen: string | null = "";
    try {
      chosen = localStorage.getItem("xwc.canvas.device");
    } catch {}
    if (chosen !== null) return;
    const own = deviceForMachine(iphone.productType, 0, 0);
    if (own) setDeviceId(own.id);
  }, [iphone?.productType, setDeviceId]);

  const waitForApp = (ms: number) => {
    if (!iphone) return;
    stopWaiting();
    const udid = iphone.udid;
    setLive("waiting");
    setLiveError(null);
    const step = async () => {
      const w = waiting.current;
      if (!w) return;
      try {
        const res = await api.previewConnect(udid);
        if (waiting.current !== w) {
          void api.previewDisconnect().catch(() => undefined);
          return;
        }
        waiting.current = null;
        session.current = res.session;
        handleMessage(res.hello);
      } catch (e) {
        if (waiting.current !== w) return;
        if (Date.now() > w.until || !appNotOpen(e)) {
          waiting.current = null;
          setLive("error");
          setLiveError(liveErrorText(e));
          return;
        }
        w.timer = window.setTimeout(() => void step(), 2000);
      }
    };
    waiting.current = { until: Date.now() + ms, timer: window.setTimeout(() => void step(), 1000) };
  };

  const connect = async () => {
    if (live === "live" || live === "connecting" || live === "waiting") {
      stopWaiting();
      session.current = 0;
      await api.previewDisconnect().catch(() => undefined);
      setLive("off");
      setLiveInfo(null);
      setLiveStats(null);
      return;
    }
    if (!iphone) {
      setLive("error");
      setLiveError(t("canvas.noIphone"));
      return;
    }
    setLive("connecting");
    setLiveError(null);
    try {
      const res = await api.previewConnect(iphone.udid);
      session.current = res.session;
      handleMessage(res.hello);
    } catch (e) {
      session.current = 0;
      if (appNotOpen(e)) {
        waitForApp(5 * 60 * 1000);
        return;
      }
      setLive("error");
      setLiveError(liveErrorText(e));
    }
  };

  const install = async () => {
    if (!iphone) return;
    const prepared = await api.previewPrepare().catch((e) => {
      useStore.getState().toast("error", errorMessage(e));
      return null;
    });
    if (!prepared) return;
    previewRoot.current = prepared.root;
    await useStore.getState().runTask(
      t("canvas.installing"),
      "run",
      () => api.startBuild({ root: prepared.root, action: "run", configuration: "debug", destination: { kind: "device", udid: iphone.udid, name: iphone.name } }),
      { root: prepared.root, ios: true, udid: iphone.udid, deviceName: iphone.name },
    );
    if (useStore.getState().task?.status === "running") waitForApp(10 * 60 * 1000);
  };

  const targets = useMemo(() => (ready ? rt.targets(path) : []), [ready, rt, path, result]);
  const screen = screenOf(device, landscape);
  const frame = frameOf(device, screen);
  const fit = stageSize.width && stageSize.height ? Math.min((stageSize.width - 24) / frame.width, (stageSize.height - 24) / frame.height, 1) : 0.5;
  const zoom = zoomPref === "fit" ? fit : Number(zoomPref) / 100;
  const showVariants = variantMode !== "off" && variantResults.length > 0;
  const variantFrames = variantResults.map((v) => {
    const sc = screenOf(v.device, v.landscape);
    return { screen: sc, frame: frameOf(v.device, sc) };
  });
  const variantWidth = variantFrames.reduce((sum, v) => sum + v.frame.width, 0) + 28 * Math.max(variantResults.length - 1, 0);
  const variantHeight = variantFrames.reduce((max, v) => Math.max(max, v.frame.height), 0) + 60;
  const variantFit = stageSize.width && stageSize.height && variantWidth ? Math.min((stageSize.width - 24) / variantWidth, (stageSize.height - 24) / variantHeight, 1) : 0.4;
  const variantZoom = zoomPref === "fit" ? variantFit : Number(zoomPref) / 100;
  const openVariants = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const item = (mode: VariantMode, label: string, disabled = false): MenuEntry => ({ type: "item", label, checked: variantMode === mode, disabled, onSelect: () => setVariantMode(mode) });
    variantMenu.toggle({
      x: r.left,
      y: r.bottom + 4,
      entries: [
        item("off", t("canvas.variants.off")),
        { type: "separator" },
        item("scheme", t("canvas.variants.scheme")),
        item("devices", t("canvas.variants.devices")),
        item("previews", t("canvas.variants.previews"), targets.length < 2),
        item("type", t("canvas.variants.type")),
        item("orientation", t("canvas.variants.orientation")),
      ],
    });
  };
  const openType = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    typeMenu.toggle({
      x: r.left,
      y: r.bottom + 4,
      entries: [
        { type: "title", label: t("canvas.textSize") },
        ...TYPE_SIZES.map(([name]): MenuEntry => ({
          type: "item",
          label: name === "large" ? `${TYPE_LABELS[name]} · ${t("canvas.textSizeDefault")}` : TYPE_LABELS[name],
          checked: typeSize === name,
          onSelect: () => setTypeSize(name),
        })),
      ],
    });
  };
  const perf = result ? estimatePerf(device, result.stats) : null;
  const simulated = (result?.notes ?? []).filter((n) => n.startsWith("~")).map((n) => n.slice(1));
  const unsupported = (result?.notes ?? []).filter((n) => !n.startsWith("~") && !n.startsWith("?"));
  const error = result?.errors[0];

  const entering = motion?.entering;
  const env = useMemo<RenderEnv>(
    () => ({
      dark: effectiveDark,
      tint: accent ? (cssColor({ rgba: effectiveDark && accent.dark ? accent.dark : accent.light }, false) ?? "#0A84FF") : (cssColor({ name: "blue" }, effectiveDark) ?? "#0A84FF"),
      buttonStyle: "automatic",
      controlSize: "regular",
      listStyle: "automatic",
      pickerStyle: "automatic",
      textFieldStyle: "automatic",
      disabled: false,
      inList: false,
      assets,
      dispatch,
      entering,
    }),
    [effectiveDark, accent, assets, dispatch, entering],
  );
  const variantEnvs = useMemo(
    () =>
      variantResults.map((v) => {
        const isDark = rootScheme(v.tree) ? rootScheme(v.tree) === "dark" : v.dark;
        return { ...env, dark: isDark, tint: cssColor({ name: "blue" }, isDark) ?? "#0A84FF" };
      }),
    [env, variantResults],
  );
  const preview = useMemo(() => (tree ? <Node node={tree} env={env} axis="y" /> : null), [tree, env]);

  return (
    <div className="canvas">
      <div className="canvas-bar">
        <span className="canvas-title">{t("canvas.title")}</span>
        <span className="grow" />
        <button className={`icon-btn${selectMode ? " on" : ""}`} title={t(selectMode ? "canvas.selectOn" : "canvas.selectOff")} onClick={() => (setSelectMode(!selectMode), setPicked(null))}>
          <MousePointer2 size={14} />
        </button>
        <button className={`icon-btn${variantMode !== "off" ? " on" : ""}`} title={t("canvas.variants")} onClick={openVariants}>
          <LayoutGrid size={14} />
        </button>
        {variantMenu.node}
        <button className={`icon-btn${landscape ? " on" : ""}`} title={t("canvas.rotate")} onClick={() => setLandscape(!landscape)}>
          <RotateCwSquare size={14} />
        </button>
        <button className={`icon-btn${typeSize !== "large" ? " on" : ""}`} title={t("canvas.textSize")} onClick={openType}>
          <ALargeSmall size={15} />
        </button>
        {typeMenu.node}
        <DevicePicker device={device} owned={owned} onChange={setDeviceId} />
        <button
          className="icon-btn"
          title={t(schemePref === "auto" ? "canvas.schemeAuto" : schemePref === "dark" ? "canvas.schemeDark" : "canvas.schemeLight")}
          onClick={() => setSchemePref(schemePref === "auto" ? "light" : schemePref === "light" ? "dark" : "auto")}
        >
          {schemePref === "auto" ? <SunMoon size={15} /> : schemePref === "dark" ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <button
          className="icon-btn canvas-zoom-btn"
          title={t("canvas.zoomFit")}
          onClick={() => setZoomPref(zoomPref === "fit" ? "100" : zoomPref === "100" ? "75" : zoomPref === "75" ? "50" : "fit")}
        >
          {zoomPref === "fit" ? <Maximize size={14} /> : `${zoomPref}%`}
        </button>
        <button className="icon-btn" title={t("canvas.reset")} onClick={() => (rt.resetState(), rerenderNow())}>
          <RotateCcw size={14} />
        </button>
        <button className="icon-btn" title={t("canvas.close")} onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="canvas-live">
        {targets.length > 1 && (
          <Select width={150} value={target ?? ""} options={targets.map((x) => ({ value: x.key, label: x.label }))} onChange={(v) => setTarget(v)} />
        )}
        {devices.length > 1 && (
          <Select
            width={140}
            value={iphone?.udid ?? ""}
            options={devices.map((d) => ({ value: d.udid, label: `${d.name.trim() || "iPhone"} · ${modelName(d.productType) ?? d.deviceClass ?? ""}` }))}
            onChange={(v) => {
              if (v === iphone?.udid) return;
              if (session.current) {
                session.current = 0;
                void api.previewDisconnect().catch(() => undefined);
                setLive("off");
                setLiveInfo(null);
                setLiveStats(null);
              }
              setLiveUdid(v);
            }}
          />
        )}
        <button className={`chip live-chip ${live}`} onClick={() => void connect()} title={t("canvas.liveHint")}>
          <Smartphone size={12} />
          {live === "live"
            ? t("canvas.liveOn", { name: liveInfo?.name ?? "iPhone" })
            : live === "connecting"
              ? t("canvas.connecting")
              : live === "waiting"
                ? t("canvas.waiting")
                : t("canvas.liveOff")}
        </button>
        {live === "live" && iphone && (
          <button
            className="icon-btn"
            title={t("canvas.screenshot")}
            disabled={shooting}
            onClick={() => {
              setShooting(true);
              void takeScreenshot(iphone).finally(() => setShooting(false));
            }}
          >
            {shooting ? <span className="spinner" /> : <Camera size={13} />}
          </button>
        )}
        {live === "live" && (
          <button className={`icon-btn rec-btn ${rec}`} title={rec === "on" ? t("canvas.stopRecording") : t("canvas.record")} disabled={rec === "starting" || rec === "saving"} onClick={toggleRecording}>
            {rec === "starting" || rec === "saving" ? <span className="spinner" /> : rec === "on" ? <Square size={10} fill="currentColor" /> : <Circle size={11} fill="currentColor" />}
          </button>
        )}
        {rec === "on" && <RecClock since={recSince} />}
        {rec === "saving" && <span className="canvas-stats">{t("canvas.savingVideo", { percent: Math.round(recDone * 100) })}</span>}
        {live === "error" && (
          <span className="canvas-live-error" title={liveError ?? ""}>
            {liveError}
          </span>
        )}
        {(live === "error" || live === "waiting") && iphone && (
          <button className="btn small" title={t("canvas.installHint")} onClick={() => void install()}>
            {t("canvas.installApp")}
          </button>
        )}
        {live === "live" && liveStats && (
          <span className="canvas-stats">
            <Zap size={11} />
            {t("canvas.liveStats", {
              fps: Math.round(liveStats.fps),
              max: liveInfo?.maxFps ?? 60,
              mem: Math.round(liveStats.memoryMB),
              cpu: Math.round(liveStats.cpu),
              thermal: t(`canvas.thermal.${liveStats.thermal}` as Parameters<typeof t>[0]),
            })}
          </span>
        )}
      </div>
      <div className="canvas-stage" ref={stage}>
        <PreviewBoundary resetKey={result}>
        {!trusted ? (
          <div className="canvas-empty">{t("canvas.restricted")}</div>
        ) : !ready ? (
          <div className="canvas-empty">{t("canvas.loading")}</div>
        ) : !tree ? (
          <div className="canvas-empty">{targets.length ? (error ? `${t("canvas.error")} ${error.message}` : t("canvas.nothing")) : t("canvas.noViews")}</div>
        ) : showVariants ? (
          <div className="canvas-variants" style={{ width: variantWidth * variantZoom, height: variantHeight * variantZoom }}>
            <div style={{ transform: `scale(${variantZoom})`, transformOrigin: "0 0", width: variantWidth, height: variantHeight, display: "flex", gap: 28, alignItems: "flex-start" }}>
              {variantResults.map((v, vi) => (
                <div key={v.key} className="canvas-variant">
                  <div className="canvas-variant-label" style={{ fontSize: 12 / variantZoom, height: 18 / variantZoom }}>
                    {v.label}
                  </div>
                  <div style={{ position: "relative", width: variantFrames[vi].frame.width, height: variantFrames[vi].frame.height }}>
                    <DeviceFrame device={v.device} screen={variantFrames[vi].screen} typeSize={v.typeSize} motion={motion?.curve} dark={rootScheme(v.tree) ? rootScheme(v.tree) === "dark" : v.dark} background={screenBackground(v.tree)}>
                      {v.tree && <Node node={v.tree} env={variantEnvs[vi]} axis="y" />}
                    </DeviceFrame>
                    {selectMode && v.tree && <SelectLayer zoom={variantZoom} nodes={indexNodes(v.tree)} path={path} picked={picked} onPick={pickNode} tree={v.tree} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="canvas-zoom" style={{ width: frame.width * zoom, height: frame.height * zoom }}>
            <div style={{ transform: `scale(${zoom})`, transformOrigin: "0 0", width: frame.width, height: frame.height, position: "relative" }}>
              <DeviceFrame device={device} screen={screen} typeSize={typeSize} motion={motion?.curve} dark={effectiveDark} background={screenBackground(tree)}>
                {preview}
              </DeviceFrame>
              {selectMode && <SelectLayer zoom={zoom} nodes={nodeIndex} path={path} picked={picked} onPick={pickNode} tree={tree} />}
            </div>
          </div>
        )}
        </PreviewBoundary>
      </div>
      <div className="canvas-foot">
        {error && error.line > 0 && (
          <span className="canvas-err" title={error.message}>
            {t("canvas.syntax", { line: error.line, message: error.message })}
          </span>
        )}
        {perf && (
          <span className={`canvas-perf ${perf.level}`} title={t("canvas.perfHint")}>
            {device.chip} · {device.ram} GB · {device.hz} Hz · {t(`canvas.perf.${perf.level}`)} · {t("canvas.frameTime", { ms: perf.frameMs.toFixed(1), budget: perf.budgetMs })}
          </span>
        )}
        {simulated.length > 0 && <span className="canvas-note" title={simulated.join(", ")}>{t("canvas.simulated", { list: simulated.slice(0, 3).join(", ") })}</span>}
        {unsupported.length > 0 && <span className="canvas-note" title={unsupported.join(", ")}>{t("canvas.unsupported", { list: unsupported.slice(0, 3).join(", ") })}</span>}
      </div>
    </div>
  );
}

function specsFor(mode: VariantMode, key: string | null, targets: { key: string; label: string }[], device: DeviceSpec, dark: boolean, landscape: boolean, typeSize: string): VariantSpec[] {
  if (!key || mode === "off") return [];
  const base = { device, dark, target: key, landscape, typeSize };
  if (mode === "scheme") {
    return [
      { ...base, key: "light", label: t("canvas.light"), dark: false },
      { ...base, key: "dark", label: t("canvas.dark"), dark: true },
    ];
  }
  if (mode === "devices") {
    const ids = device.family === "iPad" ? ["ipadmini", device.id, device.id === "ipadpro13" ? "ipadair11" : "ipadpro13"] : ["iphonese", device.id, device.id === "iphone17promax" ? "iphone13mini" : "iphone17promax"];
    const unique = [...new Set(ids)].map((id) => deviceById(id));
    unique.sort((a, b) => a.height - b.height);
    return unique.map((d) => ({ ...base, key: d.id, label: d.name, device: d }));
  }
  if (mode === "type") {
    return ["xSmall", "large", "xxxLarge", "accessibility3"].map((size) => ({ ...base, key: size, label: TYPE_LABELS[size], typeSize: size }));
  }
  if (mode === "orientation") {
    return [
      { ...base, key: "portrait", label: t("canvas.portrait"), landscape: false },
      { ...base, key: "landscape", label: t("canvas.landscape"), landscape: true },
    ];
  }
  return targets.slice(0, 6).map((x) => ({ ...base, key: x.key, label: x.label, target: x.key }));
}

function SelectLayer({ zoom, nodes, path, picked, onPick, tree }: { zoom: number; nodes: Map<string, ViewNode>; path: string; picked: string | null; onPick: (id: string) => void; tree: ViewNode }) {
  const cursor = useStore((s) => s.cursor);
  const marked = useMemo(() => {
    const doc = getDoc(path);
    let ids: string[] = [];
    if (doc) {
      const line = Math.min(cursor.line, doc.model.getLineCount());
      const offset = doc.model.getOffsetAt({ lineNumber: line, column: cursor.column });
      let best: SrcRange | null = null;
      const hits: { id: string; r: SrcRange }[] = [];
      for (const [id, n] of nodes) {
        for (const r of n.src ?? []) {
          if (!sameFile(r.f, path) || offset < r.a || offset > r.b) continue;
          hits.push({ id, r });
          if (!best || r.b - r.a < best.b - best.a) best = r;
          break;
        }
      }
      const b = best;
      if (b) ids = hits.filter((h) => h.r.a === b.a && h.r.b === b.b).map((h) => h.id);
    }
    return picked && ids.length === 0 ? [picked] : ids;
  }, [cursor, nodes, path, picked]);
  const layer = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<{ key: string; kind: "hover" | "mark"; x: number; y: number; w: number; h: number }[]>([]);
  const [moved, setMoved] = useState(0);

  useEffect(() => {
    const screen = layer.current?.parentElement?.querySelector<HTMLElement>(".pv-screen");
    if (!screen) return;
    const idAt = (target: EventTarget | null) => {
      const el = (target as Element | null)?.closest?.("[data-pv]");
      const id = el?.getAttribute("data-pv");
      return id && nodes.has(id) ? id : null;
    };
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const click = (e: Event) => {
      block(e);
      const id = idAt(e.target);
      if (id) onPick(id);
    };
    const move = (e: Event) => setHover(idAt(e.target));
    const leave = () => setHover(null);
    const scroll = () => setMoved((n) => n + 1);
    const blocked = ["pointerdown", "mousedown", "mouseup", "dblclick", "keydown", "input", "change"] as const;
    for (const type of blocked) screen.addEventListener(type, block, true);
    screen.addEventListener("click", click, true);
    screen.addEventListener("mousemove", move, true);
    screen.addEventListener("mouseleave", leave);
    screen.addEventListener("scroll", scroll, true);
    screen.classList.add("pv-selecting");
    return () => {
      for (const type of blocked) screen.removeEventListener(type, block, true);
      screen.removeEventListener("click", click, true);
      screen.removeEventListener("mousemove", move, true);
      screen.removeEventListener("mouseleave", leave);
      screen.removeEventListener("scroll", scroll, true);
      screen.classList.remove("pv-selecting");
    };
  }, [nodes, onPick]);

  useLayoutEffect(() => {
    const host = layer.current;
    if (!host) return;
    const origin = host.getBoundingClientRect();
    const out: typeof boxes = [];
    const add = (id: string, kind: "hover" | "mark") => {
      const els = host.parentElement?.querySelectorAll<HTMLElement>(`[data-pv="${CSS.escape(id)}"]`) ?? [];
      els.forEach((el, i) => {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
        out.push({ key: `${kind}:${id}:${i}`, kind, x: (r.left - origin.left) / zoom, y: (r.top - origin.top) / zoom, w: r.width / zoom, h: r.height / zoom });
      });
    };
    for (const id of marked) add(id, "mark");
    if (hover && !marked.includes(hover)) add(hover, "hover");
    setBoxes(out);
  }, [hover, marked, zoom, tree, moved]);

  return (
    <div ref={layer} className="pv-select-layer">
      {boxes.map((b) => (
        <div key={b.key} className={`pv-select-box ${b.kind}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
          {b.kind === "mark" && b.key === boxes.find((x) => x.kind === "mark")?.key && <span className="pv-select-tag">{nodes.get(b.key.split(":")[1])?.type}</span>}
        </div>
      ))}
    </div>
  );
}

function RecClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="rec-clock">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}

function DevicePicker({ device, owned, onChange }: { device: DeviceSpec; owned: DeviceSpec[]; onChange: (id: string) => void }) {
  const menu = useMenu();
  const item = (d: DeviceSpec): Extract<MenuEntry, { type: "item" }> => ({
    type: "item",
    label: d.name,
    detail: `${d.inches}″ · ${d.hz} Hz`,
    checked: d.id === device.id,
    onSelect: () => onChange(d.id),
  });
  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const entries: MenuEntry[] = [];
    if (owned.length) entries.push({ type: "title", label: t(owned.length > 1 ? "canvas.connected" : "canvas.yourIphone") }, ...owned.map((d) => ({ ...item(d), icon: <Smartphone size={13} /> })), { type: "separator" });
    for (const family of FAMILIES) {
      const models = DEVICES.filter((d) => d.family === family);
      if (models.length === 1) entries.push(item(models[0]));
      else if (models.length > 1) entries.push({ type: "submenu", label: family === "iPad" ? "iPad" : `iPhone ${family}`, checked: device.family === family, entries: models.map(item) });
    }
    menu.toggle({ x: r.left, y: r.bottom + 4, minWidth: Math.max(r.width, 170), entries });
  };
  return (
    <>
      <button className={`select${menu.isOpen ? " open" : ""}`} style={{ width: 136 }} title={`${device.name} · ${device.width} × ${device.height} pt · ${device.chip}`} onClick={open}>
        <span className="ellipsis">{device.name}</span>
        <ChevronsUpDown size={13} className="faint" />
      </button>
      {menu.node}
    </>
  );
}

function DeviceFrame({ device, screen, typeSize, dark, background, motion, children }: { device: DeviceSpec; screen: Screen; typeSize: string; dark: boolean; background: string; motion?: AnimCurve | null; children: React.ReactNode }) {
  const anim = motion ? curveCss(motion) : null;
  const fg = dark ? "#fff" : "#000";
  const home = device.cutout === "none" && !screen.ipad;
  const statusPad = screen.ipad ? "0 22px" : home ? "0 8px" : "0 30px";
  const lift = home || screen.ipad ? 0 : device.cutout === "island" ? 6 : 2;
  const classes = ["device-frame", home ? "home-button" : "", screen.ipad ? "ipad" : "", screen.landscape ? "landscape" : ""].filter(Boolean).join(" ");
  return (
    <div className={classes} style={{ borderRadius: home ? 54 : device.radius + (screen.ipad ? 18 : 12) }}>
      <div
        className={`pv-screen${anim ? " pv-animating" : ""}`}
        style={
          {
            "--pv-anim-dur": anim ? `${anim.duration}s` : undefined,
            "--pv-anim-ease": anim?.easing,
            width: screen.width,
            height: screen.height,
            borderRadius: device.radius,
            background: cssColor({ name: background }, dark),
            color: fg,
            "--pv-safe-top": `${screen.top}px`,
            "--pv-safe-bottom": `${screen.bottom}px`,
            "--pv-safe-left": `${screen.left}px`,
            "--pv-safe-right": `${screen.right}px`,
            "--pv-type": typeScale(typeSize),
            colorScheme: dark ? "dark" : "light",
          } as React.CSSProperties
        }
      >
        {screen.top > 0 && (
          <div className={`pv-status${screen.ipad ? " ipad" : ""}`} style={{ height: screen.top, color: fg, padding: statusPad }}>
            <span className="pv-time" style={{ paddingTop: lift }}>
              9:41{screen.ipad && <span className="pv-date">Mon Jun 9</span>}
            </span>
            <span className="pv-status-icons" style={{ paddingTop: lift }}>
              <Signal size={screen.ipad ? 13 : 16} strokeWidth={2.6} />
              <Wifi size={screen.ipad ? 13 : 16} strokeWidth={2.6} />
              <BatteryFull size={screen.ipad ? 18 : 22} strokeWidth={1.8} />
            </span>
          </div>
        )}
        {device.cutout === "island" && <div className="pv-island" />}
        {device.cutout === "notch" && <div className="pv-notch" />}
        <div className="pv-safe" style={{ padding: `${screen.top}px ${screen.right}px ${screen.bottom}px ${screen.left}px` }}>
          {children}
        </div>
        {(screen.bottom > 0 || screen.ipad) && <div className="pv-home" style={{ background: fg, width: screen.ipad ? 200 : screen.landscape ? 220 : 140, marginLeft: screen.ipad ? -100 : screen.landscape ? -110 : -70 }} />}
      </div>
    </div>
  );
}
