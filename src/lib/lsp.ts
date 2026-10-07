import { t } from "../i18n";
import { monaco } from "./monaco";
import { api, errorMessage, isTauri, on } from "./ipc";
import type { ProjectInfo } from "./types";

interface Msg {
  jsonrpc: "2.0";
  id?: number | string | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
}

type ConnState = { state: "connecting" } | { state: "open" } | { state: "closed"; error: Error | undefined };

export type LspStatus = { state: "off" } | { state: "starting"; detail?: string } | { state: "ready"; mode: string } | { state: "error"; message: string };

interface Position {
  line: number;
  character: number;
}
interface Range {
  start: Position;
  end: Position;
}
interface TextEdit {
  range: Range;
  newText: string;
}

export interface LspSymbol {
  name: string;
  kind: number;
  detail?: string;
  range: Range;
  selectionRange?: Range;
  children?: LspSymbol[];
  location?: { uri: string; range: Range };
  containerName?: string;
}

const SUPPORTED = /\.(swift|c|h|m|mm|cc|cpp|hpp)$/i;
const REINIT_ID = "xwc-reinit";
const TEXT_KEYS = new Set(["text", "newText", "insertText", "value", "label", "detail", "documentation", "message"]);

function rootUri(root: string) {
  return monaco.Uri.file(root).toString();
}

function fixOutgoingUri(u: string): string {
  const lower = u.toLowerCase();
  for (const m of monaco.editor.getModels()) {
    if (m.uri.toString(true).toLowerCase() === lower || m.uri.toString().toLowerCase() === lower) return m.uri.toString();
  }
  try {
    return monaco.Uri.parse(u).toString();
  } catch {
    return u;
  }
}

function normalizeIncomingUri(u: string): string {
  try {
    return monaco.Uri.parse(u).toString(true);
  } catch {
    return u;
  }
}

function mapUris(v: any, f: (s: string) => string, key?: string): any {
  if (typeof v === "string") return v.startsWith("file:") && !(key && TEXT_KEYS.has(key)) ? f(v) : v;
  if (Array.isArray(v)) return v.map((x) => mapUris(x, f, key));
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, x] of Object.entries(v)) out[k.startsWith("file:") ? f(k) : k] = mapUris(x, f, k);
    return out;
  }
  return v;
}

class TauriTransport {
  private listener?: (m: Msg) => void;
  private queue: Msg[] = [];
  private conn: ConnState = { state: "open" };
  private stateListeners = new Set<(s: ConnState) => void>();
  private initParams: any = null;
  private opened = new Set<string>();
  private methods = new Map<string | number, string>();
  private pending = new Map<string, (m: Msg) => void>();
  private nextRequest = 1;
  private ready: Promise<void> = Promise.resolve();
  private resolveReady: (() => void) | null = null;
  root: string;

  readonly state: { readonly value: ConnState; onChange: (l: (s: ConnState) => void) => { dispose(): void } };

  constructor(root: string) {
    this.root = root;
    const self = this;
    this.state = {
      get value() {
        return self.conn;
      },
      onChange: (l) => {
        self.stateListeners.add(l);
        return { dispose: () => void self.stateListeners.delete(l) };
      },
    };
    transportRef = this;
    void on<string>("lsp://message", (raw) => this.receive(raw));
  }

  private dispatch(m: Msg) {
    const own = typeof m.id === "string" ? this.pending.get(m.id) : undefined;
    if (own) {
      this.pending.delete(m.id as string);
      own(m);
      return;
    }
    if (this.listener) this.listener(m);
    else this.queue.push(m);
  }

  setListener(l: ((m: Msg) => void) | undefined) {
    this.listener = l;
    if (l) for (const m of this.queue.splice(0)) l(m);
  }

  toString() {
    return "sourcekit-lsp (XWinCode)";
  }

