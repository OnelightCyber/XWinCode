import { useEffect, useState } from "react";
import { ImagePlus, Smartphone } from "lucide-react";
import { t, type TKey } from "../i18n";
import { pickFile } from "../lib/dialogs";
import { api, errorMessage, isTauri } from "../lib/ipc";
import { getDoc, reloadDoc } from "../lib/models";
import { join } from "../lib/paths";
import { useStore } from "../lib/store";
import type { ProjectConfig } from "../lib/types";
import { Switch } from "./Controls";

const PERMISSIONS: { key: string; label: TKey }[] = [
  { key: "NSCameraUsageDescription", label: "perm.camera" },
  { key: "NSMicrophoneUsageDescription", label: "perm.microphone" },
  { key: "NSPhotoLibraryUsageDescription", label: "perm.photos" },
  { key: "NSPhotoLibraryAddUsageDescription", label: "perm.photosAdd" },
  { key: "NSLocationWhenInUseUsageDescription", label: "perm.location" },
  { key: "NSLocationAlwaysAndWhenInUseUsageDescription", label: "perm.locationAlways" },
  { key: "NSContactsUsageDescription", label: "perm.contacts" },
  { key: "NSCalendarsFullAccessUsageDescription", label: "perm.calendars" },
  { key: "NSRemindersFullAccessUsageDescription", label: "perm.reminders" },
  { key: "NSBluetoothAlwaysUsageDescription", label: "perm.bluetooth" },
  { key: "NSMotionUsageDescription", label: "perm.motion" },
  { key: "NSFaceIDUsageDescription", label: "perm.faceId" },
  { key: "NSHealthShareUsageDescription", label: "perm.healthRead" },
  { key: "NSHealthUpdateUsageDescription", label: "perm.healthWrite" },
  { key: "NSLocalNetworkUsageDescription", label: "perm.localNetwork" },
  { key: "NSSpeechRecognitionUsageDescription", label: "perm.speech" },
  { key: "NSUserTrackingUsageDescription", label: "perm.tracking" },
];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t("err.imageInvalid")));
    img.src = src;
  });
}

async function toIconPng(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl);
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}

