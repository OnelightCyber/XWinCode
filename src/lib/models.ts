import { monaco } from "./monaco";
import { languageFor } from "./paths";

interface Doc {
  path: string;
  model: monaco.editor.ITextModel;
  savedVersion: number;
  viewState: monaco.editor.ICodeEditorViewState | null;
}

const docs = new Map<string, Doc>();
const key = (p: string) => p.toLowerCase();

let modelOptions: monaco.editor.ITextModelUpdateOptions = {
  insertSpaces: true,
  tabSize: 4,
  bracketColorizationOptions: { enabled: false, independentColorPoolPerBracketType: false },
};

export function setModelOptions(patch: monaco.editor.ITextModelUpdateOptions) {
  modelOptions = { ...modelOptions, ...patch };
  for (const d of docs.values()) d.model.updateOptions(modelOptions);
}

export function getDoc(path: string): Doc | undefined {
  return docs.get(key(path));
}

export function createDoc(path: string, content: string): Doc {
  const existing = getDoc(path);
  if (existing) return existing;
  const uri = monaco.Uri.file(path);
  const model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, languageFor(path), uri);
  model.updateOptions(modelOptions);
  const doc: Doc = { path, model, savedVersion: model.getAlternativeVersionId(), viewState: null };
  docs.set(key(path), doc);
  return doc;
}

export function isDirty(path: string): boolean {
  const d = getDoc(path);
  return !!d && d.model.getAlternativeVersionId() !== d.savedVersion;
}

export function markSaved(path: string) {
  const d = getDoc(path);
  if (d) d.savedVersion = d.model.getAlternativeVersionId();
}

export function disposeDoc(path: string) {
  const d = getDoc(path);
  if (!d) return;
  d.model.dispose();
  docs.delete(key(path));
}

export function disposeAll() {
  for (const d of docs.values()) d.model.dispose();
  docs.clear();
}

export function allDocs(): Doc[] {
  return [...docs.values()];
}

export function reloadDoc(path: string, content: string) {
  const d = getDoc(path);
  if (!d || d.model.getValue() === content) return;
  d.model.setValue(content);
  d.savedVersion = d.model.getAlternativeVersionId();
}
