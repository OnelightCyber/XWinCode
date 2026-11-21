# Changelog

Every notable change to XWinCode is listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.0] - 2026-11-21

### Added

#### Canvas

- Swift Charts: `Chart` with `BarMark`, `LineMark`, `AreaMark`, `PointMark`, `RuleMark`, `RectangleMark` and `SectorMark`, with series colors, stacking, a legend, `chartYScale`, `chartXScale` and hidden axes.
- `Path`, custom `Shape` types with `path(in:)`, and `Canvas` drawing (`fill`, `stroke`, `draw`, translate, scale and rotate) are drawn for real, at the size the view actually gets.
- `GeometryReader` now receives the real size of its container instead of the whole screen.
- Liquid Glass: `.glassEffect`, `GlassEffectContainer`, `.buttonStyle(.glass)` and `.glassProminent`, and `.tabViewBottomAccessory`.
- Navigation bars show their `.toolbar` items (leading, trailing, principal and bottom bar) and the `.searchable` field. `NavigationSplitView` shows its columns on iPad.
- `Gauge`, `.safeAreaInset`, `.badge`, `.position`, `.blur`, `.brightness`, `.contrast`, `.saturation`, `.grayscale`, `.hueRotation`, `.colorInvert`, `.clipped`, `.labelStyle` and custom `ButtonStyle` types.
- `.onAppear`, `.task` and `.onChange` run, so screens that load their data on appear are no longer empty. `.environment(_:)` and `.environmentObject(_:)` share the object you pass.
- A view that takes a model or a list it was not given gets sample data: a `static let sample` or `samples` of the type when there is one, placeholder items otherwise.
- Swift files added, changed, moved or removed outside the editor reach the preview, for example after a pull or a branch switch.
- "Things to check" in the Canvas footer lists what could not be drawn exactly or failed to run, and a click jumps to the line.
- 76 more SF Symbols.

#### Live on iPhone

- The companion app draws charts with Swift Charts, paths, custom shapes, canvases and gauges, and applies toolbars, safe-area insets, badges, the search field, masks, blur and color effects, label styles, and trimmed, dashed and round-capped strokes. Liquid Glass and the tab bar accessory use the real effect on iOS 26 and a material on earlier versions. Reinstall the companion app from the Canvas to get them.

#### Source control

- A Source Control navigator (Ctrl+2) shows the Git changes of the project. Stage or unstage files, write a message and commit, switch or create a branch, fetch, pull and push, and browse the recent history. A project that is not a repository can become one in a click.
- Changed files carry a letter in the project navigator, and folders that contain changes carry a dot.
- Added, modified and removed lines are marked in the editor gutter, against the last commit.
- "Show Changes" opens a side-by-side comparison with the last commit. The right side stays editable, and each change can be reverted on its own.
- Git only runs in projects you trust.

#### Project

- New files from a template: SwiftUI view with its preview, Swift file, observable model or empty file.
- Duplicate a file or a folder, and move one by dragging it onto a folder.
- Files and folders dropped from Explorer onto the project navigator are copied into the folder under the pointer.
- Images open in a viewer with their size, on a checkerboard for transparency.
- Project Settings gained the minimum iOS version, the supported devices, the allowed orientations and a forced light or dark appearance.
- Project Settings gained capabilities (HealthKit, HomeKit, App Groups, push notifications, Sign in with Apple, NFC, associated domains) and background modes. They are written to the entitlements file and to Info.plist.

#### Editor

- Split editor (Ctrl+\\): a second pane shows the same file or another one. "Open to the Side" in the project navigator, or Alt+click on a file.
- Find in Project can match whole words and regular expressions. Replace accepts `$1` groups with a regular expression.
- Open Quickly also finds types and functions across the project and jumps to their line.
- A file changed outside XWinCode (git, another editor, a build tool) is reloaded when you come back to the window. If you also have unsaved edits in it, they are kept and XWinCode tells you.

### Changed

- A view the preview does not know no longer hides what it contains: its content is drawn, and a view from a library gets a labeled placeholder.
- One line that fails no longer blanks the whole screen: the rest of the view is drawn and the failing part is marked.
- The preview keeps `static let` values and singletons between redraws, and stops code that takes too long instead of freezing the editor. A project whose first frame took a second now redraws in a few milliseconds.
- `ignoresSafeArea` backgrounds extend behind the navigation bar, the large title and the tab bar.
- Circles, rings and circle-shaped glass, clips and backgrounds stay round in a frame that is not square. A trimmed circle draws the right arc.
- Rows in a list fill the row and stay aligned to the leading edge.

