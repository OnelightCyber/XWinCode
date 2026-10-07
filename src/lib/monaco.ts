import * as monaco from "monaco-editor";
import { t, type TKey } from "../i18n";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

const swiftKeywords = [
  "actor", "associatedtype", "async", "await", "borrowing", "break", "case", "catch", "class", "consume",
  "consuming", "continue", "convenience", "default", "defer", "deinit", "didSet", "do", "dynamic", "each",
  "else", "enum", "extension", "fallthrough", "fileprivate", "final", "for", "func", "get", "guard", "if",
  "import", "in", "indirect", "infix", "init", "inout", "internal", "is", "isolated", "lazy", "let", "macro",
  "mutating", "nonisolated", "nonmutating", "open", "operator", "optional", "override", "package", "postfix",
  "precedencegroup", "prefix", "private", "protocol", "public", "repeat", "required", "rethrows", "return",
  "sending", "set", "some", "any", "static", "struct", "subscript", "super", "switch", "throw", "throws",
  "try", "typealias", "unowned", "var", "weak", "where", "while", "willSet", "as", "Self", "self",
  "true", "false", "nil",
];

const swiftLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".swift",
  keywords: swiftKeywords,
  operators: /[=><!~?:&|+\-*/^%.]+/,
  escapes: /\\(?:[0\\tnr"']|u\{[0-9A-Fa-f]{1,8}\})/,
  tokenizer: {
    root: [
      [/\/\/\/.*$/, "comment.doc"],
      [/\/\/.*$/, "comment"],
      [/\/\*\*(?!\/)/, "comment.doc", "@docblock"],
      [/\/\*/, "comment", "@block"],
      [/#"/, "string", "@rawstring"],
      [/"""/, "string", "@multistring"],
      [/"/, "string", "@string"],
      [/@[A-Za-z_]\w*/, "attribute"],
      [/#[A-Za-z_]\w*/, "keyword.directive"],
      [/\b0x[0-9A-Fa-f_]+\b/, "number"],
      [/\b0b[01_]+\b/, "number"],
      [/\b0o[0-7_]+\b/, "number"],
      [/\b\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?\b/, "number"],
      [/`[A-Za-z_]\w*`/, "identifier"],
      [/(func)(\s+)([A-Za-z_]\w*)/, ["keyword", "", "function.declaration"]],
      [/(struct|class|enum|protocol|actor|extension|typealias|associatedtype)(\s+)([A-Za-z_]\w*)/, ["keyword", "", "type.declaration"]],
      [/\.([a-z_]\w*)(?=\s*[({])/, "function.call"],
      [/\.([a-z_]\w*)/, "member"],
      [/[A-Z]\w*/, { cases: { "@keywords": "keyword", "@default": "type" } }],
      [/[a-z_]\w*(?=\s*\()/, { cases: { "@keywords": "keyword", "@default": "function.call" } }],
      [/[a-z_]\w*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
      [/\$\d+/, "identifier"],
      [/[{}()[\]]/, "delimiter.bracket"],
      [/@operators/, "operator"],
      [/[;,]/, "delimiter"],
    ],
    block: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
    docblock: [
      [/[^/*]+/, "comment.doc"],
      [/\*\//, "comment.doc", "@pop"],
      [/[/*]/, "comment.doc"],
    ],
    string: [
      [/\\\(/, { token: "string.interpolation", next: "@interpolation" }],
      [/@escapes/, "string.escape"],
      [/\\./, "string.escape.invalid"],
      [/[^\\"]+/, "string"],
      [/"/, "string", "@pop"],
    ],
    multistring: [
      [/\\\(/, { token: "string.interpolation", next: "@interpolation" }],
      [/@escapes/, "string.escape"],
      [/"""/, "string", "@pop"],
      [/[^\\"]+/, "string"],
      [/["\\]/, "string"],
    ],
    rawstring: [
      [/"#/, "string", "@pop"],
      [/[^"]+/, "string"],
      [/"/, "string"],
    ],
    interpolation: [
      [/\(/, { token: "delimiter.bracket", next: "@interpolation" }],
      [/\)/, { token: "string.interpolation", next: "@pop" }],
      { include: "root" },
    ],
  },
};

const swiftConfig: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: "//", blockComment: ["/*", "*/"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"', notIn: ["string", "comment"] },
    { open: "/*", close: " */", notIn: ["string"] },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
  indentationRules: {
    increaseIndentPattern: /^.*\{[^}"']*$|^.*\([^)"']*$|^\s*case\b.*:\s*$|^\s*default:\s*$/,
    decreaseIndentPattern: /^\s*(\}|\)|case\b|default:)/,
  },
  onEnterRules: [
    { beforeText: /^\s*\/\/\/.*$/, action: { indentAction: monaco.languages.IndentAction.None, appendText: "/// " } },
  ],
};

const snippets: { label: string; detail: TKey; insert: string }[] = [
  { label: "struct View", detail: "snippet.view", insert: "struct ${1:ContentView}: View {\n\tvar body: some View {\n\t\t${2:Text(\"Hello\")}\n\t}\n}" },
  { label: "func", detail: "snippet.func", insert: "func ${1:name}(${2}) ${3:-> Void }{\n\t$0\n}" },
  { label: "guard let", detail: "snippet.guardLet", insert: "guard let ${1:value} = ${2:optional} else {\n\t${3:return}\n}" },
  { label: "if let", detail: "snippet.ifLet", insert: "if let ${1:value} = ${2:optional} {\n\t$0\n}" },
  { label: "for in", detail: "snippet.forIn", insert: "for ${1:item} in ${2:collection} {\n\t$0\n}" },
  { label: "switch", detail: "snippet.switch", insert: "switch ${1:value} {\ncase ${2:.option}:\n\t$0\ndefault:\n\tbreak\n}" },
  { label: "Task", detail: "snippet.task", insert: "Task {\n\t$0\n}" },
  { label: "@State", detail: "snippet.state", insert: "@State private var ${1:name} = ${2:value}" },
  { label: "#Preview", detail: "snippet.preview", insert: "#Preview {\n\t${1:ContentView()}\n}" },
  { label: "@Test", detail: "snippet.test", insert: "@Test func ${1:name}() {\n\t#expect(${2:true})\n}" },
];

function registerSwift() {
  if (!monaco.languages.getLanguages().some((l) => l.id === "swift")) {
    monaco.languages.register({ id: "swift", extensions: [".swift"], aliases: ["Swift"] });
  }
  monaco.languages.setMonarchTokensProvider("swift", swiftLanguage);
  monaco.languages.setLanguageConfiguration("swift", swiftConfig);
  monaco.languages.registerCompletionItemProvider("swift", {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const kw = swiftKeywords.map((k) => ({
        label: k,
        kind: monaco.languages.CompletionItemKind.Keyword,
        insertText: k,
        range,
      }));
      const sn = snippets.map((s) => ({
        label: s.label,
        detail: t(s.detail),
        kind: monaco.languages.CompletionItemKind.Snippet,
        insertText: s.insert,
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range,
      }));
      const seen = new Set(swiftKeywords);
      const words: monaco.languages.CompletionItem[] = [];
      for (const m of model.getValue().matchAll(/\b[A-Za-z_]\w{2,}\b/g)) {
        if (seen.has(m[0]) || m[0] === word.word) continue;
        seen.add(m[0]);
        words.push({
          label: m[0],
          kind: /^[A-Z]/.test(m[0]) ? monaco.languages.CompletionItemKind.Class : monaco.languages.CompletionItemKind.Variable,
          insertText: m[0],
          range,
        });
      }
      return { suggestions: [...sn, ...kw, ...words] };
    },
  });
}

const DARK_CHROME: monaco.editor.IColors = {
  "editor.background": "#0D0D0F",
  "editorGutter.background": "#0D0D0F",
  "minimap.background": "#0D0D0F",
  "editorStickyScroll.background": "#0D0D0F",
  "editorStickyScrollHover.background": "#17171A",
  "editorLineNumber.foreground": "#3F3F46",
  "editorLineNumber.activeForeground": "#E4E4E7",
  "editor.lineHighlightBackground": "#FFFFFF08",
  "editor.lineHighlightBorder": "#00000000",
  "editorCursor.foreground": "#FFFFFF",
  "editorIndentGuide.background1": "#FFFFFF0E",
  "editorIndentGuide.activeBackground1": "#FFFFFF2A",
  "editorWhitespace.foreground": "#FFFFFF1A",
  "editorWidget.background": "#161618",
  "editorWidget.border": "#FFFFFF1A",
  "editorSuggestWidget.background": "#161618",
  "editorSuggestWidget.border": "#FFFFFF1A",
  "editorSuggestWidget.foreground": "#C9C9CE",
  "editorSuggestWidget.selectedBackground": "#FFFFFF1F",
  "editorSuggestWidget.selectedForeground": "#FFFFFF",
  "editorSuggestWidget.highlightForeground": "#FFFFFF",
  "editorHoverWidget.background": "#161618",
  "editorHoverWidget.border": "#FFFFFF1A",
  "editorBracketMatch.background": "#FFFFFF14",
  "editorBracketMatch.border": "#FFFFFF40",
  "editor.findMatchBackground": "#FFFFFF45",
  "editor.findMatchHighlightBackground": "#FFFFFF1F",
  "editor.wordHighlightBackground": "#FFFFFF12",
  "editor.wordHighlightStrongBackground": "#FFFFFF1C",
  "scrollbarSlider.background": "#FFFFFF14",
  "scrollbarSlider.hoverBackground": "#FFFFFF24",
  "scrollbarSlider.activeBackground": "#FFFFFF33",
  "editorOverviewRuler.border": "#00000000",
  "editorError.foreground": "#F2555A",
  "editorWarning.foreground": "#E5B84A",
  "editorInfo.foreground": "#A1A1AA",
  focusBorder: "#FFFFFF33",
  "list.hoverBackground": "#FFFFFF0F",
  "list.activeSelectionBackground": "#FFFFFF1F",
  "list.highlightForeground": "#FFFFFF",
  "editorBracketHighlight.foreground1": "#9A9AA3",
  "editorBracketHighlight.foreground2": "#9A9AA3",
  "editorBracketHighlight.foreground3": "#9A9AA3",
  "editorBracketHighlight.foreground4": "#9A9AA3",
  "editorBracketHighlight.foreground5": "#9A9AA3",
  "editorBracketHighlight.foreground6": "#9A9AA3",
  "editorBracketHighlight.unexpectedBracket.foreground": "#F2555A",
  "input.background": "#0D0D0F",
  "input.border": "#FFFFFF1A",
  "widget.shadow": "#00000080",
};

const LIGHT_CHROME: monaco.editor.IColors = {
  "editor.background": "#FFFFFF",
  "editorGutter.background": "#FFFFFF",
  "minimap.background": "#FFFFFF",
  "editorStickyScroll.background": "#FFFFFF",
  "editorStickyScrollHover.background": "#F4F4F5",
  "editorLineNumber.foreground": "#C4C4CA",
  "editorLineNumber.activeForeground": "#18181B",
  "editor.lineHighlightBackground": "#0000000A",
  "editor.lineHighlightBorder": "#00000000",
  "editorCursor.foreground": "#0A0A0B",
  "editorIndentGuide.background1": "#0000000F",
  "editorIndentGuide.activeBackground1": "#00000029",
  "editorWidget.background": "#FFFFFF",
  "editorWidget.border": "#00000014",
  "editorSuggestWidget.background": "#FFFFFF",
  "editorSuggestWidget.border": "#00000014",
  "editorSuggestWidget.selectedBackground": "#0000000F",
  "editorSuggestWidget.selectedForeground": "#0A0A0B",
  "editorSuggestWidget.highlightForeground": "#000000",
  "editorHoverWidget.background": "#FFFFFF",
  "editorHoverWidget.border": "#00000014",
  "editorBracketMatch.background": "#0000000F",
  "editorBracketMatch.border": "#00000033",
  "editor.findMatchBackground": "#00000033",
  "editor.findMatchHighlightBackground": "#00000014",
  "editor.wordHighlightBackground": "#0000000D",
  "scrollbarSlider.background": "#00000014",
  "scrollbarSlider.hoverBackground": "#00000024",
  "scrollbarSlider.activeBackground": "#00000033",
  "editorOverviewRuler.border": "#00000000",
  "editorError.foreground": "#D4343A",
  "editorWarning.foreground": "#A87708",
  focusBorder: "#00000033",
  "list.hoverBackground": "#0000000A",
  "list.activeSelectionBackground": "#0000000F",
  "editorBracketHighlight.foreground1": "#71717A",
  "editorBracketHighlight.foreground2": "#71717A",
  "editorBracketHighlight.foreground3": "#71717A",
  "editorBracketHighlight.foreground4": "#71717A",
  "editorBracketHighlight.foreground5": "#71717A",
  "editorBracketHighlight.foreground6": "#71717A",
  "editorBracketHighlight.unexpectedBracket.foreground": "#D4343A",
  "widget.shadow": "#0000001F",
};

function defineThemes() {
  monaco.editor.defineTheme("xwincode-mono-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "C9C9CE" },
      { token: "keyword", foreground: "FFFFFF", fontStyle: "bold" },
      { token: "keyword.directive", foreground: "8F8F98" },
      { token: "attribute", foreground: "8F8F98" },
      { token: "comment", foreground: "55555D", fontStyle: "italic" },
      { token: "comment.doc", foreground: "6B6B74", fontStyle: "italic" },
      { token: "string", foreground: "A3A3AC" },
      { token: "string.escape", foreground: "D4D4D8", fontStyle: "bold" },
      { token: "string.interpolation", foreground: "E4E4E7" },
      { token: "number", foreground: "E4E4E7" },
      { token: "type", foreground: "EDEDF0" },
      { token: "type.declaration", foreground: "FFFFFF", fontStyle: "bold" },
      { token: "function.declaration", foreground: "FFFFFF", fontStyle: "bold" },
      { token: "function.call", foreground: "E4E4E7" },
      { token: "member", foreground: "B4B4BC" },
      { token: "identifier", foreground: "C9C9CE" },
      { token: "operator", foreground: "8A8A93" },
      { token: "delimiter", foreground: "75757E" },
      { token: "delimiter.bracket", foreground: "9A9AA3" },
    ],
    colors: {
      ...DARK_CHROME,
      "editor.foreground": "#C9C9CE",
      "editor.selectionBackground": "#FFFFFF2B",
      "editor.inactiveSelectionBackground": "#FFFFFF14",
      "editor.selectionHighlightBackground": "#FFFFFF12",
    },
  });

  monaco.editor.defineTheme("xwincode-mono-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "3F3F46" },
      { token: "keyword", foreground: "000000", fontStyle: "bold" },
      { token: "keyword.directive", foreground: "71717A" },
      { token: "attribute", foreground: "71717A" },
      { token: "comment", foreground: "A1A1AA", fontStyle: "italic" },
      { token: "comment.doc", foreground: "8B8B94", fontStyle: "italic" },
      { token: "string", foreground: "71717A" },
      { token: "string.escape", foreground: "3F3F46", fontStyle: "bold" },
      { token: "string.interpolation", foreground: "27272A" },
      { token: "number", foreground: "18181B" },
      { token: "type", foreground: "18181B" },
      { token: "type.declaration", foreground: "000000", fontStyle: "bold" },
      { token: "function.declaration", foreground: "000000", fontStyle: "bold" },
      { token: "function.call", foreground: "27272A" },
      { token: "member", foreground: "52525B" },
      { token: "identifier", foreground: "3F3F46" },
      { token: "operator", foreground: "71717A" },
      { token: "delimiter", foreground: "8B8B94" },
      { token: "delimiter.bracket", foreground: "71717A" },
    ],
    colors: {
      ...LIGHT_CHROME,
      "editor.foreground": "#3F3F46",
      "editor.selectionBackground": "#0000001F",
      "editor.inactiveSelectionBackground": "#00000012",
    },
  });

  monaco.editor.defineTheme("xwincode-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "DFDFE0" },
      { token: "keyword", foreground: "FF7AB2", fontStyle: "bold" },
      { token: "keyword.directive", foreground: "FFA14F" },
      { token: "attribute", foreground: "FD8F3F" },
      { token: "comment", foreground: "7F8C98" },
      { token: "comment.doc", foreground: "7F8C98", fontStyle: "italic" },
      { token: "string", foreground: "FF8170" },
      { token: "string.escape", foreground: "FF8170", fontStyle: "bold" },
      { token: "string.interpolation", foreground: "DFDFE0" },
      { token: "number", foreground: "D9C97C" },
      { token: "type", foreground: "DABAFF" },
      { token: "type.declaration", foreground: "5DD8FF" },
      { token: "function.declaration", foreground: "41A1C0" },
      { token: "function.call", foreground: "B281EB" },
      { token: "member", foreground: "A167E6" },
      { token: "identifier", foreground: "DFDFE0" },
      { token: "operator", foreground: "DFDFE0" },
      { token: "delimiter", foreground: "DFDFE0" },
      { token: "delimiter.bracket", foreground: "DFDFE0" },
    ],
    colors: {
      ...DARK_CHROME,
      "editor.foreground": "#DFDFE0",
      "editor.selectionBackground": "#515B70",
      "editor.inactiveSelectionBackground": "#3A404D",
    },
  });

  monaco.editor.defineTheme("xwincode-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: "1F1F24" },
      { token: "keyword", foreground: "9B2393", fontStyle: "bold" },
      { token: "keyword.directive", foreground: "643820" },
      { token: "attribute", foreground: "815F03" },
      { token: "comment", foreground: "5D6C79" },
      { token: "comment.doc", foreground: "5D6C79", fontStyle: "italic" },
      { token: "string", foreground: "C41A16" },
      { token: "string.interpolation", foreground: "1F1F24" },
      { token: "number", foreground: "1C00CF" },
      { token: "type", foreground: "3900A0" },
      { token: "type.declaration", foreground: "0B4F79" },
      { token: "function.declaration", foreground: "0F68A0" },
      { token: "function.call", foreground: "6C36A9" },
      { token: "member", foreground: "6C36A9" },
    ],
    colors: {
      ...LIGHT_CHROME,
      "editor.foreground": "#1F1F24",
      "editor.lineHighlightBackground": "#ECF5FF",
      "editor.selectionBackground": "#B4D8FD",
    },
  });
}

let ready = false;
export function setupMonaco() {
  if (ready) return monaco;
  ready = true;
  registerSwift();
  defineThemes();
  return monaco;
}

export { monaco };
