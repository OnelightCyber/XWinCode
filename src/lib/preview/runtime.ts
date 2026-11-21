import { lineCol } from "./lexer";
import { emptyAST, parseSwift, type Accessor, type Closure, type Cond, type Expr, type FileAST, type Method, type Param, type Property, type Stmt, type TypeDecl } from "./parser";
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
import { mapModViews, modViews, type AnimCurve, type Diagnostic, type Issue, type Mod, type PreviewEvent, type PreviewTarget, type ViewNode } from "./types";
import { builtinShapePath, hostNodes, makeContext, makePath, makeRect, pathFrom, pathOf, point, rect, rectMember, size, strokeStyle, type DrawOp } from "./geometry";
import {
  coerce,
  compare,
  copyValue,
  Dbl,
  describe,
  equals,
  inRange,
  isNum,
  isT,
  keyOf,
  nodesOf,
  num,
  placeholderFor,
  random,
  rangeEnd,
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
  fresh: Set<string>;
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

class Abort extends Fault {}

const MATH1: Record<string, (x: number) => number> = {
  abs: Math.abs,
  fabs: Math.abs,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  exp: Math.exp,
  exp2: (x) => Math.pow(2, x),
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
};

interface RawIssue {
  kind: Issue["kind"];
  message: string;
  file?: string;
  pos: number;
}

interface FileEntry {
  src: string;
  ast: FileAST;
  errors: { message: string; pos: number }[];
  version: number;
  shape: string;
}

const RENDER_BUDGET = 1200;
const EVENT_BUDGET = 800;
const STATIC_BUDGET = 100;
const SLOW = "This code takes too long to run in the preview";
const VIEWISH = /\b(View|Content|Scene|ToolbarContent|Commands|Body|Label)\b/;
const SAMPLE_NAME = /^(preview|sample|example|mock|placeholder|demo|fixture|stub)(data|value|item)?$/i;
const SAMPLE_LIST = /^(previews|samples|examples|mocks|placeholders|demos|fixtures|stubs|sampledata|mockdata|previewdata|all|allitems)$/i;
const OPERATORS = new Set(["+", "-", "*", "/", "%", "<", ">", "<=", ">=", "==", "!=", "&&", "||", "&+", "&-", "&*"]);
const SYSTEM_PREFIX = "(?:CM|CL|AV|CH|LA|NW|CB|UI|NS|MK|HK|SK|WK|GK|EK|PH|CN|AR|RP|ST|SF|MP|CG|CA|CI|PK|SC|UN|AS|CK|CT|MF|MC|GC)[A-Z]";
const PLAIN_TYPES =
  "(?:DateComponents|Measurement|Unit[A-Z]|URL|Notification|Operation|Dispatch|JSON|Property|Index|Character|Decimal|Regex|Logger|Async|Throwing|Checked|Unsafe|AnyCancellable|AnyPublisher|AnyHashable|AnyShapeStyle|AnyTransition|AnyGradient|Passthrough|CurrentValue|Just|Future|Published|Calendar|Locale|Bundle|File|Process|Thread|Mirror|Range|ClosedRange|Optional|Result|Error|State|Binding|Task|Timer|Observation|Predicate|Sort|Fetch|Model|Schema|Persistent)";
const NOT_A_CONTAINER = new RegExp(`^(?:${SYSTEM_PREFIX}|${PLAIN_TYPES})|(?:Manager|Engine|Session|Monitor|Center|Service|Client|Publisher|Subject|Stream|Queue|Handler|Task|Operation|WorkItem|Timer|Action|Observer|Cancellable|Continuation|Descriptor|Configuration|Request)$`);
const NOT_A_VIEW = new RegExp(
  `^(?:${SYSTEM_PREFIX}|${PLAIN_TYPES})|(?:Manager|Engine|Session|Monitor|Center|Store|Service|Client|Controller|Provider|Repository|Formatter|Request|Response|Configuration|Config|Options|Descriptor|Query|Predicate|Error|Model|Context|Container|Delegate|Coordinator|Publisher|Subject|Stream|Token|Key|ID|Style|Record|Info|Settings|Attributes|State|Kind|Type|Value|Result|Data|Date|Time|Queue|Handler|Helper|Factory|Builder|Parser|Encoder|Decoder|Storage|Cache|Database|Bounds|Point|Size|Rect|Vector|Matrix|Transform|Entity|Component|Resource|Material|Mesh|Light|Camera|Anchor|Item|Set|Task|Timer|Action|Observer|Cancellable|Continuation|WorkItem|Operation)$`,
);

function isViewType(type: string | null | undefined): boolean {
  return !!type && VIEWISH.test(type);
}

function baseName(type: string): string {
  return type
    .replace(/<.*$/, "")
    .replace(/^(any|some)\s+/, "")
    .replace(/^SwiftUI\./, "")
    .replace(/[?!\s]/g, "");
}

function shapeOf(ast: FileAST): string {
  const types = ast.types.map((t) => `${t.kind} ${t.name}:${t.inherits.join(",")}{${t.props.map((p) => p.name).join(",")}|${t.methods.map((m) => m.name).join(",")}|${t.cases.map((c) => c.name).join(",")}|${t.inits.length}}`);
  return `${types.join(";")}#${ast.funcs.map((f) => f.name).join(",")}#${ast.globals.map((g) => g.name).join(",")}#${ast.protocols.map((p) => `${p.name}:${p.inherits.join(",")}`).join(",")}`;
}

function humanize(name: string | undefined): string {
  if (!name) return "Text";
  const words = name.replace(/^_+/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Text";
}

const NAMES_DOUBLE = ["Double", "CGFloat", "Float", "BinaryFloatingPoint", "FloatingPoint", "Numeric", "Comparable", "Int", "BinaryInteger"];
const NAMES_INT = ["Int", "BinaryInteger", "SignedInteger", "FixedWidthInteger", "Numeric", "Comparable", "Double", "CGFloat", "BinaryFloatingPoint"];
const NAMES_STRING = ["String", "StringProtocol", "Substring"];
const NAMES_BOOL = ["Bool"];
const NAMES_ARRAY = ["Array", "Collection", "Sequence", "RandomAccessCollection", "MutableCollection", "BidirectionalCollection", "RangeReplaceableCollection", "Set"];
const NAMES_RANGE = ["Range", "ClosedRange", "Collection", "Sequence"];
const NAMES_COLOR = ["Color", "ShapeStyle"];
const NAMES_FONT = ["Font"];
const NAMES_DATE = ["Date"];
const NAMES_DICT = ["Dictionary"];
const NAMES_VIEW = ["View", "Shape"];
const NAMES_NONE: string[] = [];

interface Members {
  props: Map<string, Property[]>;
  methods: Map<string, Method[]>;
}

const dollars = new WeakMap<object, number>();

function maxDollar(fn: { params: string[]; body: Stmt[] }): number {
  const hit = dollars.get(fn);
  if (hit !== undefined) return hit;
  let max = -1;
  const seen = new Set<unknown>();
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object" || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      for (const y of x) walk(y);
      return;
    }
    const o = x as Record<string, unknown>;
    if (o.k === "closure" && x !== fn) return;
    if (o.k === "id" && typeof o.name === "string") {
      const m = /^\$(\d+)$/.exec(o.name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    for (const key in o) walk(o[key]);
  };
  walk(fn.body);
  dollars.set(fn, max);
  return max;
}

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
  "reserveCapacity",
  "swapAt",
  "formIntersection",
]);

function parseSafely(src: string, path: string): ReturnType<typeof parseSwift> {
  try {
    return parseSwift(src, path);
  } catch (e) {
    return { ast: emptyAST(), errors: [{ message: e instanceof Error ? e.message : String(e), pos: 0 }] };
  }
}

