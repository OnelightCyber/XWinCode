export type ProjectKind = "iosApp" | "executable" | "library" | "unknown";

export interface ProjectInfo {
  root: string;
  name: string;
  kind: ProjectKind;
  bundleId: string | null;
}

export interface RecentProject {
  path: string;
  name: string;
  kind: ProjectKind;
  openedAt: string;
}

export type ThemePref = "system" | "dark" | "light";
export type Material = "mica" | "mica-alt" | "acrylic" | "none";
export type EditorTheme = "mono" | "xcode";
export type EditorFont = "geist-mono" | "jetbrains-mono" | "cascadia" | "consolas";
export type CursorStyle = "line" | "block" | "underline";
export type ShellPref = "auto" | "powershell" | "cmd" | "wsl";
export type IosConnection = "auto" | "usb" | "network";

export interface Settings {
  recentProjects: RecentProject[];
  wslDistro: string | null;
  editorFontSize: number;
  minimap: boolean;
  wordWrap: boolean;
  autoSave: boolean;
  organizationId: string;
  theme: ThemePref;
  language: string;
  material: Material;
  uiScale: number;
  reduceMotion: boolean;
  reopenLastProject: boolean;
  projectsDir: string | null;

  editorTheme: EditorTheme;
  editorFont: EditorFont;
  editorLineHeight: number;
  fontLigatures: boolean;
  tabSize: number;
  insertSpaces: boolean;
  lineNumbers: boolean;
  indentGuides: boolean;
  stickyScroll: boolean;
  smoothCaret: boolean;
  cursorStyle: CursorStyle;
  formatOnSave: boolean;

  terminalShell: ShellPref;
  terminalFontSize: number;
  terminalCursorBlink: boolean;

  defaultConfiguration: Configuration;
  clearConsoleOnBuild: boolean;
  showBuildHud: boolean;
  autoShowDebug: boolean;

  warmWsl: boolean;
  iosConnection: IosConnection;
  autoUpdate: boolean;
}

export interface Entry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface SearchHit {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface Diagnostic {
  file: string | null;
  line: number;
  column: number;
  severity: "error" | "warning" | "note";
  message: string;
}

export interface Device {
  udid: string;
  name: string;
  productType: string | null;
  osVersion: string | null;
  deviceClass: string | null;
  connection: string;
}

export type Destination =
  | { kind: "local" }
  | { kind: "anyIos" }
  | { kind: "device"; udid: string; name: string };

export type Configuration = "debug" | "release";

export type BuildAction = "build" | "run" | "test" | "clean" | "archive";

export interface ToolAction {
  id: string;
  label: string;
}

export interface ToolComponent {
  id: string;
  name: string;
  group: "windows" | "ios";
  status: "ok" | "missing" | "warning";
  version: string | null;
  detail: string;
  actions: ToolAction[];
}

export type TaskStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface TaskTarget {
  root: string;
  ios: boolean;
  udid?: string;
  deviceName?: string;
}

export interface TaskState {
  id: number;
  label: string;
  command: string;
  action: BuildAction | "install" | "setup";
  status: TaskStatus;
  startedAt: number;
  durationMs?: number;
  exitCode?: number | null;
  target?: TaskTarget;
}

export interface DeviceApp {
  bundleId: string;
  name: string;
  version: string | null;
  build: string | null;
  signer: string | null;
}

export interface InstallRecord {
  udid: string;
  deviceName: string;
  bundleId: string;
  appName: string;
  projectRoot: string | null;
  installedAt: string;
  expiresAt: string | null;
}

export interface ProjectConfig {
  bundleId: string;
  displayName: string;
  version: string;
  build: string;
  permissions: Record<string, string>;
  icon?: string | null;
}

export interface DeviceLine {
  id: number;
  time: string;
  process: string;
  level: "error" | "warning" | "info" | "debug";
  message: string;
}

export interface LogLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
  severity?: "error" | "warning" | "note";
}
