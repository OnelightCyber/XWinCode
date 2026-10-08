import { useEffect, useState } from "react";
import { MousePointer2 } from "lucide-react";
import { t } from "../../i18n";
import { getDoc } from "../../lib/models";
import { monaco } from "../../lib/monaco";
import { argOf, parseChain, setModifier, textLiteral } from "../../lib/preview/edit";
import { selectView, useViewSelection, type ViewSelection } from "../../lib/preview/selection";
import { useStore } from "../../lib/store";
import { Select } from "../Controls";

const STYLES = ["largeTitle", "title", "title2", "title3", "headline", "subheadline", "body", "callout", "footnote", "caption", "caption2"];
const WEIGHTS = ["ultraLight", "thin", "light", "regular", "medium", "semibold", "bold", "heavy", "black"];
const COLORS = ["primary", "secondary", "accentColor", "red", "orange", "yellow", "green", "mint", "teal", "cyan", "blue", "indigo", "purple", "pink", "brown", "gray", "white", "black"];

function member(arg: string | null): string | null {
  if (arg === null) return null;
  const m = /^\s*(?:Color)?\.(\w+)\s*$/.exec(arg);
  return m ? m[1] : "custom";
}

function numberIn(arg: string | null, label?: string): string {
  if (!arg) return "";
  const m = label ? new RegExp(`${label}\\s*:\\s*(-?[\\d.]+)`).exec(arg) : /^\s*(-?[\d.]+)\s*$/.exec(arg);
  return m ? m[1] : "";
}

function apply(sel: ViewSelection, names: string[], call: string | null) {
  const doc = getDoc(sel.path);
  if (!doc) return;
  const full = doc.model.getValue();
  const edit = setModifier(full, sel.a, sel.b, names, call);
  if (!edit) return;
  replace(sel, edit.start, edit.end, edit.text);
}

function replace(sel: ViewSelection, start: number, end: number, text: string) {
  const doc = getDoc(sel.path);
  if (!doc) return;
  const m = doc.model;
  const s = m.getPositionAt(start);
  const e = m.getPositionAt(end);
  m.pushEditOperations([], [{ range: new monaco.Range(s.lineNumber, s.column, e.lineNumber, e.column), text }], () => null);
  selectView({ ...sel, b: sel.b + text.length - (end - start) });
}

function Choice({ value, options, onChange }: { value: string | null; options: string[]; onChange: (v: string | null) => void }) {
  const opts = [{ value: "__none", label: t("insp.none") }, ...options.map((o) => ({ value: o, label: o }))];
  if (value === "custom") opts.push({ value: "custom", label: t("insp.custom") });
  return <Select width={150} value={value ?? "__none"} options={opts} onChange={(v) => v !== "custom" && onChange(v === "__none" ? null : v)} />;
}

function NumberField({ value, placeholder, onCommit }: { value: string; placeholder?: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="field insp-num">
      <input
        value={draft}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.\-]/g, ""))}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      />
    </div>
  );
}

