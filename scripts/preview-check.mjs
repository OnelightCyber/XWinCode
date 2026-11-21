import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

const out = mkdtempSync(join(tmpdir(), "xwincode-preview-"));
for (const name of ["lexer", "parser", "values", "types", "geometry", "swiftui", "runtime"]) {
  const source = readFileSync(join(root, "src", "lib", "preview", `${name}.ts`), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  writeFileSync(join(out, `${name}.js`), outputText);
}
const { Runtime } = createRequire(join(out, "index.js"))("./runtime.js");
process.on("exit", () => rmSync(out, { recursive: true, force: true }));

function collect(node, acc) {
  if (!node) return acc;
  acc.views++;
  acc.types[node.type] = (acc.types[node.type] ?? 0) + 1;
  if (node.type === "Unsupported") (node.props.error ? acc.errors : acc.placeholders).push(String(node.props.name ?? ""));
  const visit = (value) => {
    if (typeof value === "string") acc.texts.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      if (typeof value.type === "string" && value.props) collect(value, acc);
      else Object.values(value).forEach(visit);
    }
  };
  if (node.type !== "Unsupported") Object.values(node.props ?? {}).forEach(visit);
  for (const child of node.children ?? []) collect(child, acc);
  for (const child of node.label ?? []) collect(child, acc);
  for (const mod of node.mods ?? []) {
    for (const [key, value] of Object.entries(mod)) if (key !== "m") visit(value);
  }
  return acc;
}

const measure = (tree) => collect(tree, { views: 0, types: {}, texts: [], errors: [], placeholders: [] });

function swiftFiles(dir, list = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "xtool" || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) swiftFiles(path, list);
    else if (entry.name.endsWith(".swift")) list.push(path);
  }
  return list;
}

function dump(node, depth, lines) {
  if (!node || lines.length > 600) return;
  const mods = (node.mods ?? []).map((m) => m.m).join(",");
  const detail = node.type === "Text" ? ` "${String(node.props.text ?? "").slice(0, 60)}"` : node.type === "Image" ? ` ${node.props.system ?? node.props.name ?? ""}` : node.type === "Unsupported" ? ` <${node.props.name}>` : "";
  lines.push(`${"  ".repeat(depth)}${node.type}${detail}${mods ? `  [${mods}]` : ""}`);
  for (const child of node.label ?? []) dump(child, depth + 1, lines);
  for (const child of node.children ?? []) dump(child, depth + 1, lines);
}

