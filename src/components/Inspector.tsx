import { useState, type ReactNode } from "react";
import { CircleHelp, ExternalLink, FileText, Settings2 } from "lucide-react";
import { keys, t, tn, type TKey } from "../i18n";
import { getDoc } from "../lib/models";
import { basename, dirname, extname, relative } from "../lib/paths";
import { destinationLabel, useStore } from "../lib/store";
import { kindLabel } from "./AppGlyph";
import { revealInExplorer } from "./Welcome";

function fileType(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "package.swift") return t("insp.type.manifest");
  if (name === "xtool.yml") return t("insp.type.xtool");
  switch (extname(path)) {
    case "swift":
      return t("insp.type.swift");
    case "json":
      return "JSON";
    case "md":
      return "Markdown";
    case "plist":
      return t("insp.type.plist");
    case "yml":
    case "yaml":
      return "YAML";
    default:
      return extname(path) ? t("insp.type.ext", { ext: extname(path) }) : t("insp.type.file");
  }
}

function rich(key: TKey, codes: Record<string, string>): ReactNode[] {
  return t(key)
    .split(/(\{\w+\})/)
    .map((part, i) => {
      const m = /^\{(\w+)\}$/.exec(part);
      return m && codes[m[1]] !== undefined ? <code key={i}>{codes[m[1]]}</code> : part;
    });
}

function FileInspector() {
  const project = useStore((s) => s.project);
  const active = useStore((s) => s.active);
  const cursor = useStore((s) => s.cursor);
  const destination = useStore((s) => s.destination);
  const configuration = useStore((s) => s.configuration);
  const openSheet = useStore((s) => s.openSheet);
  useStore((s) => s.dirtyTick);
  const doc = active ? getDoc(active) : undefined;
  const modelOptions = doc?.model.getOptions();

  return (
    <>
      {active && project && (
        <div className="insp-section">
          <h4>{t("insp.identity")}</h4>
          <dl className="kv">
            <dt>{t("insp.name")}</dt>
            <dd>{basename(active)}</dd>
            <dt>{t("insp.type")}</dt>
            <dd>{fileType(active)}</dd>
            <dt>{t("insp.location")}</dt>
            <dd className="muted">{dirname(relative(project.root, active)) || t("insp.projectRoot")}</dd>
            <dt>{t("insp.fullPath")}</dt>
            <dd>
              <span className="muted" style={{ fontSize: 11 }}>
                {active}
              </span>{" "}
              <button className="btn ghost small" style={{ padding: "0 4px", height: 18 }} onClick={() => void revealInExplorer(active)}>
                <ExternalLink size={11} /> {t("insp.show")}
              </button>
            </dd>
          </dl>
        </div>
      )}
      {doc && (
        <div className="insp-section">
          <h4>{t("insp.textSettings")}</h4>
          <dl className="kv">
            <dt>{t("insp.encoding")}</dt>
            <dd>UTF-8</dd>
            <dt>{t("insp.lineEndings")}</dt>
            <dd>{doc.model.getEOL() === "\r\n" ? "Windows (CRLF)" : "Unix (LF)"}</dd>
            <dt>{t("insp.indentation")}</dt>
            <dd>{modelOptions?.insertSpaces === false ? t("insp.tabs", { count: modelOptions.tabSize }) : tn("insp.spaces", modelOptions?.tabSize ?? 4)}</dd>
            <dt>{t("insp.lines")}</dt>
            <dd>{doc.model.getLineCount()}</dd>
            <dt>{t("insp.cursor")}</dt>
            <dd>
              {t("insp.cursorPos", { line: cursor.line, column: cursor.column })}
              {cursor.selection > 0 && <span className="muted"> {t("insp.selected", { count: cursor.selection })}</span>}
            </dd>
          </dl>
        </div>
      )}
      {project && (
        <div className="insp-section">
          <h4>{t("insp.project")}</h4>
          <dl className="kv">
            <dt>{t("insp.name")}</dt>
            <dd>{project.name}</dd>
            <dt>{t("insp.type")}</dt>
            <dd>{kindLabel(project.kind)}</dd>
            {project.bundleId && (
              <>
                <dt>Bundle ID</dt>
                <dd className="mono" style={{ fontSize: 11.5 }}>
                  {project.bundleId}
                </dd>
              </>
            )}
            <dt>{t("insp.destination")}</dt>
            <dd>{destinationLabel(destination)}</dd>
            <dt>{t("scheme.configuration")}</dt>
            <dd>{configuration === "debug" ? "Debug" : "Release"}</dd>
            <dt>{t("insp.toolchain")}</dt>
            <dd className="muted">{project.kind === "iosApp" ? t("insp.toolchainIos") : "swift.exe (Windows, MSVC)"}</dd>
          </dl>
          {project.kind === "iosApp" && (
            <button className="btn small insp-action" onClick={() => openSheet("project")}>
              <Settings2 size={13} /> {t("cmd.projectSettings")}
            </button>
          )}
        </div>
      )}
      {!project && <div className="empty-hint">{t("jump.noSelection")}</div>}
    </>
  );
}

function QuickHelp() {
  const project = useStore((s) => s.project);
  return (
    <div className="insp-section help-card">
      <h4>{t("insp.helpTab")}</h4>
      {project?.kind === "iosApp" ? (
        <>
          <p>{rich("help.ios1", { xtool: "xtool", xip: "Xcode.xip" })}</p>
          <p>{rich("help.ios2", { run: keys("Ctrl+R"), archive: t("help.archivePath"), archiveKeys: keys("Ctrl+Shift+A"), ipa: ".ipa" })}</p>
          <p>{t("help.ios3")}</p>
        </>
      ) : (
        <>
          <p>{rich("help.win1", { build: "swift build", run: "swift run", test: "swift test" })}</p>
          <p>{rich("help.win2", { run: keys("Ctrl+R") })}</p>
        </>
      )}
      <p className="faint">{rich("help.shortcuts", { build: keys("Ctrl+B"), test: keys("Ctrl+U"), clean: keys("Ctrl+Shift+K"), open: keys("Ctrl+P") })}</p>
    </div>
  );
}

export function Inspector({ width }: { width: number }) {
  const [tab, setTab] = useState<"file" | "help">("file");
  return (
    <aside className="inspector glass" style={{ width }}>
      <div className="nav-tabs">
        <button className={`icon-btn${tab === "file" ? " on" : ""}`} title={t("insp.fileTab")} onClick={() => setTab("file")}>
          <FileText size={16} />
        </button>
        <button className={`icon-btn${tab === "help" ? " on" : ""}`} title={t("insp.helpTab")} onClick={() => setTab("help")}>
          <CircleHelp size={16} />
        </button>
      </div>
      <div className="insp-body">{tab === "file" ? <FileInspector /> : <QuickHelp />}</div>
    </aside>
  );
}
