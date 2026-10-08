import { create } from "zustand";
import { t } from "../i18n";
import { api, errorMessage, on } from "./ipc";
import { useStore } from "./store";
import type { TaskStatus } from "./types";

export type DebugStatus = "off" | "building" | "starting" | "running" | "paused";

export interface DebugFrame {
  id: number;
  name: string;
  path: string | null;
  line: number;
  column: number;
}

export interface DebugVar {
  name: string;
  value: string;
  type?: string;
  ref: number;
}

export interface DebugScope {
  name: string;
  ref: number;
}

interface DebugState {
  status: DebugStatus;
  breakpoints: Record<string, number[]>;
  frames: DebugFrame[];
  frame: number;
  scopes: DebugScope[];
  vars: Record<number, DebugVar[]>;
  open: Record<number, boolean>;
  reason: string | null;
  threadId: number | null;
  program: string | null;
}

export const useDebug = create<DebugState>(() => ({
  status: "off",
  breakpoints: {},
  frames: [],
  frame: 0,
  scopes: [],
  vars: {},
  open: {},
  reason: null,
  threadId: null,
  program: null,
}));

const set = useDebug.setState;
const get = useDebug.getState;

let session = 0;
let seq = 0;
let pending = new Map<number, { resolve: (body: any) => void; reject: (e: Error) => void }>();
let initialized: (() => void) | null = null;
let outputTail = { stdout: "", stderr: "" };

const storageKey = (root: string) => `xwc.breakpoints:${root.toLowerCase()}`;
const sameFile = (a: string, b: string) => a.replace(/\//g, "\\").toLowerCase() === b.replace(/\//g, "\\").toLowerCase();

function loadBreakpoints(root: string | null) {
  let saved: Record<string, number[]> = {};
  if (root) {
    try {
      saved = JSON.parse(localStorage.getItem(storageKey(root)) ?? "{}");
    } catch {}
  }
  set({ breakpoints: saved && typeof saved === "object" ? saved : {} });
}

function saveBreakpoints() {
  const root = useStore.getState().project?.root;
  if (!root) return;
  try {
    localStorage.setItem(storageKey(root), JSON.stringify(get().breakpoints));
  } catch {}
}

let lastRoot: string | null = null;
useStore.subscribe((s) => {
  const root = s.project?.root ?? null;
  if (root === lastRoot) return;
  lastRoot = root;
  loadBreakpoints(root);
  if (get().status !== "off") void stopDebugging();
});

export function breakpointsFor(path: string): number[] {
  const bp = get().breakpoints;
  const key = Object.keys(bp).find((k) => sameFile(k, path));
  return key ? bp[key] : [];
}

export function hasBreakpoints(): boolean {
  return Object.values(get().breakpoints).some((lines) => lines.length > 0);
}

export function setBreakpointsFor(path: string, lines: number[]) {
  const bp = { ...get().breakpoints };
  for (const k of Object.keys(bp)) if (sameFile(k, path)) delete bp[k];
  const unique = [...new Set(lines)].filter((l) => l > 0).sort((a, b) => a - b);
  if (unique.length) bp[path] = unique;
  set({ breakpoints: bp });
  saveBreakpoints();
  if (get().status === "running" || get().status === "paused") void sendBreakpoints(path).catch(() => undefined);
}

export function clearBreakpoints() {
  const paths = Object.keys(get().breakpoints);
  set({ breakpoints: {} });
  saveBreakpoints();
  if (get().status === "running" || get().status === "paused") for (const p of paths) void sendBreakpoints(p).catch(() => undefined);
}

export function toggleBreakpoint(path: string, line: number) {
  const lines = breakpointsFor(path);
  setBreakpointsFor(path, lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line]);
}

function send<T = any>(command: string, args?: object): Promise<T> {
  const s = ++seq;
  const message = JSON.stringify({ seq: s, type: "request", command, arguments: args ?? {} });
  return new Promise<T>((resolve, reject) => {
    pending.set(s, { resolve, reject });
    api.dapSend(message).catch((e) => {
      pending.delete(s);
      reject(new Error(errorMessage(e)));
    });
  });
}

