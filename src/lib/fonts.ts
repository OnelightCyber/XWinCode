import type { EditorFont } from "./types";

export const EDITOR_FONTS: { value: EditorFont; label: string; css: string }[] = [
  { value: "geist-mono", label: "Geist Mono", css: '"Geist Mono Variable"' },
  { value: "jetbrains-mono", label: "JetBrains Mono", css: '"JetBrains Mono Variable"' },
  { value: "cascadia", label: "Cascadia Code", css: '"Cascadia Code", "Cascadia Mono"' },
  { value: "consolas", label: "Consolas", css: "Consolas" },
];

export function editorFontFamily(font: EditorFont | undefined, extra = "") {
  const f = EDITOR_FONTS.find((x) => x.value === font) ?? EDITOR_FONTS[0];
  return `${f.css}, ${extra}"JetBrains Mono Variable", Consolas, monospace`;
}