  request<T>(method: string, params: any, timeoutMs: number): Promise<T | null> {
    const id = `xwc-req-${this.nextRequest++}`;
    return new Promise<T | null>((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, timeoutMs);
      this.pending.set(id, (m) => {
        window.clearTimeout(timer);
        resolve(m.error ? null : ((m.result ?? null) as T | null));
      });
      void this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async send(msg: Msg): Promise<void> {
    if (msg.method === "initialize") {
      msg.params = {
        ...msg.params,
        processId: null,
        clientInfo: { name: "XWinCode", version: "0.1.0" },
        rootUri: rootUri(this.root),
        workspaceFolders: [{ uri: rootUri(this.root), name: "workspace" }],
      };
      this.initParams = msg.params;
    } else {
      await this.ready;
    }
    const docUri: string | undefined = msg.params?.textDocument?.uri;
    if (docUri && !SUPPORTED.test(docUri)) {
      if (msg.id !== undefined && msg.method) this.dispatch({ jsonrpc: "2.0", id: msg.id, result: null });
      return;
    }
    const out = mapUris(msg, fixOutgoingUri) as Msg;
    if (out.method === "textDocument/didOpen") {
      const uri = out.params.textDocument.uri as string;
      if (this.opened.has(uri)) return;
      this.opened.add(uri);
    } else if (out.method === "textDocument/didClose") {
      this.opened.delete(out.params.textDocument.uri);
    }
    if (out.id !== undefined && out.id !== null && out.method) this.methods.set(out.id, out.method);
    try {
      await api.lspSend(JSON.stringify(out));
    } catch (e) {
      if (out.id !== undefined && out.id !== null && out.method) {
        this.methods.delete(out.id);
        console.debug(`[lsp] ${out.method}: ${errorMessage(e)}`);
        this.dispatch(
          out.method === "initialize"
            ? { jsonrpc: "2.0", id: out.id, error: { code: -32603, message: errorMessage(e) } }
            : { jsonrpc: "2.0", id: out.id, result: null },
        );
      }
    }
  }

  private receive(raw: string) {
    let m: Msg;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.id === REINIT_ID) {
      void this.finishRestart();
      return;
    }
    if (m.id !== undefined && m.id !== null && m.method === undefined) {
      const method = this.methods.get(m.id);
      this.methods.delete(m.id);
      if (m.error && method !== "initialize") {
        console.debug(`[lsp] ${method}: ${m.error.message}`);
        m = { jsonrpc: "2.0", id: m.id, result: null };
      }
    }
    this.dispatch(mapUris(m, normalizeIncomingUri));
  }

  hold() {
    if (!this.resolveReady) this.ready = new Promise((r) => (this.resolveReady = r));
  }

  release() {
    this.resolveReady?.();
    this.resolveReady = null;
  }

  restart(root: string) {
    this.root = root;
    this.hold();
    this.opened.clear();
    const params = { ...this.initParams, rootUri: rootUri(root), workspaceFolders: [{ uri: rootUri(root), name: "workspace" }] };
    void api.lspSend(JSON.stringify({ jsonrpc: "2.0", id: REINIT_ID, method: "initialize", params })).catch(() => this.release());
  }

  private async finishRestart() {
    await api.lspSend(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })).catch(() => undefined);
    for (const model of monaco.editor.getModels()) {
      const uri = model.uri.toString();
      if (!SUPPORTED.test(uri) || this.opened.has(uri)) continue;
      this.opened.add(uri);
      const open = {
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: { textDocument: { uri, languageId: model.getLanguageId(), version: model.getVersionId(), text: model.getValue() } },
      };
      await api.lspSend(JSON.stringify(open)).catch(() => undefined);
    }
    this.release();
  }
}

let transportRef: TauriTransport | null = null;
let client: unknown = null;
let status: LspStatus = { state: "off" };
const statusListeners = new Set<(s: LspStatus) => void>();

function setStatus(s: LspStatus) {
  status = s;
  statusListeners.forEach((l) => l(s));
}

export function lspStatus() {
  return status;
}

export function onLspStatus(l: (s: LspStatus) => void) {
  statusListeners.add(l);
  return () => statusListeners.delete(l);
}

let exitHooked = false;

export async function startLsp(project: ProjectInfo, detail?: string) {
  if (!isTauri) return;
  if (!exitHooked) {
    exitHooked = true;
    void on("lsp://exit", () => {
      if (status.state === "ready") setStatus({ state: "error", message: t("lsp.stopped") });
    });
  }
  setStatus({ state: "starting", detail });
  transportRef?.hold();
  try {
    const info = await api.lspStart(project.root);
    if (!transportRef) {
      const transport = new TauriTransport(project.root);
      client = new monaco.lsp.MonacoLspClient(transport as never);
    } else {
      transportRef.restart(project.root);
    }
    setStatus({ state: "ready", mode: info.mode });
  } catch (e) {
    transportRef?.release();
    setStatus({ state: "error", message: errorMessage(e) });
  }
}

export async function stopLsp() {
  if (!isTauri) return;
  await api.lspStop().catch(() => undefined);
  setStatus({ state: "off" });
}

export function hasLspClient() {
  return client !== null;
}

async function request<T>(method: string, params: any, timeoutMs: number): Promise<T | null> {
  if (!transportRef || status.state !== "ready") return null;
  return transportRef.request<T>(method, params, timeoutMs);
}

export async function formatModel(model: monaco.editor.ITextModel, options: { tabSize: number; insertSpaces: boolean }): Promise<boolean> {
  if (!SUPPORTED.test(model.uri.path)) return false;
  const version = model.getVersionId();
  const edits = await request<TextEdit[]>("textDocument/formatting", { textDocument: { uri: model.uri.toString() }, options }, 5000);
  if (!edits?.length || model.isDisposed() || model.getVersionId() !== version) return false;
  model.pushEditOperations(
    [],
    edits.map((e) => ({
      range: new monaco.Range(e.range.start.line + 1, e.range.start.character + 1, e.range.end.line + 1, e.range.end.character + 1),
      text: e.newText,
    })),
    () => null,
  );
  return true;
}

export async function documentSymbols(model: monaco.editor.ITextModel): Promise<LspSymbol[] | null> {
  if (!SUPPORTED.test(model.uri.path)) return null;
  return request<LspSymbol[]>("textDocument/documentSymbol", { textDocument: { uri: model.uri.toString() } }, 4000);
}
