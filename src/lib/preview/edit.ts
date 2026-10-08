export interface ChainMod {
  name: string;
  start: number;
  end: number;
  args: string | null;
}

export interface Chain {
  base: string;
  baseEnd: number;
  mods: ChainMod[];
}

function skipString(text: string, i: number): number {
  if (text.startsWith('"""', i)) {
    const close = text.indexOf('"""', i + 3);
    return close < 0 ? text.length : close + 3;
  }
  let j = i + 1;
  let depth = 0;
  while (j < text.length) {
    const ch = text[j];
    if (ch === "\\" && text[j + 1] === "(") {
      depth++;
      j += 2;
      continue;
    }
    if (ch === "\\") {
      j += 2;
      continue;
    }
    if (depth > 0) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      j++;
      continue;
    }
    if (ch === '"') return j + 1;
    if (ch === "\n") return j;
    j++;
  }
  return j;
}

function skipTrivia(text: string, i: number): number {
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    if (text.startsWith("//", i)) {
      const nl = text.indexOf("\n", i);
      i = nl < 0 ? text.length : nl + 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    break;
  }
  return i;
}

function matchClose(text: string, open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [pairs[text[open]]];
  let i = open + 1;
  while (i < text.length && stack.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i);
      continue;
    }
    if (text.startsWith("//", i) || text.startsWith("/*", i)) {
      i = skipTrivia(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) stack.pop();
    i++;
  }
  return i - 1;
}

export function parseChain(text: string): Chain {
  const mods: ChainMod[] = [];
  let i = 0;
  let baseEnd = -1;
  let lastSignificant = "";
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i = skipString(text, i);
      lastSignificant = '"';
      continue;
    }
    if (text.startsWith("//", i) || text.startsWith("/*", i) || /\s/.test(ch)) {
      i = skipTrivia(text, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      i = matchClose(text, i) + 1;
      lastSignificant = ")";
      continue;
    }
    if (ch === "." && /[\w)\]}"?!]/.test(lastSignificant) && /[A-Za-z_]/.test(text[i + 1] ?? "")) {
      const name = /^\.([A-Za-z_]\w*)/.exec(text.slice(i))![1];
      let j = i + 1 + name.length;
      let args: string | null = null;
      const k = skipTrivia(text, j);
      if (text[k] === "(") {
        const close = matchClose(text, k);
        args = text.slice(k + 1, close);
        j = close + 1;
      }
      const t = skipTrivia(text, j);
      if (text[t] === "{" && (args !== null || /^\s*\{/.test(text.slice(j)))) {
        j = matchClose(text, t) + 1;
      }
      if (args !== null || /^(bold|italic|monospaced|resizable|clipped|hidden|underline|strikethrough|ignoresSafeArea|textCase|scaledToFit|scaledToFill)$/.test(name) || j > i + 1 + name.length) {
        if (baseEnd < 0) baseEnd = i;
        mods.push({ name, start: i, end: j, args });
        i = j;
        lastSignificant = ")";
        continue;
      }
      i = j;
      lastSignificant = "a";
      continue;
    }
    lastSignificant = ch;
    i++;
  }
  if (baseEnd < 0) baseEnd = text.length;
  return { base: text.slice(0, baseEnd).trimEnd(), baseEnd, mods };
}

export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

function lineIndent(full: string, offset: number): string {
  const lineStart = full.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(full.slice(lineStart))![0];
}

export function setModifier(full: string, a: number, b: number, names: string[], call: string | null): TextEdit | null {
  const chain = parseChain(full.slice(a, b));
  const found = [...chain.mods].reverse().find((m) => names.includes(m.name));
  if (found) {
    if (call === null) {
      let start = a + found.start;
      while (start > a && /[ \t]/.test(full[start - 1])) start--;
      if (full[start - 1] === "\n") start--;
      if (full[start - 1] === "\r") start--;
      return { start, end: a + found.end, text: "" };
    }
    return { start: a + found.start, end: a + found.end, text: `.${call}` };
  }
  if (call === null) return null;
  const last = chain.mods[chain.mods.length - 1];
  const exprIndent = lineIndent(full, a);
  const unit = /\t/.test(exprIndent) ? "\t" : "    ";
  const onOwnLine = last ? /\n[ \t]*$/.test(full.slice(a, a + last.start)) : false;
  const indent = last && onOwnLine ? lineIndent(full, a + last.start) : exprIndent + unit;
  const eol = full.includes("\r\n") ? "\r\n" : "\n";
  return { start: b, end: b, text: `${eol}${indent}.${call}` };
}

export function argOf(chain: Chain, names: string[]): string | null {
  const found = [...chain.mods].reverse().find((m) => names.includes(m.name));
  return found ? (found.args ?? "") : null;
}

export function textLiteral(chain: Chain): { start: number; end: number; value: string } | null {
  const m = /^Text\(\s*"((?:[^"\\]|\\[^(])*)"\s*\)$/.exec(chain.base);
  if (!m) return null;
  const start = chain.base.indexOf('"') + 1;
  return { start, end: start + m[1].length, value: m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") };
}
