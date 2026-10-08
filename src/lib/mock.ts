import type { Entry, Settings } from "./types";

const ROOT = "C:\\Users\\dev\\XWinCode Projects\\HelloApp";

const files: Record<string, string> = {
  [`${ROOT}\\Package.swift`]: `// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "HelloApp",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "HelloApp", targets: ["HelloApp"]),
    ],
    targets: [
        .target(name: "HelloApp"),
    ]
)
`,
  [`${ROOT}\\xtool.yml`]: "version: 1\nbundleID: com.example.HelloApp\n",
  [`${ROOT}\\.gitignore`]: "/.build\n/xtool\n",
  [`${ROOT}\\Sources\\HelloApp\\HelloAppApp.swift`]: `import SwiftUI

@main
struct HelloAppApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
`,
  [`${ROOT}\\Sources\\HelloApp\\ContentView.swift`]: `import SwiftUI

/// Main screen of the app.
struct ContentView: View {
    @State private var taps = 0
    let title: String = "Built on Windows with XWinCode"

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "hammer.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)

            Text(title)
                .font(.title2.bold())
                .multilineTextAlignment(.center)

            Button {
                taps += 1
            } label: {
                Label("Tapped \\(taps) times", systemImage: "hand.tap")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }
}

#Preview {
    ContentView()
}
`,
  [`${ROOT}\\Sources\\HelloApp\\AnimDemo.swift`]: `import SwiftUI

struct AnimDemo: View {
    @State private var expanded = false
    @State private var liked = false

    var body: some View {
        VStack(spacing: 28) {
            RoundedRectangle(cornerRadius: expanded ? 40 : 18)
                .fill(Color("Brand"))
                .frame(width: expanded ? 260 : 120, height: expanded ? 170 : 120)
                .animation(.spring(bounce: 0.4), value: expanded)
            Button(expanded ? "Shrink" : "Grow") {
                expanded.toggle()
            }
            .buttonStyle(.borderedProminent)
            Button {
                withAnimation(.bouncy) {
                    liked.toggle()
                }
            } label: {
                Image(systemName: liked ? "heart.fill" : "heart")
                    .font(.system(size: 44))
                    .foregroundStyle(liked ? .red : .secondary)
            }
            if liked {
                Text("Thanks!")
                    .font(.title2.bold())
                    .transition(.scale)
            }
        }
        .padding()
    }
}

#Preview {
    AnimDemo()
}
`,
  [`${ROOT}\\Sources\\HelloApp\\Assets.xcassets\\Brand.colorset\\Contents.json`]: `{
  "colors" : [
    { "color" : { "color-space" : "srgb", "components" : { "alpha" : "1.000", "blue" : "0.945", "green" : "0.353", "red" : "0.369" } }, "idiom" : "universal" },
    { "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ], "color" : { "color-space" : "srgb", "components" : { "alpha" : "1.000", "blue" : "0xFF", "green" : "0x8A", "red" : "0x8C" } }, "idiom" : "universal" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
`,
  [`${ROOT}\\Sources\\HelloApp\\TasksView.swift`]: `import SwiftUI

struct Chore: Identifiable {
    let id = UUID()
    var title: String
    var done = false
}

struct TasksView: View {
    @State private var chores = [
        Chore(title: "Plug in the iPhone"),
        Chore(title: "Build with Ctrl+B", done: true),
        Chore(title: "Ship it"),
    ]
    @State private var notifications = true
    @State private var volume = 0.6
    @State private var name = ""

    var body: some View {
        TabView {
            NavigationStack {
                List {
                    Section("Today · \\(chores.filter { !$0.done }.count) left") {
                        ForEach($chores) { $chore in
                            Toggle(chore.title, isOn: $chore.done)
                        }
                    }
                    Section("Settings") {
                        TextField("Your name", text: $name)
                        Toggle("Notifications", isOn: $notifications)
                        Slider(value: $volume, in: 0...1)
                    }
                    Button("Add a task", systemImage: "plus") {
                        chores.append(Chore(title: name.isEmpty ? "New task" : name))
                    }
                }
                .navigationTitle("Tasks")
            }
            .tabItem { Label("Tasks", systemImage: "checklist") }

            ContentView()
                .tabItem { Label("Hello", systemImage: "hand.wave") }
        }
    }
}
`,
  [`${ROOT}\\Sources\\HelloApp\\Models\\Item.swift`]: `import Foundation

struct Item: Identifiable, Codable {
    let id: UUID
    var name: String
    var count: Int = 0
}
`,
};

