# Changelog

Every notable change to XWinCode is listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-07

The first public release: Xcode, for Windows.

### Added

#### Editor

- Monaco editor with a monochrome or Xcode theme, tabs, minimap, and a jump bar that follows the symbol under the cursor.
- Quick Open (`Ctrl+P`) and Command Palette (`Ctrl+Shift+P`).
- SourceKit-LSP: completion, hover help, go to definition, rename, document symbols and live diagnostics, on Windows or in WSL.
- Format on save, through SourceKit-LSP.
- Search and replace across the whole project (`Ctrl+Shift+F`).
- SwiftUI Library (`Ctrl+Shift+L`): about sixty views, modifiers and snippets, inserted with tab stops.

#### Build and run

- Windows programs built with the official Swift toolchain: build, run, test and clean, with errors in the editor, live progress and standard input in the console.
- iPhone apps built, signed and installed with xtool in WSL, over USB or Wi-Fi, and archived as `.ipa`.
- Project templates: iOS app (SwiftUI), Windows command-line tool, library with tests.
- Project settings: bundle ID, display name, version and build, app icon and privacy permissions.

#### iPhone

- Native device discovery over usbmuxd and lockdown, with no extra tool on Windows.
- usbmuxd bridge from Windows to WSL through WSL interop: no usbipd, no open port, no firewall rule.
- iPhone console (`Ctrl+Shift+C`): live device logs, filtered to your app or not.
- Installed apps: launch, reinstall or uninstall them from the Devices window.
- A reminder before apps signed with a free Apple ID expire after seven days, with a one-click reinstall.

#### App

- Monochrome liquid glass interface over Mica, Mica Alt or Acrylic, with light and dark themes that follow Windows and a build HUD.
- Integrated terminal: PowerShell, Command Prompt or WSL.
- Settings for appearance, editor, terminal, build, iPhone and WSL, tools and shortcuts.
- Setup assistant that checks Swift, the Visual Studio Build Tools, WSL, xtool, the iOS SDK and the Apple account, and installs what is missing.
- Interface in English, French, Spanish, German, Portuguese (Brazil), Italian, Simplified Chinese and Japanese, following the Windows language by default.
- Installer that sets XWinCode up for the current user, with a desktop shortcut and a Start menu entry.
- Automatic, signed updates from GitHub Releases.
- One-line setup script for every toolchain: `irm https://raw.githubusercontent.com/OnelightCyber/XWinCode/main/scripts/install.ps1 | iex`.

### Security

- Restricted Mode: a project you open for the first time runs nothing until you trust it. SourceKit-LSP and builds stay off, and you can still read and edit every file. Projects created in XWinCode are trusted from the start.
- Strict Content Security Policy: no remote code, no inline scripts, no `eval`.
- The window can only show XWinCode itself; web links open in your browser, and network (UNC) file links are ignored.
- Paths read from `xtool.yml` cannot point outside the project.
- Updates are verified against the public key built into the app, and each signature is bound to its version, so an older release cannot be passed off as a newer one.
- Device identifiers, bundle IDs, distribution names and paths are validated or quoted before they reach a shell, and system tools always start from `System32`.

[Unreleased]: https://github.com/OnelightCyber/XWinCode/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/OnelightCyber/XWinCode/releases/tag/v0.1.0