async function sendBreakpoints(path: string) {
  await send("setBreakpoints", { source: { path }, breakpoints: breakpointsFor(path).map((line) => ({ line })), sourceModified: false });
}

function log(stream: "stdout" | "stderr" | "system", text: string, severity?: "error") {
  useStore.getState().pushLog([{ stream, text, ...(severity ? { severity } : {}) }]);
}

function output(category: string, text: string) {
  if (category === "stdout" || category === "stderr") {
    const all = outputTail[category] + text;
    const parts = all.split(/\r?\n/);
    outputTail[category] = parts.pop() ?? "";
    for (const line of parts) log(category, line);
    return;
  }
  if (category === "important") log("system", text.trim(), "error");
}

function flushOutput() {
  for (const k of ["stdout", "stderr"] as const) {
    if (outputTail[k]) log(k, outputTail[k]);
    outputTail[k] = "";
  }
}

const userSource = (path: string | null): path is string => !!path && /\.swift$/i.test(path);

async function loadVars(ref: number) {
  if (!ref) return;
  try {
    const body = await send<{ variables: { name: string; value: string; type?: string; variablesReference: number }[] }>("variables", { variablesReference: ref });
    set((s) => ({ vars: { ...s.vars, [ref]: body.variables.map((v) => ({ name: v.name, value: v.value, type: v.type, ref: v.variablesReference })) } }));
  } catch {}
}

export async function selectFrame(index: number) {
  const frame = get().frames[index];
  if (!frame) return;
  set({ frame: index, scopes: [], vars: {}, open: {} });
  if (userSource(frame.path)) void useStore.getState().openFile(frame.path, { line: frame.line, column: 1 });
  try {
    const body = await send<{ scopes: { name: string; variablesReference: number }[] }>("scopes", { frameId: frame.id });
    const scopes = body.scopes.map((s) => ({ name: s.name, ref: s.variablesReference }));
    set({ scopes, open: Object.fromEntries(scopes.slice(0, 1).map((s) => [s.ref, true])) });
    await Promise.all(scopes.slice(0, 2).map((s) => loadVars(s.ref)));
  } catch {}
}

export function toggleVar(ref: number) {
  const open = !get().open[ref];
  set((s) => ({ open: { ...s.open, [ref]: open } }));
  if (open && !get().vars[ref]) void loadVars(ref);
}

async function onStopped(body: { reason?: string; threadId?: number; description?: string }) {
  const threadId = body.threadId ?? get().threadId ?? 1;
  set({ status: "paused", threadId, reason: body.description ?? body.reason ?? null, frames: [], scopes: [], vars: {} });
  try {
    const st = await send<{ stackFrames: { id: number; name: string; line: number; column: number; source?: { path?: string } }[] }>("stackTrace", { threadId, levels: 64 });
    const frames = st.stackFrames.map((f) => ({ id: f.id, name: f.name, path: f.source?.path ?? null, line: f.line, column: f.column }));
    set({ frames });
    const first = frames.findIndex((f) => userSource(f.path));
    await selectFrame(first >= 0 ? first : 0);
  } catch {}
}

function end() {
  flushOutput();
  for (const p of pending.values()) p.reject(new Error(t("err.debuggerOff")));
  pending = new Map();
  initialized = null;
  session = 0;
  set({ status: "off", frames: [], scopes: [], vars: {}, open: {}, reason: null, threadId: null, program: null });
}

function handle(raw: string) {
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type === "response") {
    const p = pending.get(msg.request_seq);
    if (!p) return;
    pending.delete(msg.request_seq);
    if (msg.success) p.resolve(msg.body ?? {});
    else p.reject(new Error(msg.message ?? msg.command));
    return;
  }
  if (msg.type !== "event") return;
  const body = msg.body ?? {};
  switch (msg.event) {
    case "initialized":
      initialized?.();
      initialized = null;
      break;
    case "stopped":
      void onStopped(body);
      break;
    case "continued":
      set({ status: "running", frames: [], scopes: [], vars: {}, reason: null });
      break;
    case "output":
      output(body.category ?? "console", String(body.output ?? ""));
      break;
    case "exited":
      flushOutput();
      log("system", t("debug.exited", { code: body.exitCode ?? "?" }));
      break;
    case "terminated":
      void api.dapStop().catch(() => undefined);
      end();
      break;
  }
}

