import { lineChanges } from "./diff";
import { api } from "./ipc";
import { monaco } from "./monaco";
import { allDocs, getDoc } from "./models";
import type { GitStatus } from "./types";

interface Context {
  root: string;
  head: string | null;
  active: boolean;
}

const COLORS = { add: "rgba(52,199,89,0.75)", mod: "rgba(10,132,255,0.75)", del: "rgba(255,69,58,0.75)" };

const origins = new Map<string, Promise<string | null>>();
const marks = new WeakMap<monaco.editor.ITextModel, string[]>();
const timers = new Map<string, number>();
let context: Context | null = null;

const key = (path: string) => path.toLowerCase();

export function originalText(path: string): Promise<string | null> {
  const ctx = context;
  if (!ctx?.active || !ctx.head) return Promise.resolve(null);
  const k = key(path);
  let pending = origins.get(k);
  if (!pending) {
    pending = api.gitOriginal(ctx.root, path).catch(() => null);
    origins.set(k, pending);
  }
  return pending;
}

function clear(model: monaco.editor.ITextModel) {
  const old = marks.get(model);
  if (old?.length) marks.set(model, model.deltaDecorations(old, []));
}

async function paint(path: string) {
  const doc = getDoc(path);
  if (!doc) return;
  const ctx = context;
  if (!ctx?.active) return clear(doc.model);
  const text = await originalText(path);
  if (context !== ctx || getDoc(path) !== doc || doc.model.isDisposed()) return;
  if (text === null) return clear(doc.model);
  const last = doc.model.getLineCount();
  const decorations: monaco.editor.IModelDeltaDecoration[] = lineChanges(text, doc.model.getValue()).map((c) => {
    const from = Math.min(last, Math.max(1, c.start));
    const to = Math.min(last, Math.max(from, c.end));
    const style = c.kind === "del" && c.start === 0 ? "del-top" : c.kind;
    return {
      range: new monaco.Range(from, 1, to, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `git-mark git-${style}`,
        overviewRuler: { color: COLORS[c.kind], position: monaco.editor.OverviewRulerLane.Left },
      },
    };
  });
  marks.set(doc.model, doc.model.deltaDecorations(marks.get(doc.model) ?? [], decorations));
}

export function setGitContext(root: string | null, status: GitStatus | null) {
  const active = !!root && !!status?.repo && !status.locked;
  const head = status?.head ?? null;
  if (!root) {
    context = null;
    origins.clear();
  } else if (!context || context.root !== root || context.head !== head || context.active !== active) {
    context = { root, head, active };
    origins.clear();
  }
  for (const doc of allDocs()) void paint(doc.path);
}

export function touchGitMarks(path: string, delay = 250) {
  const k = key(path);
  window.clearTimeout(timers.get(k));
  timers.set(
    k,
    window.setTimeout(() => {
      timers.delete(k);
      void paint(path);
    }, delay),
  );
}

export function gitHead(): string | null {
  return context?.active ? context.head : null;
}