export function ViewInspector() {
  const sel = useViewSelection((s) => s.sel);
  useStore((s) => s.dirtyTick);
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!sel) return;
    const doc = getDoc(sel.path);
    const sub = doc?.model.onDidChangeContent(() => refresh((n) => n + 1));
    return () => sub?.dispose();
  }, [sel?.path]);
  if (!sel) return null;
  const doc = getDoc(sel.path);
  if (!doc) return null;
  const full = doc.model.getValue();
  if (sel.b > full.length) return null;
  const chain = parseChain(full.slice(sel.a, sel.b));
  const literal = textLiteral(chain);
  const font = member(argOf(chain, ["font"]));
  const weight = member(argOf(chain, ["fontWeight"]));
  const color = member(argOf(chain, ["foregroundStyle", "foregroundColor"]));
  const background = member(argOf(chain, ["background"]));
  const padArg = argOf(chain, ["padding"]);
  const frameArg = argOf(chain, ["frame"]);
  const radiusArg = argOf(chain, ["clipShape", "cornerRadius"]);
  const opacityArg = argOf(chain, ["opacity"]);
  const radius = radiusArg === null ? "" : numberIn(radiusArg, "cornerRadius") || numberIn(radiusArg);
  const opacity = opacityArg === null ? 1 : Number(numberIn(opacityArg) || 1);

  const setFrame = (label: "width" | "height", v: string) => {
    const other = label === "width" ? "height" : "width";
    const otherValue = numberIn(frameArg, other);
    if (frameArg !== null && /maxWidth|maxHeight|minWidth|minHeight|alignment/.test(frameArg)) {
      const re = new RegExp(`${label}\\s*:\\s*-?[\\d.]+`);
      let args = re.test(frameArg) ? frameArg.replace(re, v ? `${label}: ${v}` : "") : v ? `${label}: ${v}, ${frameArg}` : frameArg;
      args = args.replace(/,\s*,/g, ",").replace(/^\s*,\s*|\s*,\s*$/g, "");
      apply(sel, ["frame"], `frame(${args})`);
      return;
    }
    const parts = [label === "width" ? v : otherValue, label === "height" ? v : otherValue];
    const args = [parts[0] ? `width: ${parts[0]}` : "", parts[1] ? `height: ${parts[1]}` : ""].filter(Boolean).join(", ");
    apply(sel, ["frame"], args ? `frame(${args})` : null);
  };

  return (
    <div className="insp-section view-insp">
      <h4>
        <MousePointer2 size={11} /> {sel.type}
      </h4>
      <dl className="kv">
        {literal && (
          <>
            <dt>{t("insp.text")}</dt>
            <dd>
              <div className="field">
                <input
                  defaultValue={literal.value}
                  key={`${sel.id}:${literal.value}`}
                  onBlur={(e) => e.target.value !== literal.value && replace(sel, sel.a + literal.start, sel.a + literal.end, e.target.value.replace(/\\/g, "\\\\").replace(/"/g, '\\"'))}
                  onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
                />
              </div>
            </dd>
          </>
        )}
        <dt>{t("insp.font")}</dt>
        <dd>
          <Choice value={font} options={STYLES} onChange={(v) => apply(sel, ["font"], v ? `font(.${v})` : null)} />
        </dd>
        <dt>{t("insp.weight")}</dt>
        <dd>
          <Choice value={weight} options={WEIGHTS} onChange={(v) => apply(sel, ["fontWeight"], v ? `fontWeight(.${v})` : null)} />
        </dd>
        <dt>{t("insp.color")}</dt>
        <dd>
          <Choice value={color} options={COLORS} onChange={(v) => apply(sel, ["foregroundStyle", "foregroundColor"], v ? `foregroundStyle(${v === "accentColor" ? ".tint" : `.${v}`})` : null)} />
        </dd>
        <dt>{t("insp.background")}</dt>
        <dd>
          <Choice value={background} options={COLORS} onChange={(v) => apply(sel, ["background"], v ? `background(${v === "accentColor" ? ".tint" : `.${v}`})` : null)} />
        </dd>
        <dt>{t("insp.padding")}</dt>
        <dd>
          <NumberField value={padArg === null ? "" : padArg.trim() === "" ? "16" : numberIn(padArg)} placeholder={t("insp.none")} onCommit={(v) => apply(sel, ["padding"], v ? `padding(${v})` : null)} />
        </dd>
        <dt>{t("insp.frame")}</dt>
        <dd className="insp-pair">
          <NumberField value={numberIn(frameArg, "width")} placeholder="W" onCommit={(v) => setFrame("width", v)} />
          <NumberField value={numberIn(frameArg, "height")} placeholder="H" onCommit={(v) => setFrame("height", v)} />
        </dd>
        <dt>{t("insp.corners")}</dt>
        <dd>
          <NumberField value={radius} placeholder={t("insp.none")} onCommit={(v) => apply(sel, ["clipShape", "cornerRadius"], v ? `clipShape(.rect(cornerRadius: ${v}))` : null)} />
        </dd>
        <dt>{t("insp.opacity")}</dt>
        <dd className="insp-pair">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            defaultValue={opacity}
            key={`${sel.id}:${opacity}`}
            onPointerUp={(e) => {
              const v = Number((e.target as HTMLInputElement).value);
              apply(sel, ["opacity"], v >= 1 ? null : `opacity(${v})`);
            }}
          />
          <span className="muted">{Math.round(opacity * 100)} %</span>
        </dd>
      </dl>
      <p className="faint insp-hint">{t("insp.viewHint")}</p>
    </div>
  );
}