on<{ session: number; message: string }>("dap://message", (e) => {
  if (e.session === session) handle(e.message);
});
on<{ session: number }>("dap://closed", (e) => {
  if (e.session === session) end();
});

function waitTask(): Promise<TaskStatus> {
  return new Promise((resolve) => {
    const check = () => {
      const status = useStore.getState().task?.status;
      if (status && status !== "running") {
        unsub();
        resolve(status);
      }
    };
    const unsub = useStore.subscribe(check);
    check();
  });
}

export function canDebug(): boolean {
  const kind = useStore.getState().project?.kind;
  return !!kind && kind !== "iosApp" && kind !== "library";
}

export async function startDebugging() {
  const store = useStore.getState();
  const project = store.project;
  if (!project || get().status !== "off" || !canDebug()) return;
  set({ status: "building" });
  await store.build("build");
  const result = useStore.getState().task?.status === "running" ? await waitTask() : useStore.getState().task?.status;
  if (result !== "succeeded") {
    set({ status: "off" });
    return;
  }
  set({ status: "starting" });
  try {
    const started = await api.dapStart(project.root);
    session = started.session;
    seq = 0;
    pending = new Map();
    outputTail = { stdout: "", stderr: "" };
    set({ program: started.program });
    const ready = new Promise<void>((resolve) => (initialized = resolve));
    await send("initialize", { clientID: "xwincode", clientName: "XWinCode", adapterID: "lldb-dap", linesStartAt1: true, columnsStartAt1: true, pathFormat: "path", supportsVariableType: true });
    log("system", `▸ ${new Date().toLocaleTimeString()} — ${t("debug.started", { name: project.name })}`);
    const launched = send("launch", { program: started.program, cwd: project.root, args: [], stopOnEntry: false });
    await ready;
    for (const path of Object.keys(get().breakpoints)) await sendBreakpoints(path).catch(() => undefined);
    await send("configurationDone");
    if (get().status === "starting") set({ status: "running" });
    await launched;
  } catch (e) {
    if (session || get().status !== "off") {
      log("system", errorMessage(e), "error");
      useStore.getState().toast("error", errorMessage(e));
      await stopDebugging();
    }
  }
}

export async function runOrDebug() {
  if (canDebug() && hasBreakpoints()) return startDebugging();
  return useStore.getState().build("run");
}

export async function stopDebugging() {
  const status = get().status;
  if (status === "off") return;
  if (status === "building") {
    await useStore.getState().stop();
    set({ status: "off" });
    return;
  }
  await Promise.race([send("disconnect", { terminateDebuggee: true }).catch(() => undefined), new Promise((r) => setTimeout(r, 1500))]);
  await api.dapStop().catch(() => undefined);
  end();
}

const threadArgs = () => ({ threadId: get().threadId ?? 1 });

export function debugContinue() {
  if (get().status !== "paused") return;
  set({ status: "running", frames: [], scopes: [], vars: {} });
  void send("continue", threadArgs()).catch(() => undefined);
}

export function debugPause() {
  if (get().status !== "running") return;
  void send("pause", threadArgs()).catch(() => undefined);
}

function step(command: "next" | "stepIn" | "stepOut") {
  if (get().status !== "paused") return;
  set({ status: "running" });
  void send(command, threadArgs()).catch(() => undefined);
}

export const debugStepOver = () => step("next");
export const debugStepIn = () => step("stepIn");
export const debugStepOut = () => step("stepOut");

export function currentLocation(): { path: string; line: number } | null {
  const s = get();
  if (s.status !== "paused") return null;
  const f = s.frames[s.frame];
  return f && userSource(f.path) ? { path: f.path, line: f.line } : null;
}
