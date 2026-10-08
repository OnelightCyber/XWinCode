import { lineCol } from "./lexer";
import { parseSwift, type Cond, type Expr, type FileAST, type Method, type Property, type Stmt, type TypeDecl } from "./parser";
import {
  animCurve,
  applyMod,
  arg,
  fontCall,
  fontMethod,
  forEachRows,
  handlerOf,
  isViewName,
  makeColor,
  makeView,
  namedColor,
  sequence,
  toColor,
  toFont,
  withOpacity,
  type Ctx,
  type Handler,
} from "./swiftui";
import type { AnimCurve, Diagnostic, Mod, PreviewEvent, PreviewTarget, ViewNode } from "./types";
import {
  coerce,
  compare,
  copyValue,
  Dbl,
  describe,
  equals,
  isNum,
  isT,
  keyOf,
  nodesOf,
  num,
  placeholderFor,
  random,
  resetRandom,
  sprintf,
  truthy,
  views,
  type EvArg,
  type Slot,
  type V,
} from "./values";

interface Inst {
  decl: TypeDecl;
  fields: Map<string, Slot>;
  key: string;
  counters: Map<string, number>;
}

type SelfRef = { inst: Inst } | { value: V; decl: TypeDecl | null } | null;

class Env {
  vars = new Map<string, Slot>();

  constructor(
    readonly parent: Env | null,
    readonly self: SelfRef,
  ) {}

  get(name: string): Slot | undefined {
    for (let e: Env | null = this; e; e = e.parent) {
      const s = e.vars.get(name);
      if (s) return s;
    }
    return undefined;
  }

  define(name: string, v: V) {
    let cur = v;
    this.vars.set(name, {
      get: () => cur,
      set: (x) => {
        cur = x;
      },
    });
  }

  alias(name: string, slot: Slot) {
    this.vars.set(name, slot);
  }

  child(): Env {
    return new Env(this, this.self);
  }
}

class Signal {
  constructor(
    readonly kind: "ret" | "brk" | "cont",
    readonly value: V = null,
  ) {}
}

class Implicit {
  constructor(readonly value: V) {}
}

export class Fault extends Error {}

const STATE_ATTRS = ["State", "StateObject", "AppStorage", "SceneStorage", "FocusState", "GestureState", "SceneStorage", "Query"];

const BUILTIN_TYPES = new Set([
  "Color",
  "Font",
  "Double",
  "Float",
  "CGFloat",
  "Int",
  "UInt",
  "Int64",
  "Int32",
  "String",
  "Bool",
  "Array",
  "Set",
  "Dictionary",
  "UUID",
  "Date",
  "URL",
  "Calendar",
  "GridItem",
  "EdgeInsets",
  "CGSize",
  "CGPoint",
  "CGRect",
  "Angle",
  "Binding",
  "UIColor",
  "NSColor",
  "UIFont",
  "DispatchQueue",
  "Task",
  "Animation",
  "Edge",
  "Alignment",
  "HorizontalAlignment",
  "VerticalAlignment",
  "UnitPoint",
  "ContentMode",
  "Locale",
  "TimeZone",
  "Timer",
  "UserDefaults",
  "UIScreen",
  "UIDevice",
  "ProcessInfo",
  "LocalizedStringKey",
  "AttributedString",
  "Gradient",
  "ShapeStyle",
  "Material",
  "JSONDecoder",
  "JSONEncoder",
  "Data",
  "NumberFormatter",
  "DateFormatter",
  "Measurement",
  "Duration",
  "ContinuousClock",
  "Self",
]);

const MUTATING = new Set([
  "append",
  "insert",
  "remove",
  "removeAll",
  "removeLast",
  "removeFirst",
  "popLast",
  "sort",
  "shuffle",
  "reverse",
  "toggle",
  "negate",
  "removeValue",
  "updateValue",
  "formUnion",
  "subtract",
  "merge",
  "move",
]);

function parseSafely(src: string, path: string): ReturnType<typeof parseSwift> {
  try {
    return parseSwift(src, path);
  } catch (e) {
    return { ast: { types: [], previews: [], funcs: [], globals: [] }, errors: [{ message: e instanceof Error ? e.message : String(e), pos: 0 }] };
  }
}

export interface RenderResult {
  tree: ViewNode | null;
  errors: Diagnostic[];
  notes: string[];
  stats: { views: number; depth: number; heavy: number };
}

function mark(nodes: ViewNode[], s: Extract<Stmt, { k: "expr" }>): ViewNode[] {
  if (s.file === undefined || s.end === undefined) return nodes;
  for (const n of nodes) {
    const last = n.src?.[n.src.length - 1];
    if (last && last.f === s.file && last.a === s.pos && last.b === s.end) continue;
    (n.src ??= []).push({ f: s.file, a: s.pos, b: s.end });
  }
  return nodes;
}

export class Runtime {
  private files = new Map<string, { src: string; ast: FileAST; errors: { message: string; pos: number }[] }>();
  private types = new Map<string, TypeDecl>();
  private exts = new Map<string, TypeDecl[]>();
  private funcs = new Map<string, Method>();
  private globalProps = new Map<string, Property>();
  private globals = new Env(null, null);
  private state = new Map<string, V>();
  private statics = new Map<string, V>();
  private handlers = new Map<string, Handler>();
  private shared = new Map<string, V>();
  private notes = new Set<string>();
  private stack: Inst[] = [];
  private steps = 0;
  private uid = 1;
  scheme: "light" | "dark" = "light";
  size = { width: 393, height: 852 };
  typeSize = "large";
  pendingAnimation: AnimCurve | null = null;

  takeAnimation(): AnimCurve | null {
    const a = this.pendingAnimation;
    this.pendingAnimation = null;
    return a;
  }
  sizeClass: { h: "compact" | "regular"; v: "compact" | "regular" } = { h: "compact", v: "regular" };

  sourceOf(path: string): string | undefined {
    return this.files.get(path)?.src;
  }

  setFiles(list: { path: string; src: string }[]) {
    const seen = new Set<string>();
    for (const { path, src } of list) {
      seen.add(path);
      const prev = this.files.get(path);
      if (prev && prev.src === src) continue;
      this.files.set(path, { src, ...parseSafely(src, path) });
    }
    for (const path of [...this.files.keys()]) if (!seen.has(path)) this.files.delete(path);
    this.types.clear();
    this.exts.clear();
    this.funcs.clear();
    this.globalProps.clear();
    for (const { ast } of this.files.values()) {
      for (const t of ast.types) {
        if (t.kind === "extension") {
          const list2 = this.exts.get(t.name) ?? [];
          list2.push(t);
          this.exts.set(t.name, list2);
        } else if (!this.types.has(t.name)) this.types.set(t.name, t);
      }
      for (const f of ast.funcs) this.funcs.set(f.name, f);
      for (const g of ast.globals) this.globalProps.set(g.name, g);
    }
  }

  resetState() {
    this.state.clear();
    this.shared.clear();
  }

  targets(path: string): PreviewTarget[] {
    const file = this.files.get(path);
    if (!file) return [];
    const out: PreviewTarget[] = [];
    file.ast.previews.forEach((p, i) => out.push({ key: `preview:${i}`, label: p.name ?? (file.ast.previews.length > 1 ? `Preview ${i + 1}` : "Preview") }));
    for (const t of file.ast.types) {
      if (t.kind !== "struct" && t.kind !== "class") continue;
      if (t.inherits.some((i) => /\bPreviewProvider\b/.test(i))) out.push({ key: `provider:${t.name}`, label: t.name.replace(/_Previews$/, "") });
    }
    for (const t of file.ast.types) {
      if (t.kind !== "struct") continue;
      if (t.inherits.some((i) => /^(SwiftUI\.)?View$/.test(i.trim()))) out.push({ key: `view:${t.name}`, label: t.name });
    }
    for (const t of file.ast.types) {
      if (t.main || t.inherits.some((i) => /^(SwiftUI\.)?App$/.test(i.trim()))) out.push({ key: `app:${t.name}`, label: t.name });
    }
    return out;
  }

  render(path: string, key: string): RenderResult {
    this.handlers.clear();
    this.notes.clear();
    this.statics.clear();
    this.stack = [];
    this.steps = 0;
    resetRandom();
    const file = this.files.get(path);
    const errors: Diagnostic[] = (file?.errors ?? []).map((e) => ({ message: e.message, ...lineCol(file!.src, e.pos) }));
    const stats = { views: 0, depth: 0, heavy: 0 };
    if (!file) return { tree: null, errors, notes: [], stats };
    try {
      const nodes = this.evalTarget(file.ast, key);
      if (!nodes.length) return { tree: null, errors, notes: [...this.notes], stats };
      const root: ViewNode = nodes.length === 1 ? nodes[0] : { id: "", type: "VStack", props: { alignment: "center" }, children: nodes };
      this.assign(root, "r", 0, stats);
      return { tree: root, errors, notes: [...this.notes], stats };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { tree: null, errors: [...errors, { message, line: 0, column: 0 }], notes: [...this.notes], stats };
    }
  }

  dispatch(ev: PreviewEvent): boolean {
    const h = this.handlers.get(ev.id);
    if (!h) return false;
    this.steps = 0;
    try {
      if (h.kind === "tap") h.run();
      else if (h.kind === "set") h.run(ev.value);
      else if (ev.kind === "increment") h.inc();
      else if (ev.kind === "decrement") h.dec();
    } catch (e) {
      this.notes.add(e instanceof Error ? e.message : String(e));
    }
    return true;
  }

  private assign(n: ViewNode, id: string, depth: number, stats: RenderResult["stats"]) {
    n.id = id;
    stats.views++;
    stats.depth = Math.max(stats.depth, depth);
    const h = handlerOf(n);
    if (h) {
      n.event = id;
      this.handlers.set(id, h);
    }
    n.children?.forEach((c, i) => this.assign(c, `${id}.${i}`, depth + 1, stats));
    n.label?.forEach((c, i) => this.assign(c, `${id}.l${i}`, depth + 1, stats));
    const options = n.props.options as { label: ViewNode[] }[] | undefined;
    options?.forEach((o, k) => o.label.forEach((c, i) => this.assign(c, `${id}.o${k}.${i}`, depth + 1, stats)));
    n.mods?.forEach((m, j) => {
      if (m.m === "background" && m.view) m.view.forEach((c, i) => this.assign(c, `${id}.b${j}.${i}`, depth + 1, stats));
      if (m.m === "overlay") m.view.forEach((c, i) => this.assign(c, `${id}.v${j}.${i}`, depth + 1, stats));
      if (m.m === "tabItem") m.label.forEach((c, i) => this.assign(c, `${id}.t${j}.${i}`, depth + 1, stats));
      if (m.m === "shadow" || (m.m === "background" && m.material)) stats.heavy++;
      if (m.m === "onTap") {
        const mh = handlerOf(m);
        if (mh) {
          m.event = `${id}.tap${j}`;
          this.handlers.set(m.event, mh);
        }
      }
    });
  }

