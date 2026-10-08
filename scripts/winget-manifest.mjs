import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const version = (process.argv[2] ?? "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: node scripts/winget-manifest.mjs <version>");
  process.exit(1);
}

const id = "OnelightCyber.XWinCode";
const repo = "https://github.com/OnelightCyber/XWinCode";
const url = `${repo}/releases/download/v${version}/XWinCode_${version}_x64-setup.exe`;

const res = await fetch(url, { redirect: "follow" });
if (!res.ok) {
  console.error(`Download failed (${res.status}): ${url}`);
  process.exit(1);
}
const sha = createHash("sha256").update(Buffer.from(await res.arrayBuffer())).digest("hex").toUpperCase();
const date = new Date().toISOString().slice(0, 10);
const out = join("src-tauri", "target", "winget", version);
mkdirSync(out, { recursive: true });

const header = (type) => `# yaml-language-server: $schema=https://aka.ms/winget-manifest.${type}.1.10.0.schema.json\n\n`;

writeFileSync(
  join(out, `${id}.yaml`),
  header("version") +
    `PackageIdentifier: ${id}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.10.0
`,
);

writeFileSync(
  join(out, `${id}.installer.yaml`),
  header("installer") +
    `PackageIdentifier: ${id}
PackageVersion: ${version}
InstallerLocale: en-US
InstallerType: nullsoft
Scope: user
InstallModes:
- interactive
- silent
- silentWithProgress
UpgradeBehavior: install
ReleaseDate: ${date}
Installers:
- Architecture: x64
  InstallerUrl: ${url}
  InstallerSha256: ${sha}
ManifestType: installer
ManifestVersion: 1.10.0
`,
);

writeFileSync(
  join(out, `${id}.locale.en-US.yaml`),
  header("defaultLocale") +
    `PackageIdentifier: ${id}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: OnelightCyber
PublisherUrl: https://github.com/OnelightCyber
PublisherSupportUrl: ${repo}/issues
PackageName: XWinCode
PackageUrl: ${repo}
License: GPL-3.0-or-later
LicenseUrl: ${repo}/blob/main/LICENSE
Copyright: Copyright (c) 2026 OnelightCyber
ShortDescription: Xcode for Windows. Write, build, preview and debug Swift on Windows, and build, sign and install iPhone apps.
Description: XWinCode is a free and open-source Swift IDE for Windows. It edits, builds, runs and debugs Swift programs with the official toolchain, previews SwiftUI views live on 35 iPhone and iPad models and on a real iPhone, and builds, signs and installs iPhone apps through xtool in WSL, without a Mac.
Moniker: xwincode
Tags:
- swift
- swiftui
- ios
- iphone
- xcode
- ide
- developer-tools
ReleaseNotesUrl: ${repo}/releases/tag/v${version}
ManifestType: defaultLocale
ManifestVersion: 1.10.0
`,
);

console.log(`Wrote ${out} (SHA256 ${sha})`);
