import { documentSymbols, lspStatus, type LspSymbol } from "./lsp";
import type { monaco } from "./monaco";

export type SymbolKind =
  | "class"
  | "struct"
  | "enum"
  | "protocol"
  | "extension"
  | "actor"
  | "func"
  | "method"
  | "init"
  | "property"
  | "case"
  | "typealias"
  | "macro"
  | "other";

export interface Sym {
  name: string;
  kind: SymbolKind;
  line: number;
  column: number;
  endLine: number;
  depth: number;
}

export const KIND_BADGE: Record<SymbolKind, string> = {
  class: "C",
  struct: "S",
  enum: "E",
  protocol: "P",
  extension: "Ex",
  actor: "A",
  func: "ƒ",
  method: "M",
  init: "I",
  property: "V",
  case: "c",
  typealias: "T",
  macro: "#",
  other: "•",
};

const LSP_KIND: Record<number, SymbolKind> = {
  2: "extension",
  3: "extension",
  5: "class",
  6: "method",
  7: "property",
  8: "property",
  9: "init",
  10: "enum",
  11: "protocol",
  12: "func",
  13: "property",
  14: "property",
  22: "case",
  23: "struct",
  26: "typealias",
};

function flattenLsp(items: LspSymbol[], depth: number, out: Sym[]) {
  for (const s of items) {
    const range = s.range ?? s.location?.range;
    if (!range) continue;
    const at = s.selectionRange?.start ?? range.start;
    out.push({
      name: s.name,
      kind: LSP_KIND[s.kind] ?? "other",
      line: at.line + 1,
      column: at.character + 1,
      endLine: range.end.line + 1,
      depth,
    });
    if (s.children?.length) flattenLsp(s.children, depth + 1, out);
  }
}

function nestFlat(list: Sym[]): Sym[] {
  const sorted = [...list].sort((a, b) => a.line - b.line);
  const stack: Sym[] = [];
  for (const s of sorted) {
    while (stack.length && stack[stack.length - 1].endLine < s.line) stack.pop();
    s.depth = stack.length;
    stack.push(s);
  }
  return sorted;
}

const DECL =
  /^(\s*)(?:@[\w.]+(?:\([^)]*\))?\s+)*(?:(?:public|private|fileprivate|internal|open|package|static|final|override|mutating|nonmutating|nonisolated|lazy|weak|unowned|required|convenience|dynamic|indirect|class(?=\s+(?:func|var|let)))(?:\([^)]*\))?\s+)*(struct|class|enum|protocol|actor|extension|func|init|deinit|var|let|case|typealias|macro)\b\s*([^\s(:<{=,]*)/;

const TYPE_KINDS = new Set<SymbolKind>(["class", "struct", "enum", "protocol", "extension", "actor"]);
const CODE_KINDS = new Set<SymbolKind>(["func", "method", "init", "other"]);

function kindOf(keyword: string, parent: SymbolKind | undefined): SymbolKind {
  const inType = parent !== undefined && TYPE_KINDS.has(parent);
  switch (keyword) {
    case "func":
      return inType ? "method" : "func";
    case "init":
    case "deinit":
      return "init";
    case "var":
    case "let":
      return "property";
    case "case":
      return "case";
    case "struct":
    case "class":
    case "enum":
    case "protocol":
    case "actor":
    case "extension":
    case "typealias":
    case "macro":
      return keyword;
    default:
      return "other";
  }
}

export function scanSymbols(text: string): Sym[] {
  const lines = text.split(/\r?\n/);
  const out: Sym[] = [];
  const stack: { indent: number; kind: SymbolKind; index: number }[] = [];
  let inComment = false;
  lines.forEach((line, i) => {
    if (inComment) {
      if (line.includes("*/")) inComment = false;
      return;
    }
    if (/^\s*\/\*/.test(line) && !line.includes("*/")) {
      inComment = true;
      return;
    }
    if (/^\s*\/\//.test(line)) return;
    const m = DECL.exec(line);
    if (!m) return;
    const indent = m[1].replace(/\t/g, "    ").length;
    while (stack.length && stack[stack.length - 1].indent >= indent) out[stack.pop()!.index].endLine = i;
    const parent = stack[stack.length - 1]?.kind;
    const keyword = m[2];
    if ((keyword === "var" || keyword === "let" || keyword === "case") && (parent === undefined ? indent > 0 : CODE_KINDS.has(parent))) return;
    const kind = kindOf(keyword, parent);
    out.push({
      name: keyword === "init" || keyword === "deinit" ? keyword : m[3] || keyword,
      kind,
      line: i + 1,
      column: indent + 1,
      endLine: lines.length,
      depth: stack.length,
    });
    stack.push({ indent, kind, index: out.length - 1 });
  });
  return out;
}

export async function symbolsFor(model: monaco.editor.ITextModel): Promise<Sym[]> {
  if (lspStatus().state === "ready") {
    const lsp = await documentSymbols(model).catch(() => null);
    if (lsp?.length) {
      const flat: Sym[] = [];
      flattenLsp(lsp, 0, flat);
      return lsp.some((s) => s.children?.length) ? flat.sort((a, b) => a.line - b.line) : nestFlat(flat);
    }
  }
  return /\.swift$/i.test(model.uri.path) ? scanSymbols(model.getValue()) : [];
}

export function symbolAt(symbols: Sym[], line: number): Sym | null {
  let best: Sym | null = null;
  for (const s of symbols) {
    if (s.line <= line && line <= s.endLine && (!best || s.depth >= best.depth)) best = s;
  }
  return best;
}