let settings: Settings = {
  recentProjects: [
    { path: ROOT, name: "HelloApp", kind: "iosApp", openedAt: new Date().toISOString() },
    { path: "C:\\Users\\dev\\XWinCode Projects\\CliTool", name: "CliTool", kind: "executable", openedAt: new Date(Date.now() - 86400000).toISOString() },
    { path: "C:\\Users\\dev\\XWinCode Projects\\MathKit", name: "MathKit", kind: "library", openedAt: new Date(Date.now() - 5 * 86400000).toISOString() },
  ],
  wslDistro: null,
  editorFontSize: 13,
  minimap: false,
  wordWrap: false,
  autoSave: true,
  organizationId: "com.example",
  theme: "system",
  language: "system",
  material: "mica",
  uiScale: 100,
  reduceMotion: false,
  reopenLastProject: false,
  projectsDir: null,
  editorTheme: "mono",
  editorFont: "geist-mono",
  editorLineHeight: 1.6,
  fontLigatures: true,
  tabSize: 4,
  insertSpaces: true,
  lineNumbers: true,
  indentGuides: true,
  stickyScroll: true,
  smoothCaret: true,
  cursorStyle: "line",
  formatOnSave: true,
  terminalShell: "auto",
  terminalFontSize: 12,
  terminalCursorBlink: true,
  defaultConfiguration: "debug",
  clearConsoleOnBuild: false,
  showBuildHud: true,
  autoShowDebug: true,
  warmWsl: true,
  iosConnection: "auto",
  autoUpdate: false,
};

function children(dir: string): Entry[] {
  const seen = new Map<string, Entry>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(dir + "\\")) continue;
    const rest = path.slice(dir.length + 1);
    const [head, ...tail] = rest.split("\\");
    const full = `${dir}\\${head}`;
    if (!seen.has(head)) seen.set(head, { name: head, path: full, isDir: tail.length > 0 });
  }
  return [...seen.values()].sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
}

type Handler = (payload: unknown) => void;
const listeners = new Map<string, Set<Handler>>();

export function mockOn(event: string, handler: Handler): () => void {
  const set = listeners.get(event) ?? new Set();
  set.add(handler);
  listeners.set(event, set);
  return () => set.delete(handler);
}

function mockEmit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((h) => h(payload));
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

let taskId = 0;
let logSession = 0;
let previewSession = 0;
let previewTimer: ReturnType<typeof setInterval> | null = null;

