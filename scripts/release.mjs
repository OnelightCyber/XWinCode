import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const REPO = "https://github.com/OnelightCyber/XWinCode";
const version = process.argv[2];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) fail("Usage: npm run release -- <major.minor.patch>");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

if (git("status", "--porcelain")) fail("Commit or stash your changes first.");
if (git("tag", "-l", `v${version}`)) fail(`v${version} already exists.`);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sectionBody = (text, name) => {
  const re = new RegExp(`^## \\[${escape(name)}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: |(?![\\s\\S]))`, "m");
  return re.exec(text)?.[1].trim() ?? "";
};

let changelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
let notes = sectionBody(changelog, version);
if (!notes) {
  notes = sectionBody(changelog, "Unreleased");
  if (!notes) fail("Describe the changes under ## [Unreleased] in CHANGELOG.md first.");
  const today = new Date().toISOString().slice(0, 10);
  changelog = changelog.replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n## [${version}] - ${today}\n`);
  const previous = new RegExp(`^## \\[${escape(version)}\\][\\s\\S]*?^## \\[(\\d+\\.\\d+\\.\\d+)\\]`, "m").exec(changelog)?.[1];
  const link = previous ? `${REPO}/compare/v${previous}...v${version}` : `${REPO}/releases/tag/v${version}`;
  changelog = changelog.replace(/^\[Unreleased\]: .*$/m, `[Unreleased]: ${REPO}/compare/v${version}...HEAD\n[${version}]: ${link}`);
  writeFileSync("CHANGELOG.md", changelog);
}

const edit = (file, change) => writeFileSync(file, change(readFileSync(file, "utf8")));
edit("package.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit("package-lock.json", (s) => s.replace(/("name": "xwincode",\s*"version": ")[^"]+/g, `$1${version}`));
edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`));
edit("src-tauri/Cargo.lock", (s) => s.replace(/(name = "xwincode"\r?\nversion = ")[^"]+/, `$1${version}`));

git("add", "CHANGELOG.md", "package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock");
if (git("diff", "--cached", "--name-only")) git("commit", "-m", `release: v${version}`);
git("tag", "-a", `v${version}`, "--cleanup=verbatim", "-m", `XWinCode ${version}\n\n${notes}\n`);
git("push", "origin", "HEAD", "--follow-tags");
console.log(`v${version} pushed. GitHub Actions now builds the installer; publish the draft release once it is ready.`);
