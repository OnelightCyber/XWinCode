# Changelog

Every notable change to XWinCode is listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.0.0] - 2026-10-08

### Added

#### Canvas

- Canvas (`Ctrl+Alt+Enter`): a live SwiftUI preview next to the editor that redraws as you type. A built-in Swift interpreter runs your views, `#Preview` blocks and `PreviewProvider`s: `@State`, `@Binding`, `@Observable` and `ObservableObject` models, navigation stacks, tab views, lists, forms and controls all respond to clicks.
- 29 iPhone models, from iPhone 11 to iPhone 17 Pro Max, with their real screen size, safe areas, Dynamic Island or notch, in light or dark appearance. A compact menu groups them by generation, with the iPhone you plug in at the top, and the Canvas starts on that model.
- Taps, toggles, sliders and text fields redraw at once, in the Canvas and on the iPhone.
- Selection mode: click a view in the preview to select its code in the editor, and the view under the cursor is outlined in the preview.
- View inspector: with a view selected, change its text, font, weight, color, background, padding, frame, corners or opacity from the Inspector. XWinCode rewrites the code, and `Ctrl+Z` undoes it.
- Variants: light and dark, three screen sizes, text sizes, portrait and landscape, or every `#Preview` of the file, side by side. Interacting with one updates them all.
- Landscape, Dynamic Type (from XS to AX5) and six iPads, with the right safe areas and size classes.
- Animations: `.animation(_:value:)`, `withAnimation` and `.transition` play in the Canvas and on the iPhone.
- The project's assets: colors from `.colorset` (light and dark, and `AccentColor` as the tint), SVG images and custom fonts used with `.font(.custom(_:size:))`.
- A performance estimate for each model: the frame time of the view against the budget set by the phone's chip and refresh rate.

#### Live on iPhone

- The free XWinCode Preview companion app draws the same preview with Apple's real SwiftUI on your iPhone over USB, sends taps and edits back to XWinCode, and reports the real frame rate, memory, CPU and thermal state. Install it from the Canvas in one click, then open it on the iPhone: the Canvas connects as soon as it is open.
- Live over Wi-Fi: after one session over USB, allow the PC on the iPhone, and Live also works without a cable when Wi-Fi sync is on in the Apple Devices app.
- With several iPhones and iPads plugged in, choose which one shows the Live preview; the device menu lists every connected model.
- Record a video of the Live preview on the iPhone, up to three minutes, saved as MP4 in Videos › XWinCode.

#### iPhone

- Take Screenshot, in the Devices window and in the Canvas: the whole iPhone screen at full resolution, saved in Pictures › XWinCode. It works on iOS 17 and later through the open-source go-ios, which XWinCode downloads the first time and runs without administrator rights.

#### Debugger

- A debugger for Windows programs, built on LLDB: click the editor gutter (or press `F9`) to set a breakpoint, then run. XWinCode builds the program, stops at the breakpoint, highlights the current line and shows the variables and the call stack.
- Continue (`F5`), Step Over (`F10`), Step Into (`F11`) and Step Out (`Shift+F11`), from the debug bar or the Debug menu. Breakpoints follow the code as you edit and are saved with the project.

### Changed

- Quick Help describes the Canvas instead of saying that previews need a Mac.
- Smoother everywhere: typing no longer redraws the preview until the result changes, a click in the preview redraws only the views it changes, the Inspector only refreshes the lines that move, and the side panels no longer pay for an invisible background blur.

### Fixed

- Quitting XWinCode now stops the iPhone console, the running build, SourceKit-LSP and the terminals. The iPhone console used to keep running in the background after the window closed.

### Security

- Live on iPhone over USB stays on the loopback interface of the iPhone. Over Wi-Fi, XWinCode and the iPhone share a random 256-bit key that is only ever sent over USB, and only trusted once you allow the PC on the iPhone. The iPhone keeps it in its keychain, and the PC encrypts it with your Windows account (DPAPI). Each session starts with an HMAC-SHA256 challenge and runs encrypted with ChaCha20-Poly1305, with replay protection. A connection that does not authenticate within five seconds is dropped, a device that fails five times in a minute is ignored for a minute, and a stranger's connection can never replace the current one.
- go-ios is pinned to version 1.3.2 and checked against its SHA-256 before each use. Its tunnel to the iPhone only listens on 127.0.0.1, and it stops after three idle minutes or when XWinCode quits. Its screen streaming mode, which listens on every network interface, is never used.
- The Canvas reports code nested too deeply to preview as an error, instead of stopping.

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

[Unreleased]: https://github.com/OnelightCyber/XWinCode/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/OnelightCyber/XWinCode/compare/v0.1.0...v2.0.0
[0.1.0]: https://github.com/OnelightCyber/XWinCode/releases/tag/v0.1.0
