import { Download } from "lucide-react";
import logo from "../assets/logo.svg";
import { t } from "../i18n";
import { useAppVersion } from "../lib/format";
import { useStore } from "../lib/store";

function Notes({ text }: { text: string }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return <p className="faint">{t("upd.noNotes")}</p>;
  return (
    <div className="update-notes">
      {lines.map((line, i) => {
        const heading = /^#+\s*(.*)$/.exec(line);
        if (heading) return <h4 key={i}>{heading[1]}</h4>;
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet) return <li key={i}>{bullet[1]}</li>;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export function UpdateSheet() {
  const update = useStore((s) => s.update);
  const state = useStore((s) => s.updateState);
  const progress = useStore((s) => s.updateProgress);
  const error = useStore((s) => s.updateError);
  const version = useAppVersion();
  const { openSheet, installUpdate } = useStore.getState();
  const busy = state === "downloading";
  const close = () => !busy && openSheet(null);

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet update-sheet">
        <div className="update-hero">
          <img src={logo} alt="" draggable={false} />
          <div>
            <h2>{t("upd.title")}</h2>
            <p>{update ? t("upd.versions", { next: update.version, current: version }) : t("update.upToDate")}</p>
          </div>
        </div>
        <div className="sheet-body">
          <h3 className="update-section">{t("upd.notes")}</h3>
          <Notes text={update?.notes ?? ""} />
          {busy && (
            <div className="update-progress-wrap">
              <div className="update-progress">
                <span style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} className={progress === null ? "indeterminate" : undefined} />
              </div>
              <div className="faint">{progress !== null && progress >= 1 ? t("upd.installing") : t("upd.downloading", { percent: Math.round((progress ?? 0) * 100) })}</div>
            </div>
          )}
          {state === "error" && error && <div className="form-error">{error}</div>}
        </div>
        <div className="sheet-foot">
          <span className="faint" style={{ fontSize: 11.5 }}>
            {t("upd.saveFirst")}
          </span>
          <span className="grow" />
          <button className="btn" disabled={busy} onClick={close}>
            {t("common.later")}
          </button>
          <button className="btn primary" disabled={busy || !update} onClick={() => void installUpdate()}>
            <Download size={14} /> {t("upd.install")}
          </button>
        </div>
      </div>
    </div>
  );
}