  private evalTarget(ast: FileAST, key: string): ViewNode[] {
    const [kind, name] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const env = this.globals.child();
    if (kind === "preview") {
      const p = ast.previews[Number(name)];
      if (!p) return [];
      return this.toNodes(this.runBody(p.body, env));
    }
    const decl = this.types.get(name);
    if (!decl) return [];
    if (kind === "view") return this.instantiateView(decl, [], [], `root:${name}`);
    if (kind === "provider") {
      const prop = this.findProp(decl, "previews");
      if (!prop) return [];
      return this.toNodes(this.propValue(prop, new Env(this.globals, { value: { t: "type", name }, decl })));
    }
    if (kind === "app") {
      const prop = this.findProp(decl, "body");
      if (!prop) return [];
      const inst: Inst = { decl, fields: new Map(), key: `app:${name}`, counters: new Map() };
      this.initFields(inst, [], [], new Env(this.globals, { inst }));
      return this.withInst(inst, () => this.toNodes(this.propValue(prop, new Env(this.globals, { inst }))));
    }
    return [];
  }

  private ctx(): Ctx {
    return {
      call: (fn, args) => this.callValue(fn, args.map((value) => ({ label: null, value })), []),
      build: (fn, args) => this.build(fn, args ?? []),
      scheme: this.scheme,
      size: this.size,
      note: (f) => this.notes.add(f),
    };
  }

  private build(fn: V | undefined, args: V[]): ViewNode[] {
    if (fn === undefined || fn === null) return [];
    const v = isT(fn, "closure") || isT(fn, "fn") ? this.callValue(fn, args.map((value) => ({ label: null, value })), []) : fn;
    return this.toNodes(v);
  }

  private toNodes(v: V): ViewNode[] {
    if (v === null || v === undefined) return [];
    const n = nodesOf(v);
    if (n) return n;
    if (isT(v, "color")) return [{ id: "", type: "Color", props: { color: v.spec } }];
    if (isT(v, "sym")) {
      const c = namedColor(v.name, this.scheme);
      if (c) return [{ id: "", type: "Color", props: { color: c } }];
    }
    if (typeof v === "string") return [{ id: "", type: "Text", props: { text: v } }];
    return [];
  }

  private withInst<T>(inst: Inst, fn: () => T): T {
    this.stack.push(inst);
    try {
      return fn();
    } finally {
      this.stack.pop();
    }
  }

  private childKey(name: string): string {
    const parent = this.stack[this.stack.length - 1];
    if (!parent) return `root:${name}`;
    const n = (parent.counters.get(name) ?? 0) + 1;
    parent.counters.set(name, n);
    return `${parent.key}/${name}#${n}`;
  }

  private findProp(decl: TypeDecl, name: string, wantStatic?: boolean): Property | undefined {
    const match = (p: Property) => p.name === name && (wantStatic === undefined || p.isStatic === wantStatic);
    return decl.props.find(match) ?? this.exts.get(decl.name)?.flatMap((e) => e.props).find(match);
  }

  private findMethod(decl: TypeDecl, name: string, wantStatic?: boolean): Method | undefined {
    const match = (m: Method) => m.name === name && (wantStatic === undefined || m.isStatic === wantStatic);
    return decl.methods.find(match) ?? this.exts.get(decl.name)?.flatMap((e) => e.methods).find(match);
  }

  private conforms(decl: TypeDecl, proto: string): boolean {
    const own = decl.inherits.some((i) => i.trim() === proto || i.trim() === `SwiftUI.${proto}`);
    return own || (this.exts.get(decl.name) ?? []).some((e) => e.inherits.some((i) => i.trim() === proto));
  }

  private instantiateView(decl: TypeDecl, args: EvArg[], trailing: V[], key: string): ViewNode[] {
    if (this.stack.length > 48) throw new Fault("Views are nested too deeply");
    const inst: Inst = { decl, fields: new Map(), key, counters: new Map() };
    const env = new Env(this.globals, { inst });
    try {
      return this.withInst(inst, () => {
        this.initFields(inst, args, trailing, env);
        const body = this.findProp(decl, "body", false);
        if (!body) return [];
        return this.toNodes(this.propValue(body, env));
      });
    } catch (e) {
      if (e instanceof Fault) return [{ id: "", type: "Unsupported", props: { name: `${decl.name}: ${e.message}` } }];
      throw e;
    }
  }

  private initFields(inst: Inst, args: EvArg[], trailing: V[], env: Env) {
    const decl = inst.decl;
    const stored = decl.props.filter((p) => !p.isStatic && !p.getter);
    const init = this.pickInit(decl, args);
    const pending = [...trailing];
    for (const p of stored) {
      const provided = init ? undefined : this.takeArg(p, args, pending);
      inst.fields.set(p.name, this.fieldSlot(inst, p, provided, env));
    }
    if (init) this.runInit(init, args, trailing, env);
  }

  private takeArg(p: Property, args: EvArg[], pending: V[]): V | undefined {
    const byLabel = args.find((a) => a.label === p.name);
    if (byLabel) return byLabel.value;
    const isClosureType = !!p.type && (/->/.test(p.type) || /^(Content|Label|Destination|some View|AnyView|Header|Footer)$/.test(p.type.trim()) || /View$/.test(p.type.trim()));
    if (isClosureType && pending.length) {
      const fn = pending.shift()!;
      if (/->/.test(p.type ?? "")) return fn;
      return views(this.build(fn, []));
    }
    return undefined;
  }

  private placeholder(type: string | null): V {
    const base = (type ?? "").replace(/[?!\s]/g, "");
    const decl = this.types.get(base);
    if (decl && (type ?? "").trim().endsWith("?")) return null;
    if (decl?.kind === "enum" && decl.cases.length) return { t: "sym", name: decl.cases[0].name, type: decl.name };
    if (decl && (decl.kind === "struct" || decl.kind === "class") && !this.conforms(decl, "View") && this.stack.length < 32) {
      try {
        return this.construct(decl, [], []);
      } catch (e) {
        if (!(e instanceof Fault)) throw e;
      }
    }
    return placeholderFor(type);
  }