async function simulateBuild(action: string) {
  const id = ++taskId;
  const label = action === "run" ? "Running HelloApp on the iPhone" : "Building HelloApp";
  mockEmit("task://start", { taskId: id, label, command: `xtool dev ${action === "run" ? "run" : "build"} -c debug` });
  const lines = [
    "Planning...",
    "[1/1] Planning build",
    "Building for debugging...",
    "[3/7] Compiling HelloApp HelloAppApp.swift",
    "[4/7] Compiling HelloApp ContentView.swift",
    `${ROOT.replace(/\\/g, "/").replace("C:", "/mnt/c")}/Sources/HelloApp/ContentView.swift:6:9: warning: 'title' could be declared private`,
    "[6/7] Emitting module HelloApp",
    "[7/7] Linking HelloApp",
    "Build of product 'HelloApp' complete! (4.12s)",
  ];
  if (action === "run") {
    lines.push("Installing to device: iPhone (udid: 00008110-000A1B2C3D4E5F60)", "[Signing] 100%", "[Installing] 100%", "[Verifying] 100%");
  }
  for (const line of lines) {
    await delay(220);
    mockEmit("task://output", { taskId: id, stream: "stdout", lines: [line] });
    const m = /^(.+?):(\d+):(\d+): (error|warning|note): (.*)$/.exec(line);
    if (m) {
      mockEmit("task://diagnostic", {
        taskId: id,
        file: m[1].replace("/mnt/c", "C:").replace(/\//g, "\\"),
        line: +m[2],
        column: +m[3],
        severity: m[4],
        message: m[5],
      });
    }
  }
  mockEmit("task://exit", { taskId: id, code: 0, success: true, cancelled: false, durationMs: 4120 });
}

async function simulateDeviceLog(session: number) {
  const sample = [
    "Oct  7 14:30:01 iPhone HelloApp(UIKitCore)[812] <Notice>: Scene became active",
    "Oct  7 14:30:01 iPhone HelloApp[812] <Notice>: Loaded 12 items",
    "Oct  7 14:30:02 iPhone HelloApp(CFNetwork)[812] <Error>: Task <1> finished with error -1009",
    "Oct  7 14:30:03 iPhone HelloApp[812] <Notice>: Button tapped 1 times",
  ];
  for (const line of sample) {
    await delay(500);
    mockEmit("devicelog://lines", { session, lines: [line] });
  }
}

export async function mockInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await delay(30);
  const a = args as Record<string, any>;
  const r = (v: unknown) => v as T;
  switch (cmd) {
    case "get_settings":
      return r(structuredClone(settings));
    case "save_settings":
      settings = a.settings;
      return r(undefined);
    case "remove_recent":
      settings.recentProjects = settings.recentProjects.filter((p) => p.path !== a.path);
      return r(undefined);
    case "default_projects_dir":
      return r("C:\\Users\\dev\\XWinCode Projects");
    case "preview_prepare":
      return r({ root: "C:\\Users\\dev\\AppData\\Local\\dev.xwincode.app\\XWinCodePreview", bundleId: "dev.xwincode.preview" });
    case "preview_connect": {
      previewSession += 1;
      const session = previewSession;
      if (previewTimer) clearInterval(previewTimer);
      previewTimer = setInterval(() => {
        const stats = { type: "stats", fps: 118 + Math.round(Math.random() * 2), maxFps: 120, memoryMB: 38 + Math.random() * 4, cpu: 3 + Math.random() * 5, thermal: "nominal", lowPower: false, battery: 0.82 };
        mockEmit("preview://message", { session, message: JSON.stringify(stats) });
      }, 1000);
      const hello = { type: "hello", version: 1, name: "iPhone", model: "iPhone", machine: "iPhone16,1", system: "26.0", width: 393, height: 852, scale: 3, maxFps: 120 };
      return r({ session, hello: JSON.stringify(hello) });
    }
    case "dap_start":
      throw "LLDB was not found: install Swift for Windows (Settings → Tools & SDKs).";
    case "dap_send":
    case "dap_stop":
      return r(undefined);
    case "preview_send": {
      const sent = JSON.parse(String(a.message)) as { type?: string; on?: boolean };
      if (sent.type === "record") {
        const session = previewSession;
        if (sent.on) setTimeout(() => mockEmit("preview://message", { session, message: JSON.stringify({ type: "recording", state: "on" }) }), 400);
        else
          for (let i = 0; i < 4; i++)
            setTimeout(() => mockEmit("preview://video", { session, part: i, parts: 4, path: i === 3 ? "C:\\Users\\dev\\Videos\\XWinCode\\iPhone 2026-10-08 at 19.30.00.mp4" : null, error: null }), 350 * (i + 1));
      }
      return r(undefined);
    }
    case "preview_disconnect":
      if (previewTimer) clearInterval(previewTimer);
      previewTimer = null;
      return r(undefined);
    case "project_trusted":
      return r(true);
    case "trust_project":
      return r(undefined);
    case "open_project":
    case "create_project":
      return r({ root: ROOT, name: "HelloApp", kind: "iosApp", bundleId: "com.example.HelloApp" });
    case "read_dir":
      return r(children(a.path));
    case "list_files":
      return r(Object.keys(files));
    case "read_text_file":
      if (!(a.path in files)) throw "File not found";
      return r(files[a.path]);
    case "write_text_file":
      files[a.path] = a.contents;
      return r(undefined);
    case "create_file":
      files[a.path] = "";
      return r(undefined);
    case "path_exists":
      return r(a.path in files);
    case "search_project": {
      const q = String(a.query).toLowerCase();
      const hits: { path: string; line: number; column: number; text: string }[] = [];
      for (const [path, text] of Object.entries(files)) {
        text.split("\n").forEach((line, i) => {
          const col = line.toLowerCase().indexOf(q);
          if (q && col >= 0) hits.push({ path, line: i + 1, column: col + 1, text: line.trim() });
        });
      }
      return r(hits);
    }
    case "replace_in_file": {
      const text = files[a.path] ?? "";
      const parts = text.split(a.query);
      files[a.path] = parts.join(a.replacement);
      return r(parts.length - 1);
    }
    case "check_toolchain":
      await delay(600);
      return r([
        { id: "swift", name: "Swift for Windows", group: "windows", status: "ok", version: "6.2.1", detail: "C:\\Users\\dev\\AppData\\Local\\Programs\\Swift\\Toolchains\\6.2.1+Asserts\\usr\\bin\\swift.exe", actions: [] },
        { id: "msvc", name: "C++ tools & Windows SDK", group: "windows", status: "ok", version: null, detail: "Visual Studio Build Tools 2022", actions: [] },
        { id: "sourcekit", name: "SourceKit-LSP", group: "windows", status: "ok", version: null, detail: "Ships with Swift", actions: [] },
        { id: "appleDevices", name: "Apple Mobile Device", group: "ios", status: "ok", version: null, detail: "Service running on 127.0.0.1:27015", actions: [] },
        { id: "wsl", name: "WSL (Linux)", group: "ios", status: "ok", version: "Ubuntu", detail: "Distributions: Ubuntu", actions: [] },
        { id: "wslSwift", name: "Swift for Linux (WSL)", group: "ios", status: "ok", version: "6.4", detail: "Installed in WSL (with socat for the iPhone bridge)", actions: [] },
        { id: "xtool", name: "xtool", group: "ios", status: "ok", version: null, detail: "Builds, signs and installs iOS apps", actions: [{ id: "install-xtool", label: "Update" }] },
        { id: "imobiledevice", name: "iPhone tools (console, apps)", group: "ios", status: "ok", version: null, detail: "libimobiledevice installed in WSL", actions: [] },
        { id: "darwinSdk", name: "iOS SDK (Darwin)", group: "ios", status: "ok", version: null, detail: "Generated from Xcode.xip", actions: [] },
        { id: "appleId", name: "Apple account (signing)", group: "ios", status: "ok", version: null, detail: "Signed in: automatic signing and provisioning", actions: [{ id: "xtool-login", label: "Sign in" }] },
      ]);
    case "list_devices":
      return r([{ udid: "00008110-000A1B2C3D4E5F60", name: "iPhone", productType: "iPhone16,1", osVersion: "26.0", deviceClass: "iPhone", connection: "USB" }]);
    case "list_wsl_distros":
      return r(["Ubuntu", "Debian"]);
    case "wsl_device_check":
      return r("iPhone [USB]: 00008110-000A1B2C3D4E5F60");
    case "device_log_start":
      logSession += 1;
      void simulateDeviceLog(logSession);
      return r(logSession);
    case "device_apps":
      await delay(400);
      return r([
        { bundleId: "com.example.HelloApp", name: "HelloApp", version: "1.0", build: "1", signer: "Apple Development: dev@example.com" },
        { bundleId: "com.example.Notes", name: "Notes Lab", version: "0.3", build: "7", signer: "Apple Development: dev@example.com" },
      ]);
    case "device_app_action":
      await delay(500);
      return r("ok");
    case "iphone_screenshot":
      await delay(900);
      return r(`C:\\Users\\dev\\Pictures\\XWinCode\\${a.name} 2026-10-08 at 18.48.29.png`);
    case "list_installs":
      return r([
        {
          udid: "00008110-000A1B2C3D4E5F60",
          deviceName: "iPhone",
          bundleId: "com.example.HelloApp",
          appName: "HelloApp",
          projectRoot: ROOT,
          installedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
          expiresAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        },
      ]);
    case "read_project_config":
      return r({ bundleId: "com.example.HelloApp", displayName: "Hello", version: "1.0", build: "1", permissions: { NSCameraUsageDescription: "Used by Hello." }, icon: null });
    case "start_build":
      void simulateBuild(a.request.action);
      return r(taskId);
    case "stop_task":
      return r(true);
    case "vibrancy_supported":
    case "set_window_material":
      return r(false);
    case "system_theme":
      return r(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    case "wsl_warmup":
      await delay(400);
      return r(400);
    default:
      return r(undefined);
  }
}
