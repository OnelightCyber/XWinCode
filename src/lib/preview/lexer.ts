export type TokKind = "id" | "num" | "str" | "op" | "punct" | "attr" | "pound" | "eof";

export interface StrChunk {
  code: string;
  pos: number;
}

export interface Token {
  kind: TokKind;
  value: string;
  pos: number;
  end: number;
  nl: boolean;
  space: boolean;
  parts?: (string | StrChunk)[];
  float?: boolean;
}

export class SyntaxError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
  }
}

const OPS = [
  "<<=",
  ">>=",
  "<<",
  ">>",
  "^=",
  "|=",
  "&=",
  "&+=",
  "&-=",
  "&*=",
  "&+",
  "&-",
  "&*",
  "...",
  "..<",
  "===",
  "!==",
  "->",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "=",
  "?",
  "&",
  "|",
  "^",
  "~",
];

const PUNCT = new Set(["(", ")", "{", "}", "[", "]", ",", ":", ";", ".", "\\"]);

const isIdStart = (c: string) => /[A-Za-z_À-￿]/.test(c);
const isIdPart = (c: string) => /[A-Za-z0-9_À-￿]/.test(c);
const isDigit = (c: string) => c >= "0" && c <= "9";

function unescape(c: string): string {
  switch (c) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "0":
      return "\0";
    default:
      return c;
  }
}

export function lex(src: string, base = 0): Token[] {
  const out: Token[] = [];
  let i = 0;
  let nl = false;
  let space = false;
  const n = src.length;

  const push = (kind: TokKind, value: string, start: number, extra: Partial<Token> = {}) => {
    out.push({ kind, value, pos: base + start, end: base + i, nl, space, ...extra });
    nl = false;
    space = false;
  };

  const readString = (start: number, raw: number): Token => {
    const triple = src.startsWith('"""', i);
    const close = '"'.repeat(triple ? 3 : 1) + "#".repeat(raw);
    i += triple ? 3 : 1;
    if (triple) {
      const eol = src.indexOf("\n", i);
      if (eol !== -1 && src.slice(i, eol).trim() === "") i = eol + 1;
    }
    const parts: (string | StrChunk)[] = [];
    let text = "";
    const escape = "\\" + "#".repeat(raw);
    while (i < n) {
      if (src.startsWith(close, i)) {
        i += close.length;
        if (text) parts.push(text);
        if (triple) dedent(parts);
        return { kind: "str", value: "", pos: base + start, end: base + i, nl: false, space: false, parts };
      }
      const c = src[i];
      if (!triple && c === "\n") throw new SyntaxError("Unterminated string", base + start);
      if (src.startsWith(escape, i)) {
        const after = src[i + escape.length];
        if (after === "(") {
          if (text) parts.push(text);
          text = "";
          let depth = 1;
          let j = i + escape.length + 1;
          const codeStart = j;
          while (j < n && depth > 0) {
            const d = src[j];
            if (d === '"') {
              j++;
              while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1;
            } else if (d === "(") depth++;
            else if (d === ")") depth--;
            j++;
          }
          if (depth > 0) throw new SyntaxError("Unterminated interpolation", base + i);
          parts.push({ code: src.slice(codeStart, j - 1), pos: base + codeStart });
          i = j;
          continue;
        }
        if (after === "u" && src[i + escape.length + 1] === "{") {
          const endBrace = src.indexOf("}", i);
          const hex = src.slice(i + escape.length + 2, endBrace);
          text += String.fromCodePoint(parseInt(hex, 16) || 0x3f);
          i = endBrace + 1;
          continue;
        }
        if (after === "\n" && triple) {
          i += escape.length + 1;
          continue;
        }
        text += unescape(after ?? "");
        i += escape.length + 1;
        continue;
      }
      text += c;
      i++;
    }
    throw new SyntaxError("Unterminated string", base + start);
  };

  while (i < n) {
    const c = src[i];
    if (c === "\n" || c === "\r") {
      nl = true;
      space = true;
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\f") {
      space = true;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (src.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (src.startsWith("*/", i)) {
          depth--;
          i += 2;
        } else {
          if (src[i] === "\n") nl = true;
          i++;
        }
      }
      space = true;
      continue;
    }
    const start = i;
    if (c === "#") {
      let raw = 0;
      while (src[i + raw] === "#") raw++;
      if (src[i + raw] === '"') {
        i += raw;
        const tok = readString(start, raw);
        out.push({ ...tok, nl, space });
        nl = false;
        space = false;
        continue;
      }
      i++;
      while (i < n && isIdPart(src[i])) i++;
      push("pound", src.slice(start + 1, i), start);
      continue;
    }
    if (c === '"') {
      const tok = readString(start, 0);
      out.push({ ...tok, nl, space });
      nl = false;
      space = false;
      continue;
    }
    if (c === "@") {
      i++;
      while (i < n && isIdPart(src[i])) i++;
      push("attr", src.slice(start + 1, i), start);
      continue;
    }
    if (c === "`") {
      const close = src.indexOf("`", i + 1);
      i = close === -1 ? n : close + 1;
      push("id", src.slice(start + 1, i - 1), start);
      continue;
    }
    if (c === "$" && (isIdPart(src[i + 1] ?? "") || isDigit(src[i + 1] ?? ""))) {
      i++;
      while (i < n && isIdPart(src[i])) i++;
      push("id", src.slice(start, i), start);
      continue;
    }
    if (isIdStart(c)) {
      while (i < n && isIdPart(src[i])) i++;
      push("id", src.slice(start, i), start);
      continue;
    }
    if (isDigit(c)) {
      let float = false;
      if (c === "0" && (src[i + 1] === "x" || src[i + 1] === "b" || src[i + 1] === "o")) {
        i += 2;
        while (i < n && /[0-9a-fA-F_]/.test(src[i])) i++;
      } else {
        while (i < n && (isDigit(src[i]) || src[i] === "_")) i++;
        if (src[i] === "." && isDigit(src[i + 1] ?? "")) {
          float = true;
          i++;
          while (i < n && (isDigit(src[i]) || src[i] === "_")) i++;
        }
        if ((src[i] === "e" || src[i] === "E") && /[0-9+-]/.test(src[i + 1] ?? "")) {
          float = true;
          i += 2;
          while (i < n && isDigit(src[i])) i++;
        }
      }
      push("num", src.slice(start, i).replace(/_/g, ""), start, { float });
      continue;
    }
    if (PUNCT.has(c) && !(c === "." && src.startsWith("..", i))) {
      i++;
      push("punct", c, start);
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      i += op.length;
      push("op", op, start);
      continue;
    }
    i++;
    push("op", c, start);
  }
  out.push({ kind: "eof", value: "", pos: base + n, end: base + n, nl: true, space: true });
  return out;
}

function dedent(parts: (string | StrChunk)[]) {
  const last = parts[parts.length - 1];
  if (typeof last === "string") {
    const m = /\n([ \t]*)$/.exec(last);
    if (m) {
      const indent = m[1];
      parts[parts.length - 1] = last.slice(0, last.length - m[0].length);
      for (let k = 0; k < parts.length; k++) {
        const p = parts[k];
        if (typeof p !== "string") continue;
        parts[k] = p.replace(new RegExp(`(^|\\n)${indent.replace(/\t/g, "\\t")}`, "g"), "$1");
      }
    }
  }
}

export function lineCol(src: string, pos: number): { line: number; column: number } {
  let line = 1;
  let col = 1;
  for (let k = 0; k < pos && k < src.length; k++) {
    if (src[k] === "\n") {
      line++;
      col = 1;
    } else col++;
  }
  return { line, column: col };
}