export interface RenderResult {
  tree: ViewNode | null;
  errors: Diagnostic[];
  notes: string[];
  issues: Issue[];
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
  private files = new Map<string, FileEntry>();
  private types = new Map<string, TypeDecl>();
  private exts = new Map<string, TypeDecl[]>();
  private protocols = new Map<string, string[]>();
  private family = new Map<TypeDecl, TypeDecl[]>();
  private index = new Map<TypeDecl, Members>();
  private conformance = new Map<TypeDecl, Map<string, boolean>>();
  private caseOwner = new Map<string, string | null>();
  private viewMethods = new Map<string, Method>();
  private shapeMethods = new Map<string, Method>();
  private context: Ctx | null = null;
  private prefix = "";
  private atFile: string | undefined;
  private atPos = -1;
  private funcs = new Map<string, Method>();
  private globalProps = new Map<string, Property>();
  private globals = new Env(null, null);
  private state = new Map<string, V>();
  private statics = new Map<string, { value: V; deps: Map<string, number> }>();
  private tracking: Set<string>[] = [];
  private builtins = new Map<string, V | null>();
  private shape = "";
  private clock = 0;
  private handlers = new Map<string, Handler>();
  private shared = new Map<string, V>();
  private notes = new Set<string>();
  private issues = new Map<string, RawIssue>();
  private carry = new Map<string, RawIssue>();
  private sink = this.issues;
  private appeared = new Set<string>();
  private watched = new Map<string, string>();
  private effects: (() => void)[] = [];
  private stack: Inst[] = [];
  private steps = 0;
  private deadline = Infinity;
  private viewMode = false;
  private curFile: string | undefined;
  private sampleDepth = 0;
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
    let changed = false;
    for (const { path, src } of list) {
      seen.add(path);
      const prev = this.files.get(path);
      if (prev && prev.src === src) continue;
      const parsed = parseSafely(src, path);
      this.files.set(path, { src, ...parsed, version: ++this.clock, shape: shapeOf(parsed.ast) });
      changed = true;
    }
    for (const path of [...this.files.keys()]) {
      if (seen.has(path)) continue;
      this.files.delete(path);
      changed = true;
    }
    if (!changed) return;
    this.types.clear();
    this.exts.clear();
    this.protocols.clear();
    this.family.clear();
    this.index.clear();
    this.conformance.clear();
    this.caseOwner.clear();
    this.viewMethods.clear();
    this.shapeMethods.clear();
    this.funcs.clear();
    this.globalProps.clear();
    this.carry.clear();
    let shape = "";
    for (const [path, entry] of this.files) {
      const ast = entry.ast;
      shape += `${path}\n${entry.shape}\n`;
      for (const t of ast.types) {
        if (t.kind === "extension") {
          const list2 = this.exts.get(t.name) ?? [];
          list2.push(t);
          this.exts.set(t.name, list2);
        } else if (!this.types.has(t.name)) this.types.set(t.name, t);
      }
      for (const p of ast.protocols) this.protocols.set(p.name, p.inherits);
      for (const f of ast.funcs) this.funcs.set(f.name, f);
      for (const g of ast.globals) this.globalProps.set(g.name, g);
    }
    for (const e of this.exts.get("View") ?? []) for (const m of e.methods) if (!this.viewMethods.has(m.name)) this.viewMethods.set(m.name, m);
    for (const e of this.exts.get("Shape") ?? []) for (const m of e.methods) if (!this.shapeMethods.has(m.name)) this.shapeMethods.set(m.name, m);
    if (shape !== this.shape) {
      this.shape = shape;
      this.statics.clear();
    }
  }

  resetState() {
    this.state.clear();
    this.shared.clear();
    this.statics.clear();
    this.appeared.clear();
    this.watched.clear();
    this.previous.clear();
    this.before.clear();
    this.explicit.clear();
    this.carry.clear();
    this.overrides.clear();
    this.effects = [];
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
      if (this.conforms(t, "View")) out.push({ key: `view:${t.name}`, label: t.name });
    }
    for (const t of file.ast.types) {
      if (t.main || t.inherits.some((i) => /^(SwiftUI\.)?App$/.test(i.trim()))) out.push({ key: `app:${t.name}`, label: t.name });
    }
    return out;
  }

  render(path: string, key: string): RenderResult {
    let result = this.renderPass(path, key);
    for (let pass = 0; pass < 3 && this.effects.length; pass++) {
      this.flushEffects();
      result = this.renderPass(path, key);
    }
    this.effects = [];
    return result;
  }

  private renderPass(path: string, key: string): RenderResult {
    this.handlers.clear();
    this.notes.clear();
    this.issues = new Map(this.carry);
    this.sink = this.issues;
    this.stack = [];
    this.tracking = [];
    this.steps = 0;
    this.viewMode = false;
    this.curFile = path;
    this.atFile = path;
    this.atPos = -1;
    this.context = null;
    this.prefix = `${this.scheme}|${this.size.width}x${this.size.height}|${this.typeSize}|`;
    this.sampleDepth = 0;
    this.rootCounters.clear();
    resetRandom();
    const file = this.files.get(path);
    const errors: Diagnostic[] = (file?.errors ?? []).map((e) => ({ message: e.message, ...lineCol(file!.src, e.pos) }));
    for (const i of this.carry.values()) if (i.kind === "error") errors.push({ message: i.message, line: 0, column: 0 });
    const stats = { views: 0, depth: 0, heavy: 0 };
    if (!file) return { tree: null, errors, notes: [], issues: [], stats };
    this.deadline = performance.now() + RENDER_BUDGET;
    try {
      const nodes = this.evalTarget(file.ast, key);
      if (!nodes.length) return { tree: null, errors, notes: [...this.notes], issues: this.issueList(), stats };
      const root: ViewNode = nodes.length === 1 ? nodes[0] : { id: "", type: "VStack", props: { alignment: "center" }, children: nodes };
      this.assign(root, "r", 0, stats);
      return { tree: root, errors, notes: [...this.notes], issues: this.issueList(), stats };
    } catch (e) {
      const message = e instanceof RangeError ? "This code recurses too deeply to preview" : e instanceof Error ? e.message : String(e);
      this.report("error", message);
      return { tree: null, errors: [...errors, { message, line: 0, column: 0 }], notes: [...this.notes], issues: this.issueList(), stats };
    } finally {
      this.deadline = Infinity;
    }
  }

  dispatch(ev: PreviewEvent): boolean {
    const h = this.handlers.get(ev.id);
    if (!h) return false;
    this.carry.clear();
    this.guarded(() => {
      if (h.kind === "tap") h.run();
      else if (h.kind === "set") h.run(ev.value);
      else if (ev.kind === "increment") h.inc();
      else if (ev.kind === "decrement") h.dec();
    });
    return true;
  }

  private guarded(run: () => void) {
    const prevSink = this.sink;
    const prevMode = this.viewMode;
    this.sink = this.carry;
    this.viewMode = false;
    this.steps = 0;
    this.deadline = performance.now() + EVENT_BUDGET;
    try {
      run();
    } catch (e) {
      this.report("error", e instanceof RangeError ? "This code recurses too deeply to preview" : e instanceof Error ? e.message : String(e));
    } finally {
      this.deadline = Infinity;
      this.sink = prevSink;
      this.viewMode = prevMode;
    }
  }

  private flushEffects() {
    const run = this.effects;
    this.effects = [];
    for (const fx of run) this.guarded(fx);
  }

  private report(kind: Issue["kind"], message: string) {
    const k = `${kind}|${message}|${this.atFile ?? ""}|${this.atPos}`;
    if (!this.sink.has(k) && this.sink.size < 200) this.sink.set(k, { kind, message, file: this.atFile, pos: this.atPos });
  }

  private note(feature: string) {
    this.notes.add(feature);
    this.report("unsupported", feature);
  }

  private issueList(): Issue[] {
    return [...this.issues.values()].map((i) => {
      const src = i.file !== undefined ? this.files.get(i.file)?.src : undefined;
      const at = src !== undefined && i.pos >= 0 ? lineCol(src, i.pos) : { line: 0, column: 0 };
      return { kind: i.kind, message: i.message, file: i.file, ...at };
    });
  }

  private tick() {
    if ((++this.steps & 127) === 0 && performance.now() > this.deadline) throw new Abort(SLOW);
  }

  private touch(file: string | undefined) {
    if (file === undefined) return;
    for (const set of this.tracking) set.add(file);
  }

  private scoped<T>(file: string | undefined, view: boolean, run: () => T): T {
    const prevFile = this.curFile;
    const prevMode = this.viewMode;
    const prevAtFile = this.atFile;
    const prevAtPos = this.atPos;
    if (file !== undefined) {
      this.curFile = file;
      this.touch(file);
    }
    this.viewMode = view;
    try {
      const result = run();
      this.atFile = prevAtFile;
      this.atPos = prevAtPos;
      return result;
    } finally {
      this.curFile = prevFile;
      this.viewMode = prevMode;
    }
  }

  private fresh(k: string): { value: V; deps: Map<string, number> } | undefined {
    const hit = this.statics.get(k);
    if (!hit) return undefined;
    for (const [f, version] of hit.deps) {
      if (this.files.get(f)?.version !== version) {
        this.statics.delete(k);
        return undefined;
      }
    }
    if (this.tracking.length) for (const f of hit.deps.keys()) this.touch(f);
    return hit;
  }

  private cached(key: string, file: string | undefined, label: string, compute: () => V): V {
    if (this.overrides.size) {
      const forced = this.overrides.get(key);
      if (forced !== undefined) return forced;
    }
    const signature = this.prefix + key;
    const hit = this.fresh(key) ?? this.fresh(signature);
    if (hit) return hit.value;
    const deps = new Set<string>();
    if (file !== undefined) deps.add(file);
    this.tracking.push(deps);
    const outer = this.deadline;
    this.deadline = Math.min(outer, performance.now() + STATIC_BUDGET);
    let value: V;
    try {
      value = this.scoped(file, false, compute);
    } catch (e) {
      if (!(e instanceof Abort) || performance.now() > outer) throw e;
      this.report("skipped", label);
      value = { t: "opaque", name: label };
    } finally {
      this.deadline = outer;
      this.tracking.pop();
    }
    for (const f of deps) this.touch(f);
    const stamped = new Map<string, number>();
    for (const f of deps) stamped.set(f, this.files.get(f)?.version ?? 0);
    this.statics.set(isT(value, "obj") || isT(value, "opaque") ? key : signature, { value, deps: stamped });
    return value;
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
      for (const [slot, list] of modViews(m)) list.forEach((c, i) => this.assign(c, `${id}.${slot}${j}.${i}`, depth + 1, stats));
      if (m.m === "shadow" || m.m === "glass" || (m.m === "background" && m.material)) stats.heavy++;
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
      const inst: Inst = { decl, fields: new Map(), key: `app:${name}`, counters: new Map(), fresh: new Set() };
      this.initFields(inst, [], [], new Env(this.globals, { inst }));
      return this.withInst(inst, () => this.toNodes(this.propValue(prop, new Env(this.globals, { inst }))));
    }
    return [];
  }

  private ctx(): Ctx {
    return (this.context ??= {
      call: (fn, args) => this.plain(() => this.callValue(fn, args.map((value) => ({ label: null, value })), [])),
      build: (fn, args) => this.build(fn, args ?? []),
      scheme: this.scheme,
      size: this.size,
      wide: this.sizeClass.h === "regular",
      note: (f) => this.note(f),
      format: (v, style) => this.formatValue(v, style),
    });
  }

  private plain<T>(run: () => T): T {
    const prev = this.viewMode;
    this.viewMode = false;
    try {
      return run();
    } finally {
      this.viewMode = prev;
    }
  }

  private build(fn: V | undefined, args: V[]): ViewNode[] {
    if (fn === undefined || fn === null) return [];
    const prev = this.viewMode;
    this.viewMode = true;
    try {
      const v = isT(fn, "closure") || isT(fn, "fn") ? this.callValue(fn, args.map((value) => ({ label: null, value })), []) : fn;
      return this.toNodes(v);
    } finally {
      this.viewMode = prev;
    }
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
    if (isT(v, "opaque") && v.view) return [this.placeholderNode(v.name)];
    if (isT(v, "host")) return hostNodes(v) ?? [];
    return [];
  }

  private placeholderNode(name: string): ViewNode {
    const base = name.replace(/^<|>$/g, "").split(".")[0];
    this.note(base);
    return { id: "", type: "Unsupported", props: { name: base, kind: "view" } };
  }

  private withInst<T>(inst: Inst, fn: () => T): T {
    this.stack.push(inst);
    try {
      return fn();
    } finally {
      this.stack.pop();
    }
  }

  private rootCounters = new Map<string, number>();

  private childKey(name: string): string {
    const parent = this.stack[this.stack.length - 1];
    const counters = parent ? parent.counters : this.rootCounters;
    const n = (counters.get(name) ?? 0) + 1;
    counters.set(name, n);
    return parent ? `${parent.key}/${name}#${n}` : n === 1 ? `root:${name}` : `root:${name}#${n}`;
  }

  private measured = new Map<string, { width: number; height: number }>();

  setMeasured(key: string, width: number, height: number): boolean {
    const prev = this.measured.get(key);
    if (prev && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5) return false;
    if (this.measured.size > 4000) this.measured.clear();
    this.measured.set(key, { width, height });
    return true;
  }

  private measure(kind: string): { key: string; width: number; height: number; known: boolean } {
    const key = `${this.childKey(`<${kind}>`)}@${this.size.width}x${this.size.height}`;
    const hit = this.measured.get(key);
    if (hit) return { key, width: hit.width, height: hit.height, known: true };
    return { key, width: this.size.width, height: kind === "GeometryReader" ? this.size.height : this.size.width, known: false };
  }

  private shapeView(value: V, decl: TypeDecl): V {
    const method = this.findMethod(decl, "path", false);
    if (!method) return value;
    const m = this.measure("Shape");
    const made = this.callMethod(method, [{ label: "in", value: rect(0, 0, m.width, m.height) }], [], new Env(this.globals, { value, decl }));
    const cmds = pathOf(made) ?? [];
    return views([{ id: "", type: "Path", props: { cmds: cmds.map((c) => c.slice()), box: [m.width, m.height], measure: m.key } }]);
  }

  private canvasView(args: EvArg[], trailing: V[]): V {
    const fn = trailing[0] ?? arg(args, "renderer");
    const m = this.measure("Canvas");
    const ops: DrawOp[] = [];
    if (fn !== undefined) {
      const painter = {
        color: (v: V | undefined) => toColor(v, this.scheme),
        text: (v: V | undefined) => {
          const nodes = v === undefined ? null : typeof v === "string" ? [{ id: "", type: "Text", props: { text: v } } as ViewNode] : nodesOf(v);
          const n = nodes?.[0];
          if (!n || n.type !== "Text") return null;
          const font = n.mods?.find((x) => x.m === "font") as Extract<Mod, { m: "font" }> | undefined;
          const fg = n.mods?.find((x) => x.m === "foreground") as Extract<Mod, { m: "foreground" }> | undefined;
          return { text: String(n.props.text ?? ""), size: font?.font.size, weight: font?.font.weight, color: fg?.color };
        },
        run: (f: V, values: V[]) => void this.plain(() => this.callValue(f, values.map((value) => ({ label: null, value })), [])),
      };
      this.plain(() => this.callValue(fn, [{ label: null, value: makeContext(ops, painter) }, { label: null, value: size(m.width, m.height) }], []));
    }
    return views([{ id: "", type: "Canvas", props: { ops, box: [m.width, m.height], measure: m.key } }]);
  }

  private geometryView(trailing: V[]): V {
    const m = this.measure("GeometryReader");
    const frame = rect(0, 0, m.width, m.height);
    const proxy: V = {
      t: "host",
      kind: "GeometryProxy",
      get: (name) => {
        if (name === "size") return size(m.width, m.height);
        if (name === "safeAreaInsets") return { t: "tuple", items: [new Dbl(0), new Dbl(0), new Dbl(0), new Dbl(0)], labels: ["top", "leading", "bottom", "trailing"] };
        return undefined;
      },
      call: (name) => (name === "frame" || name === "bounds" ? frame : undefined),
    };
    const children = this.build(trailing[0], [proxy]);
    return views([{ id: "", type: "ZStack", props: { alignment: "topLeading", measure: m.key, geometry: true }, children, mods: [{ m: "frame", maxWidth: "inf", maxHeight: "inf", alignment: "topLeading" }] }]);
  }

  private effectKey(kind: string, fn: V): string {
    const inst = this.stack[this.stack.length - 1];
    const where = isT(fn, "closure") ? `${fn.file ?? ""}:${(fn.fn as Closure).pos ?? 0}` : isT(fn, "fn") ? fn.name : "";
    return `${inst ? inst.key : "root"}!${kind}@${where}`;
  }

  private effect(kind: string, fn: V | undefined) {
    if (fn === undefined || fn === null || !(isT(fn, "closure") || isT(fn, "fn"))) return;
    const k = this.effectKey(kind, fn);
    if (this.appeared.has(k)) return;
    this.appeared.add(k);
    this.effects.push(() => void this.callValue(fn, [], []));
  }

  private watch(args: EvArg[], trailing: V[]) {
    const value = arg(args, "of");
    const fn = trailing[0] ?? arg(args, "perform");
    if (value === undefined || fn === undefined || !isT(fn, "closure")) return;
    const k = this.effectKey("change", fn);
    const now = keyOf(value);
    const before = this.watched.get(k);
    this.watched.set(k, now);
    this.previous.set(k, value);
    const run = () => {
      const old = this.before.get(k) ?? null;
      const values = fn.fn.params.length === 1 ? [value] : [old, value];
      this.callValue(fn, values.map((x) => ({ label: null, value: x })), []);
    };
    if (before === undefined ? arg(args, "initial") === true : before !== now) this.effects.push(run);
    else this.before.set(k, value);
    if (before !== undefined && before !== now) this.effects.push(() => void this.before.set(k, value));
  }

  private previous = new Map<string, V>();
  private before = new Map<string, V>();

  private inject(value: V) {
    if (!isT(value, "obj") && !isT(value, "rec")) return;
    const name = value.type.name;
    if (this.explicit.has(name) || this.shared.get(name) === value) return;
    this.explicit.add(name);
    const had = this.shared.has(name);
    this.shared.set(name, value);
    if (had) this.effects.push(() => {});
  }

  private explicit = new Set<string>();

  private styleButtons(n: ViewNode, style: V, decl: TypeDecl, make: Method): ViewNode {
    if (n.type === "Button") {
      const label = n.label?.length ? n.label : [{ id: "", type: "Text", props: { text: String(n.props.title ?? "") } } as ViewNode];
      const configuration: V = {
        t: "tuple",
        items: [views(label), false, n.props.role ? { t: "sym", name: String(n.props.role) } : null, { t: "fn", name: "trigger", call: () => null }],
        labels: ["label", "isPressed", "role", "trigger"],
      };
      const body = this.toNodes(this.callMethod(make, [{ label: "configuration", value: configuration }], [], new Env(this.globals, { value: style, decl })));
      const props = { ...n.props };
      delete props.title;
      return { ...n, props, label: body, mods: [...(n.mods ?? []), { m: "buttonStyle", value: "custom" }] };
    }
    const walk = (c: ViewNode) => this.styleButtons(c, style, decl, make);
    return { ...n, children: n.children?.map(walk), label: n.label?.map(walk), mods: n.mods?.map((m) => mapModViews(m, walk)) };
  }

  private live(decl: TypeDecl): TypeDecl {
    return this.types.get(decl.name) ?? decl;
  }

  private superOf(decl: TypeDecl): TypeDecl | undefined {
    if (decl.kind !== "class") return undefined;
    for (const i of decl.inherits) {
      const t = this.types.get(baseName(i));
      if (t && t.kind === "class" && t !== decl) return t;
    }
    return undefined;
  }

  private related(decl: TypeDecl): TypeDecl[] {
    const hit = this.family.get(decl);
    if (hit) return hit;
    const out: TypeDecl[] = [decl];
    const seen = new Set<string>([decl.name]);
    const queue: string[] = [...decl.inherits];
    const add = (d: TypeDecl) => {
      out.push(d);
      queue.push(...d.inherits);
    };
    for (const e of this.exts.get(decl.name) ?? []) add(e);
    while (queue.length) {
      for (const part of queue.shift()!.split("&")) {
        const name = baseName(part);
        if (!name || seen.has(name) || name === "View" || name === "Shape" || name === "ShapeStyle") continue;
        seen.add(name);
        const t = this.types.get(name);
        if (t && t.kind === "class" && decl.kind === "class") add(t);
        for (const e of this.exts.get(name) ?? []) add(e);
        queue.push(...(this.protocols.get(name) ?? []));
      }
    }
    this.family.set(decl, out);
    return out;
  }

  private stored(decl: TypeDecl): Property[] {
    const chain: TypeDecl[] = [];
    for (let d: TypeDecl | undefined = decl, n = 0; d && n < 8; n++) {
      chain.unshift(d);
      d = this.superOf(d);
    }
    return chain.flatMap((d) => d.props.filter((p) => !p.isStatic && !p.getter));
  }

  private members(decl: TypeDecl): Members {
    const hit = this.index.get(decl);
    if (hit) return hit;
    const made: Members = { props: new Map(), methods: new Map() };
    for (const d of this.related(decl)) {
      for (const p of d.props) {
        const list = made.props.get(p.name);
        if (list) list.push(p);
        else made.props.set(p.name, [p]);
      }
      for (const m of d.methods) {
        const list = made.methods.get(m.name);
        if (list) list.push(m);
        else made.methods.set(m.name, [m]);
      }
    }
    this.index.set(decl, made);
    return made;
  }

  private findProp(decl: TypeDecl, name: string, wantStatic?: boolean): Property | undefined {
    const list = this.members(decl).props.get(name);
    if (!list) return undefined;
    if (wantStatic === undefined) return list[0];
    for (const p of list) if (p.isStatic === wantStatic) return p;
    return undefined;
  }

  private findMethod(decl: TypeDecl, name: string, wantStatic?: boolean): Method | undefined {
    const list = this.members(decl).methods.get(name);
    if (!list) return undefined;
    if (wantStatic === undefined) return list[0];
    for (const m of list) if (m.isStatic === wantStatic) return m;
    return undefined;
  }

  private conforms(decl: TypeDecl, proto: string): boolean {
    let known = this.conformance.get(decl);
    if (!known) {
      known = new Map();
      this.conformance.set(decl, known);
    }
    const hit = known.get(proto);
    if (hit !== undefined) return hit;
    const seen = new Set<string>();
    const queue: string[] = [...decl.inherits, ...(this.exts.get(decl.name) ?? []).flatMap((e) => e.inherits)];
    let found = false;
    while (queue.length && !found) {
      for (const part of queue.shift()!.split("&")) {
        const name = baseName(part);
        if (name === proto) {
          found = true;
          break;
        }
        if (!name || seen.has(name)) continue;
        seen.add(name);
        queue.push(...(this.protocols.get(name) ?? []));
        const t = this.types.get(name);
        if (t && t.kind === "class" && t !== decl) queue.push(...t.inherits);
      }
    }
    known.set(proto, found);
    return found;
  }

  private instantiateView(decl: TypeDecl, args: EvArg[], trailing: V[], key: string): ViewNode[] {
    if (this.stack.length > 48) throw new Fault("Views are nested too deeply");
    const inst: Inst = { decl, fields: new Map(), key, counters: new Map(), fresh: new Set() };
    const env = new Env(this.globals, { inst });
    const prevAtFile = this.atFile;
    const prevAtPos = this.atPos;
    try {
      return this.withInst(inst, () =>
        this.scoped(decl.file, false, () => {
          this.initFields(inst, args, trailing, env);
          const body = this.findProp(decl, "body", false);
          if (!body) return [];
          return this.toNodes(this.propValue(body, env));
        }),
      );
    } catch (e) {
      if (!(e instanceof Fault) || e instanceof Abort) throw e;
      const message = `${decl.name}: ${e.message}`;
      this.report("error", message);
      this.atFile = prevAtFile;
      this.atPos = prevAtPos;
      return [{ id: "", type: "Unsupported", props: { name: message, error: true } }];
    }
  }

  private initFields(inst: Inst, args: EvArg[], trailing: V[], env: Env) {
    const decl = inst.decl;
    const init = this.pickInit(decl, args, trailing);
    const pending = [...trailing];
    for (const p of this.stored(decl)) {
      const provided = init ? undefined : this.takeArg(p, args, pending);
      inst.fields.set(p.name, this.fieldSlot(inst, p, provided, env, !!init));
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

  private placeholder(type: string | null, name?: string): V {
    const raw = (type ?? "").trim();
    if (!raw || /[?!]$/.test(raw) || /->/.test(raw)) return null;
    const list = /^\[\s*([\w.]+)\s*\]$/.exec(raw) ?? /^(?:Array|Set)<\s*([\w.]+)\s*>$/.exec(raw);
    if (list) return this.sampleList(baseName(list[1]));
    const base = baseName(raw);
    const decl = this.types.get(base);
    if (decl?.kind === "enum" && decl.cases.length) return { t: "sym", name: decl.cases[0].name, type: decl.name };
    if (decl && (decl.kind === "struct" || decl.kind === "class") && !this.conforms(decl, "View")) return this.sample(decl);
    if (/^(String|Substring|LocalizedStringKey|LocalizedStringResource)$/.test(base)) return humanize(name);
    return placeholderFor(type);
  }

  private sample(decl: TypeDecl): V {
    for (const d of this.related(decl)) {
      const p = d.props.find((x) => x.isStatic && SAMPLE_NAME.test(x.name));
      if (!p) continue;
      const v = this.staticMember(decl.name, p.name);
      if (isT(v, "rec") || isT(v, "obj")) return v;
    }
    if (this.sampleDepth > 3 || this.stack.length >= 32) return null;
    this.sampleDepth++;
    try {
      return this.construct(decl, [], []);
    } catch (e) {
      if (!(e instanceof Fault) || e instanceof Abort) throw e;
      return null;
    } finally {
      this.sampleDepth--;
    }
  }

  private sampleList(element: string): V {
    const decl = this.types.get(element);
    if (!decl) return [];
    for (const d of this.related(decl)) {
      const p = d.props.find((x) => x.isStatic && SAMPLE_LIST.test(x.name));
      if (!p) continue;
      const v = this.staticMember(decl.name, p.name);
      if (Array.isArray(v) && v.length) return v.slice();
    }
    if (decl.kind === "enum") return decl.cases.slice(0, 6).map((c) => ({ t: "sym" as const, name: c.name, type: decl.name }));
    if (this.conforms(decl, "View") || this.sampleDepth > 0) return [];
    const out: V[] = [];
    for (let i = 0; i < 3; i++) {
      const v = this.sample(decl);
      if (v !== null) out.push(v);
    }
    return out;
  }

  private fieldSlot(inst: Inst, p: Property, provided: V | undefined, env: Env, viaInit: boolean): Slot {
    const attr = p.attrs.find((a) => /^[A-Z]/.test(a)) ?? "";
    const attrName = attr.replace(/\(.*$/, "");
    const fallback = () => (viaInit ? placeholderFor(p.type) : this.placeholder(p.type, p.name));
    if (STATE_ATTRS.includes(attrName)) {
      const k = `${inst.key}#${p.name}`;
      if (!this.state.has(k)) {
        const v = provided !== undefined ? provided : p.init ? this.evalExpr(p.init, env) : attrName === "Query" ? this.placeholder(p.type, p.name) : fallback();
        this.state.set(k, coerce(copyValue(v), p.type));
        inst.fresh.add(p.name);
      }
      return {
        get: () => this.state.get(k) ?? null,
        set: (v) => void this.state.set(k, coerce(v, p.type)),
      };
    }
    if (attrName === "Binding") {
      if (provided !== undefined && isT(provided, "binding")) return { get: provided.get, set: provided.set };
      let local: V = provided !== undefined ? provided : p.init ? this.evalExpr(p.init, env) : this.placeholder(p.type, p.name);
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
    let value: V = provided !== undefined ? provided : p.init ? this.evalExpr(p.init, env) : fallback();
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
      case "dismissWindow":
      case "openSettings":
      case "requestReview":
      case "dismissSearch":
      case "refresh":
      case "purchase":
        return { t: "fn", name: key, call: () => null };
      case "horizontalSizeClass":
        return { t: "sym", name: this.sizeClass.h };
      case "verticalSizeClass":
        return { t: "sym", name: this.sizeClass.v };
      case "dynamicTypeSize":
        return { t: "sym", name: this.typeSize };
      case "scenePhase":
        return { t: "sym", name: "active" };
      case "layoutDirection":
        return { t: "sym", name: "leftToRight" };
      case "colorSchemeContrast":
        return { t: "sym", name: "standard" };
      case "displayScale":
        return new Dbl(3);
      case "pixelLength":
        return new Dbl(1 / 3);
      case "isEnabled":
        return true;
      case "isPresented":
      case "isSearching":
      case "isFocused":
      case "accessibilityReduceMotion":
      case "accessibilityReduceTransparency":
      case "accessibilityDifferentiateWithoutColor":
      case "isLuminanceReduced":
        return false;
      case "locale":
      case "calendar":
      case "timeZone":
        return { t: "sym", name: "current" };
      case "editMode":
        return null;
    }
    const typeName = /\(\s*(\w+)\.self\s*\)/.exec(attr)?.[1];
    if (typeName) return this.sharedObject(typeName, p, env);
    return key ? this.opaque(key) : null;
  }

  private sharedObject(typeName: string | null, p: Property, env: Env): V {
    const name = (typeName ?? "").replace(/[?!]/g, "").trim();
    if (!name) return p.init ? this.evalExpr(p.init, env) : null;
    const existing = this.shared.get(name);
    if (existing !== undefined) return existing;
    const decl = this.types.get(name);
    this.shared.set(name, null);
    const v = decl ? this.sample(decl) : null;
    this.shared.set(name, v);
    return v;
  }

  private bind(params: Param[], args: EvArg[], trailing: V[], strict: boolean): (V | undefined)[] | null {
    const out: (V | undefined)[] = new Array<V | undefined>(params.length).fill(undefined);
    const used = new Array<boolean>(args.length).fill(false);
    let ai = 0;
    params.forEach((param, i) => {
      const a = args[ai];
      if (!a || a.label !== param.label) return;
      if (param.type.endsWith("...")) {
        const items: V[] = [];
        while (ai < args.length && (items.length === 0 || args[ai].label === null)) {
          items.push(args[ai].value);
          used[ai++] = true;
        }
        out[i] = items;
        return;
      }
      out[i] = a.value;
      used[ai++] = true;
    });
    if (used.includes(false)) {
      if (strict) return null;
      args.forEach((a, j) => {
        if (used[j]) return;
        let i = a.label !== null ? params.findIndex((p, k) => out[k] === undefined && (p.label === a.label || p.name === a.label)) : -1;
        if (i < 0 && a.label === null) i = params.findIndex((_p, k) => out[k] === undefined);
        if (i < 0) return;
        out[i] = a.value;
        used[j] = true;
      });
    }
    for (const fn of trailing) {
      let i = params.findIndex((p, k) => out[k] === undefined && /->/.test(p.type));
      if (i < 0) {
        if (strict) return null;
        for (let k = params.length - 1; k >= 0 && i < 0; k--) if (out[k] === undefined) i = k;
      }
      if (i >= 0) out[i] = fn;
    }
    if (strict && params.some((p, i) => out[i] === undefined && !p.def)) return null;
    return out;
  }

  private pickInit(decl: TypeDecl, args: EvArg[], trailing: V[]): Method | undefined {
    const own = decl.inits;
    const extra = this.related(decl).flatMap((d) => (d === decl ? [] : d.inits));
    const inits = [...own, ...extra];
    if (!inits.length) return undefined;
    const exact = inits.find((m) => this.bind(m.params, args, trailing, true));
    if (exact) return exact;
    if (!own.length) return undefined;
    const count = args.length + trailing.length;
    return inits.find((m) => m.params.length === count) ?? inits.find((m) => m.params.filter((p) => !p.def).length <= count && m.params.length >= count) ?? own[0];
  }

  private runInit(init: Method, args: EvArg[], trailing: V[], env: Env) {
    const local = env.child();
    const bound = this.bind(init.params, args, trailing, true) ?? this.bind(init.params, args, trailing, false) ?? [];
    init.params.forEach((param, i) => {
      const given = bound[i];
      const v = given !== undefined ? given : param.def ? this.evalExpr(param.def, local) : this.placeholder(param.type, param.name);
      local.define(param.name, coerce(v, param.type));
    });
    this.scoped(init.file, false, () => this.runBody(init.body, local));
  }

  private delegateInit(toSuper: boolean, args: EvArg[], trailing: V[], env: Env) {
    const self = env.self;
    if (!self) return;
    const decl = "inst" in self ? self.inst.decl : self.decl;
    if (!decl) return;
    if (decl.kind === "extension" && !toSuper) {
      const holder = this.forming[this.forming.length - 1];
      if (holder) holder.value = this.callType(decl.name, args, trailing, this.globals);
      return;
    }
    const target = toSuper ? this.superOf(decl) : decl;
    if (!target) return;
    const init = [...target.inits, ...(toSuper ? [] : this.related(target).flatMap((d) => (d === target ? [] : d.inits)))].find((m) => this.bind(m.params, args, trailing, true));
    if (init) this.runInit(init, args, trailing, new Env(this.globals, self));
  }

  private forming: { value: V }[] = [];

  private extensionInit(name: string, args: EvArg[], trailing: V[]): V | undefined {
    const exts = this.exts.get(name);
    if (!exts || this.forming.length > 8) return undefined;
    for (const e of exts) {
      const init = e.inits.find((m) => this.bind(m.params, args, trailing, true));
      if (!init) continue;
      const holder: { value: V } = { value: null };
      this.forming.push(holder);
      try {
        this.runInit(init, args, trailing, new Env(this.globals, { value: { t: "type", name }, decl: e }));
      } finally {
        this.forming.pop();
      }
      return holder.value;
    }
    return undefined;
  }

  private propValue(p: Property, env: Env): V {
    if (p.getter) return this.scoped(p.file, isViewType(p.type), () => this.runBody(p.getter!, env.child()));
    if (p.init) return this.scoped(p.file, false, () => this.evalExpr(p.init!, env));
    return placeholderFor(p.type);
  }

  construct(decl: TypeDecl, args: EvArg[], trailing: V[]): V {
    this.touch(decl.file);
    if (this.conforms(decl, "View")) return views(this.instantiateView(decl, args, trailing, this.childKey(decl.name)));
    if (["UIViewRepresentable", "UIViewControllerRepresentable", "NSViewRepresentable", "NSViewControllerRepresentable"].some((p) => this.conforms(decl, p))) {
      this.note(`~${decl.name}`);
      return views([{ id: "", type: "Unsupported", props: { name: decl.name, kind: "native" } }]);
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
    this.scoped(decl.file, false, () => {
      const init = this.pickInit(decl, args, trailing);
      const pending = [...trailing];
      for (const p of this.stored(decl)) {
        if (p.isLazy && p.init) continue;
        const provided = init ? undefined : this.takeArg(p, args, pending);
        const v = provided !== undefined ? provided : p.init ? this.evalExpr(p.init, env) : init ? placeholderFor(p.type) : this.placeholder(p.type, p.name);
        fields.set(p.name, coerce(copyValue(v), p.type));
      }
      if (init) this.runInit(init, args, trailing, env);
    });
    if (this.conforms(decl, "Shape") || this.conforms(decl, "InsettableShape")) return this.shapeView(value, decl);
    return value;
  }

  private caseRaw(decl: TypeDecl, name: string): V {
    const c = decl.cases.find((x) => x.name === name);
    if (c?.raw) return this.evalExpr(c.raw, this.globals);
    if (decl.inherits.some((i) => /^(Int|Int\d+|UInt\d*)$/.test(i.trim()))) {
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
    const state = { last: null as V, exprs: 0 };
    for (const s of stmts) {
      this.tick();
      const file = (s.k === "expr" ? s.file : undefined) ?? this.curFile;
      this.atFile = file;
      this.atPos = s.pos;
      let r: Signal | Implicit | undefined;
      if (this.viewMode) {
        try {
          r = this.step(s, stmts, env, out, state);
        } catch (e) {
          if (!(e instanceof Fault) || e instanceof Abort) throw e;
          this.report("error", e.message);
          this.atFile = file;
          this.atPos = s.pos;
          this.recover(s, env, out, e.message);
          continue;
        }
      } else r = this.step(s, stmts, env, out, state);
      if (r) return r;
    }
    if (stmts.length === 1 && state.exprs === 1 && !nodesOf(state.last) && !isT(state.last, "color")) return new Implicit(state.last);
    return undefined;
  }

  private step(s: Stmt, stmts: Stmt[], env: Env, out: ViewNode[], state: { last: V; exprs: number }): Signal | Implicit | undefined {
    if (s.k === "expr") {
      const v = this.evalExpr(s.e, env);
      state.exprs++;
      state.last = v;
      if (isT(v, "opaque") && !this.viewMode) return undefined;
      const n = this.toNodes(v);
      if (n.length && !(typeof v === "string" && stmts.length === 1 && !this.inBuilder(s.e))) out.push(...mark(n, s));
      return undefined;
    }
    const r = this.exec(s, env, out);
    if (r instanceof Signal) return r;
    if (r instanceof Implicit && stmts.length === 1) return r;
    return undefined;
  }

  private recover(s: Stmt, env: Env, out: ViewNode[], message: string) {
    if (s.k === "decl" || s.k === "seq") {
      const names = s.k === "decl" ? s.names : s.body.flatMap((b) => (b.k === "decl" ? b.names : []));
      for (const n of names) if (!env.vars.has(n)) env.define(n, null);
      return;
    }
    if (s.k === "assign" || s.k === "break" || s.k === "continue") return;
    const node: ViewNode = { id: "", type: "Unsupported", props: { name: message, error: true } };
    const file = (s.k === "expr" ? s.file : undefined) ?? this.curFile;
    if (file !== undefined) node.src = [{ f: file, a: s.pos, b: s.k === "expr" && s.end !== undefined ? s.end : s.pos + 1 }];
    out.push(node);
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
        for (const item of items) {
          this.tick();
          const local = env.child();
          if (s.names.length > 1) {
            const parts = isT(item, "tuple") ? item.items : Array.isArray(item) ? item : [item];
            s.names.forEach((name, i) => local.define(name, parts[i] ?? null));
          } else local.define(s.names[0], item);
          if (s.where && !truthy(this.evalExpr(s.where, local))) continue;
          const r = this.runBlock(s.body, local, out);
          if (r instanceof Signal) {
            if (r.kind === "brk") break;
            if (r.kind === "ret") return r;
          }
        }
        return undefined;
      }
      case "while": {
        while (truthy(this.evalExpr(s.cond, env))) {
          this.tick();
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
          const hit =
            c.patterns === null ||
            c.patterns.some((p, i) => {
              if (!this.matches(p, v, local)) return false;
              const guard = c.guards[i];
              return !guard || truthy(this.evalExpr(guard, local));
            });
          if (hit) {
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
        if (v === null || v === undefined || isT(v, "opaque")) return false;
        env.define(c.name, v);
      } else if (!this.matches(c.pattern, this.evalExpr(c.e, env), env)) return false;
    }
    return true;
  }

  private matches(p: Expr, v: V, env: Env): boolean {
    if (p.k === "id" && p.name === "_") return true;
    if (p.k === "member" && p.base === null) {
      if (p.name === "none") return v === null || (isT(v, "sym") && v.name === "none");
      return isT(v, "sym") ? v.name === p.name : typeof v === "string" ? v === p.name : false;
    }
    if (p.k === "call" && p.callee.k === "id" && p.callee.name === "__type") {
      return truthy(this.callValue(this.lookup("__is", env), [{ label: null, value: v }, { label: null, value: this.evalExpr(p.args[0].value, env) }], []));
    }
    if (p.k === "call" && p.callee.k === "member" && p.callee.base === null) {
      if (p.callee.name === "some") return v !== null && p.args.every((a) => this.matches(a.value, v, env));
      if (!isT(v, "sym") || v.name !== p.callee.name) return false;
      return p.args.every((a, i) => {
        const part = v.args?.[i]?.value ?? null;
        if (a.value.k === "id") {
          if (a.value.name !== "_") env.define(a.value.name, part);
          return true;
        }
        return this.matches(a.value, part, env);
      });
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
    if (isT(pv, "range")) return isNum(v) && inRange(pv, num(v));
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

  private overrides = new Map<string, V>();
  private observing = new Set<Accessor>();

  private lvalue(e: Expr, env: Env): Slot {
    if (e.k === "id") {
      const s = this.slotFor(e.name, env);
      if (s) return s;
      if (e.name === "self" && env.self && "value" in env.self) {
        const ref = env.self;
        return {
          get: () => ref.value,
          set: (x) => {
            const cur = ref.value;
            if ((isT(cur, "rec") && isT(x, "rec")) || (isT(cur, "obj") && isT(x, "obj"))) {
              cur.fields.clear();
              for (const [k, value] of x.fields) cur.fields.set(k, value);
            } else ref.value = x;
          },
        };
      }
      if (this.globalProps.has(e.name)) {
        const name = e.name;
        return { get: () => this.lookup(name, env), set: (x) => void this.overrides.set(`global:${name}`, x) };
      }
      throw new Fault(`Cannot assign to '${e.name}'`);
    }
    if (e.k === "member" && e.base) {
      if (e.base.k === "id" && e.base.name === "self") {
        const s = this.selfSlot(env.self, e.name);
        if (s) return s;
      }
      const baseV = this.evalExpr(e.base, env);
      const name = e.name;
      if (isT(baseV, "obj")) return this.fieldSlotOf(baseV, name);
      if (isT(baseV, "type")) {
        const typeName = baseV.name;
        return { get: () => this.staticMember(typeName, name), set: (x) => void this.overrides.set(`${typeName}.${name}`, x) };
      }
      if (isT(baseV, "host")) return { get: () => baseV.get(name) ?? null, set: (x) => void baseV.call(`set:${name}`, [{ label: null, value: x }], []) };
      if (isT(baseV, "binding") && name === "wrappedValue") return { get: baseV.get, set: baseV.set };
      if (baseV === null || isT(baseV, "opaque")) return { get: () => null, set: () => {} };
      const baseSlot = this.lvalue(e.base, env);
      return {
        get: () => this.member(baseSlot.get(), name, env),
        set: (x) => {
          const cur = baseSlot.get();
          if (isT(cur, "obj")) this.fieldSlotOf(cur, name).set(x);
          else if (isT(cur, "rec")) {
            const next = { t: "rec" as const, type: cur.type, fields: new Map(cur.fields) };
            const decl = this.live(cur.type);
            this.storeField(next, decl, this.findProp(decl, name, false), name, x);
            baseSlot.set(next);
          } else if (isT(cur, "tuple")) {
            const idx = /^\d+$/.test(name) ? Number(name) : cur.labels.indexOf(name);
            const items = cur.items.slice();
            items[idx] = x;
            baseSlot.set({ ...cur, items });
          } else if (isT(cur, "binding")) {
            const inner = cur.get();
            if (isT(inner, "obj")) this.fieldSlotOf(inner, name).set(x);
            else if (isT(inner, "rec")) {
              const next = { t: "rec" as const, type: inner.type, fields: new Map(inner.fields) };
              const decl = this.live(inner.type);
              this.storeField(next, decl, this.findProp(decl, name, false), name, x);
              cur.set(next);
            }
          }
        },
      };
    }
    if (e.k === "sub") {
      const baseSlot = this.lvalue(e.base, env);
      const args = e.args.map((a) => ({ label: a.label, value: this.evalExpr(a.value, env) }));
      const idx = args[0]?.value ?? null;
      return {
        get: () => this.subscript(baseSlot.get(), args),
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

  private storeField(target: Extract<V, { t: "obj" }> | Extract<V, { t: "rec" }>, decl: TypeDecl, p: Property | undefined, name: string, v: V) {
    if (p?.setter) {
      this.runAccessor(p.setter, v, target, decl, p);
      return;
    }
    const old = target.fields.get(name) ?? null;
    const next = coerce(v, p?.type ?? null);
    if (p?.willSet) this.runAccessor(p.willSet, next, target, decl, p);
    target.fields.set(name, next);
    if (p?.didSet) this.runAccessor(p.didSet, old, target, decl, p);
  }

  private runAccessor(a: Accessor, value: V, self: V, decl: TypeDecl, p: Property) {
    if (this.observing.has(a)) return;
    this.observing.add(a);
    try {
      const local = new Env(this.globals, { value: self, decl }).child();
      local.define(a.param, value);
      this.scoped(p.file, false, () => this.runBody(a.body, local));
    } finally {
      this.observing.delete(a);
    }
  }

  private fieldSlotOf(obj: Extract<V, { t: "obj" }>, name: string): Slot {
    const decl = this.live(obj.type);
    const p = this.findProp(decl, name, false);
    return {
      get: () => this.member(obj, name, this.globals),
      set: (v) => this.storeField(obj, decl, p, name, v),
    };
  }

  private selfSlot(self: SelfRef, name: string): Slot | undefined {
    if (!self) return undefined;
    if ("inst" in self) {
      const inst = self.inst;
      const direct = inst.fields.get(name);
      if (direct) return direct;
      if (!name.startsWith("_")) return undefined;
      const key = name.slice(1);
      const inner = inst.fields.get(key);
      if (!inner) return undefined;
      return {
        get: inner.get,
        set: (v) => {
          if (isT(v, "binding")) inst.fields.set(key, { get: v.get, set: v.set });
          else if (inst.fresh.has(key) || !this.state.has(`${inst.key}#${key}`)) inner.set(v);
        },
      };
    }
    const v = self.value;
    if (isT(v, "obj") || isT(v, "rec")) {
      const decl = this.live(v.type);
      const p = this.findProp(decl, name, false);
      if (!v.fields.has(name) && !(p && (!p.getter || p.setter))) return undefined;
      if (isT(v, "obj")) return this.fieldSlotOf(v, name);
      return {
        get: () => (p?.getter ? this.member(v, name, this.globals) : (v.fields.get(name) ?? null)),
        set: (x) => this.storeField(v, decl, p, name, x),
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
            s += p.fmt ? sprintf(p.fmt, [v]) : p.style ? this.formatValue(v, this.evalExpr(p.style, env)) : describe(v);
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
        return this.subscript(
          this.evalExpr(e.base, env),
          e.args.map((a) => ({ label: a.label, value: this.evalExpr(a.value, env) })),
        );
      case "closure":
        return { t: "closure", fn: e, env, file: this.curFile };
      case "bin": {
        if (e.op === "&&") return truthy(this.evalExpr(e.l, env)) && truthy(this.evalExpr(e.r, env));
        if (e.op === "||") return truthy(this.evalExpr(e.l, env)) || truthy(this.evalExpr(e.r, env));
        if (e.op === "??") {
          const l = this.evalExpr(e.l, env);
          return l === null || l === undefined || isT(l, "opaque") ? this.evalExpr(e.r, env) : l;
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
    if (g) return g.getter ? this.propValue(g, this.globals) : this.cached(`global:${name}`, g.file, name, () => this.propValue(g, this.globals));
    if (this.types.has(name) || BUILTIN_TYPES.has(name) || isViewName(name) || name === "ForEach" || name === "WindowGroup" || name === "GeometryReader" || name === "Canvas" || name === "Path") return { t: "type", name };
    const f = this.funcs.get(name);
    if (f) return { t: "fn", name, call: (args, trailing) => this.callMethod(f, args, trailing, this.globals) };
    const builtin = this.builtinFunction(name);
    if (builtin) return builtin;
    if (/^\$\d+$/.test(name)) return null;
    if (OPERATORS.has(name)) return this.operator(name);
    if (/^[A-Z]/.test(name) || /^k[A-Z]/.test(name)) return this.opaque(name);
    throw new Fault(`Unknown name '${name}'`);
  }

  private operator(name: string): V {
    return {
      t: "fn",
      name,
      call: (args) => {
        const a = args[0]?.value ?? null;
        const b = args[1]?.value ?? null;
        if (name === "&&") return truthy(a) && truthy(b);
        if (name === "||") return truthy(a) || truthy(b);
        if (args.length === 1 && name === "-") return this.binop("-", 0, a);
        return this.binop(name, a, b);
      },
    };
  }

  private enumOf(caseName: string): string | undefined {
    const hit = this.caseOwner.get(caseName);
    if (hit !== undefined) return hit ?? undefined;
    let found: string | null = null;
    for (const t of this.types.values()) {
      if (t.kind === "enum" && t.cases.some((c) => c.name === caseName)) {
        if (found) {
          found = null;
          break;
        }
        found = t.name;
      }
    }
    this.caseOwner.set(caseName, found);
    return found ?? undefined;
  }

  private opaque(name: string, view = false): V {
    const base = name.replace(/^<|>$/g, "").split(".")[0];
    if (/^(CM|CL|AV|CH|LA|NW|CB|UI|NS|MK|HK|SK|WK|GK|EK|PH|CN|AR|RP|ST|SF|MP)[A-Z]/.test(base) || /Manager$|Engine$|Session$|Monitor$|Center$/.test(base)) this.note(`~${base}`);
    return view ? { t: "opaque", name, view: true } : { t: "opaque", name };
  }

  private typeNamesOf(v: V): string[] {
    if (v instanceof Dbl) return NAMES_DOUBLE;
    if (typeof v === "number") return NAMES_INT;
    if (typeof v === "string") return NAMES_STRING;
    if (typeof v === "boolean") return NAMES_BOOL;
    if (Array.isArray(v)) return NAMES_ARRAY;
    if (v === null || typeof v !== "object") return NAMES_NONE;
    switch (v.t) {
      case "range":
        return NAMES_RANGE;
      case "color":
        return NAMES_COLOR;
      case "font":
        return NAMES_FONT;
      case "date":
        return NAMES_DATE;
      case "dict":
        return NAMES_DICT;
      case "views":
        return NAMES_VIEW;
      case "sym":
        if (!v.type) {
          if (toFont(v)) return NAMES_FONT;
          if (toColor(v, this.scheme)) return NAMES_COLOR;
        }
        return NAMES_NONE;
      default:
        return NAMES_NONE;
    }
  }

  private extMember(v: V, name: string, kind: "method" | "prop"): { m?: Method; p?: Property } | undefined {
    if (!this.exts.size) return undefined;
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
      if (p?.getter) return this.withInst(inst, () => this.propValue(p, new Env(this.globals, self)));
      const m = this.findMethod(inst.decl, name, false);
      if (m) return { t: "fn", name, call: (args, trailing) => this.withInst(inst, () => this.callMethod(m, args, trailing, new Env(this.globals, self))) };
      if (this.findProp(inst.decl, name, true) || this.findMethod(inst.decl, name, true)) return this.staticMember(inst.decl.name, name);
      return undefined;
    }
    const v = self.value;
    const decl = self.decl ? (self.decl.kind === "extension" ? self.decl : this.live(self.decl)) : null;
    if (!decl || this.typeNamesOf(v).length) {
      const ext = this.extMember(v, name, "prop");
      if (ext?.p) return this.propValue(ext.p, new Env(this.globals, self));
      const extM = this.extMember(v, name, "method");
      if (extM?.m) {
        const m = extM.m;
        return { t: "fn", name, call: (args, trailing) => this.callMethod(m, args, trailing, new Env(this.globals, self)) };
      }
      if (!decl && /^[a-z]/.test(name)) {
        if (nodesOf(v)) return { t: "fn", name, call: (args, trailing) => this.callMember(v, name, args, trailing, env) };
        try {
          return this.member(v, name, env);
        } catch (e) {
          if (!(e instanceof Fault) || e instanceof Abort) throw e;
        }
        if (this.typeNamesOf(v).length) return { t: "fn", name, call: (args, trailing) => this.callMember(v, name, args, trailing, env) };
        return undefined;
      }
      if (!decl) return undefined;
    }
    if (isT(v, "type")) {
      const st = this.staticMember(decl.name, name);
      if (!isT(st, "sym") || st.type !== undefined || decl.cases.some((c) => c.name === name)) {
        if (!(isT(st, "sym") && st.type === decl.name && !decl.cases.some((c) => c.name === name))) return st;
      }
    }
    if ((isT(v, "rec") || isT(v, "obj")) && v.fields.has(name)) return v.fields.get(name) ?? null;
    const p = this.findProp(decl, name);
    if (p && !p.isStatic) {
      if (p.getter) return this.propValue(p, new Env(this.globals, self));
      if (p.isLazy && p.init && (isT(v, "rec") || isT(v, "obj"))) {
        const made = coerce(this.propValue(p, new Env(this.globals, self)), p.type);
        v.fields.set(name, made);
        return made;
      }
    }
    if (p?.isStatic) return this.staticMember(decl.name, name);
    const m = this.findMethod(decl, name);
    if (m) return { t: "fn", name, call: (args, trailing) => this.callMethod(m, args, trailing, new Env(this.globals, self)) };
    if (decl.kind === "enum") {
      if (decl.cases.some((c) => c.name === name)) return { t: "sym", name, type: decl.name };
      if (isT(v, "sym") && name === "rawValue") return this.caseRaw(decl, v.name);
    }
    return undefined;
  }

  private callMethod(m: Method, args: EvArg[], trailing: V[], env: Env): V {
    const local = env.child();
    const bound = this.bind(m.params, args, trailing, false) ?? [];
    m.params.forEach((param, i) => {
      const given = bound[i];
      const v = given !== undefined ? given : param.def ? this.evalExpr(param.def, local) : placeholderFor(param.type);
      local.define(param.name, coerce(v, param.type));
    });
    return this.scoped(m.file, isViewType(m.ret), () => this.runBody(m.body, local));
  }

  callValue(fn: V, args: EvArg[], trailing: V[]): V {
    if (isT(fn, "fn")) return fn.call(args, trailing);
    if (isT(fn, "closure")) {
      const env = (fn.env as Env).child();
      const params = fn.fn.params;
      const values = [...args.map((a) => a.value), ...trailing];
      if (params.length === 1 && values.length > 1) values.splice(0, values.length, { t: "tuple", items: values.slice(), labels: values.map(() => null) });
      const wanted = params.length > 1 ? params.length : params.length === 0 ? maxDollar(fn.fn) + 1 : 1;
      if (wanted > 1 && values.length === 1 && isT(values[0], "tuple")) values.splice(0, 1, ...(values[0] as Extract<V, { t: "tuple" }>).items);
      params.forEach((p, i) => {
        const v = values[i] ?? null;
        env.define(p, v);
        if (p.startsWith("$") && isT(v, "binding")) env.alias(p.slice(1), { get: v.get, set: v.set });
      });
      values.forEach((v, i) => env.define(`$${i}`, v));
      const prevFile = this.curFile;
      if (fn.file !== undefined) this.curFile = fn.file;
      try {
        return this.runBody(fn.fn.body, env);
      } finally {
        this.curFile = prevFile;
      }
    }
    if (isT(fn, "type")) return this.callType(fn.name, args, trailing, this.globals);
    return null;
  }

  private reduceInto(fn: V | undefined, initial: V, list: V[]): V {
    let acc = copyValue(initial);
    const slot: Slot = { get: () => acc, set: (v) => void (acc = v) };
    if (!fn || !isT(fn, "closure")) return acc;
    const params = fn.fn.params;
    for (const x of list) {
      this.tick();
      const env = (fn.env as Env).child();
      env.alias("$0", slot);
      env.define("$1", x);
      if (params[0]) env.alias(params[0], slot);
      if (params[1]) env.define(params[1], x);
      this.runBody(fn.fn.body, env);
    }
    return acc;
  }

  private evalCall(e: Extract<Expr, { k: "call" }>, env: Env): V {
    const args: EvArg[] = e.args.map((a) => ({ label: a.label, value: this.evalExpr(a.value, env) }));
    const trailing: V[] = [];
    for (const t of e.trailing) {
      const fn: V = { t: "closure", fn: t.fn, env, file: this.curFile };
      if (t.label === null) trailing.push(fn);
      else args.push({ label: t.label, value: fn });
    }
    const callee = e.callee;
    if (callee.k === "member" && callee.base === null) {
      if (callee.name === "constant") {
        const v = args[0]?.value ?? null;
        return { t: "binding", get: () => v, set: () => {} };
      }
      if (callee.name === "init") return args.length && args.every((a) => a.label) ? { t: "tuple", items: args.map((a) => a.value), labels: args.map((a) => a.label ?? "") } : null;
      return { t: "sym", name: callee.name, args };
    }
    if (callee.k === "member" && callee.base) {
      const name = callee.name;
      if (name === "init" && callee.base.k === "id" && (callee.base.name === "self" || callee.base.name === "super")) {
        this.delegateInit(callee.base.name === "super", args, trailing, env);
        return null;
      }
      if (MUTATING.has(name)) {
        let slot: Slot | null = null;
        try {
          slot = this.lvalue(callee.base, env);
        } catch (err) {
          if (err instanceof Abort) throw err;
          slot = null;
        }
        if (slot) {
          const cur = slot.get();
          if (Array.isArray(cur) || typeof cur === "boolean" || isT(cur, "dict") || isNum(cur)) return this.mutate(slot, cur, name, args, trailing);
        }
      }
      const base = this.evalExpr(callee.base, env);
      return this.callMember(base, name, args, trailing, env, callee.base);
    }
    if (callee.k === "id") {
      const name = callee.name;
      const local = env.get(name);
      if (local) return this.callValue(local.get(), args, trailing);
      const self = env.self;
      const implicit = self && "value" in self && /^[a-z]/.test(name) ? self.value : undefined;
      if (implicit !== undefined && (isT(implicit, "rec") || isT(implicit, "obj") || (isT(implicit, "sym") && implicit.type) || isT(implicit, "type"))) {
        const fromSelf = this.selfMember(self, name, env);
        if (fromSelf !== undefined && (isT(fromSelf, "fn") || isT(fromSelf, "closure"))) return this.callValue(fromSelf, args, trailing);
        return this.callType(name, args, trailing, env);
      }
      if (implicit !== undefined && !this.types.has(name) && !isViewName(name)) {
        const extM = this.extMember(implicit, name, "method");
        if (extM?.m) return this.callMethod(extM.m, args, trailing, new Env(this.globals, self));
        const collection = Array.isArray(implicit) || isT(implicit, "range") || isT(implicit, "dict");
        const global = this.funcs.has(name) || (!!this.builtinFunction(name) && !((name === "min" || name === "max") && args.length < 2 && collection));
        if (!global) {
          try {
            return this.callMember(implicit, name, args, trailing, env);
          } catch (err) {
            if (!(err instanceof Fault) || err instanceof Abort) throw err;
          }
        }
        return this.callType(name, args, trailing, env);
      }
      const fromSelf = this.selfMember(self, name, env);
      if (fromSelf !== undefined && (isT(fromSelf, "fn") || isT(fromSelf, "closure"))) return this.callValue(fromSelf, args, trailing);
      return this.callType(name, args, trailing, env);
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
    const custom = this.extensionInit(name, args, trailing);
    if (custom !== undefined) return custom;
    if (name === "GeometryReader") return this.geometryView(trailing);
    if (name === "Canvas") return this.canvasView(args, trailing);
    if (isViewName(name)) {
      const nodes = makeView(name, args, trailing, ctx);
      if (nodes) return views(nodes);
    }
    const builtin = this.builtinCall(name, args, trailing, env);
    if (builtin !== undefined) return builtin;
    const fn = this.builtinFunction(name);
    if (fn && isT(fn, "fn")) return fn.call(args, trailing);
    if (!/^[A-Z]/.test(name)) return this.opaque(name);
    const closures = [...trailing, ...args.filter((a) => a.label !== null && /^(content|label|header|footer|title|icon|actions)$/.test(a.label) && isT(a.value, "closure")).map((a) => a.value)];
    if (closures.length && !NOT_A_CONTAINER.test(name)) {
      this.note(name);
      return views([{ id: "", type: "Group", props: {}, children: closures.flatMap((c) => this.build(c, [])) }]);
    }
    return this.opaque(name, !closures.length && !NOT_A_VIEW.test(name));
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
        const at = arg(args, "at");
        if (at === undefined) {
          if (!next.some((x) => equals(x, a0))) next.push(copyValue(a0));
        } else if (arg(args, "contentsOf") !== undefined) next.splice(num(at), 0, ...sequence(arg(args, "contentsOf") ?? null));
        else next.splice(num(at), 0, copyValue(a0));
        break;
      }
      case "remove": {
        const at = arg(args, "at");
        if (at !== undefined) result = next.splice(num(at), 1)[0] ?? null;
        else if (isT(arg(args, "atOffsets") ?? null, "range") || Array.isArray(arg(args, "atOffsets") ?? null)) {
          const drop = sequence(arg(args, "atOffsets") ?? null).map(num);
          next.splice(0, next.length, ...next.filter((_x, i) => !drop.includes(i)));
        } else {
          const i = next.findIndex((x) => equals(x, a0));
          if (i >= 0) result = next.splice(i, 1)[0] ?? null;
        }
        break;
      }
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
      case "swapAt": {
        const i = num(args[0]?.value ?? 0);
        const j = num(args[1]?.value ?? 0);
        if (i >= 0 && j >= 0 && i < next.length && j < next.length) [next[i], next[j]] = [next[j], next[i]];
        break;
      }
      case "formUnion":
        for (const x of sequence(a0)) if (!next.some((y) => equals(x, y))) next.push(x);
        break;
      case "subtract": {
        const drop = sequence(a0);
        next.splice(0, next.length, ...next.filter((x) => !drop.some((y) => equals(x, y))));
        break;
      }
      case "formIntersection": {
        const keep = sequence(a0);
        next.splice(0, next.length, ...next.filter((x) => keep.some((y) => equals(x, y))));
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
    if (isT(v, "opaque")) return this.opaque(`${v.name}.${name}`, v.view);
    if (isT(v, "type")) return this.staticMember(v.name, name);
    if (isT(v, "host")) {
      const direct = v.get(name);
      if (direct !== undefined) return direct;
    }
    const ext = this.extMember(v, name, "prop");
    if (ext?.p) return this.propValue(ext.p, new Env(this.globals, { value: v, decl: null }));
    if (isT(v, "binding")) {
      if (name === "wrappedValue") return v.get();
      if (name === "projectedValue") return v;
      return {
        t: "binding",
        get: () => this.member(v.get(), name, env),
        set: (x) => {
          const cur = v.get();
          if (isT(cur, "obj")) this.fieldSlotOf(cur, name).set(x);
          else if (isT(cur, "rec")) {
            const next = { t: "rec" as const, type: cur.type, fields: new Map(cur.fields) };
            const decl = this.live(cur.type);
            this.storeField(next, decl, this.findProp(decl, name, false), name, x);
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
      const r = this.selfMember({ value: v, decl: this.live(v.type) }, name, env);
      if (r !== undefined) return r;
    }
    const owner = isT(v, "sym") && !v.type ? this.enumOf(v.name) : undefined;
    const typed: V = owner && isT(v, "sym") ? { ...v, type: owner } : v;
    if (isT(typed, "sym") && typed.type) {
      const decl = this.types.get(typed.type);
      if (name === "rawValue" && decl) return this.caseRaw(decl, typed.name);
      if (name === "id" && decl && !this.findProp(decl, "id", false)) return typed.name;
      if (decl) {
        const r = this.selfMember({ value: typed, decl }, name, env);
        if (r !== undefined) return r;
      }
    }
    if (isT(v, "views") && name === "body") return v;
    return this.builtinMember(v, name, undefined, [], env);
  }

  private callMember(base: V, name: string, args: EvArg[], trailing: V[], env: Env, target?: Expr): V {
    if (base === null || base === undefined) return null;
    if (isT(base, "type")) return name === "init" ? this.callType(base.name, args, trailing, env) : this.staticCall(base.name, name, args, trailing, env);
    if (name === "init") return null;
    if (isT(base, "opaque")) {
      if (base.view) {
        const out = applyMod([this.placeholderNode(base.name)], name, args, trailing, this.ctx());
        if (out) return views(out);
      }
      if ((name === "run" || name === "async") && trailing[0] !== undefined && !base.view) {
        this.plain(() => this.callValue(trailing[0], [], []));
        return null;
      }
      return this.opaque(`${base.name}.${name}`, base.view);
    }
    if (isT(base, "host")) {
      const direct = base.call(name, args, trailing);
      if (direct !== undefined) return direct;
      const drawn = hostNodes(base);
      if (drawn) return this.applyModifier(drawn, base, name, args, trailing, env);
      return null;
    }
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
      const decl = isT(base, "sym") ? this.types.get(base.type!) : this.live(base.type);
      if (decl) {
        const m = this.findMethod(decl, name);
        if (m) {
          const ref = { value: base, decl };
          const result = this.callMethod(m, args, trailing, new Env(this.globals, ref));
          if (ref.value !== base && target) {
            try {
              this.lvalue(target, env).set(ref.value);
            } catch (err) {
              if (!(err instanceof Fault) || err instanceof Abort) throw err;
            }
          }
          return result;
        }
        if (decl.kind !== "enum" || !isT(base, "sym")) {
          const f = (isT(base, "rec") || isT(base, "obj")) && base.fields.get(name);
          if (f && (isT(f, "closure") || isT(f, "fn"))) return this.callValue(f, args, trailing);
        }
      }
    }
    if (isT(base, "fn") || isT(base, "closure")) {
      if (name === "callAsFunction") return this.callValue(base, args, trailing);
      return this.callValue(this.member(base, name, env), args, trailing);
    }
    if ((name === "async" || name === "sync") && trailing[0] !== undefined && isT(base, "sym")) {
      this.plain(() => this.callValue(trailing[0], [], []));
      return null;
    }
    return this.builtinMember(base, name, args, trailing, env);
  }

  private applyModifier(nodes: ViewNode[], base: V, name: string, args: EvArg[], trailing: V[], env: Env): V {
    switch (name) {
      case "modifier": {
        const m = args[0]?.value ?? null;
        if (isT(m, "rec") || isT(m, "obj")) {
          const decl = this.live(m.type);
          const method = this.findMethod(decl, "body");
          if (method) return this.callMethod(method, [{ label: "content", value: views(nodes) }], [], new Env(this.globals, { value: m, decl }));
        }
        return views(nodes);
      }
      case "onAppear":
        this.effect("appear", trailing[0] ?? arg(args, "perform") ?? arg(args, null));
        return views(nodes);
      case "task":
        this.effect("task", trailing[0] ?? arg(args, null));
        return views(nodes);
      case "onChange":
        this.watch(args, trailing);
        return views(nodes);
      case "environment":
      case "environmentObject": {
        const first = arg(args, null);
        if (first !== undefined && isT(first, "keypath")) {
          const value = arg(args, null, 1);
          if (first.path.includes("colorScheme") && value !== undefined) return this.applyModifier(nodes, base, "preferredColorScheme", [{ label: null, value }], [], env);
          return views(nodes);
        }
        if (first !== undefined) this.inject(first);
        return views(nodes);
      }
      case "buttonStyle": {
        const style = args[0]?.value ?? null;
        if (isT(style, "rec") || isT(style, "obj")) {
          const decl = this.live(style.type);
          const make = this.findMethod(decl, "makeBody");
          if (make) return views(nodes.map((n) => this.styleButtons(n, style, decl, make)));
        }
        break;
      }
    }
    const ext = this.viewMethods.get(name);
    const userFirst = ext && name !== "padding" && name !== "frame" && name !== "font" && name !== "background" && name !== "foregroundStyle";
    if (userFirst && ext) return this.callMethod(ext, args, trailing, new Env(this.globals, { value: views(nodes), decl: null }));
    const out = applyMod(nodes, name, args, trailing, this.ctx());
    if (out) return views(out);
    if (ext) return this.callMethod(ext, args, trailing, new Env(this.globals, { value: views(nodes), decl: null }));
    const shapeExt = this.shapeMethods.get(name);
    if (shapeExt) return this.callMethod(shapeExt, args, trailing, new Env(this.globals, { value: views(nodes), decl: null }));
    if (name === "path" && nodes.length === 1) {
      const made = builtinShapePath(nodes[0].type, [{ label: "cornerRadius", value: new Dbl(Number(nodes[0].props.radius ?? 8)) }], arg(args, "in"));
      if (made) return made;
    }
    this.note(`.${name}()`);
    return views(nodes);
  }

  private staticMember(typeName: string, name: string): V {
    if (name === "init" || name === "self") return { t: "type", name: typeName };
    if (!this.types.has(typeName) && !BUILTIN_TYPES.has(typeName) && !this.exts.has(typeName) && !isViewName(typeName)) return this.opaque(`${typeName}.${name}`);
    const user = this.types.get(typeName);
    if (user) {
      this.touch(user.file);
      if (user.kind === "enum" && user.cases.some((c) => c.name === name)) return { t: "sym", name, type: typeName };
      if (name === "allCases" && user.kind === "enum") return user.cases.map((c) => ({ t: "sym" as const, name: c.name, type: typeName }));
      const self: SelfRef = { value: { t: "type", name: typeName }, decl: user };
      const p = this.findProp(user, name, true);
      if (p) return p.getter ? this.propValue(p, new Env(this.globals, self)) : this.cached(`${typeName}.${name}`, p.file, `${typeName}.${name}`, () => this.propValue(p, new Env(this.globals, self)));
      const m = this.findMethod(user, name, true);
      if (m) return { t: "fn", name, call: (args, trailing) => this.callMethod(m, args, trailing, new Env(this.globals, self)) };
      if (this.types.has(name)) return { t: "type", name };
    }
    const exts = this.exts.get(typeName);
    const extProp = exts?.flatMap((x) => x.props).find((p) => p.name === name && p.isStatic);
    if (extProp) {
      const self: SelfRef = { value: { t: "type", name: typeName }, decl: null };
      return extProp.getter ? this.propValue(extProp, new Env(this.globals, self)) : this.cached(`${typeName}.${name}`, extProp.file, `${typeName}.${name}`, () => this.propValue(extProp, new Env(this.globals, self)));
    }
    const extMethod = user ? undefined : exts?.flatMap((x) => x.methods).find((m) => m.name === name && m.isStatic);
    if (extMethod) return { t: "fn", name, call: (args, trailing) => this.callMethod(extMethod, args, trailing, new Env(this.globals, { value: { t: "type", name: typeName }, decl: null })) };
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
        if (name === "zero" || name === "leastNonzeroMagnitude" || name === "leastNormalMagnitude") return new Dbl(0);
        if (name === "nan") return new Dbl(NaN);
        break;
      case "Int":
        if (name === "max") return Number.MAX_SAFE_INTEGER;
        if (name === "min") return Number.MIN_SAFE_INTEGER;
        if (name === "zero") return 0;
        break;
      case "Date":
        if (name === "now") return { t: "date", ms: Date.now() };
        if (name === "distantPast") return { t: "date", ms: Date.UTC(1, 0, 1) };
        if (name === "distantFuture") return { t: "date", ms: Date.UTC(4001, 0, 1) };
        break;
      case "CGPoint":
        if (name === "zero") return point(0, 0);
        break;
      case "CGSize":
        if (name === "zero") return size(0, 0);
        break;
      case "CGRect":
        if (name === "zero") return rect(0, 0, 0, 0);
        break;
      case "UIScreen":
        if (name === "main") return { t: "tuple", items: [rect(0, 0, this.size.width, this.size.height), new Dbl(3)], labels: ["bounds", "scale"] };
        break;
      case "ProcessInfo":
        if (name === "processInfo")
          return {
            t: "tuple",
            items: [{ t: "tuple", items: [26, 0, 0], labels: ["majorVersion", "minorVersion", "patchVersion"] }, "Version 26.0 (Build 23A341)", 6, 6, 8589934592, false, { t: "sym", name: "nominal" }, new Dbl(86400), "App", "iPhone", false, false],
            labels: ["operatingSystemVersion", "operatingSystemVersionString", "processorCount", "activeProcessorCount", "physicalMemory", "isLowPowerModeEnabled", "thermalState", "systemUptime", "processName", "hostName", "isiOSAppOnMac", "isMacCatalystApp"],
          };
        break;
      case "UIDevice":
        if (name === "current")
          return {
            t: "tuple",
            items: ["iPhone", "iPhone", "iPhone", "iOS", "26.0", new Dbl(0.82), { t: "sym", name: "unplugged" }, true, { t: "sym", name: "phone" }, { t: "sym", name: "portrait" }, false],
            labels: ["name", "model", "localizedModel", "systemName", "systemVersion", "batteryLevel", "batteryState", "isBatteryMonitoringEnabled", "userInterfaceIdiom", "orientation", "isProximityMonitoringEnabled"],
          };
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
        return range !== undefined && isT(range, "range") ? range.lo + Math.floor(random() * (rangeEnd(range) - range.lo)) : 0;
      case "Double.random":
      case "CGFloat.random":
      case "Float.random": {
        const r = range as V;
        if (isT(r, "range")) return new Dbl(r.lo + random() * (r.hi - r.lo));
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
      case "Task.detached":
        if (trailing[0] !== undefined) this.plain(() => this.callValue(trailing[0], [], []));
        return null;
      case "Task.sleep":
      case "Task.yield":
      case "Task.checkCancellation":
        return null;
    }
    if (isT(member, "sym")) return { ...member, args };
    if (isT(member, "color") && name !== "init") return this.builtinMember(member, name, args, trailing, env);
    return null;
  }

  private subscript(base: V, args: EvArg[]): V {
    const idx = args[0]?.value ?? null;
    if (args[0]?.label && !(isT(base, "dict") && args[0].label === "default") && !isT(base, "rec") && !isT(base, "obj")) {
      const ext = this.extMember(base, "subscript", "method");
      if (ext?.m) return this.callMethod(ext.m, args, [], new Env(this.globals, { value: base, decl: null }));
    }
    if (Array.isArray(base)) {
      if (isT(idx, "range")) return base.slice(Math.max(0, idx.lo), rangeEnd(idx));
      const i = num(idx);
      if (i < 0 || i >= base.length) throw new Fault("Index out of range");
      return base[i];
    }
    if (typeof base === "string") return isT(idx, "range") ? base.slice(Math.max(0, idx.lo), rangeEnd(idx)) : (base[num(idx)] ?? null);
    if (isT(base, "opaque")) return this.opaque(`${base.name}[]`);
    if (isT(base, "dict")) {
      const hit = base.m.get(keyOf(idx));
      return hit ? hit[1] : (arg(args, "default") ?? null);
    }
    if (isT(base, "tuple")) return base.items[num(idx)] ?? null;
    if (isT(base, "rec") || isT(base, "obj")) {
      const decl = this.live(base.type);
      const m = this.findMethod(decl, "subscript");
      if (m) return this.callMethod(m, args, [], new Env(this.globals, { value: base, decl }));
      return null;
    }
    if (isT(base, "binding")) {
      return {
        t: "binding",
        get: () => {
          const cur = base.get();
          if (Array.isArray(cur)) return cur[num(idx)] ?? null;
          return this.subscript(cur, args);
        },
        set: (x) => {
          const cur = base.get();
          if (Array.isArray(cur)) {
            const next = cur.slice();
            next[num(idx)] = x;
            base.set(next);
          } else if (isT(cur, "dict")) {
            const m = new Map(cur.m);
            if (x === null) m.delete(keyOf(idx));
            else m.set(keyOf(idx), [idx, x]);
            base.set({ t: "dict", m });
          }
        },
      };
    }
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
        return { t: "range", lo: num(a), hi: num(b), closed: true };
    }
    if (isT(a, "date")) {
      if (isT(b, "date")) {
        if (op === "-") return new Dbl((a.ms - b.ms) / 1000);
      } else if (isNum(b) && (op === "+" || op === "-")) return { t: "date", ms: a.ms + (op === "+" ? 1 : -1) * num(b) * 1000 };
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
            this.note("?division by zero");
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
    const hit = this.builtins.get(name);
    if (hit !== undefined) return hit ?? undefined;
    const made = this.makeBuiltin(name);
    this.builtins.set(name, made ?? null);
    return made;
  }

  private makeBuiltin(name: string): V | undefined {
    const f = MATH1[name];
    if (f) {
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
      case "hypot":
        return { t: "fn", name, call: (args) => new Dbl(Math.hypot(num(args[0]?.value ?? 0), num(args[1]?.value ?? 0))) };
      case "fmod":
        return { t: "fn", name, call: (args) => new Dbl(num(args[0]?.value ?? 0) % (num(args[1]?.value ?? 1) || 1)) };
      case "NSLocalizedString":
        return { t: "fn", name, call: (args) => describe(args[0]?.value ?? "") };
      case "CACurrentMediaTime":
        return { t: "fn", name, call: () => new Dbl(Date.now() / 1000) };
      case "__cast":
        return { t: "fn", name, call: (args) => this.cast(args[0]?.value ?? null, describe(args[1]?.value ?? "")) };
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
            if (isT(v, "rec") || isT(v, "obj")) return v.type.name === t || this.conforms(this.live(v.type), t) || this.related(this.live(v.type)).some((d) => d.name === t);
            if (isT(v, "sym") && v.type) return v.type === t;
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
        const localized = arg(args, "localized");
        if (localized !== undefined) return describe(localized);
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
      case "Dictionary": {
        const m = new Map<string, [V, V]>();
        const grouping = arg(args, "grouping");
        const by = arg(args, "by") ?? trailing[0];
        if (grouping !== undefined) {
          for (const x of sequence(grouping)) {
            const k = this.keyPathOr(by, x);
            const slot = m.get(keyOf(k));
            if (slot) (slot[1] as V[]).push(x);
            else m.set(keyOf(k), [k, [x]]);
          }
          return { t: "dict", m };
        }
        for (const pair of sequence(arg(args, "uniqueKeysWithValues") ?? first ?? null)) {
          if (isT(pair, "tuple")) m.set(keyOf(pair.items[0]), [pair.items[0], pair.items[1] ?? null]);
        }
        return { t: "dict", m };
      }
      case "State":
      case "StateObject":
      case "ObservedObject":
      case "Published":
      case "AppStorage":
      case "SceneStorage":
      case "Bindable":
      case "FocusState":
      case "GestureState":
      case "AnyShapeStyle":
      case "AnyTransition":
        return arg(args, "initialValue") ?? arg(args, "wrappedValue") ?? first ?? null;
      case "Path": {
        const fn = trailing[0];
        if (fn !== undefined) {
          const made = makePath();
          this.plain(() => this.callValue(fn, [{ label: null, value: made }], []));
          return made;
        }
        return pathFrom(args) ?? makePath();
      }
      case "DateComponents":
        return { t: "tuple", items: args.map((a) => a.value), labels: args.map((a) => a.label) };
      case "IndexSet": {
        const range = arg(args, "integersIn");
        if (range !== undefined) return sequence(range);
        return first === undefined ? [] : Array.isArray(first) ? first : [first];
      }
      case "NavigationPath":
        return [];
      case "Measurement":
        return { t: "tuple", items: [arg(args, "value") ?? new Dbl(0), arg(args, "unit") ?? null], labels: ["value", "unit"] };
      case "UnitPoint":
        return point(num(arg(args, "x") ?? 0), num(arg(args, "y") ?? 0));
      case "CGVector":
        return { t: "tuple", items: [arg(args, "dx") ?? new Dbl(0), arg(args, "dy") ?? new Dbl(0)], labels: ["dx", "dy"] };
      case "Calendar":
        return { t: "sym", name: "current" };
      case "UUID":
        return `${Math.floor(random() * 0xffffffff).toString(16).padStart(8, "0")}-0000-4000-8000-${Math.floor(random() * 0xffffffffffff).toString(16).padStart(12, "0")}`;
      case "Date": {
        const epoch = arg(args, "timeIntervalSince1970");
        if (epoch !== undefined) return { t: "date", ms: num(epoch) * 1000 };
        const reference = arg(args, "timeIntervalSinceReferenceDate");
        if (reference !== undefined) return { t: "date", ms: (num(reference) + 978307200) * 1000 };
        const interval = arg(args, "timeInterval");
        const base = arg(args, "since");
        if (interval !== undefined && base !== undefined && isT(base, "date")) return { t: "date", ms: base.ms + num(interval) * 1000 };
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
        return size(num(arg(args, "width") ?? first ?? 0), num(arg(args, "height") ?? arg(args, null, 1) ?? 0));
      case "CGPoint":
        return point(num(arg(args, "x") ?? first ?? 0), num(arg(args, "y") ?? arg(args, null, 1) ?? 0));
      case "CGRect":
        return makeRect(args);
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
        if (trailing[0] !== undefined) this.plain(() => this.callValue(trailing[0], [], []));
        return null;
      case "Timer":
      case "DispatchQueue":
        return null;
      case "Gradient":
        return { t: "sym", name: "gradient", args };
      case "StrokeStyle":
        return strokeStyle(args);
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
    const apply = (fn: V | undefined, ...xs: V[]) => (xs.length === 1 ? this.keyPathOr(fn, xs[0]) : this.plain(() => this.callValue(fn ?? null, xs.map((value) => ({ label: null, value })), [])));
    if (isT(v, "tuple")) {
      const geo = rectMember(v, name, args);
      if (geo !== undefined) return geo;
      if (name === "formatted" && v.labels[0] === "value" && v.labels[1] === "unit") return `${this.formatNumber(v.items[0], undefined)} ${isT(v.items[1], "sym") ? v.items[1].name : ""}`.trim();
    }
    if (call && (name === "map" || name === "flatMap") && !Array.isArray(v) && typeof v !== "string" && !isT(v, "range") && !isT(v, "dict") && !isT(v, "binding") && !isT(v, "views")) return this.keyPathOr(fnArg, v);
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
      if (call && !v.type) {
        const special = this.symCall(v, name, a);
        if (special !== undefined) return special;
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
          if (fnArg !== undefined && (isT(fnArg, "closure") || isT(fnArg, "fn") || isT(fnArg, "keypath"))) return [...v].some((c) => truthy(apply(fnArg, c)));
          return name === "contains" ? v.includes(describe(first ?? "")) : v.toLowerCase().includes(describe(first ?? "").toLowerCase());
        case "map":
          return [...v].map((c) => apply(fnArg, c));
        case "compactMap":
          return [...v].map((c) => apply(fnArg, c)).filter((x) => x !== null && x !== undefined);
        case "filter":
          return [...v].filter((c) => truthy(apply(fnArg, c))).join("");
        case "allSatisfy":
          return [...v].every((c) => truthy(apply(fnArg, c)));
        case "localizedUppercase":
          return v.toUpperCase();
        case "localizedLowercase":
          return v.toLowerCase();
        case "starts":
          return v.startsWith(describe(arg(a, "with") ?? ""));
        case "replacing":
          return v.split(describe(first ?? "")).join(describe(arg(a, "with") ?? ""));
        case "range":
          return v.includes(describe(arg(a, "of") ?? first ?? "")) ? { t: "range", lo: v.indexOf(describe(arg(a, "of") ?? first ?? "")), hi: v.indexOf(describe(arg(a, "of") ?? first ?? "")) + describe(arg(a, "of") ?? first ?? "").length } : null;
        case "padding": {
          const length = num(arg(a, "toLength") ?? 0);
          return v.padEnd(length, describe(arg(a, "withPad") ?? " ")).slice(0, length);
        }
        case "isLetter":
          return /^\p{L}$/u.test(v);
        case "isWhitespace":
          return /^\s$/.test(v);
        case "isUppercase":
          return v !== v.toLowerCase() && v === v.toUpperCase();
        case "isLowercase":
          return v !== v.toUpperCase() && v === v.toLowerCase();
        case "isPunctuation":
          return /^\p{P}$/u.test(v);
        case "wholeNumberValue":
          return /^\d$/.test(v) ? Number(v) : null;
        case "formatted":
        case "localizedDescription":
        case "path":
        case "lastPathComponent":
          return name === "lastPathComponent" ? (v.split("/").pop() ?? v) : v;
        case "sorted":
          return [...v].sort();
        case "indices":
          return { t: "range", lo: 0, hi: [...v].length };
        case "hashValue":
        case "hash":
          return [...v].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
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
        case "rounded": {
          const rule = isT(first ?? null, "sym") ? (first as { name: string }).name : "";
          const r = rule === "up" ? Math.ceil(x) : rule === "down" ? Math.floor(x) : rule === "towardZero" ? Math.trunc(x) : rule === "awayFromZero" ? (x < 0 ? Math.floor(x) : Math.ceil(x)) : Math.round(x);
          return new Dbl(r);
        }
        case "isFinite":
          return Number.isFinite(x);
        case "isInfinite":
          return !Number.isFinite(x) && !Number.isNaN(x);
        case "advanced":
          return this.binop("+", v, arg(a, "by") ?? 0);
        case "distance":
          return this.binop("-", arg(a, "to") ?? 0, v);
        case "sign":
          return { t: "sym", name: x < 0 ? "minus" : "plus" };
        case "hashValue":
          return x;
        case "quotientAndRemainder": {
          const d = num(arg(a, "dividingBy") ?? 1) || 1;
          return { t: "tuple", items: [Math.trunc(x / d), x % d], labels: ["quotient", "remainder"] };
        }
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
          return Math.max(0, rangeEnd(v) - v.lo);
        case "contains":
          if (first !== undefined && isNum(first)) return inRange(v, num(first));
          break;
        case "overlaps": {
          const o = first;
          return o !== undefined && isT(o, "range") ? o.lo <= v.hi && v.lo <= o.hi : false;
        }
        case "clamped": {
          const o = arg(a, "to");
          return o !== undefined && isT(o, "range") ? { ...v, lo: Math.max(v.lo, o.lo), hi: Math.min(v.hi, o.hi) } : v;
        }
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
        case "mapValues":
        case "compactMapValues": {
          const m = new Map<string, [V, V]>();
          for (const [k, [key, x]] of v.m) {
            const y = apply(fnArg, x);
            if (name === "mapValues" || (y !== null && y !== undefined)) m.set(k, [key, y]);
          }
          return { t: "dict", m };
        }
        case "filter": {
          const m = new Map<string, [V, V]>();
          for (const [k, [key, x]] of v.m) if (truthy(apply(fnArg, { t: "tuple", items: [key, x], labels: ["key", "value"] }))) m.set(k, [key, x]);
          return { t: "dict", m };
        }
        case "merging": {
          const m = new Map(v.m);
          const other = first;
          if (other !== undefined && isT(other, "dict")) for (const [k, pair] of other.m) m.set(k, pair);
          return { t: "dict", m };
        }
      }
    }
    if (isT(v, "date")) {
      switch (name) {
        case "formatted":
          return this.formatDate(v.ms, a.some((x) => x.label !== null) ? { t: "sym", name: "__parts", args: a } : first);
        case "ISO8601Format":
          return new Date(v.ms).toISOString();
        case "advanced":
          return { t: "date", ms: v.ms + num(arg(a, "by") ?? 0) * 1000 };
        case "distance": {
          const other = arg(a, "to");
          return new Dbl(other !== undefined && isT(other, "date") ? (other.ms - v.ms) / 1000 : 0);
        }
        case "compare": {
          const other = first;
          const d = other !== undefined && isT(other, "date") ? v.ms - other.ms : 0;
          return { t: "sym", name: d < 0 ? "orderedAscending" : d > 0 ? "orderedDescending" : "orderedSame" };
        }
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
          const into = arg(a, "into");
          if (into !== undefined) return this.reduceInto(trailing[0] ?? a[a.length - 1]?.value, into, list);
          const fn = trailing[0] ?? a[1]?.value;
          let acc: V = a[0]?.value ?? null;
          for (const x of list) acc = this.plain(() => this.callValue(fn ?? null, [{ label: null, value: acc }, { label: null, value: x }], []));
          return acc;
        }
        case "count":
          return list.filter((x) => truthy(apply(arg(a, "where") ?? trailing[0], x))).length;
        case "union": {
          const out = list.slice();
          for (const x of sequence(first ?? null)) if (!out.some((y) => equals(x, y))) out.push(x);
          return out;
        }
        case "intersection": {
          const other = sequence(first ?? null);
          return list.filter((x) => other.some((y) => equals(x, y)));
        }
        case "subtracting": {
          const other = sequence(first ?? null);
          return list.filter((x) => !other.some((y) => equals(x, y)));
        }
        case "symmetricDifference": {
          const other = sequence(first ?? null);
          return [...list.filter((x) => !other.some((y) => equals(x, y))), ...other.filter((x) => !list.some((y) => equals(x, y)))];
        }
        case "isSubset": {
          const other = sequence(arg(a, "of") ?? null);
          return list.every((x) => other.some((y) => equals(x, y)));
        }
        case "isSuperset": {
          const other = sequence(arg(a, "of") ?? null);
          return other.every((x) => list.some((y) => equals(x, y)));
        }
        case "isDisjoint": {
          const other = sequence(arg(a, "with") ?? null);
          return !list.some((x) => other.some((y) => equals(x, y)));
        }
        case "lastIndex": {
          const of = arg(a, "of");
          for (let i = list.length - 1; i >= 0; i--) if (of !== undefined ? equals(list[i], of) : truthy(apply(arg(a, "where") ?? trailing[0], list[i]))) return i;
          return null;
        }
        case "elementsEqual": {
          const other = sequence(first ?? null);
          return other.length === list.length && list.every((x, i) => equals(x, other[i]));
        }
        case "starts": {
          const other = sequence(arg(a, "with") ?? null);
          return other.every((x, i) => equals(x, list[i] ?? null));
        }
        case "drop": {
          const fn = arg(a, "while") ?? trailing[0];
          let i = 0;
          while (i < list.length && truthy(apply(fn, list[i]))) i++;
          return list.slice(i);
        }
        case "index":
          return num(arg(a, "after") ?? arg(a, "before") ?? first ?? 0) + (arg(a, "before") !== undefined ? -1 : arg(a, "after") !== undefined ? 1 : num(arg(a, "offsetBy") ?? 0));
        case "underestimatedCount":
        case "capacity":
          return list.length;
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
          return fnArg !== undefined && (isT(fnArg, "closure") || isT(fnArg, "fn") || isT(fnArg, "keypath")) ? list.some((x) => truthy(apply(fnArg, x))) : list.some((x) => equals(x, first ?? null));
        case "allSatisfy":
          return list.every((x) => truthy(apply(fnArg, x)));
        case "firstIndex": {
          const of = arg(a, "of");
          const i = of !== undefined ? list.findIndex((x) => equals(x, of)) : list.findIndex((x) => truthy(apply(arg(a, "where") ?? trailing[0], x)));
          return i < 0 ? null : i;
        }
        case "joined":
          if (arg(a, "separator") === undefined && list.length && list.every((x) => Array.isArray(x))) return list.flatMap((x) => x as V[]);
          return list.map((x) => describe(x)).join(describe(arg(a, "separator") ?? ""));
        case "prefix": {
          const fn = arg(a, "while");
          if (fn !== undefined) {
            let i = 0;
            while (i < list.length && truthy(apply(fn, list[i]))) i++;
            return list.slice(0, i);
          }
          const upTo = arg(a, "upTo");
          const through = arg(a, "through");
          return list.slice(0, upTo !== undefined ? num(upTo) : through !== undefined ? num(through) + 1 : num(first ?? 0));
        }
        case "suffix": {
          const from = arg(a, "from");
          return from !== undefined ? list.slice(num(from)) : list.slice(Math.max(0, list.length - num(first ?? 0)));
        }
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
    if (isT(v, "binding")) {
      if (call && (name === "animation" || name === "transaction")) return v;
      return call ? this.callMember(v.get(), name, a, trailing, env) : this.member(v.get(), name, env);
    }
    if (isT(v, "fn") || isT(v, "closure")) return null;
    this.note(call ? `?${name}()` : `?${name}`);
    return null;
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
    return this.plain(() => this.callValue(fn, [{ label: null, value: x }], []));
  }

  private cast(v: V, type: string): V {
    if (v === null || isT(v, "opaque")) return null;
    const t = type.replace(/[?!\s]/g, "");
    switch (t) {
      case "String":
        return typeof v === "string" ? v : null;
      case "Int":
        return typeof v === "number" ? v : null;
      case "Double":
      case "CGFloat":
      case "Float":
        return v instanceof Dbl ? v : typeof v === "number" ? new Dbl(v) : null;
      case "Bool":
        return typeof v === "boolean" ? v : null;
    }
    const decl = this.types.get(t);
    if (decl && (isT(v, "rec") || isT(v, "obj"))) return v.type.name === t || this.related(this.live(v.type)).some((d) => d.name === t) ? v : null;
    if (this.protocols.has(t) && (isT(v, "rec") || isT(v, "obj"))) return this.conforms(this.live(v.type), t) ? v : null;
    return v;
  }

  locale: string | undefined;

  private symCall(v: Extract<V, { t: "sym" }>, name: string, a: EvArg[]): V | undefined {
    const first = arg(a, null);
    const dateArg = (label: string | null, index = 0): number | null => {
      const d = label === null ? arg(a, null, index) : arg(a, label);
      return d !== undefined && isT(d, "date") ? d.ms : null;
    };
    const unitOf = (x: V | undefined) => (x !== undefined && isT(x, "sym") ? x.name : "");
    const part = (d: Date, unit: string): number => {
      switch (unit) {
        case "year":
          return d.getFullYear();
        case "month":
          return d.getMonth() + 1;
        case "day":
          return d.getDate();
        case "hour":
          return d.getHours();
        case "minute":
          return d.getMinutes();
        case "second":
          return d.getSeconds();
        case "weekday":
          return d.getDay() + 1;
        case "weekOfYear": {
          const start = new Date(d.getFullYear(), 0, 1);
          return Math.ceil(((d.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
        }
        case "nanosecond":
          return d.getMilliseconds() * 1e6;
      }
      return 0;
    };
    const day = (ms: number) => {
      const d = new Date(ms);
      return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    };
    const shift = (ms: number, unit: string, n: number): number => {
      const d = new Date(ms);
      switch (unit) {
        case "year":
          d.setFullYear(d.getFullYear() + n);
          break;
        case "month":
          d.setMonth(d.getMonth() + n);
          break;
        case "weekOfYear":
        case "weekOfMonth":
          d.setDate(d.getDate() + n * 7);
          break;
        case "day":
        case "weekday":
          d.setDate(d.getDate() + n);
          break;
        case "hour":
          d.setHours(d.getHours() + n);
          break;
        case "minute":
          d.setMinutes(d.getMinutes() + n);
          break;
        case "second":
          d.setSeconds(d.getSeconds() + n);
          break;
      }
      return d.getTime();
    };
    switch (name) {
      case "component": {
        const ms = dateArg("from");
        return ms === null ? undefined : part(new Date(ms), unitOf(first));
      }
      case "dateComponents": {
        const ms = dateArg("from");
        if (ms === null) return undefined;
        const units = (Array.isArray(first) ? first : []).map((u) => unitOf(u)).filter((u) => u);
        return { t: "tuple", items: units.map((u) => part(new Date(ms), u)), labels: units };
      }
      case "date": {
        const adding = arg(a, "byAdding");
        const to = dateArg("to");
        if (adding !== undefined && to !== null) {
          if (isT(adding, "sym")) return { t: "date", ms: shift(to, adding.name, num(arg(a, "value") ?? 0)) };
          if (isT(adding, "tuple")) return { t: "date", ms: adding.labels.reduce((ms, label, i) => (label ? shift(ms, label, num(adding.items[i])) : ms), to) };
        }
        const from = arg(a, "from");
        if (from !== undefined && isT(from, "tuple")) {
          const get = (l: string, d: number) => (from.labels.includes(l) ? num(from.items[from.labels.indexOf(l)]) : d);
          return { t: "date", ms: new Date(get("year", 2026), get("month", 1) - 1, get("day", 1), get("hour", 0), get("minute", 0), get("second", 0)).getTime() };
        }
        return undefined;
      }
      case "startOfDay": {
        const ms = dateArg("for");
        return ms === null ? undefined : { t: "date", ms: day(ms) };
      }
      case "isDateInToday":
      case "isDateInYesterday":
      case "isDateInTomorrow": {
        const ms = dateArg(null);
        if (ms === null) return undefined;
        const offset = name === "isDateInToday" ? 0 : name === "isDateInYesterday" ? -1 : 1;
        return day(ms) === shift(day(Date.now()), "day", offset);
      }
      case "isDateInWeekend": {
        const ms = dateArg(null);
        return ms === null ? undefined : [0, 6].includes(new Date(ms).getDay());
      }
      case "isDate": {
        const x = dateArg(null);
        const y = dateArg("inSameDayAs") ?? dateArg("equalTo");
        return x === null || y === null ? undefined : day(x) === day(y);
      }
      case "bool":
        return arg(a, "forKey") !== undefined ? false : undefined;
      case "integer":
        return arg(a, "forKey") !== undefined ? 0 : undefined;
      case "double":
      case "float":
        return arg(a, "forKey") !== undefined ? new Dbl(0) : undefined;
      case "string":
      case "object":
      case "array":
      case "dictionary":
      case "data":
      case "url":
      case "value":
        return arg(a, "forKey") !== undefined ? null : undefined;
      case "set":
      case "removeObject":
      case "synchronize":
        return arg(a, "forKey") !== undefined || name === "synchronize" ? null : undefined;
      case "formatted": {
        const amount = v.args?.[0]?.value;
        const scale: Record<string, number> = { seconds: 1, milliseconds: 0.001, microseconds: 1e-6, nanoseconds: 1e-9 };
        if (amount === undefined || !isNum(amount) || scale[v.name] === undefined) return undefined;
        const total = Math.round(num(amount) * scale[v.name]);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
      }
    }
    return undefined;
  }

  private formatValue(v: V, style: V | undefined): string {
    if (isT(v, "date")) return this.formatDate(v.ms, style);
    if (isNum(v)) return this.formatNumber(v, style);
    return describe(v);
  }

  private formatDate(ms: number, style: V | undefined): string {
    const d = new Date(ms);
    const sym = style !== undefined && style !== null && isT(style, "sym") ? style : null;
    const sub = (name: string): Extract<V, { t: "sym" }> | null => {
      const hit = sym?.args?.find((x) => x.label === name)?.value;
      return hit !== undefined && isT(hit, "sym") ? hit : null;
    };
    const choice = (x: V | undefined) => (x !== undefined && isT(x, "sym") ? x.name : "");
    if (!sym) return d.toLocaleString(this.locale, { dateStyle: "medium", timeStyle: "short" });
    switch (sym.name) {
      case "time":
        return d.toLocaleTimeString(this.locale, { hour: "numeric", minute: "2-digit" });
      case "date":
        return d.toLocaleDateString(this.locale, { dateStyle: "long" });
      case "relative":
      case "offset": {
        const diff = Math.round((ms - Date.now()) / 1000);
        const abs = Math.abs(diff);
        const [n, unit] = abs >= 86400 ? [Math.round(abs / 86400), "day"] : abs >= 3600 ? [Math.round(abs / 3600), "hour"] : abs >= 60 ? [Math.round(abs / 60), "minute"] : [abs, "second"];
        return new Intl.RelativeTimeFormat(this.locale, { numeric: "auto" }).format(diff < 0 ? -n : n, unit as Intl.RelativeTimeFormatUnit);
      }
      case "timer": {
        const total = Math.abs(Math.round((Date.now() - ms) / 1000));
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
      }
      case "iso8601":
        return d.toISOString();
      case "__parts": {
        const date = choice(sym.args?.find((x) => x.label === "date")?.value);
        const time = choice(sym.args?.find((x) => x.label === "time")?.value);
        const dateStyle = date === "omitted" ? undefined : date === "numeric" ? "short" : date === "long" ? "long" : date === "complete" ? "full" : "medium";
        const timeStyle = time === "omitted" ? undefined : time === "standard" ? "medium" : time === "complete" ? "long" : "short";
        if (!dateStyle && !timeStyle) return "";
        return d.toLocaleString(this.locale, { dateStyle: dateStyle as Intl.DateTimeFormatOptions["dateStyle"], timeStyle: timeStyle as Intl.DateTimeFormatOptions["timeStyle"] });
      }
      case "dateTime": {
        const options: Intl.DateTimeFormatOptions = {};
        const width = (name: string) => choice(sub(name)?.args?.[0]?.value);
        if (sub("year")) options.year = width("year") === "twoDigits" ? "2-digit" : "numeric";
        if (sub("month")) options.month = width("month") === "wide" ? "long" : width("month") === "narrow" ? "narrow" : width("month") === "twoDigits" ? "2-digit" : width("month") === "defaultDigits" ? "numeric" : "short";
        if (sub("day")) options.day = width("day") === "twoDigits" ? "2-digit" : "numeric";
        if (sub("weekday")) options.weekday = width("weekday") === "wide" ? "long" : width("weekday") === "narrow" ? "narrow" : "short";
        if (sub("hour")) options.hour = "numeric";
        if (sub("minute")) options.minute = "2-digit";
        if (sub("second")) options.second = "2-digit";
        if (!Object.keys(options).length) return d.toLocaleString(this.locale, { dateStyle: "short", timeStyle: "short" });
        return d.toLocaleString(this.locale, options);
      }
    }
    return d.toLocaleDateString(this.locale, { dateStyle: "medium" });
  }

  private formatNumber(v: V, style: V | undefined): string {
    const x = num(v);
    const sym = style !== undefined && style !== null && isT(style, "sym") ? style : null;
    const find = (s: V, name: string): Extract<V, { t: "sym" }> | null => {
      if (!isT(s, "sym")) return null;
      if (s.name === name) return s;
      for (const a of s.args ?? []) {
        const hit = find(a.value, name);
        if (hit) return hit;
      }
      return null;
    };
    const options: Intl.NumberFormatOptions = {};
    const percent = sym?.name === "percent";
    if (percent) options.style = "percent";
    if (sym?.name === "currency") {
      options.style = "currency";
      options.currency = describe(sym.args?.find((a) => a.label === "code")?.value ?? "USD");
    }
    const fraction = sym ? find(sym, "fractionLength") : null;
    const digits = fraction?.args?.[0]?.value;
    if (digits !== undefined && digits !== null) {
      if (isT(digits, "range")) {
        options.minimumFractionDigits = Math.max(0, digits.lo);
        options.maximumFractionDigits = Math.min(20, Math.max(options.minimumFractionDigits, digits.hi));
      } else {
        options.minimumFractionDigits = num(digits);
        options.maximumFractionDigits = num(digits);
      }
    } else if (percent) options.maximumFractionDigits = 0;
    else if (v instanceof Dbl && options.style !== "currency") options.maximumFractionDigits = 2;
    const notation = sym ? find(sym, "notation") : null;
    const notationName = notation?.args?.[0]?.value;
    if (notationName !== undefined && isT(notationName, "sym") && notationName.name === "compactName") options.notation = "compact";
    const grouping = sym ? find(sym, "grouping") : null;
    const groupingName = grouping?.args?.[0]?.value;
    if (groupingName !== undefined && isT(groupingName, "sym") && groupingName.name === "never") options.useGrouping = false;
    try {
      return new Intl.NumberFormat(this.locale, options).format(x);
    } catch {
      return String(x);
    }
  }
}

export function treeHasMod(node: ViewNode, m: Mod["m"]): boolean {
  if (node.mods?.some((x) => x.m === m)) return true;
  return [...(node.children ?? []), ...(node.label ?? [])].some((c) => treeHasMod(c, m));
}
