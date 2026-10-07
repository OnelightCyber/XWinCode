export const sep = "\\";

export function normalize(p: string): string {
  const n = p.replace(/\//g, "\\").replace(/\\+$/, "");
  return /^[a-z]:/.test(n) ? n[0].toUpperCase() + n.slice(1) : n;
}

export function basename(p: string): string {
  const n = normalize(p);
  return n.slice(n.lastIndexOf("\\") + 1);
}

export function dirname(p: string): string {
  const n = normalize(p);
  const i = n.lastIndexOf("\\");
  return i < 0 ? "" : n.slice(0, i);
}

export function join(...parts: string[]): string {
  return normalize(parts.filter(Boolean).join("\\"));
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i + 1).toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normalize(a).toLowerCase() === normalize(b).toLowerCase();
}

export function isInside(root: string, p: string): boolean {
  const r = normalize(root).toLowerCase() + "\\";
  return normalize(p).toLowerCase().startsWith(r);
}

export function relative(root: string, p: string): string {
  return isInside(root, p) ? normalize(p).slice(normalize(root).length + 1) : normalize(p);
}

export function windowsToWsl(p: string): string {
  const n = normalize(p);
  const m = /^([a-zA-Z]):(.*)$/.exec(n);
  return m ? `/mnt/${m[1].toLowerCase()}${m[2].replace(/\\/g, "/")}` : n.replace(/\\/g, "/");
}

export function wslToWindows(p: string): string {
  const m = /^\/mnt\/([a-zA-Z])(\/.*)?$/.exec(p.trim());
  if (!m) return p;
  return `${m[1].toUpperCase()}:${(m[2] ?? "\\").replace(/\//g, "\\")}`;
}

export function languageFor(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "package.resolved") return "json";
  switch (extname(path)) {
    case "swift":
      return "swift";
    case "json":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "yml":
    case "yaml":
      return "yaml";
    case "plist":
    case "xml":
    case "entitlements":
    case "storyboard":
    case "xib":
      return "xml";
    case "c":
    case "h":
    case "m":
      return "c";
    case "cpp":
    case "hpp":
    case "mm":
    case "cc":
      return "cpp";
    case "js":
    case "mjs":
      return "javascript";
    case "ts":
      return "typescript";
    case "sh":
      return "shell";
    case "ps1":
      return "powershell";
    case "html":
      return "html";
    case "css":
      return "css";
    case "toml":
    case "ini":
      return "ini";
    default:
      return "plaintext";
  }
}
