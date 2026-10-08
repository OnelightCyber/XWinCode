import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BuildAction,
  Configuration,
  Destination,
  Device,
  DeviceApp,
  Diagnostic,
  Entry,
  InstallRecord,
  ProjectConfig,
  ProjectInfo,
  SearchHit,
  Settings,
  ToolComponent,
} from "./types";
import { mockInvoke, mockOn } from "./mock";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return isTauri ? invoke<T>(cmd, args) : mockInvoke<T>(cmd, args);
}

export const api = {
  readDir: (path: string) => call<Entry[]>("read_dir", { path }),
  readTextFile: (path: string) => call<string>("read_text_file", { path }),
  writeTextFile: (path: string, contents: string) => call<void>("write_text_file", { path, contents }),
  createFile: (path: string) => call<void>("create_file", { path }),
  createDir: (path: string) => call<void>("create_dir", { path }),
  renamePath: (from: string, to: string) => call<void>("rename_path", { from, to }),
  deletePath: (path: string) => call<void>("delete_path", { path }),
  pathExists: (path: string) => call<boolean>("path_exists", { path }),
  searchProject: (root: string, query: string, caseSensitive: boolean) =>
    call<SearchHit[]>("search_project", { root, query, caseSensitive }),
  listFiles: (root: string) => call<string[]>("list_files", { root }),
  replaceInFile: (path: string, query: string, replacement: string, caseSensitive: boolean) =>
    call<number>("replace_in_file", { path, query, replacement, caseSensitive }),
  setLanguage: (language: string) => call<void>("set_language", { language }),

  createProject: (options: { template: string; name: string; organizationId: string; location: string }) =>
    call<ProjectInfo>("create_project", { options }),
  openProject: (path: string) => call<ProjectInfo>("open_project", { path }),
  projectTrusted: (root: string) => call<boolean>("project_trusted", { root }),
  trustProject: (root: string) => call<void>("trust_project", { root }),
  defaultProjectsDir: () => call<string>("default_projects_dir"),
  readProjectConfig: (root: string) => call<ProjectConfig>("read_project_config", { root }),
  writeProjectConfig: (root: string, config: ProjectConfig) => call<void>("write_project_config", { root, config }),
  setProjectIcon: (root: string, pngBase64: string) => call<string>("set_project_icon", { root, pngBase64 }),
  readImageDataUrl: (path: string) => call<string>("read_image_data_url", { path }),
  previewPrepare: () => call<{ root: string; bundleId: string }>("preview_prepare"),
  previewConnect: (udid: string) => call<{ session: number; hello: string }>("preview_connect", { udid }),
  previewSend: (message: string) => call<void>("preview_send", { message }),
  previewDisconnect: () => call<void>("preview_disconnect"),
  iphoneScreenshot: (udid: string, name: string, os: string | null) => call<string>("iphone_screenshot", { udid, name, os }),
  dapStart: (root: string) => call<{ session: number; program: string }>("dap_start", { root }),
  dapSend: (message: string) => call<void>("dap_send", { message }),
  dapStop: () => call<void>("dap_stop"),

  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),
  removeRecent: (path: string) => call<void>("remove_recent", { path }),

  checkToolchain: () => call<ToolComponent[]>("check_toolchain"),
  runFixAction: (id: string) => call<void>("run_fix_action", { id }),
  runSetupTask: (id: string) => call<number>("run_setup_task", { id }),
  installSdk: (path: string) => call<number>("install_sdk", { path }),
  listWslDistros: () => call<string[]>("list_wsl_distros"),
  wslWarmup: () => call<number>("wsl_warmup"),

  listDevices: () => call<Device[]>("list_devices"),
  wslDeviceCheck: () => call<string>("wsl_device_check"),
  deviceLogStart: (udid: string, process: string | null) => call<number>("device_log_start", { udid, process }),
  deviceLogStop: () => call<void>("device_log_stop"),
  deviceApps: (udid: string) => call<DeviceApp[]>("device_apps", { udid }),
  deviceAppAction: (udid: string, bundleId: string, action: "launch" | "uninstall") =>
    call<string>("device_app_action", { udid, bundleId, action }),
  listInstalls: () => call<InstallRecord[]>("list_installs"),
  recordInstall: (udid: string, deviceName: string, projectRoot: string | null, appPath: string | null) =>
    call<InstallRecord>("record_install", { udid, deviceName, projectRoot, appPath }),
  forgetInstall: (udid: string, bundleId: string) => call<void>("forget_install", { udid, bundleId }),

  startBuild: (request: { root: string; action: BuildAction; configuration: Configuration; destination: Destination }) =>
    call<number>("start_build", { request }),
  installApp: (udid: string, path: string) => call<number>("install_app", { udid, path }),
  lspStart: (root: string) => call<{ mode: string; server: string }>("lsp_start", { root }),
  lspSend: (message: string) => call<void>("lsp_send", { message }),
  lspStop: () => call<void>("lsp_stop"),
  ptyOpen: (shell: string, cwd: string | null, cols: number, rows: number) =>
    call<{ id: number; title: string }>("pty_open", { shell, cwd, cols, rows }),
  ptyWrite: (id: number, data: string) => call<void>("pty_write", { id, data }),
  ptyResize: (id: number, cols: number, rows: number) => call<void>("pty_resize", { id, cols, rows }),
  ptyKill: (id: number) => call<void>("pty_kill", { id }),
  quitApp: () => call<void>("quit_app"),
  vibrancySupported: () => call<boolean>("vibrancy_supported"),
  setWindowMaterial: (material: string) => call<boolean>("set_window_material", { material }),
  setUiScale: (percent: number) => call<void>("set_ui_scale", { percent }),
  systemTheme: () => call<"dark" | "light">("system_theme"),
  stopTask: () => call<boolean>("stop_task"),
  sendTaskInput: (text: string) => call<void>("send_task_input", { text }),
};

export interface TaskStartEvent {
  taskId: number;
  label: string;
  command: string;
}
export interface TaskOutputEvent {
  taskId: number;
  stream: "stdout" | "stderr";
  lines: string[];
}
export type TaskDiagnosticEvent = Diagnostic & { taskId: number };
export interface TaskExitEvent {
  taskId: number;
  code: number | null;
  success: boolean;
  cancelled: boolean;
  durationMs: number;
}

export async function on<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri) return listen<T>(event, (e) => handler(e.payload));
  return mockOn(event, handler as (payload: unknown) => void);
}

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