  private fieldSlot(inst: Inst, p: Property, provided: V | undefined, env: Env): Slot {
    const attr = p.attrs.find((a) => /^[A-Z]/.test(a)) ?? "";
    const attrName = attr.replace(/\(.*$/, "");
    if (STATE_ATTRS.includes(attrName)) {
      const k = `${inst.key}#${p.name}`;
      if (!this.state.has(k)) {
        const v = provided !== undefined ? provided : p.init ? this.evalExpr(p.init, env) : attrName === "Query" ? [] : this.placeholder(p.type);
        this.state.set(k, coerce(copyValue(v), p.type));
      }
      return {
        get: () => this.state.get(k) ?? null,
        set: (v) => void this.state.set(k, coerce(v, p.type)),
      };
    }
    if (attrName === "Binding") {
      if (provided !== undefined && isT(provided, "binding")) return { get: provided.get, set: provided.set };
      let local: V = provided !== undefined ? provided : p.init ? this.evalExpr(p.init, env) : placeholderFor(p.type);
      return { get: () => local, set: (v) => void (local = v) };
    }
    if (attrName === "Environment") {
      const v = this.environmentValue(attr, p, env);
      return { get: () => v, set: () => {} };
    }
    if (attrName === "EnvironmentObject" || attrName === "ObservedObject" || attrName === "Bindable") {
      const v = provided !== undefined ? provided : this.sharedObject(p.type, p, env);
      return { get: () => v, set: () => {} };
    }
    if (attrName === "Namespace") {
      const v: V = { t: "sym", name: "namespace" };
      return { get: () => v, set: () => {} };
    }
    let value: V = provided !== undefined ? provided : p.init ? this.evalExpr(p.init, env) : this.placeholder(p.type);
    value = coerce(value, p.type);
    return {
      get: () => value,
      set: (v) => void (value = coerce(v, p.type)),
    };
  }

  private environmentValue(attr: string, p: Property, env: Env): V {
    const key = /\\\.(\w+)/.exec(attr)?.[1];
    switch (key) {
      case "colorScheme":
        return { t: "sym", name: this.scheme };
      case "dismiss":
      case "openURL":
      case "openWindow":
      case "dismissSearch":
      case "refresh":
        return { t: "fn", name: key, call: () => null };
      case "horizontalSizeClass":
        return { t: "sym", name: this.sizeClass.h };
      case "verticalSizeClass":
        return { t: "sym", name: this.sizeClass.v };
      case "dynamicTypeSize":
        return { t: "sym", name: this.typeSize };
      case "scenePhase":
        return { t: "sym", name: "active" };
      case "isEnabled":
      case "isPresented":
        return key === "isEnabled";
      case "locale":
        return { t: "sym", name: "current" };
      case "editMode":
        return null;
    }
    const typeName = /\(\s*(\w+)\.self\s*\)/.exec(attr)?.[1];
    if (typeName) return this.sharedObject(typeName, p, env);
    return null;
  }

  private sharedObject(typeName: string | null, p: Property, env: Env): V {
    const name = (typeName ?? "").replace(/[?!]/g, "").trim();
    if (!name) return p.init ? this.evalExpr(p.init, env) : null;
    const existing = this.shared.get(name);
    if (existing !== undefined) return existing;
    const decl = this.types.get(name);
    const v = decl ? this.construct(decl, [], []) : null;
    this.shared.set(name, v);
    return v;
  }

  private pickInit(decl: TypeDecl, args: EvArg[]): Method | undefined {
    const inits = [...decl.inits, ...(this.exts.get(decl.name)?.flatMap((e) => e.inits) ?? [])];
    if (!inits.length) return undefined;
    const labels = args.map((a) => a.label);
    return (
      inits.find((m) => {
        const required = m.params.filter((p) => !p.def);
        if (required.length > args.length || m.params.length < args.length) return false;
        return labels.every((l, i) => (m.params[i]?.label ?? null) === l);
      }) ??
      inits.find((m) => m.params.length === args.length) ??
      undefined
    );
  }

  private runInit(init: Method, args: EvArg[], trailing: V[], env: Env) {
    const local = env.child();
    const pending = [...trailing];
    init.params.forEach((param, i) => {
      const a = args.find((x) => x.label === param.label && param.label !== null) ?? args[i];
      let v: V = a !== undefined ? a.value : param.def ? this.evalExpr(param.def, local) : pending.length ? pending.shift()! : this.placeholder(param.type);
      v = coerce(v, param.type);
      local.define(param.name, v);
    });
    this.runBody(init.body, local);
  }

  private propValue(p: Property, env: Env): V {
    if (p.getter) return this.runBody(p.getter, env.child());
    if (p.init) return this.evalExpr(p.init, env);
    return placeholderFor(p.type);
  }

  construct(decl: TypeDecl, args: EvArg[], trailing: V[]): V {
    if (this.conforms(decl, "View")) return views(this.instantiateView(decl, args, trailing, this.childKey(decl.name)));
    if (["UIViewRepresentable", "UIViewControllerRepresentable", "NSViewRepresentable", "NSViewControllerRepresentable"].some((p) => this.conforms(decl, p))) {
      this.notes.add(`~${decl.name}`);
      return views([{ id: "", type: "Unsupported", props: { name: decl.name } }]);
    }
    if (decl.kind === "enum") {
      const raw = arg(args, "rawValue");
      if (raw !== undefined) {
        const c = decl.cases.find((x) => equals(this.caseRaw(decl, x.name), raw));
        return c ? { t: "sym", name: c.name, type: decl.name } : null;
      }
      return null;
    }
    const fields = new Map<string, V>();
    const value: V = decl.kind === "class" ? { t: "obj", type: decl, fields, uid: this.uid++ } : { t: "rec", type: decl, fields };
    const env = new Env(this.globals, { value, decl });
    const stored = decl.props.filter((p) => !p.isStatic && !p.getter);
    const init = this.pickInit(decl, args);
    const pending = [...trailing];
    for (const p of stored) {
      const provided = init ? undefined : this.takeArg(p, args, pending);
      const v = provided !== undefined ? provided : p.init ? this.evalExpr(p.init, env) : this.placeholder(p.type);
      fields.set(p.name, coerce(copyValue(v), p.type));
    }
    if (init) this.runInit(init, args, trailing, env);
    return value;
  }

  private caseRaw(decl: TypeDecl, name: string): V {
    const c = decl.cases.find((x) => x.name === name);
    if (c?.raw) return this.evalExpr(c.raw, this.globals);
    if (decl.inherits.some((i) => /^(Int|Int\d+)$/.test(i.trim()))) {
      let n = 0;
      for (const x of decl.cases) {
        if (x.raw) n = num(this.evalExpr(x.raw, this.globals));
        if (x.name === name) return n;
        n++;
      }
    }
    return name;
  }

  runBody(stmts: Stmt[], env: Env): V {
    const out: ViewNode[] = [];
    const r = this.runBlock(stmts, env, out);
    if (r instanceof Signal) return r.kind === "ret" ? r.value : out.length ? views(out) : null;
    if (r instanceof Implicit) return r.value;
    if (out.length) return views(out);
    return null;
  }

  private runBlock(stmts: Stmt[], env: Env, out: ViewNode[]): Signal | Implicit | undefined {
    let last: V = null;
    let exprs = 0;
    for (const s of stmts) {
      if (++this.steps > 300000) throw new Fault("Too many steps");
      if (s.k === "expr") {
        const v = this.evalExpr(s.e, env);
        exprs++;
        last = v;
        const n = this.toNodes(v);
        if (n.length && !(typeof v === "string" && stmts.length === 1 && !this.inBuilder(s.e))) out.push(...mark(n, s));
        continue;
      }
      const r = this.exec(s, env, out);
      if (r instanceof Signal) return r;
      if (r instanceof Implicit && stmts.length === 1) return r;
    }
    if (stmts.length === 1 && exprs === 1 && !nodesOf(last) && !isT(last, "color")) return new Implicit(last);
    return undefined;
  }

  private inBuilder(e: Expr): boolean {
    return e.k === "call" || e.k === "member";
  }

  private exec(s: Stmt, env: Env, out: ViewNode[]): Signal | Implicit | undefined {
    switch (s.k) {
      case "decl": {
        let v: V = s.init ? copyValue(this.evalExpr(s.init, env)) : placeholderFor(s.type);
        v = coerce(v, s.type);
        if (s.names.length === 1) env.define(s.names[0], v);
        else {
          const items = isT(v, "tuple") ? v.items : Array.isArray(v) ? v : [];
          s.names.forEach((n, i) => env.define(n, items[i] ?? null));
        }
        return undefined;
      }
      case "seq":
        for (const b of s.body) {
          const r = this.exec(b, env, out);
          if (r instanceof Signal) return r;
        }
        return undefined;
      case "assign":
        this.assignTo(s.target, s.op, s.value, env);
        return undefined;
      case "expr": {
        const v = this.evalExpr(s.e, env);
        out.push(...mark(this.toNodes(v), s));
        return undefined;
      }
      case "if": {
        const local = env.child();
        if (this.conds(s.conds, local)) return this.runBlock(s.then, local, out);
        if (s.else) return this.runBlock(s.else, env.child(), out);
        return undefined;
      }
      case "guard":
        if (!this.conds(s.conds, env)) return this.runBlock(s.else, env.child(), out);
        return undefined;
      case "for": {
        const items = sequence(this.evalExpr(s.seq, env));
        let n = 0;
        for (const item of items) {
          if (++n > 2000) break;
          const local = env.child();
          if (s.names.length > 1) {
            const parts = isT(item, "tuple") ? item.items : Array.isArray(item) ? item : [item];
            s.names.forEach((name, i) => local.define(name, parts[i] ?? null));
          } else local.define(s.names[0], item);
          const r = this.runBlock(s.body, local, out);
          if (r instanceof Signal) {
            if (r.kind === "brk") break;
            if (r.kind === "ret") return r;
          }
        }
        return undefined;
      }
      case "while": {
        let n = 0;
        while (truthy(this.evalExpr(s.cond, env))) {
          if (++n > 10000) throw new Fault("Loop does not end");
          const r = this.runBlock(s.body, env.child(), out);
          if (r instanceof Signal) {
            if (r.kind === "brk") break;
            if (r.kind === "ret") return r;
          }
        }
        return undefined;
      }
      case "switch": {
        const v = this.evalExpr(s.subject, env);
        for (const c of s.cases) {
          const local = env.child();
          if (c.patterns === null || c.patterns.some((p) => this.matches(p, v, local))) {
            const r = this.runBlock(c.body, local, out);
            return r instanceof Signal && r.kind === "brk" ? undefined : r;
          }
        }
        return undefined;
      }
      case "return":
        return new Signal("ret", s.e ? this.evalExpr(s.e, env) : null);
      case "break":
        return new Signal("brk");
      case "continue":
        return new Signal("cont");
    }
  }

  private conds(conds: Cond[], env: Env): boolean {
    for (const c of conds) {
      if (c.k === "expr") {
        if (!truthy(this.evalExpr(c.e, env))) return false;
      } else if (c.k === "let") {
        const v = this.evalExpr(c.e, env);
        if (v === null || v === undefined) return false;
        env.define(c.name, v);
      } else if (!this.matches(c.pattern, this.evalExpr(c.e, env), env)) return false;
    }
    return true;
  }

  private matches(p: Expr, v: V, env: Env): boolean {
    if (p.k === "id" && p.name === "_") return true;
    if (p.k === "member" && p.base === null) return isT(v, "sym") ? v.name === p.name : typeof v === "string" ? v === p.name : false;
    if (p.k === "call" && p.callee.k === "member" && p.callee.base === null) {
      if (!isT(v, "sym") || v.name !== p.callee.name) return false;
      p.args.forEach((a, i) => {
        if (a.value.k === "id") env.define(a.value.name, v.args?.[i]?.value ?? null);
      });
      return true;
    }
    if (p.k === "id" && !env.get(p.name) && !this.types.has(p.name) && /^[a-z]/.test(p.name)) {
      env.define(p.name, v);
      return true;
    }
    if (p.k === "tuple") {
      const items = isT(v, "tuple") ? v.items : [];
      return p.items.every((a, i) => this.matches(a.value, items[i] ?? null, env));
    }
    const pv = this.evalExpr(p, env);
    if (isT(pv, "range")) return isNum(v) && num(v) >= pv.lo && num(v) < pv.hi;
    return equals(pv, v);
  }

  private assignTo(target: Expr, op: string, valueExpr: Expr, env: Env) {
    if (target.k === "id" && target.name === "_") {
      this.evalExpr(valueExpr, env);
      return;
    }
    const slot = this.lvalue(target, env);
    let v = this.evalExpr(valueExpr, env);
    if (op !== "=") v = this.binop(op.slice(0, -1).replace(/^&(?=[+\-*])/, ""), slot.get(), v);
    slot.set(copyValue(v));
  }

  private lvalue(e: Expr, env: Env): Slot {
    if (e.k === "id") {
      const s = this.slotFor(e.name, env);
      if (s) return s;
      throw new Fault(`Cannot assign to '${e.name}'`);
    }
    if (e.k === "member" && e.base) {
      if (e.base.k === "id" && e.base.name === "self") {
        const s = this.selfSlot(env.self, e.name);
        if (s) return s;
      }
      const baseV = this.evalExpr(e.base, env);
      if (isT(baseV, "obj")) return this.fieldSlotOf(baseV, e.name);
      if (isT(baseV, "binding") && e.name === "wrappedValue") return { get: baseV.get, set: baseV.set };
      if (e.base.k === "member" && e.base.base?.k === "id" && e.base.base.name === "self") void 0;
      const baseSlot = this.lvalue(e.base, env);
      const name = e.name;
      return {
        get: () => this.member(baseSlot.get(), name, env),
        set: (x) => {
          const cur = baseSlot.get();
          if (isT(cur, "obj")) cur.fields.set(name, x);
          else if (isT(cur, "rec")) {
            const next = { t: "rec" as const, type: cur.type, fields: new Map(cur.fields) };
            next.fields.set(name, coerce(x, cur.type.props.find((p) => p.name === name)?.type ?? null));
            baseSlot.set(next);
          } else if (isT(cur, "tuple")) {
            const idx = /^\d+$/.test(name) ? Number(name) : cur.labels.indexOf(name);
            const items = cur.items.slice();
            items[idx] = x;
            baseSlot.set({ ...cur, items });
          }
        },
      };
    }
    if (e.k === "sub") {
      const baseSlot = this.lvalue(e.base, env);
      const idx = this.evalExpr(e.args[0].value, env);
      return {
        get: () => this.subscript(baseSlot.get(), idx, e.args),
        set: (x) => {
          const cur = baseSlot.get();
          if (Array.isArray(cur)) {
            const next = cur.slice();
            next[num(idx)] = x;
            baseSlot.set(next);
          } else if (isT(cur, "dict")) {
            const m = new Map(cur.m);
            if (x === null) m.delete(keyOf(idx));
            else m.set(keyOf(idx), [idx, x]);
            baseSlot.set({ t: "dict", m });
          }
        },
      };
    }
    throw new Fault("Unsupported assignment");
  }

  private fieldSlotOf(obj: Extract<V, { t: "obj" }>, name: string): Slot {
    return {
      get: () => obj.fields.get(name) ?? null,
      set: (v) => void obj.fields.set(name, coerce(v, obj.type.props.find((p) => p.name === name)?.type ?? null)),
    };
  }

  private selfSlot(self: SelfRef, name: string): Slot | undefined {
    if (!self) return undefined;
    if ("inst" in self) {
      const direct = self.inst.fields.get(name);
      if (direct) return direct;
      if (name.startsWith("_")) return self.inst.fields.get(name.slice(1));
      return undefined;
    }
    const v = self.value;
    if (isT(v, "obj") && (v.fields.has(name) || v.type.props.some((p) => p.name === name && !p.getter))) return this.fieldSlotOf(v, name);
    if (isT(v, "rec") && v.fields.has(name)) {
      return {
        get: () => v.fields.get(name) ?? null,
        set: (x) => void v.fields.set(name, x),
      };
    }
    return undefined;
  }

  private slotFor(name: string, env: Env): Slot | undefined {
    const local = env.get(name);
    if (local) return local;
    return this.selfSlot(env.self, name);
  }

  evalExpr(e: Expr, env: Env): V {
    switch (e.k) {
      case "num":
        return e.float ? new Dbl(e.v) : e.v;
      case "str": {
        let s = "";
        for (const p of e.parts) {
          if (typeof p === "string") s += p;
          else {
            const v = this.evalExpr(p.e, env);
            s += p.fmt ? sprintf(p.fmt, [v]) : describe(v);
          }
        }
        return s;
      }
      case "bool":
        return e.v;
      case "nil":
        return null;
      case "id":
        return this.lookup(e.name, env);
      case "member":
        if (e.base === null) return { t: "sym", name: e.name };
        return this.member(this.evalExpr(e.base, env), e.name, env);
      case "call":
        return this.evalCall(e, env);
      case "sub":
        return this.subscript(this.evalExpr(e.base, env), this.evalExpr(e.args[0].value, env), e.args, env);
      case "closure":
        return { t: "closure", fn: e, env };
      case "bin": {
        if (e.op === "&&") return truthy(this.evalExpr(e.l, env)) && truthy(this.evalExpr(e.r, env));
        if (e.op === "||") return truthy(this.evalExpr(e.l, env)) || truthy(this.evalExpr(e.r, env));
        if (e.op === "??") {
          const l = this.evalExpr(e.l, env);
          return l === null || l === undefined ? this.evalExpr(e.r, env) : l;
        }
        return this.binop(e.op, this.evalExpr(e.l, env), this.evalExpr(e.r, env));
      }
      case "un": {
        const v = this.evalExpr(e.e, env);
        if (e.op === "!") return !truthy(v);
        if (e.op === "-") return v instanceof Dbl ? new Dbl(-v.v) : -num(v);
        if (e.op === "~") return ~num(v);
        return v;
      }
      case "tern":
        return truthy(this.evalExpr(e.c, env)) ? this.evalExpr(e.a, env) : this.evalExpr(e.b, env);
      case "array":
        return e.items.map((x) => this.evalExpr(x, env));
      case "dict": {
        const m = new Map<string, [V, V]>();
        for (const [k, x] of e.entries) {
          const kv = this.evalExpr(k, env);
          m.set(keyOf(kv), [kv, this.evalExpr(x, env)]);
        }
        return { t: "dict", m };
      }
      case "keypath":
        return { t: "keypath", path: e.path };
      case "tuple":
        return { t: "tuple", items: e.items.map((a) => this.evalExpr(a.value, env)), labels: e.items.map((a) => a.label) };
      case "ifexpr": {
        const local = env.child();
        if (this.conds(e.conds, local)) return this.runBody(e.a, local);
        return e.b ? this.runBody(e.b, env.child()) : null;
      }
    }
  }

  private lookup(name: string, env: Env): V {
    if (name.startsWith("$") && !/^\$\d+$/.test(name)) {
      const base = name.slice(1);
      const local = env.get(name);
      if (local) return local.get();
      const slot = this.slotFor(base, env);
      if (slot) {
        const cur = slot.get();
        if (isT(cur, "binding")) return cur;
        return { t: "binding", get: () => slot.get(), set: (v) => slot.set(v) };
      }
      return { t: "binding", get: () => null, set: () => {} };
    }
    const local = env.get(name);
    if (local) return local.get();
    if (name === "self" || name === "Self" || name === "super") return name === "Self" ? this.selfType(env.self) : this.selfValue(env.self);
    const fromSelf = this.selfMember(env.self, name, env);
    if (fromSelf !== undefined) return fromSelf;
    const g = this.globalProps.get(name);
    if (g) {
      const k = `global:${name}`;
      if (!this.statics.has(k)) this.statics.set(k, this.propValue(g, this.globals));
      return this.statics.get(k) ?? null;
    }
    if (this.types.has(name) || BUILTIN_TYPES.has(name) || isViewName(name) || name === "ForEach" || name === "WindowGroup") return { t: "type", name };
    const f = this.funcs.get(name);
    if (f) return { t: "fn", name, call: (args, trailing) => this.callMethod(f, args, trailing, this.globals) };
    const builtin = this.builtinFunction(name);
    if (builtin) return builtin;
    if (/^\$\d+$/.test(name)) return null;
    if (/^[A-Z]/.test(name) || /^k[A-Z]/.test(name)) return this.opaque(name);
    throw new Fault(`Unknown name '${name}'`);
  }

  private enumOf(caseName: string): string | undefined {
    let found: string | undefined;
    for (const t of this.types.values()) {
      if (t.kind === "enum" && t.cases.some((c) => c.name === caseName)) {
        if (found) return undefined;
        found = t.name;
      }
    }
    return found;
  }

  private opaque(name: string): V {
    const base = name.replace(/^<|>$/g, "").split(".")[0];
    if (/^(CM|CL|AV|CH|LA|NW|CB|UI|NS|MK|HK|SK|WK|GK|EK|PH|CN|AR|RP|ST|SF|MP)[A-Z]/.test(base) || /Manager$|Engine$|Session$|Monitor$|Center$/.test(base)) this.notes.add(`~${base}`);
    return { t: "opaque", name };
  }

  private typeNamesOf(v: V): string[] {
    if (v instanceof Dbl) return ["Double", "CGFloat", "Float", "BinaryFloatingPoint", "FloatingPoint", "Numeric", "Comparable", "Int", "BinaryInteger"];
    if (typeof v === "number") return ["Int", "BinaryInteger", "SignedInteger", "FixedWidthInteger", "Numeric", "Comparable", "Double", "CGFloat", "BinaryFloatingPoint"];
    if (typeof v === "string") return ["String", "StringProtocol", "Substring"];
    if (typeof v === "boolean") return ["Bool"];
    if (Array.isArray(v)) return ["Array", "Collection", "Sequence", "RandomAccessCollection"];
    if (isT(v, "color")) return ["Color", "ShapeStyle"];
    if (isT(v, "font")) return ["Font"];
    if (isT(v, "date")) return ["Date"];
    if (isT(v, "dict")) return ["Dictionary"];
    if (isT(v, "views")) return ["View", "Shape"];
    if (isT(v, "sym") && !v.type) {
      if (toFont(v)) return ["Font"];
      if (toColor(v, this.scheme)) return ["Color", "ShapeStyle"];
    }
    return [];
  }

  private extMember(v: V, name: string, kind: "method" | "prop"): { m?: Method; p?: Property } | undefined {
    for (const t of this.typeNamesOf(v)) {
      for (const e of this.exts.get(t) ?? []) {
        if (kind === "method") {
          const m = e.methods.find((x) => x.name === name && !x.isStatic);
          if (m) return { m };
        } else {
          const p = e.props.find((x) => x.name === name && !x.isStatic && !!x.getter);
          if (p) return { p };
        }
      }
    }
    return undefined;
  }

  private selfValue(self: SelfRef): V {
    if (!self) return null;
    if ("inst" in self) return { t: "sym", name: "self" };
    return self.value;
  }

  private selfType(self: SelfRef): V {
    if (!self) return null;
    if ("inst" in self) return { t: "type", name: self.inst.decl.name };
    return self.decl ? { t: "type", name: self.decl.name } : null;
  }

  private selfMember(self: SelfRef, name: string, env: Env): V | undefined {
    if (!self) return undefined;
    if ("inst" in self) {
      const inst = self.inst;
      const f = inst.fields.get(name) ?? (name.startsWith("_") ? inst.fields.get(name.slice(1)) : undefined);
      if (f) return f.get();
      const p = this.findProp(inst.decl, name, false);
      if (p?.getter) return this.withInst(inst, () => this.runBody(p.getter!, new Env(this.globals, self).child()));
      const m = this.findMethod(inst.decl, name, false);
      if (m) return { t: "fn", name, call: (args, trailing) => this.withInst(inst, () => this.callMethod(m, args, trailing, new Env(this.globals, self))) };
      const sp = this.findProp(inst.decl, name, true);
      if (sp) return this.staticMember(inst.decl.name, name);
      return undefined;
    }
    const v = self.value;
    if (!self.decl || this.typeNamesOf(v).length) {
      const ext = this.extMember(v, name, "prop");
      if (ext?.p) return this.runBody(ext.p.getter!, new Env(this.globals, self).child());
      const extM = this.extMember(v, name, "method");
      if (extM?.m) {
        const m = extM.m;
        return { t: "fn", name, call: (args, trailing) => this.callMethod(m, args, trailing, new Env(this.globals, self)) };
      }
      if (!self.decl && /^[a-z]/.test(name)) {
        if (nodesOf(v)) return { t: "fn", name, call: (args, trailing) => this.callMember(v, name, args, trailing, env) };
        try {
          return this.member(v, name, env);
        } catch (e) {
          if (!(e instanceof Fault)) throw e;
        }
        if (this.typeNamesOf(v).length) return { t: "fn", name, call: (args, trailing) => this.callMember(v, name, args, trailing, env) };
        return undefined;
      }
      if (!self.decl) return undefined;
    }
    if (self.decl && isT(v, "type")) {
      const st = this.staticMember(self.decl.name, name);
      if (!isT(st, "sym") || st.type !== undefined || self.decl.cases.some((c) => c.name === name)) {
        if (!(isT(st, "sym") && st.type === self.decl.name && !self.decl.cases.some((c) => c.name === name))) return st;
      }
    }
    if (self.decl) {
      if ((isT(v, "rec") || isT(v, "obj")) && v.fields.has(name)) return v.fields.get(name) ?? null;
      const p = this.findProp(self.decl, name);
      if (p?.getter && !p.isStatic) return this.runBody(p.getter, new Env(this.globals, self).child());
      if (p?.isStatic) return this.staticMember(self.decl.name, name);
      const m = this.findMethod(self.decl, name);
      if (m) return { t: "fn", name, call: (args, trailing) => this.callMethod(m, args, trailing, new Env(this.globals, self)) };
      if (self.decl.kind === "enum" && self.decl.cases.some((c) => c.name === name)) return { t: "sym", name, type: self.decl.name };
    }
    void env;
    return undefined;
  }

  private callMethod(m: Method, args: EvArg[], trailing: V[], env: Env): V {
    const local = env.child();
    const pending = [...trailing];
    const used = new Set<number>();
    m.params.forEach((param, i) => {
      let idx = args.findIndex((a, j) => !used.has(j) && a.label !== null && a.label === param.label);
      if (idx < 0) idx = args.findIndex((a, j) => !used.has(j) && a.label === null && (param.label === null || i === j));
      let v: V;
      if (idx >= 0) {
        used.add(idx);
        v = args[idx].value;
      } else if (param.def) v = this.evalExpr(param.def, local);
      else if (pending.length) v = pending.shift()!;
      else v = placeholderFor(param.type);
      local.define(param.name, coerce(v, param.type));
    });
    return this.runBody(m.body, local);
  }

  callValue(fn: V, args: EvArg[], trailing: V[]): V {
    if (isT(fn, "fn")) return fn.call(args, trailing);
    if (isT(fn, "closure")) {
      const env = (fn.env as Env).child();
      const params = fn.fn.params;
      const values = [...args.map((a) => a.value), ...trailing];
      if (params.length === 1 && values.length > 1) values.splice(0, values.length, { t: "tuple", items: values.slice(), labels: values.map(() => null) });
      if (params.length > 1 && values.length === 1 && isT(values[0], "tuple")) values.splice(0, 1, ...(values[0] as Extract<V, { t: "tuple" }>).items);
      params.forEach((p, i) => {
        const v = values[i] ?? null;
        env.define(p, v);
        if (p.startsWith("$") && isT(v, "binding")) env.alias(p.slice(1), { get: v.get, set: v.set });
      });
      values.forEach((v, i) => env.define(`$${i}`, v));
      return this.runBody(fn.fn.body, env);
    }
    if (isT(fn, "type")) return this.callType(fn.name, args, trailing, this.globals);
    return null;
  }

  private evalCall(e: Extract<Expr, { k: "call" }>, env: Env): V {
    const args: EvArg[] = e.args.map((a) => ({ label: a.label, value: this.evalExpr(a.value, env) }));
    const trailing: V[] = [];
    for (const t of e.trailing) {
      const fn: V = { t: "closure", fn: t.fn, env };
      if (t.label === null) trailing.push(fn);
      else args.push({ label: t.label, value: fn });
    }
    const callee = e.callee;
    if (callee.k === "member" && callee.base === null) {
      if (callee.name === "constant") {
        const v = args[0]?.value ?? null;
        return { t: "binding", get: () => v, set: () => {} };
      }
      if (callee.name === "init") return null;
      return { t: "sym", name: callee.name, args };
    }
    if (callee.k === "member" && callee.base) {
      const name = callee.name;
      if (MUTATING.has(name)) {
        let slot: Slot | null = null;
        try {
          slot = this.lvalue(callee.base, env);
        } catch {
          slot = null;
        }
        if (slot) {
          const cur = slot.get();
          if (Array.isArray(cur) || typeof cur === "boolean" || isT(cur, "dict") || isNum(cur)) return this.mutate(slot, cur, name, args, trailing);
        }
      }
      const base = this.evalExpr(callee.base, env);
      return this.callMember(base, name, args, trailing, env);
    }
    if (callee.k === "id") {
      const local = env.get(callee.name);
      if (local) return this.callValue(local.get(), args, trailing);
      const self = env.self;
      if (self && "value" in self && !this.types.has(callee.name) && !isViewName(callee.name) && /^[a-z]/.test(callee.name)) {
        try {
          return this.callMember(self.value, callee.name, args, trailing, env);
        } catch (e) {
          if (!(e instanceof Fault)) throw e;
        }
      }
      const fromSelf = this.selfMember(env.self, callee.name, env);
      if (fromSelf !== undefined && (isT(fromSelf, "fn") || isT(fromSelf, "closure"))) return this.callValue(fromSelf, args, trailing);
      return this.callType(callee.name, args, trailing, env);
    }
    return this.callValue(this.evalExpr(callee, env), args, trailing);
  }

  private callType(name: string, args: EvArg[], trailing: V[], env: Env): V {
    const user = this.types.get(name);
    if (user) return this.construct(user, args, trailing);
    const f = this.funcs.get(name);
    if (f) return this.callMethod(f, args, trailing, this.globals);
    const ctx = this.ctx();
    if (name === "ForEach") {
      const data = arg(args, null);
      const fn = trailing[0] ?? arg(args, "content");
      return views(forEachRows(data ?? null, fn, ctx));
    }
    if (name === "WindowGroup" || name === "Settings" || name === "DocumentGroup" || name === "MenuBarExtra" || name === "Window") return views(this.build(trailing[0] ?? arg(args, "content"), []));
    if (isViewName(name)) {
      const nodes = makeView(name, args, trailing, ctx);
      if (nodes) return views(nodes);
    }
    const builtin = this.builtinCall(name, args, trailing, env);
    if (builtin !== undefined) return builtin;
    const fn = this.builtinFunction(name);
    if (fn && isT(fn, "fn")) return fn.call(args, trailing);
    return this.opaque(name);
  }

  private mutate(slot: Slot, cur: V, name: string, args: EvArg[], trailing: V[]): V {
    const a0 = args[0]?.value ?? null;
    if (typeof cur === "boolean" && name === "toggle") {
      slot.set(!cur);
      return null;
    }
    if (isNum(cur) && name === "negate") {
      slot.set(cur instanceof Dbl ? new Dbl(-cur.v) : -num(cur));
      return null;
    }
    if (isT(cur, "dict")) {
      const m = new Map(cur.m);
      if (name === "removeValue") m.delete(keyOf(a0));
      if (name === "updateValue") m.set(keyOf(args[1]?.value ?? null), [args[1]?.value ?? null, a0]);
      if (name === "removeAll") m.clear();
      slot.set({ t: "dict", m });
      return null;
    }
    if (!Array.isArray(cur)) return null;
    const next = cur.slice();
    let result: V = null;
    switch (name) {
      case "append":
        if (arg(args, "contentsOf") !== undefined) next.push(...sequence(arg(args, "contentsOf") ?? null));
        else next.push(copyValue(a0));
        break;
      case "insert": {
        const at = num(arg(args, "at") ?? 0);
        next.splice(at, 0, copyValue(a0));
        break;
      }
      case "remove":
        result = next.splice(num(arg(args, "at") ?? 0), 1)[0] ?? null;
        break;
      case "removeAll": {
        const pred = arg(args, "where") ?? trailing[0];
        if (pred !== undefined) {
          const kept = next.filter((x) => !truthy(this.callValue(pred, [{ label: null, value: x }], [])));
          next.splice(0, next.length, ...kept);
        } else next.length = 0;
        break;
      }
      case "removeLast":
      case "popLast":
        result = next.pop() ?? null;
        break;
      case "removeFirst":
        result = next.shift() ?? null;
        break;
      case "sort": {
        const by = arg(args, "by") ?? trailing[0];
        next.sort((x, y) => (by !== undefined ? (truthy(this.callValue(by, [{ label: null, value: x }, { label: null, value: y }], [])) ? -1 : 1) : compare(x, y)));
        break;
      }
      case "shuffle":
        next.sort(() => random() - 0.5);
        break;
      case "reverse":
        next.reverse();
        break;
      case "move": {
        const fromOffsets = arg(args, "fromOffsets");
        const to = num(arg(args, "toOffset") ?? 0);
        const idxs = sequence(fromOffsets ?? null).map(num);
        const moving = idxs.map((i) => next[i]);
        const rest = next.filter((_x, i) => !idxs.includes(i));
        rest.splice(Math.min(to, rest.length), 0, ...moving);
        next.splice(0, next.length, ...rest);
        break;
      }
      default:
        return null;
    }
    slot.set(next);
    return result;
  }

  private member(v: V, name: string, env: Env): V {
    if (v === null || v === undefined) return null;
    if (name === "self") return v;
    if (isT(v, "opaque")) return this.opaque(`${v.name}.${name}`);
    if (isT(v, "type")) return this.staticMember(v.name, name);
    const ext = this.extMember(v, name, "prop");
    if (ext?.p) return this.runBody(ext.p.getter!, new Env(this.globals, { value: v, decl: null }).child());
    if (isT(v, "binding")) {
      if (name === "wrappedValue") return v.get();
      if (name === "projectedValue") return v;
      return {
        t: "binding",
        get: () => this.member(v.get(), name, env),
        set: (x) => {
          const cur = v.get();
          if (isT(cur, "obj")) cur.fields.set(name, x);
          else if (isT(cur, "rec")) {
            const next = { t: "rec" as const, type: cur.type, fields: new Map(cur.fields) };
            next.fields.set(name, coerce(x, cur.type.props.find((p) => p.name === name)?.type ?? null));
            v.set(next);
          }
        },
      };
    }
    if (isT(v, "sym") && v.name === "self" && env.self && "inst" in env.self) {
      const r = this.selfMember(env.self, name, env);
      if (r !== undefined) return r;
    }
    if (isT(v, "rec") || isT(v, "obj")) {
      if (v.fields.has(name)) return v.fields.get(name) ?? null;
      const r = this.selfMember({ value: v, decl: v.type }, name, env);
      if (r !== undefined) return r;
    }
    const owner = isT(v, "sym") && !v.type ? this.enumOf(v.name) : undefined;
    const typed: V = owner && isT(v, "sym") ? { ...v, type: owner } : v;
    if (isT(typed, "sym") && typed.type) {
      const decl = this.types.get(typed.type);
      if (name === "rawValue" && decl) return this.caseRaw(decl, typed.name);
      if (name === "id" && decl) return typed.name;
      if (decl) {
        const r = this.selfMember({ value: typed, decl }, name, env);
        if (r !== undefined) return r;
      }
    }
    if (isT(v, "views") && name === "body") return v;
    return this.builtinMember(v, name, undefined, [], env);
  }

  private callMember(base: V, name: string, args: EvArg[], trailing: V[], env: Env): V {
    if (base === null || base === undefined) return null;
    if (name === "init") return null;
    if (isT(base, "opaque")) return this.opaque(`${base.name}.${name}`);
    if (isT(base, "type")) return this.staticCall(base.name, name, args, trailing, env);
    if (!nodesOf(base)) {
      const ext = this.extMember(base, name, "method");
      if (ext?.m) return this.callMethod(ext.m, args, trailing, new Env(this.globals, { value: base, decl: null }));
    }
    if (isT(base, "sym") && base.name === "self" && env.self && "inst" in env.self) {
      const r = this.selfMember(env.self, name, env);
      if (r !== undefined) return this.callValue(r, args, trailing);
    }
    let nodes = nodesOf(base);
    if (!nodes && (isT(base, "color") || (isT(base, "sym") && !base.type && namedColor(base.name, this.scheme) && !["opacity", "gradient", "mix"].includes(name)))) {
      if (!["opacity", "gradient", "mix", "secondary"].includes(name)) nodes = this.toNodes(base);
    }
    if (nodes) return this.applyModifier(nodes, base, name, args, trailing, env);
    if (isT(base, "sym") && !base.type) {
      const owner = this.enumOf(base.name);
      if (owner && this.findMethod(this.types.get(owner)!, name)) base = { ...base, type: owner };
    }
    if (isT(base, "rec") || isT(base, "obj") || (isT(base, "sym") && base.type)) {
      const decl = isT(base, "sym") ? this.types.get(base.type!) : base.type;
      if (decl) {
        const m = this.findMethod(decl, name);
        if (m) return this.callMethod(m, args, trailing, new Env(this.globals, { value: base, decl }));
        if (decl.kind !== "enum" || !isT(base, "sym")) {
          const f = (isT(base, "rec") || isT(base, "obj")) && base.fields.get(name);
          if (f && (isT(f, "closure") || isT(f, "fn"))) return this.callValue(f, args, trailing);
        }
      }
    }
    if (isT(base, "fn") || isT(base, "closure")) return this.callValue(this.member(base, name, env), args, trailing);
    return this.builtinMember(base, name, args, trailing, env);
  }

  private applyModifier(nodes: ViewNode[], base: V, name: string, args: EvArg[], trailing: V[], env: Env): V {
    if (name === "modifier") {
      const m = args[0]?.value ?? null;
      if (isT(m, "rec") || isT(m, "obj")) {
        const method = this.findMethod(m.type, "body");
        if (method) return this.callMethod(method, [{ label: "content", value: views(nodes) }], [], new Env(this.globals, { value: m, decl: m.type }));
      }
      return views(nodes);
    }
    const ext = this.exts.get("View")?.flatMap((x) => x.methods).find((m) => m.name === name);
    const userFirst = ext && !["padding", "frame", "font", "background", "foregroundStyle"].includes(name);
    if (userFirst && ext) return this.callMethod(ext, args, trailing, new Env(this.globals, { value: views(nodes), decl: null }));
    const out = applyMod(nodes, name, args, trailing, this.ctx());
    if (out) return views(out);
    if (ext) return this.callMethod(ext, args, trailing, new Env(this.globals, { value: views(nodes), decl: null }));
    const shapeExt = this.exts.get("Shape")?.flatMap((x) => x.methods).find((m) => m.name === name);
    if (shapeExt) return this.callMethod(shapeExt, args, trailing, new Env(this.globals, { value: views(nodes), decl: null }));
    this.notes.add(`.${name}()`);
    void base;
    void env;
    return views(nodes);
  }

  private staticMember(typeName: string, name: string): V {
    if (!this.types.has(typeName) && !BUILTIN_TYPES.has(typeName) && !this.exts.has(typeName) && !isViewName(typeName)) return this.opaque(`${typeName}.${name}`);
    const user = this.types.get(typeName);
    if (user) {
      if (user.kind === "enum" && user.cases.some((c) => c.name === name)) return { t: "sym", name, type: typeName };
      if (name === "allCases" && user.kind === "enum") return user.cases.map((c) => ({ t: "sym" as const, name: c.name, type: typeName }));
      const p = this.findProp(user, name, true);
      if (p) {
        const k = `${typeName}.${name}`;
        if (!this.statics.has(k)) this.statics.set(k, this.propValue(p, new Env(this.globals, { value: { t: "type", name: typeName }, decl: user })));
        return this.statics.get(k) ?? null;
      }
      const m = this.findMethod(user, name, true);
      if (m) return { t: "fn", name, call: (args, trailing) => this.callMethod(m, args, trailing, new Env(this.globals, { value: { t: "type", name: typeName }, decl: user })) };
      if (this.types.has(name)) return { t: "type", name };
      if (name === "init") return { t: "type", name: typeName };
    }
    const ext = this.exts.get(typeName)?.flatMap((x) => x.props).find((p) => p.name === name && p.isStatic);
    if (ext) {
      const k = `${typeName}.${name}`;
      if (!this.statics.has(k)) this.statics.set(k, this.propValue(ext, new Env(this.globals, { value: { t: "type", name: typeName }, decl: null })));
      return this.statics.get(k) ?? null;
    }
    switch (typeName) {
      case "Color":
      case "UIColor":
      case "NSColor": {
        const c = namedColor(name, this.scheme);
        if (c) return { t: "color", spec: c };
        break;
      }
      case "Font":
        if (toFont({ t: "sym", name })) return { t: "font", spec: toFont({ t: "sym", name })! };
        break;
      case "Double":
      case "CGFloat":
      case "Float":
        if (name === "pi") return new Dbl(Math.PI);
        if (name === "infinity" || name === "greatestFiniteMagnitude") return new Dbl(Infinity);
        if (name === "zero") return new Dbl(0);
        break;
      case "Int":
        if (name === "max") return Number.MAX_SAFE_INTEGER;
        if (name === "min") return Number.MIN_SAFE_INTEGER;
        if (name === "zero") return 0;
        break;
      case "Date":
        if (name === "now") return { t: "date", ms: Date.now() };
        break;
      case "CGSize":
      case "CGPoint":
      case "CGRect":
        if (name === "zero") return { t: "tuple", items: [new Dbl(0), new Dbl(0)], labels: typeName === "CGPoint" ? ["x", "y"] : ["width", "height"] };
        break;
      case "UIScreen":
        if (name === "main") return { t: "tuple", items: [{ t: "tuple", items: [{ t: "tuple", items: [new Dbl(this.size.width), new Dbl(this.size.height)], labels: ["width", "height"] }], labels: ["size"] }], labels: ["bounds"] };
        break;
    }
    return { t: "sym", name, type: BUILTIN_TYPES.has(typeName) ? undefined : typeName };
  }

  private staticCall(typeName: string, name: string, args: EvArg[], trailing: V[], env: Env): V {
    const member = this.staticMember(typeName, name);
    if (isT(member, "fn")) return member.call(args, trailing);
    if (isT(member, "type")) return this.callType(member.name, args, trailing, env);
    const first = arg(args, null);
    const range = arg(args, "in");
    switch (`${typeName}.${name}`) {
      case "Int.random":
        return isT(range ?? null, "range") ? (range as { lo: number }).lo + Math.floor(random() * ((range as { hi: number }).hi - (range as { lo: number }).lo)) : 0;
      case "Double.random":
      case "CGFloat.random": {
        const r = range as V;
        if (isT(r, "range")) return new Dbl(r.lo + random() * (r.hi - 1 - r.lo));
        return new Dbl(random());
      }
      case "Bool.random":
        return random() < 0.5;
      case "Font.system":
      case "Font.custom":
        return { t: "font", spec: fontCall(name, args) };
      case "Binding.constant":
        return { t: "binding", get: () => first ?? null, set: () => {} };
      case "Color.init":
        return { t: "color", spec: makeColor("", args, this.scheme) ?? { name: "gray" } };
    }
    if (isT(member, "sym")) return { ...member, args };
    if (isT(member, "color") && name !== "init") return this.builtinMember(member, name, args, trailing, env);
    return null;
  }

  private subscript(base: V, idx: V, args: { label: string | null }[], env?: Env): V {
    void env;
    if (Array.isArray(base)) {
      if (isT(idx, "range")) return base.slice(idx.lo, idx.hi);
      const i = num(idx);
      if (i < 0 || i >= base.length) throw new Fault("Index out of range");
      return base[i];
    }
    if (typeof base === "string") return base[num(idx)] ?? null;
    if (isT(base, "opaque")) return this.opaque(`${base.name}[]`);
    if (isT(base, "dict")) {
      const hit = base.m.get(keyOf(idx));
      if (hit) return hit[1];
      const def = args.find((a) => a.label === "default");
      return def ? null : null;
    }
    if (isT(base, "tuple")) return base.items[num(idx)] ?? null;
    return null;
  }

  private binop(op: string, a: V, b: V): V {
    switch (op) {
      case "==":
        return equals(a, b);
      case "!=":
        return !equals(a, b);
      case "===":
        return isT(a, "obj") && isT(b, "obj") ? a.uid === b.uid : a === b;
      case "!==":
        return !(isT(a, "obj") && isT(b, "obj") ? a.uid === b.uid : a === b);
      case "<":
        return compare(a, b) < 0;
      case ">":
        return compare(a, b) > 0;
      case "<=":
        return compare(a, b) <= 0;
      case ">=":
        return compare(a, b) >= 0;
      case "..<":
        return { t: "range", lo: num(a), hi: num(b) };
      case "...":
        return { t: "range", lo: num(a), hi: num(b) + 1 };
    }
    if (op === "+") {
      if (typeof a === "string" || typeof b === "string") return describe(a) + describe(b);
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      const na = nodesOf(a);
      const nb = nodesOf(b);
      if (na && nb && na.length === 1 && nb.length === 1 && na[0].type === "Text" && nb[0].type === "Text") {
        return views([{ ...na[0], props: { text: `${na[0].props.text ?? ""}${nb[0].props.text ?? ""}` } }]);
      }
    }
    const dbl = a instanceof Dbl || b instanceof Dbl;
    const x = num(a);
    const y = num(b);
    const wrap = (r: number) => (dbl ? new Dbl(r) : r);
    switch (op) {
      case "+":
      case "&+":
        return wrap(x + y);
      case "-":
      case "&-":
        return wrap(x - y);
      case "*":
      case "&*":
        return wrap(x * y);
      case "/":
        if (!dbl) {
          if (y === 0) {
            this.notes.add("?division by zero");
            return 0;
          }
          return Math.trunc(x / y);
        }
        return new Dbl(y === 0 ? 0 : x / y);
      case "%":
        if (y === 0) return wrap(0);
        return wrap(x % y);
      case "&":
        return x & y;
      case "|":
        return x | y;
      case "^":
        return x ^ y;
      case "<<":
        return x << y;
      case ">>":
        return x >> y;
    }
    throw new Fault(`Operator '${op}' is not supported`);
  }

  private builtinFunction(name: string): V | undefined {
    const math1: Record<string, (x: number) => number> = {
      abs: Math.abs,
      sqrt: Math.sqrt,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round,
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      exp: Math.exp,
      log: Math.log,
      log2: Math.log2,
      log10: Math.log10,
      atan: Math.atan,
    };
    if (math1[name]) {
      const f = math1[name];
      return {
        t: "fn",
        name,
        call: (args) => {
          const v = args[0]?.value ?? 0;
          const r = f(num(v));
          return v instanceof Dbl || !Number.isInteger(r) ? new Dbl(r) : r;
        },
      };
    }
    switch (name) {
      case "min":
      case "max":
        return {
          t: "fn",
          name,
          call: (args) => {
            const vals = args.length === 1 ? sequence(args[0].value) : args.map((a) => a.value);
            if (!vals.length) return null;
            return vals.reduce((m, x) => ((name === "min" ? compare(x, m) < 0 : compare(x, m) > 0) ? x : m));
          },
        };
      case "pow":
        return { t: "fn", name, call: (args) => new Dbl(Math.pow(num(args[0]?.value ?? 0), num(args[1]?.value ?? 0))) };
      case "atan2":
        return { t: "fn", name, call: (args) => new Dbl(Math.atan2(num(args[0]?.value ?? 0), num(args[1]?.value ?? 0))) };
      case "print":
      case "debugPrint":
      case "dump":
      case "assert":
      case "assertionFailure":
      case "precondition":
        return { t: "fn", name, call: () => null };
      case "fatalError":
        return {
          t: "fn",
          name,
          call: (args) => {
            throw new Fault(describe(args[0]?.value ?? "fatalError"));
          },
        };
      case "withAnimation":
      case "withTransaction":
        return {
          t: "fn",
          name,
          call: (args, trailing) => {
            const body = trailing[0] ?? args[args.length - 1]?.value ?? null;
            if (name === "withAnimation") {
              const spec = trailing.length ? args[0]?.value : args.length > 1 ? args[0]?.value : undefined;
              const curve = animCurve(spec);
              if (curve) this.pendingAnimation = curve;
            }
            return this.callValue(body, [], []);
          },
        };
      case "zip":
        return {
          t: "fn",
          name,
          call: (args) => {
            const a = sequence(args[0]?.value ?? null);
            const b = sequence(args[1]?.value ?? null);
            return a.slice(0, b.length).map((x, i) => ({ t: "tuple" as const, items: [x, b[i]], labels: [null, null] }));
          },
        };
      case "stride":
        return {
          t: "fn",
          name,
          call: (args) => {
            const from = num(arg(args, "from") ?? 0);
            const by = num(arg(args, "by") ?? 1) || 1;
            const through = arg(args, "through");
            const to = through !== undefined ? num(through) : num(arg(args, "to") ?? 0);
            const dbl = [arg(args, "from"), arg(args, "by"), arg(args, "to"), through].some((x) => x instanceof Dbl);
            const out: V[] = [];
            for (let x = from; by > 0 ? (through !== undefined ? x <= to : x < to) : through !== undefined ? x >= to : x > to; x += by) {
              out.push(dbl ? new Dbl(x) : x);
              if (out.length > 2000) break;
            }
            return out;
          },
        };
      case "type":
        return { t: "fn", name, call: (args) => (isT(args[0]?.value ?? null, "rec") ? { t: "type", name: (args[0].value as { type: TypeDecl }).type.name } : null) };
      case "__is":
        return {
          t: "fn",
          name,
          call: (args) => {
            const v = args[0]?.value ?? null;
            const t = describe(args[1]?.value ?? "");
            if (isT(v, "rec") || isT(v, "obj")) return v.type.name === t;
            if (t === "String") return typeof v === "string";
            if (t === "Int") return typeof v === "number";
            if (t === "Double") return v instanceof Dbl;
            if (t === "Bool") return typeof v === "boolean";
            return v !== null;
          },
        };
    }
    return undefined;
  }

  private builtinCall(name: string, args: EvArg[], trailing: V[], env: Env): V | undefined {
    const first = arg(args, null);
    switch (name) {
      case "Color":
        return { t: "color", spec: makeColor("", args, this.scheme) ?? { name: "gray" } };
      case "UIColor":
      case "NSColor":
        return { t: "color", spec: makeColor("", args, this.scheme) ?? { name: "gray" } };
      case "Font":
        return { t: "font", spec: {} };
      case "Double":
      case "CGFloat":
      case "Float":
      case "TimeInterval": {
        if (typeof first === "string") {
          const n = Number(first);
          return Number.isFinite(n) ? new Dbl(n) : null;
        }
        return new Dbl(num(first ?? 0));
      }
      case "Int":
      case "Int64":
      case "Int32":
      case "UInt": {
        if (typeof first === "string") {
          const n = Number(first);
          return Number.isInteger(n) ? n : null;
        }
        return Math.trunc(num(first ?? 0));
      }
      case "String": {
        const fmt = arg(args, "format");
        if (fmt !== undefined) return sprintf(describe(fmt), args.filter((a) => a.label === null).map((a) => a.value));
        const rep = arg(args, "repeating");
        if (rep !== undefined) return describe(rep).repeat(num(arg(args, "count") ?? 0));
        const d = arg(args, "describing") ?? first;
        if (isT(d ?? null, "range")) return describe(d ?? null);
        return d === undefined ? "" : Array.isArray(d) ? d.map((x) => describe(x)).join("") : describe(d);
      }
      case "Bool":
        return typeof first === "string" ? (first === "true" ? true : first === "false" ? false : null) : truthy(first ?? false);
      case "Array":
      case "Set":
      case "ContiguousArray": {
        const rep = arg(args, "repeating");
        if (rep !== undefined) return Array.from({ length: Math.min(2000, num(arg(args, "count") ?? 0)) }, () => copyValue(rep));
        const seq = sequence(first ?? null);
        if (name === "Set") {
          const seen = new Set<string>();
          return seq.filter((x) => (seen.has(keyOf(x)) ? false : (seen.add(keyOf(x)), true)));
        }
        return seq;
      }
      case "Dictionary":
        return { t: "dict", m: new Map() };
      case "UUID":
        return `${Math.floor(random() * 0xffffffff).toString(16).padStart(8, "0")}-0000-4000-8000-${Math.floor(random() * 0xffffffffffff).toString(16).padStart(12, "0")}`;
      case "Date": {
        const since = arg(args, "timeIntervalSinceNow");
        return { t: "date", ms: Date.now() + (since !== undefined ? num(since) * 1000 : 0) };
      }
      case "URL":
        return arg(args, "string") ?? first ?? null;
      case "GridItem":
        return { t: "sym", name: "GridItem", args };
      case "EdgeInsets":
        return {
          t: "tuple",
          items: ["top", "leading", "bottom", "trailing"].map((l) => arg(args, l) ?? new Dbl(0)),
          labels: ["top", "leading", "bottom", "trailing"],
        };
      case "CGSize":
        return { t: "tuple", items: [arg(args, "width") ?? new Dbl(0), arg(args, "height") ?? new Dbl(0)], labels: ["width", "height"] };
      case "CGPoint":
        return { t: "tuple", items: [arg(args, "x") ?? new Dbl(0), arg(args, "y") ?? new Dbl(0)], labels: ["x", "y"] };
      case "CGRect":
        return { t: "tuple", items: [arg(args, "x") ?? new Dbl(0), arg(args, "y") ?? new Dbl(0), arg(args, "width") ?? new Dbl(0), arg(args, "height") ?? new Dbl(0)], labels: ["x", "y", "width", "height"] };
      case "Angle":
        return { t: "sym", name: arg(args, "radians") !== undefined ? "radians" : "degrees", args: [{ label: null, value: arg(args, "degrees") ?? arg(args, "radians") ?? 0 }] };
      case "Binding": {
        const get = arg(args, "get");
        const set = arg(args, "set");
        return {
          t: "binding",
          get: () => (get !== undefined ? this.callValue(get, [], []) : null),
          set: (v) => void (set !== undefined ? this.callValue(set, [{ label: null, value: v }], []) : null),
        };
      }
      case "LocalizedStringKey":
      case "AttributedString":
      case "Text.init":
        return describe(first ?? "");
      case "Task":
      case "Timer":
      case "DispatchQueue":
        return null;
      case "Gradient":
        return { t: "sym", name: "gradient", args };
      case "StrokeStyle":
        return { t: "tuple", items: [arg(args, "lineWidth") ?? new Dbl(1)], labels: ["lineWidth"] };
      case "TimelineView":
        return views(this.build(trailing[0], [{ t: "tuple", items: [{ t: "date", ms: Date.now() }], labels: ["date"] }]));
      case "Animation":
        return null;
    }
    void trailing;
    void env;
    return undefined;
  }

  private builtinMember(v: V, name: string, args: EvArg[] | undefined, trailing: V[], env: Env): V {
    const call = args !== undefined;
    const a = args ?? [];
    const first = arg(a, null);
    const fnArg = trailing[0] ?? first ?? arg(a, "by") ?? arg(a, "where");
    const apply = (fn: V | undefined, ...xs: V[]) => this.callValue(fn ?? null, xs.map((value) => ({ label: null, value })), []);
    if (isT(v, "color")) {
      if (name === "opacity") return { t: "color", spec: withOpacity(v.spec, num(first ?? 1)) };
      if (name === "gradient" || name === "mix" || name === "secondary" || name === "shadow") return v;
      return this.applyModifier(this.toNodes(v), v, name, a, trailing, env);
    }
    if (isT(v, "font")) return call ? { t: "font", spec: fontMethod(v.spec, name, a) } : v;
    if (isT(v, "sym")) {
      const font = toFont(v);
      if (font && call) return { t: "font", spec: fontMethod(font, name, a) };
      if (font && !call && name === "bold") return { t: "font", spec: fontMethod(font, "bold", []) };
      const color = toColor(v, this.scheme);
      if (color) {
        if (name === "opacity") return { t: "color", spec: withOpacity(color, num(first ?? 1)) };
        if (name === "gradient" || name === "mix") return { t: "color", spec: color };
      }
      if (name === "rawValue" || name === "description") return v.name;
      if (name === "uuidString") return v.name;
      if (call) return { t: "sym", name: v.name, args: [...(v.args ?? []), { label: name, value: { t: "sym", name, args: a } }] };
      return { t: "sym", name: `${v.name}.${name}`, args: v.args };
    }
    if (typeof v === "string") {
      switch (name) {
        case "count":
          return [...v].length;
        case "isEmpty":
          return v.length === 0;
        case "uppercased":
          return v.toUpperCase();
        case "lowercased":
          return v.toLowerCase();
        case "capitalized":
        case "localizedCapitalized":
          return v.replace(/\b\w/g, (c) => c.toUpperCase());
        case "first":
          return v[0] ?? null;
        case "last":
          return v[v.length - 1] ?? null;
        case "hasPrefix":
          return v.startsWith(describe(first ?? ""));
        case "hasSuffix":
          return v.endsWith(describe(first ?? ""));
        case "contains":
        case "localizedCaseInsensitiveContains":
        case "localizedStandardContains":
          return name === "contains" ? v.includes(describe(first ?? "")) : v.toLowerCase().includes(describe(first ?? "").toLowerCase());
        case "split":
          return v.split(describe(arg(a, "separator") ?? first ?? " ")).filter((x) => x);
        case "components":
          return v.split(describe(arg(a, "separatedBy") ?? " "));
        case "trimmingCharacters":
          return v.trim();
        case "replacingOccurrences":
          return v.split(describe(arg(a, "of") ?? "")).join(describe(arg(a, "with") ?? ""));
        case "prefix":
          return v.slice(0, num(first ?? 0));
        case "suffix":
          return v.slice(Math.max(0, v.length - num(first ?? 0)));
        case "dropFirst":
          return v.slice(num(first ?? 1));
        case "dropLast":
          return v.slice(0, Math.max(0, v.length - num(first ?? 1)));
        case "reversed":
          return [...v].reverse().join("");
        case "description":
        case "uuidString":
        case "absoluteString":
        case "localized":
          return v;
        case "appending":
          return v + describe(first ?? "");
        case "isNumber":
          return /^\d$/.test(v);
        case "utf8":
        case "unicodeScalars":
          return [...v];
      }
    }
    if (isNum(v)) {
      const x = num(v);
      switch (name) {
        case "description":
          return describe(v);
        case "formatted":
          return this.formatNumber(v, first);
        case "rounded":
          return new Dbl(Math.round(x));
        case "isMultiple":
          return x % num(arg(a, "of") ?? 1) === 0;
        case "magnitude":
          return v instanceof Dbl ? new Dbl(Math.abs(x)) : Math.abs(x);
        case "squareRoot":
          return new Dbl(Math.sqrt(x));
        case "truncatingRemainder":
          return new Dbl(x % num(arg(a, "dividingBy") ?? 1));
        case "isZero":
          return x === 0;
        case "isNaN":
          return Number.isNaN(x);
        case "signum":
          return Math.sign(x);
        case "clamped":
          return v;
        case "degrees":
          return { t: "sym", name: "degrees", args: [{ label: null, value: v }] };
      }
    }
    if (typeof v === "boolean" && name === "description") return String(v);
    if (isT(v, "range")) {
      switch (name) {
        case "lowerBound":
          return v.lo;
        case "upperBound":
          return v.hi;
        case "count":
          return Math.max(0, v.hi - v.lo);
        case "contains":
          return num(first ?? 0) >= v.lo && num(first ?? 0) < v.hi;
      }
    }
    if (isT(v, "tuple")) {
      const idx = /^\d+$/.test(name) ? Number(name) : v.labels.indexOf(name);
      if (idx >= 0) return v.items[idx] ?? null;
      if (name === "size" || name === "frame") return v;
      if (name === "width" || name === "height") return new Dbl(0);
    }
    if (isT(v, "dict")) {
      switch (name) {
        case "count":
          return v.m.size;
        case "isEmpty":
          return v.m.size === 0;
        case "keys":
          return [...v.m.values()].map(([k]) => k);
        case "values":
          return [...v.m.values()].map(([, x]) => x);
      }
    }
    if (isT(v, "date")) {
      switch (name) {
        case "formatted":
          return a.length ? new Date(v.ms).toLocaleDateString() : new Date(v.ms).toLocaleString();
        case "timeIntervalSince1970":
          return new Dbl(v.ms / 1000);
        case "timeIntervalSinceReferenceDate":
          return new Dbl(v.ms / 1000 - 978307200);
        case "timeIntervalSinceNow":
          return new Dbl((v.ms - Date.now()) / 1000);
        case "timeIntervalSince": {
          const other = first;
          return new Dbl((v.ms - (isT(other ?? null, "date") ? (other as { ms: number }).ms : v.ms)) / 1000);
        }
        case "addingTimeInterval":
          return { t: "date", ms: v.ms + num(first ?? 0) * 1000 };
        case "description":
          return new Date(v.ms).toISOString();
      }
    }
    if (isT(v, "range") || Array.isArray(v) || isT(v, "dict")) {
      const list = sequence(v);
      switch (name) {
        case "count":
          return list.length;
        case "isEmpty":
          return list.length === 0;
        case "first":
          return call ? (list.find((x) => truthy(apply(arg(a, "where") ?? trailing[0], x))) ?? null) : (list[0] ?? null);
        case "last":
          return call ? ([...list].reverse().find((x) => truthy(apply(arg(a, "where") ?? trailing[0], x))) ?? null) : (list[list.length - 1] ?? null);
        case "indices":
          return { t: "range", lo: 0, hi: list.length };
        case "startIndex":
          return 0;
        case "endIndex":
          return list.length;
        case "enumerated":
          return list.map((x, i) => ({ t: "tuple" as const, items: [i, x], labels: ["offset", "element"] }));
        case "map":
          return list.map((x) => this.keyPathOr(fnArg, x));
        case "compactMap":
          return list.map((x) => this.keyPathOr(fnArg, x)).filter((x) => x !== null && x !== undefined);
        case "flatMap":
          return list.flatMap((x) => sequence(this.keyPathOr(fnArg, x)));
        case "filter":
          return list.filter((x) => truthy(this.keyPathOr(fnArg, x)));
        case "forEach":
          for (const x of list) apply(fnArg, x);
          return null;
        case "reduce": {
          const init = a[0]?.value ?? null;
          const fn = trailing[0] ?? a[1]?.value;
          if (arg(a, "into") !== undefined) return init;
          let acc: V = init;
          for (const x of list) acc = isT(fn ?? null, "id") ? acc : this.reduceStep(fn, acc, x);
          return acc;
        }
        case "sorted": {
          const by = arg(a, "by") ?? trailing[0] ?? first;
          const copy = list.slice();
          if (by === undefined) return copy.sort(compare);
          if (isT(by, "keypath")) return copy.sort((x, y) => compare(this.keyPathOr(by, x), this.keyPathOr(by, y)));
          return copy.sort((x, y) => (truthy(apply(by, x, y)) ? -1 : truthy(apply(by, y, x)) ? 1 : 0));
        }
        case "reversed":
          return list.slice().reverse();
        case "shuffled":
          return list.slice().sort(() => random() - 0.5);
        case "contains":
          return fnArg !== undefined && (isT(fnArg, "closure") || isT(fnArg, "fn")) ? list.some((x) => truthy(apply(fnArg, x))) : list.some((x) => equals(x, first ?? null));
        case "allSatisfy":
          return list.every((x) => truthy(apply(fnArg, x)));
        case "firstIndex": {
          const of = arg(a, "of");
          const i = of !== undefined ? list.findIndex((x) => equals(x, of)) : list.findIndex((x) => truthy(apply(arg(a, "where") ?? trailing[0], x)));
          return i < 0 ? null : i;
        }
        case "joined":
          return list.map((x) => describe(x)).join(describe(arg(a, "separator") ?? ""));
        case "prefix":
          return list.slice(0, num(first ?? 0));
        case "suffix":
          return list.slice(Math.max(0, list.length - num(first ?? 0)));
        case "dropFirst":
          return list.slice(num(first ?? 1));
        case "dropLast":
          return list.slice(0, Math.max(0, list.length - num(first ?? 1)));
        case "min":
        case "max": {
          if (!list.length) return null;
          const by = arg(a, "by") ?? trailing[0];
          return list.reduce((m, x) => {
            const less = by !== undefined ? truthy(apply(by, x, m)) : compare(x, m) < 0;
            return name === "min" ? (less ? x : m) : !less && !equals(x, m) ? x : m;
          });
        }
        case "randomElement":
          return list.length ? list[Math.floor(random() * list.length)] : null;
        case "lazy":
          return list;
        case "description":
          return describe(list);
        case "sum":
          return list.reduce((s: V, x) => this.binop("+", s, x), 0);
      }
      if (/^\d+$/.test(name)) return list[Number(name)] ?? null;
    }
    if (isT(v, "binding")) return this.member(v.get(), name, env);
    this.notes.add(call ? `?${name}()` : `?${name}`);
    return null;
  }

  private reduceStep(fn: V | undefined, acc: V, x: V): V {
    if (isT(fn ?? null, "fn") && (fn as { name: string }).name.length <= 2) return this.binop((fn as { name: string }).name, acc, x);
    return this.callValue(fn ?? null, [{ label: null, value: acc }, { label: null, value: x }], []);
  }

  private keyPathOr(fn: V | undefined, x: V): V {
    if (fn === undefined) return x;
    if (isT(fn, "keypath")) {
      let cur = x;
      for (const part of fn.path) {
        if (part.startsWith("@")) continue;
        if (part === "self") continue;
        cur = this.member(cur, part, this.globals);
      }
      return cur;
    }
    return this.callValue(fn, [{ label: null, value: x }], []);
  }

  private formatNumber(v: V, style: V | undefined): string {
    const x = num(v);
    const sym = isT(style ?? null, "sym") ? (style as Extract<V, { t: "sym" }>) : null;
    const find = (s: V, name: string): Extract<V, { t: "sym" }> | null => {
      if (!isT(s, "sym")) return null;
      if (s.name === name) return s;
      for (const a of s.args ?? []) {
        const hit = find(a.value, name);
        if (hit) return hit;
      }
      return null;
    };
    const percent = sym?.name === "percent";
    const value = percent ? x * 100 : x;
    const fraction = sym ? find(sym, "fractionLength") : null;
    const digits = fraction?.args?.[0]?.value;
    const text =
      digits !== undefined && digits !== null
        ? value.toLocaleString(undefined, { minimumFractionDigits: num(digits), maximumFractionDigits: num(digits) })
        : v instanceof Dbl || percent
          ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : value.toLocaleString();
    return percent ? `${text}%` : text;
  }
}

export function treeHasMod(node: ViewNode, m: Mod["m"]): boolean {
  if (node.mods?.some((x) => x.m === m)) return true;
  return [...(node.children ?? []), ...(node.label ?? [])].some((c) => treeHasMod(c, m));
}