function scan(dir, filter, showTree) {
  const files = swiftFiles(dir).map((path) => ({ path, src: readFileSync(path, "utf8") }));
  const rt = new Runtime();
  rt.locale = "en-US";
  const started = performance.now();
  rt.setFiles(files);
  const parsed = performance.now() - started;
  const tally = { ok: 0, partial: 0, empty: 0, fail: 0 };
  const notes = new Map();
  let slowest = 0;
  for (const file of files) {
    const name = relative(dir, file.path).replace(/\\/g, "/");
    if (filter && !name.includes(filter)) continue;
    const targets = rt.targets(file.path);
    for (const e of rt.render(file.path, targets[0]?.key ?? "none:").errors.filter((x) => x.line > 0)) console.log(`PARSE ${name}:${e.line}:${e.column} ${e.message}`);
    for (const target of targets) {
      rt.resetState();
      const before = performance.now();
      const result = rt.render(file.path, target.key);
      const first = performance.now() - before;
      const again = performance.now();
      rt.render(file.path, target.key);
      const warm = performance.now() - again;
      slowest = Math.max(slowest, warm);
      const m = measure(result.tree);
      const failures = [...result.errors.filter((x) => x.line === 0).map((x) => x.message), ...m.errors];
      for (const note of result.notes) notes.set(note, (notes.get(note) ?? 0) + 1);
      const state = failures.length ? "fail" : m.views === 0 ? "empty" : m.placeholders.length ? "partial" : "ok";
      tally[state]++;
      const lines = [`${state.toUpperCase().padEnd(7)} ${name} ${target.key}  views=${m.views} texts=${m.texts.length} first=${first.toFixed(1)}ms warm=${warm.toFixed(1)}ms`];
      if (failures.length) lines.push(`        errors: ${[...new Set(failures)].join(" | ")}`);
      if (m.placeholders.length) lines.push(`        placeholders: ${[...new Set(m.placeholders)].join(" | ")}`);
      const located = result.issues.filter((i) => i.kind !== "unsupported");
      if (located.length) lines.push(`        issues: ${located.map((i) => `${i.kind} ${i.message} @${i.file ? relative(dir, i.file).replace(/\\/g, "/") : "?"}:${i.line}`).join(" | ")}`);
      console.log(lines.join("\n"));
      if (showTree) {
        const tree = [];
        dump(result.tree, 2, tree);
        console.log(tree.join("\n"));
      }
    }
  }
  console.log(`\n${files.length} files parsed in ${parsed.toFixed(0)}ms, slowest warm render ${slowest.toFixed(1)}ms`);
  console.log(`ok=${tally.ok} partial=${tally.partial} empty=${tally.empty} fail=${tally.fail}`);
  if (notes.size) console.log(`notes: ${[...notes].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`).join("  ")}`);
}

function check() {
  const dir = join(root, "tests", "preview");
  const cases = JSON.parse(readFileSync(join(dir, "idioms.json"), "utf8"));
  const files = swiftFiles(dir).map((path) => ({ path, src: readFileSync(path, "utf8") }));
  const rt = new Runtime();
  rt.locale = "en-US";
  rt.setFiles(files);
  const owner = new Map();
  for (const file of files) for (const target of rt.targets(file.path)) owner.set(target.key, file.path);
  let failed = 0;
  for (const file of files) {
    for (const e of rt.render(file.path, "none:").errors.filter((x) => x.line > 0)) {
      failed++;
      console.log(`FAIL parse ${relative(dir, file.path)}:${e.line}:${e.column} ${e.message}`);
    }
  }
  for (const [id, spec] of Object.entries(cases)) {
    const key = spec.target ?? `view:${id.split("@")[0]}`;
    const path = owner.get(key);
    const problems = [];
    if (!path) problems.push(`no target ${key}`);
    else {
      rt.resetState();
      rt.sizeClass = spec.wide ? { h: "regular", v: "regular" } : { h: "compact", v: "regular" };
      rt.scheme = spec.dark ? "dark" : "light";
      let result = rt.render(path, key);
      for (const tap of spec.tap ?? []) {
        const hit = find(result.tree, (n) => n.event && measure(n).texts.some((t) => t.includes(tap)));
        if (!hit) problems.push(`nothing to tap for "${tap}"`);
        else {
          rt.dispatch({ id: hit.event, kind: "tap" });
          result = rt.render(path, key);
        }
      }
      const m = measure(result.tree);
      const allowed = spec.problems ?? [];
      const errors = [...result.errors.filter((x) => x.line === 0).map((x) => x.message), ...m.errors].filter((e) => !allowed.some((a) => e.includes(a)));
      if (errors.length) problems.push(`errors: ${[...new Set(errors)].join(" | ")}`);
      const unseen = allowed.filter((a) => !result.issues.some((i) => i.kind === "error" && i.message.includes(a) && i.line > 0));
      if (unseen.length) problems.push(`expected a located error: ${unseen.join(" | ")}`);
      const missing = (spec.expect ?? []).filter((want) => !m.texts.some((got) => got.includes(want)));
      if (missing.length) problems.push(`missing: ${missing.join(" | ")}`);
      const present = (spec.absent ?? []).filter((bad) => m.texts.some((got) => got.includes(bad)));
      if (present.length) problems.push(`should be absent: ${present.join(" | ")}`);
      const stray = m.placeholders.filter((name) => !(spec.placeholders ?? []).includes(name));
      if (stray.length) problems.push(`placeholders: ${[...new Set(stray)].join(" | ")}`);
      const lacking = (spec.types ?? []).filter((type) => !m.types[type]);
      if (lacking.length) problems.push(`node types missing: ${lacking.join(" | ")}`);
      const dump = JSON.stringify(result.tree ?? null);
      const absent = (spec.json ?? []).filter((piece) => !dump.includes(piece));
      if (absent.length) problems.push(`tree lacks: ${absent.join(" | ")}`);
      const noisy = result.notes.filter((n) => !(spec.notes ?? []).includes(n) && !n.startsWith("~") && !(spec.placeholders ?? []).includes(n));
      if (noisy.length) problems.push(`notes: ${noisy.join(" ")}`);
      if (problems.length && (missing.length || present.length)) problems.push(`got: ${m.texts.slice(0, 24).join(" | ")}`);
    }
    if (problems.length) {
      failed++;
      console.log(`FAIL ${id}\n     ${problems.join("\n     ")}`);
    }
  }
  const total = Object.keys(cases).length;
  console.log(`${total - failed}/${total} preview checks passed`);
  if (failed) process.exitCode = 1;
}

function find(node, test) {
  if (!node) return null;
  if (test(node)) return node;
  for (const child of [...(node.children ?? []), ...(node.label ?? [])]) {
    const hit = find(child, test);
    if (hit) return hit;
  }
  for (const mod of node.mods ?? []) {
    for (const value of Object.values(mod)) {
      for (const item of Array.isArray(value) ? value : []) {
        const hit = item && typeof item === "object" ? find(item.type ? item : null, test) ?? (Array.isArray(item.view) ? item.view.map((v) => find(v, test)).find(Boolean) : null) : null;
        if (hit) return hit;
      }
    }
  }
  return null;
}

const args = process.argv.slice(2);
if (args[0] === "--scan" && args[1]) scan(resolve(args[1]), args.find((a, i) => i > 1 && !a.startsWith("--")), args.includes("--tree"));
else check();
