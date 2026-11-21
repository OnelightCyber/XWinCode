import { useEffect, useState } from "react";
import { locale, t } from "../i18n";
import { api } from "../lib/ipc";

function byteSize(bytes: number): string {
  const unit = bytes >= 1024 * 1024 ? "megabyte" : bytes >= 1024 ? "kilobyte" : "byte";
  const value = unit === "megabyte" ? bytes / (1024 * 1024) : unit === "kilobyte" ? bytes / 1024 : bytes;
  return new Intl.NumberFormat(locale(), { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: 1 }).format(value);
}

export function ImageView({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [actual, setActual] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    setSize(null);
    api
      .readImageDataUrl(path)
      .then((data) => {
        if (!cancelled) setUrl(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const comma = url ? url.indexOf(",") : -1;
  const bytes = url && comma >= 0 ? (url.slice(0, comma).endsWith(";base64") ? Math.floor(((url.length - comma - 1) * 3) / 4) : url.length - comma - 1) : 0;

  return (
    <div className="image-view">
      <div className={`image-stage${actual ? " actual" : ""}`}>
        {url && !failed && <img src={url} alt="" draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} />}
        {failed && <div className="empty-hint">{t("image.failed")}</div>}
      </div>
      <div className="image-foot">
        <span className="faint">{size ? t("image.info", { width: size.w, height: size.h, size: byteSize(bytes) }) : ""}</span>
        <span className="grow" />
        <button className="btn small" disabled={!size} onClick={() => setActual(!actual)}>
          {actual ? t("image.fit") : t("image.actual")}
        </button>
      </div>
    </div>
  );
}
