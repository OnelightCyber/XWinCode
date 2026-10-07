import { useEffect, useRef } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { t as tr } from "../i18n";
import { editorFontFamily } from "../lib/fonts";
import { api, errorMessage, isTauri, on } from "../lib/ipc";
import { openExternal } from "../lib/links";
import { useStore, type TerminalTab } from "../lib/store";

const DARK: ITheme = {
  background: "#0d0d0f",
  foreground: "#d4d4d8",
  cursor: "#ffffff",
  cursorAccent: "#0d0d0f",
  selectionBackground: "#ffffff38",
  black: "#18181b",
  red: "#f2555a",
  green: "#7fd69a",
  yellow: "#e5c46a",
  blue: "#7ea8f0",
  magenta: "#c79bf0",
  cyan: "#78cfe0",
  white: "#d4d4d8",
  brightBlack: "#63636b",
  brightRed: "#ff8085",
  brightGreen: "#a3e8b6",
  brightYellow: "#f2da92",
  brightBlue: "#a6c4f7",
  brightMagenta: "#dbbbf7",
  brightCyan: "#a3e2ee",
  brightWhite: "#ffffff",
};

const LIGHT: ITheme = {
  ...DARK,
  background: "#ffffff",
  foreground: "#18181b",
  cursor: "#0a0a0b",
  cursorAccent: "#ffffff",
  selectionBackground: "#0000002a",
  black: "#18181b",
  white: "#71717a",
  brightWhite: "#0a0a0b",
  red: "#c4282e",
  green: "#1d7a3c",
  yellow: "#946800",
  brightYellow: "#7a5600",
  blue: "#2457b8",
  magenta: "#7b3cb0",
  cyan: "#0b6e85",
};

const NERD = '"CaskaydiaCove NF", "CaskaydiaCove Nerd Font", "Cascadia Code NF", "Symbols Nerd Font Mono", ';

interface Props {
  tab: TerminalTab;
  visible: boolean;
  cwd: string | null;
  onTitle: (key: number, title: string) => void;
  onExit: (key: number) => void;
}

export function TerminalView({ tab, visible, cwd, onTitle, onExit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const ptyId = useRef<number | null>(null);
  const fontSize = useStore((s) => s.settings?.terminalFontSize ?? 12);
  const font = useStore((s) => s.settings?.editorFont);
  const blink = useStore((s) => s.settings?.terminalCursorBlink ?? true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const dark = document.documentElement.dataset.theme !== "light";
    const t = new XTerm({
      fontFamily: editorFontFamily(font, NERD),
      fontSize,
      lineHeight: 1.25,
      cursorBlink: blink,
      cursorStyle: "bar",
      allowProposedApi: true,
      scrollback: 10000,
      theme: dark ? DARK : LIGHT,
      linkHandler: { activate: (_e, uri) => void openExternal(uri) },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.loadAddon(
      new WebLinksAddon((_e, uri) => void openExternal(uri)),
    );
    t.open(el);
    term.current = t;
    fit.current = f;
    requestAnimationFrame(() => f.fit());

    let disposed = false;
    let waiting = false;
    const unsubs: Promise<() => void>[] = [];
    if (!isTauri) {
      t.writeln(`\x1b[36mXWinCode\x1b[0m — ${tr("term.desktopOnly")}`);
    } else {
      unsubs.push(
        on<{ id: number; data: string }>("pty://data", (e) => {
          if (e.id !== ptyId.current) return;
          if (waiting) {
            waiting = false;
            t.write("\r\x1b[2K");
          }
          t.write(e.data);
        }),
        on<{ id: number }>("pty://exit", (e) => {
          if (e.id === ptyId.current) {
            t.writeln(`\r\n\x1b[90m[${tr("term.exited")}]\x1b[0m`);
            ptyId.current = null;
            onExit(tab.key);
          }
        }),
      );
      void Promise.all(unsubs).then(async () => {
        if (tab.shell === "wsl" && useStore.getState().wsl !== "ready") {
          waiting = true;
          t.write(`\x1b[90m${tr("term.wslBooting")}\x1b[0m`);
        }
        try {
          const info = await api.ptyOpen(tab.shell, cwd, t.cols, t.rows);
          if (disposed) {
            void api.ptyKill(info.id);
            return;
          }
          ptyId.current = info.id;
          onTitle(tab.key, info.title);
        } catch (e) {
          t.writeln(`\x1b[31m${errorMessage(e)}\x1b[0m`);
        }
      });
    }
    const dataSub = t.onData((d) => {
      if (ptyId.current !== null) void api.ptyWrite(ptyId.current, d);
    });
    const resizeSub = t.onResize(({ cols, rows }) => {
      if (ptyId.current !== null) void api.ptyResize(ptyId.current, cols, rows);
    });
    const ro = new ResizeObserver(() => {
      if (el.offsetParent !== null) f.fit();
    });
    ro.observe(el);

    const themeObserver = new MutationObserver(() => {
      t.options.theme = document.documentElement.dataset.theme === "light" ? LIGHT : DARK;
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      disposed = true;
      ro.disconnect();
      themeObserver.disconnect();
      dataSub.dispose();
      resizeSub.dispose();
      unsubs.forEach((p) => void p.then((u) => u()));
      if (ptyId.current !== null) void api.ptyKill(ptyId.current);
      t.dispose();
    };
  }, [tab.key]);

  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontSize = fontSize;
    t.options.fontFamily = editorFontFamily(font, NERD);
    t.options.cursorBlink = blink;
    if (host.current?.offsetParent) fit.current?.fit();
  }, [fontSize, font, blink]);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      fit.current?.fit();
      term.current?.focus();
    });
  }, [visible]);

  return <div ref={host} className="terminal-host" style={{ display: visible ? "block" : "none" }} />;
}
