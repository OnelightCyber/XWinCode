import { openProjectDialog } from "../components/Welcome";
import { t, type TKey } from "../i18n";
import { requestClose } from "./appWindow";
import { clearBreakpoints, debugContinue, debugStepIn, debugStepOut, debugStepOver, runOrDebug, startDebugging, stopDebugging, toggleBreakpoint, useDebug } from "./debugger";
import { useStore } from "./store";
import type { BuildAction } from "./types";

export interface Command {
  id: string;
  readonly label: string;
  readonly group: string;
  shortcut?: string;
  needsProject?: boolean;
  run: () => void;
}

const st = () => useStore.getState();
const build = (a: BuildAction) => () => void st().build(a);

function cmd(
  id: string,
  label: TKey,
  group: TKey,
  run: () => void,
  extra: { shortcut?: string; needsProject?: boolean } = {},
): Command {
  return {
    id,
    get label() {
      return t(label);
    },
    get group() {
      return t(group);
    },
    ...extra,
    run,
  };
}

export const commands: Record<string, Command> = {
  newProject: cmd("newProject", "cmd.newProject", "group.file", () => st().openSheet("newProject"), { shortcut: "Ctrl+Shift+N" }),
  newFile: cmd("newFile", "cmd.newFile", "group.file", () => window.dispatchEvent(new Event("xwc:new-file")), { shortcut: "Ctrl+N", needsProject: true }),
  openProject: cmd("openProject", "cmd.openProject", "group.file", () => void openProjectDialog(), { shortcut: "Ctrl+O" }),
  closeProject: cmd("closeProject", "cmd.closeProject", "group.file", () => void st().closeProject(), { needsProject: true }),
  save: cmd("save", "cmd.save", "group.file", () => void st().save(undefined, { format: true }), { shortcut: "Ctrl+S", needsProject: true }),
  saveAll: cmd("saveAll", "cmd.saveAll", "group.file", () => void st().saveAll(), { shortcut: "Ctrl+Alt+S", needsProject: true }),
  closeTab: cmd("closeTab", "cmd.closeTab", "group.file", () => st().active && void st().closeTab(st().active!), { shortcut: "Ctrl+W", needsProject: true }),
  quickOpen: cmd("quickOpen", "cmd.quickOpen", "group.file", () => st().openSheet("quickOpen"), { shortcut: "Ctrl+P", needsProject: true }),
  projectSettings: cmd("projectSettings", "cmd.projectSettings", "group.file", () => st().openSheet("project"), { needsProject: true }),
  quit: cmd("quit", "cmd.quit", "group.file", () => void requestClose(), { shortcut: "Alt+F4" }),

  build: cmd("build", "cmd.build", "group.product", build("build"), { shortcut: "Ctrl+B", needsProject: true }),
  run: cmd("run", "cmd.run", "group.product", () => void runOrDebug(), { shortcut: "Ctrl+R", needsProject: true }),
  test: cmd("test", "cmd.test", "group.product", build("test"), { shortcut: "Ctrl+U", needsProject: true }),
  clean: cmd("clean", "cmd.clean", "group.product", build("clean"), { shortcut: "Ctrl+Shift+K", needsProject: true }),
  archive: cmd("archive", "cmd.archive", "group.product", build("archive"), { shortcut: "Ctrl+Shift+A", needsProject: true }),
  stop: cmd("stop", "cmd.stop", "group.product", () => void (useDebug.getState().status !== "off" ? stopDebugging() : st().stop()), { shortcut: "Ctrl+." }),

  debug: cmd("debug", "cmd.debug", "group.debug", () => void startDebugging(), { needsProject: true }),
  continue: cmd("continue", "cmd.continue", "group.debug", debugContinue, { shortcut: "F5", needsProject: true }),
  stepOver: cmd("stepOver", "cmd.stepOver", "group.debug", debugStepOver, { shortcut: "F10", needsProject: true }),
  stepIn: cmd("stepIn", "cmd.stepIn", "group.debug", debugStepIn, { shortcut: "F11", needsProject: true }),
  stepOut: cmd("stepOut", "cmd.stepOut", "group.debug", debugStepOut, { shortcut: "Shift+F11", needsProject: true }),
  toggleBreakpoint: cmd(
    "toggleBreakpoint",
    "cmd.toggleBreakpoint",
    "group.debug",
    () => {
      const s = st();
      if (s.active && /\.swift$/i.test(s.active)) toggleBreakpoint(s.active, s.cursor.line);
    },
    { shortcut: "F9", needsProject: true },
  ),
  clearBreakpoints: cmd("clearBreakpoints", "cmd.clearBreakpoints", "group.debug", () => clearBreakpoints(), { needsProject: true }),

  toggleNavigator: cmd("toggleNavigator", "cmd.toggleNavigator", "group.view", () => st().toggle("navigator"), { shortcut: "Ctrl+0" }),
  toggleDebug: cmd("toggleDebug", "cmd.toggleDebug", "group.view", () => st().toggle("debugArea"), { shortcut: "Ctrl+Shift+Y" }),
  toggleInspector: cmd("toggleInspector", "cmd.toggleInspector", "group.view", () => st().toggle("inspector"), { shortcut: "Ctrl+Alt+0" }),
  library: cmd("library", "cmd.library", "group.view", () => st().openSheet("library"), { shortcut: "Ctrl+Shift+L", needsProject: true }),
  canvas: cmd("canvas", "cmd.canvas", "group.view", () => st().toggleCanvas(), { shortcut: "Ctrl+Alt+Enter", needsProject: true }),

  navProject: cmd("navProject", "cmd.navProject", "group.navigate", () => st().setNavTab("project"), { shortcut: "Ctrl+1" }),
  findInProject: cmd(
    "findInProject",
    "cmd.findInProject",
    "group.navigate",
    () => {
      st().setNavTab("search");
      window.dispatchEvent(new Event("xwc:focus-search"));
    },
    { shortcut: "Ctrl+Shift+F", needsProject: true },
  ),
  navIssues: cmd("navIssues", "cmd.navIssues", "group.navigate", () => st().setNavTab("issues"), { shortcut: "Ctrl+5" }),
  nextTab: cmd("nextTab", "cmd.nextTab", "group.navigate", () => cycleTab(1), { shortcut: "Ctrl+Tab" }),
  prevTab: cmd("prevTab", "cmd.prevTab", "group.navigate", () => cycleTab(-1), { shortcut: "Ctrl+Shift+Tab" }),

  newTerminal: cmd("newTerminal", "cmd.newTerminal", "group.terminal", () => st().addTerminal(), { shortcut: "Ctrl+Shift+T" }),
  deviceConsole: cmd("deviceConsole", "cmd.deviceConsole", "group.window", () => st().setDebugTab("device"), { shortcut: "Ctrl+Shift+C", needsProject: true }),
  devices: cmd("devices", "cmd.devices", "group.window", () => st().openSheet("devices"), { shortcut: "Ctrl+Shift+2" }),
  settings: cmd("settings", "cmd.settings", "group.window", () => st().openSheet("settings"), { shortcut: "Ctrl+," }),
  tools: cmd("tools", "cmd.tools", "group.window", () => st().openSheet("settings", "tools")),

  commandPalette: cmd("commandPalette", "cmd.commandPalette", "group.help", () => st().openSheet("commands"), { shortcut: "Ctrl+Shift+P" }),
  shortcuts: cmd("shortcuts", "cmd.shortcuts", "group.help", () => st().openSheet("settings", "shortcuts")),
  checkUpdates: cmd("checkUpdates", "cmd.checkUpdates", "group.help", () => void st().checkForUpdate(true)),
  about: cmd("about", "cmd.about", "group.help", () => st().openSheet("settings", "about")),
};

