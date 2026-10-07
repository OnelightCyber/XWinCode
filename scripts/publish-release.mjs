import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "release";
const dryRun = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY ?? "OnelightCyber/XWinCode";
const tag = process.env.GITHUB_REF_NAME ?? process.argv.find((a) => /^v\d+\.\d+\.\d+$/.test(a));

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) fail("Run this for a vX.Y.Z tag.");
const version = tag.slice(1);
const appVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
if (appVersion !== version) fail(`tauri.conf.json is at ${appVersion} but the tag is ${tag}.`);

const installer = `XWinCode_${version}_x64-setup.exe`;
const exe = join(dir, installer);
const sig = `${exe}.sig`;
if (!existsSync(exe) || !existsSync(sig)) fail(`Missing ${exe} or its signature.`);

const changelog = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
const escaped = version.replace(/\./g, "\\.");
const section = new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[[^\\]]+\\]: |(?![\\s\\S]))`, "m").exec(changelog);
const notes = section?.[1].trim() ?? "";
if (!notes) fail(`CHANGELOG.md has no section for ${version}.`);
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(sig, "utf8").trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${installer}`,
    },
  },
};
const latest = join(dir, "latest.json");
writeFileSync(latest, `${JSON.stringify(manifest, null, 2)}\n`);

const body = join(dir, "notes.md");
writeFileSync(
  body,
  `${notes}\n\n---\n\n**Install:** download \`${installer}\` below and run it. Already on XWinCode? It offers the update by itself.\n`,
);

const files = [exe, sig, latest];
const gh = (...args) => (dryRun ? console.log(["gh", ...args].join(" ")) : execFileSync("gh", args, { stdio: "inherit" }));
let exists = false;
if (dryRun) {
  console.log(readFileSync(latest, "utf8"));
  console.log(readFileSync(body, "utf8"));
} else {
  try {
    execFileSync("gh", ["release", "view", tag], { stdio: "ignore" });
    exists = true;
  } catch {
    exists = false;
  }
}
if (exists) {
  gh("release", "upload", tag, ...files, "--clobber");
  gh("release", "edit", tag, "--notes-file", body);
} else {
  gh("release", "create", tag, "--draft", "--verify-tag", "--title", `XWinCode ${tag}`, "--notes-file", body, ...files);
}