### Fixed

- The Canvas could stop following the code for several seconds after showing a view that kept resizing, such as a `GeometryReader` with an animation.
- `GeometryReader` now takes the space it is offered instead of the size of its content.
- Content inside `.frame(maxWidth: .infinity, maxHeight: .infinity)` was pinned to the top instead of following the frame alignment.
- `.background { }` views were squashed to a thin band and `.overlay(alignment:)` ignored its vertical alignment.
- Backgrounds made of a colour or a material now extend under the status bar and the home indicator, as on iOS.
- `LinearGradient`, `RadialGradient` and `AngularGradient` were drawn as one flat colour.
- `.scrollContentBackground`, `.listRowBackground`, `.listRowSeparator` and `.listRowInsets` were ignored.
- A button whose label uses `.frame(maxWidth: .infinity)` did not take the full width, and a horizontal `ScrollView` took the whole height.
- `LazyVGrid` cells were aligned to the left instead of centred, shapes ignored `.aspectRatio`, and `.frame(maxWidth:)` with a number did not size the view.
- A view inside a `ZStack` could be hidden behind an earlier one.
- The Canvas now starts in the appearance the app forces through `UIUserInterfaceStyle` or `.preferredColorScheme`.
- `ProcessInfo.processInfo` and `UIDevice.current` printed their own names instead of values.
- The Welcome window and the language server handshake showed version 0.1.0.
- Closing or moving a file could log an error when the language server reported on it afterwards.
- Renaming a folder left the tabs of the files inside it pointing at the old path, and renaming a file with unsaved edits marked those edits as saved.
- `Spacer` did not push views apart in the Canvas: a value after a `Spacer` now sits at the far edge.
- Text typed while a file was being saved was marked as saved and could be lost on close.
- A save that failed still let the tab close, the build start, the update install or the app quit.
- Opening a file that is not valid UTF-8 replaced its unreadable bytes, and saving then damaged the file. Such a file is now refused.
- A crash or a full disk during a save could leave the file truncated. Saves are now written to a temporary file and swapped in.
- Renaming a file to change only the case of its name (`view.swift` to `View.swift`) was refused.
- Saving, creating and renaming files and typing in the terminal no longer run on the interface thread.
- Starting two builds at the same moment could leave the first one running with no way to stop it.
- Swift the preview read wrongly: `for … where`, `for try await`, `async let`, `case … where`, `case is`, open ranges (`2...`, `..<5`), closed ranges of `Double`, `as?`, one-line type declarations, property observers (`didSet`, `willSet`), computed properties with a setter, `lazy var`, custom `subscript`, `dict[key, default:]`, operators passed as functions (`reduce(0, +)`, `sorted(by: >)`), `rawValue` inside an enum, `Optional.map`, `reduce(into:)`, `Dictionary(grouping:by:)`, `zip` with `$0` and `$1`, key paths in `contains(where:)`, `self = …` in a mutating method, class inheritance, `super.init`, default implementations from a protocol extension, extension initializers, explicit `init`s with a trailing closure, and `State(initialValue:)`.
- `Text(_:format:)`, `Text(_:style:)`, `\(value, format:)`, `.formatted(date:time:)`, `.dateTime`, `.currency(code:)`, `Calendar.current` and date arithmetic give real values.
- Loops and ranges longer than 1,000 items were cut short without notice.
- A global function was not called from inside a type when the type had no method of that name.
- Editing a model's code kept running the old code for objects already on screen.
- Text typed while the language server restarted could leave it out of step with the file until the file was reopened.

### Security

- DOMPurify 3.4.17, Vite 8.3.8 and rustls 0.23.46 fix the advisories reported against the previous versions.

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

[Unreleased]: https://github.com/OnelightCyber/XWinCode/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/OnelightCyber/XWinCode/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/OnelightCyber/XWinCode/compare/v0.1.0...v2.0.0
[0.1.0]: https://github.com/OnelightCyber/XWinCode/releases/tag/v0.1.0