function cycleTab(dir: 1 | -1) {
  const { tabs, active, setActive } = st();
  if (!tabs.length) return;
  const i = tabs.findIndex((p) => p === active);
  setActive(tabs[(i + dir + tabs.length) % tabs.length]);
}

function match(e: KeyboardEvent): string | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const digit = /^Digit(\d)$/.exec(e.code)?.[1] ?? /^Numpad(\d)$/.exec(e.code)?.[1];

  if (e.key === "F5" && !ctrl) return e.shiftKey ? "stop" : useDebug.getState().status === "paused" ? "continue" : "run";
  if (e.key === "F9" && !ctrl && !e.shiftKey) return "toggleBreakpoint";
  if (e.key === "F10" && !ctrl) return "stepOver";
  if (e.key === "F11" && !ctrl) return e.shiftKey ? "stepOut" : "stepIn";
  if (!ctrl) return null;
  if (key === "Tab") return e.shiftKey ? "prevTab" : "nextTab";
  if (digit !== undefined) {
    if (digit === "0") return e.altKey ? "toggleInspector" : "toggleNavigator";
    if (digit === "1" && !e.shiftKey) return "navProject";
    if (digit === "5" && !e.shiftKey) return "navIssues";
    if (digit === "2" && e.shiftKey) return "devices";
    return null;
  }
  if (key === "." || e.code === "Period") return "stop";
  if (key === ",") return "settings";
  if (e.altKey && key === "s") return "saveAll";
  if (e.altKey) return null;
  if (e.shiftKey) {
    switch (key) {
      case "n":
        return "newProject";
      case "k":
        return "clean";
      case "a":
        return "archive";
      case "y":
        return "toggleDebug";
      case "f":
        return "findInProject";
      case "o":
        return "quickOpen";
      case "t":
        return "newTerminal";
      case "p":
        return "commandPalette";
      case "l":
        return "library";
      case "c":
        return "deviceConsole";
    }
    return null;
  }
  switch (key) {
    case "n":
      return "newFile";
    case "o":
      return "openProject";
    case "s":
      return "save";
    case "w":
      return "closeTab";
    case "p":
      return "quickOpen";
    case "b":
      return "build";
    case "r":
      return "run";
    case "u":
      return "test";
  }
  return null;
}

export function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    const s = st();
    if (s.sheet && !document.querySelector(".menu")) {
      e.preventDefault();
      e.stopPropagation();
      s.openSheet(null);
    }
    return;
  }
  const id = match(e);
  if (!id) {
    if ((e.ctrlKey && (e.key === "r" || e.key === "R" || e.key === "p" || e.key === "j")) || e.key === "F5" || e.key === "F7" || e.key === "F10" || e.key === "F11") e.preventDefault();
    return;
  }
  if (id === "deviceConsole" && (e.target as Element | null)?.closest?.(".terminal-host")) return;
  const command = commands[id];
  e.preventDefault();
  e.stopPropagation();
  if (command.needsProject && !st().project) return;
  command.run();
}