export function ProjectSettingsSheet() {
  const project = useStore((s) => s.project)!;
  const { openSheet, toast } = useStore.getState();
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dropping, setDropping] = useState(false);
  const close = () => openSheet(null);

  useEffect(() => {
    void api
      .readProjectConfig(project.root)
      .then(setConfig)
      .catch((e) => setError(errorMessage(e)));
  }, [project.root]);

  const applyImage = async (path: string) => {
    try {
      const png = await toIconPng(await api.readImageDataUrl(path));
      const icon = await api.setProjectIcon(project.root, png);
      setConfig((c) => (c ? { ...c, icon } : c));
      toast("success", t("ps.icon.saved"));
      void useStore.getState().refreshTree();
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/webview").then(async ({ getCurrentWebview }) => {
      unlisten = await getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") setDropping(true);
        else if (e.payload.type === "leave") setDropping(false);
        else if (e.payload.type === "drop") {
          setDropping(false);
          const path = e.payload.paths.find((p) => /\.(png|jpe?g|webp|gif|bmp)$/i.test(p));
          if (path) void applyImage(path);
        }
      });
    });
    return () => unlisten?.();
  }, []);

  const chooseImage = async () => {
    const path = await pickFile(t("ps.icon.dialog"), ["png", "jpg", "jpeg", "webp", "gif", "bmp"], t("ps.icon.images"));
    if (path) await applyImage(path);
  };

  const patch = (p: Partial<ProjectConfig>) => setConfig((c) => (c ? { ...c, ...p } : c));
  const setPermission = (key: string, value: string | null) =>
    setConfig((c) => {
      if (!c) return c;
      const permissions = { ...c.permissions };
      if (value === null) delete permissions[key];
      else permissions[key] = value;
      return { ...c, permissions };
    });

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      await api.writeProjectConfig(project.root, config);
      for (const name of ["xtool.yml", "Info.plist"]) {
        const path = join(project.root, name);
        if (getDoc(path)) reloadDoc(path, await api.readTextFile(path));
      }
      useStore.setState({ project: { ...project, bundleId: config.bundleId } });
      void useStore.getState().refreshTree();
      toast("success", t("ps.saved"));
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const extra = config ? Object.keys(config.permissions).filter((k) => !PERMISSIONS.some((p) => p.key === k)) : [];
  const appName = config?.displayName || project.name;

  return (
    <div className="scrim center" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`sheet project-sheet${dropping ? " dropping" : ""}`}>
        <div className="ps-hero">
          <button className="ps-icon" title={t("ps.icon.choose")} onClick={() => void chooseImage()}>
            {config?.icon ? <img src={config.icon} alt="" draggable={false} /> : <Smartphone size={34} strokeWidth={1.4} />}
            <span className="ps-icon-edit">
              <ImagePlus size={14} />
            </span>
          </button>
          <div style={{ minWidth: 0 }}>
            <h2>{t("ps.title")}</h2>
            <div className="ps-sub ellipsis">
              {appName} · <span className="mono">{config?.bundleId ?? project.bundleId ?? ""}</span>
            </div>
          </div>
        </div>
        <div className="sheet-body">
          {!config && !error && (
            <div className="set-loading">
              <span className="spinner" /> {t("ps.loading")}
            </div>
          )}
          {config && (
            <>
              <div className="set-group">
                <h3>{t("ps.identity")}</h3>
                <div className="set-card">
                  <div className="set-row">
                    <div className="set-label">
                      <div className="l">{t("ps.displayName")}</div>
                      <div className="h">{t("ps.displayName.hint")}</div>
                    </div>
                    <input className="input" style={{ width: 240 }} placeholder={project.name} value={config.displayName} onChange={(e) => patch({ displayName: e.target.value })} />
                  </div>
                  <div className="set-row">
                    <div className="set-label">
                      <div className="l">{t("np.bundleId")}</div>
                      <div className="h">{t("ps.bundleId.hint")}</div>
                    </div>
                    <input className="input mono" style={{ width: 240, fontSize: 12 }} value={config.bundleId} onChange={(e) => patch({ bundleId: e.target.value.trim() })} />
                  </div>
                  <div className="set-row">
                    <div className="set-label">
                      <div className="l">{t("ps.versionBuild")}</div>
                      <div className="h">{t("ps.version.hint")}</div>
                    </div>
                    <div className="row">
                      <input className="input" style={{ width: 96 }} value={config.version} onChange={(e) => patch({ version: e.target.value.trim() })} />
                      <input className="input" style={{ width: 72 }} value={config.build} onChange={(e) => patch({ build: e.target.value.trim() })} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="set-group">
                <h3>{t("ps.icon")}</h3>
                <div className="set-card">
                  <div className="set-row">
                    <div className="set-label">
                      <div className="l">{config.icon ? t("ps.icon.current") : t("ps.icon.none")}</div>
                      <div className="h">{t("ps.icon.hint")}</div>
                    </div>
                    <button className="btn small" onClick={() => void chooseImage()}>
                      <ImagePlus size={13} /> {t("ps.icon.choose")}
                    </button>
                  </div>
                </div>
              </div>
              <div className="set-group">
                <h3>{t("ps.permissions")}</h3>
                <div className="set-card">
                  {PERMISSIONS.map((p) => {
                    const value = config.permissions[p.key];
                    const on = value !== undefined;
                    return (
                      <div key={p.key} className={`set-row perm-row${on ? " on" : ""}`}>
                        <Switch on={on} onChange={(v) => setPermission(p.key, v ? t("ps.perm.default", { app: appName }) : null)} />
                        <div className="set-label">
                          <div className="l">{t(p.label)}</div>
                          {on ? (
                            <input className="input perm-text" value={value} onChange={(e) => setPermission(p.key, e.target.value)} />
                          ) : (
                            <div className="h mono">{p.key}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {extra.map((key) => (
                    <div key={key} className="set-row perm-row on">
                      <Switch on onChange={() => setPermission(key, null)} />
                      <div className="set-label">
                        <div className="l mono">{key}</div>
                        <input className="input perm-text" value={config.permissions[key]} onChange={(e) => setPermission(key, e.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="set-foot">{t("ps.permissions.hint")}</div>
              </div>
            </>
          )}
          {error && <div className="form-error">{error}</div>}
        </div>
        <div className="sheet-foot">
          <button className="btn" onClick={close}>
            {t("common.cancel")}
          </button>
          <span className="grow" />
          <button className="btn primary" disabled={!config || saving} onClick={() => void save()}>
            {t("common.save")}
          </button>
        </div>
        {dropping && <div className="drop-overlay">{t("ps.dropHere")}</div>}
      </div>
    </div>
  );
}
