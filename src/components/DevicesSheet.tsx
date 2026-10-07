import { useCallback, useEffect, useState } from "react";
import { Cable, Copy, Download, Play, RefreshCw, RotateCcw, Smartphone, Trash2, Wifi } from "lucide-react";
import { t } from "../i18n";
import { confirmAsk, pickFile } from "../lib/dialogs";
import { relativeTime } from "../lib/format";
import { api, errorMessage } from "../lib/ipc";
import { useStore } from "../lib/store";
import type { Device, DeviceApp, InstallRecord } from "../lib/types";
import { Seg } from "./Controls";
import { installIphoneTools } from "./DeviceConsole";

const MISSING_TOOLS = "XWC_MISSING_TOOLS";
const SIDELOADED = /Apple Development|iPhone Developer/i;

type AppsState = { kind: "loading" } | { kind: "ready"; apps: DeviceApp[] } | { kind: "missing"; message: string } | { kind: "error"; message: string };

function ExpiryBadge({ record }: { record: InstallRecord | undefined }) {
  if (!record?.expiresAt) return null;
  const left = Date.parse(record.expiresAt) - Date.now();
  if (left <= 0) return <span className="app-badge bad">{t("dev.expired")}</span>;
  return <span className={`app-badge${left < 2 * 86400000 ? " warn" : ""}`}>{t("dev.expires", { when: relativeTime(record.expiresAt) })}</span>;
}

function AppsSection({ device }: { device: Device }) {
  const installs = useStore((s) => s.installs);
  const { toast, reinstall, refreshInstalls } = useStore.getState();
  const [state, setState] = useState<AppsState>({ kind: "loading" });
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "ready", apps: await api.deviceApps(device.udid) });
    } catch (e) {
      const message = errorMessage(e);
      setState(message.startsWith(MISSING_TOOLS) ? { kind: "missing", message: message.replace(/^XWC_MISSING_TOOLS:\s*/, "") } : { kind: "error", message });
    }
  }, [device.udid]);

  useEffect(() => {
    void load();
  }, [load]);

  const recordFor = (bundleId: string) => installs.find((r) => r.udid === device.udid && r.bundleId === bundleId);

  const act = async (app: DeviceApp, action: "launch" | "uninstall") => {
    if (action === "uninstall" && !(await confirmAsk(t("dev.uninstallConfirm", { app: app.name, device: device.name }), t("dev.uninstall")))) return;
    setBusy(app.bundleId);
    try {
      await api.deviceAppAction(device.udid, app.bundleId, action);
      if (action === "launch") toast("success", t("dev.launched", { app: app.name }));
      else {
        toast("success", t("dev.uninstalled", { app: app.name }));
        await api.forgetInstall(device.udid, app.bundleId).catch(() => undefined);
        await refreshInstalls();
        await load();
      }
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const apps = state.kind === "ready" ? state.apps.filter((a) => scope === "all" || SIDELOADED.test(a.signer ?? "") || recordFor(a.bundleId)) : [];

  return (
    <div className="dev-apps">
      <div className="dev-apps-head">
        <h3>{t("dev.apps")}</h3>
        <Seg
          small
          value={scope}
          options={[
            { value: "mine", label: t("dev.mine") },
            { value: "all", label: t("dev.all") },
          ]}
          onChange={setScope}
        />
        <span className="grow" />
        <button className="icon-btn" title={t("common.refresh")} onClick={() => void load()}>
          <RefreshCw size={13} className={state.kind === "loading" ? "spin" : ""} />
        </button>
      </div>
      <div className="card dev-apps-list">
        {state.kind === "loading" && (
          <div className="set-loading">
            <span className="spinner" /> {t("dev.appsLoading")}
          </div>
        )}
        {state.kind === "missing" && (
          <div className="dev-apps-note">
            <span>{state.message}</span>
            <button className="btn small primary" onClick={installIphoneTools}>
              <Download size={13} /> {t("devlog.installTools")}
            </button>
          </div>
        )}
        {state.kind === "error" && <div className="dev-apps-note bad">{state.message}</div>}
        {state.kind === "ready" && apps.length === 0 && <div className="dev-apps-note">{t("dev.noApps")}</div>}
        {apps.map((app) => {
          const record = recordFor(app.bundleId);
          return (
            <div key={app.bundleId} className="app-row">
              <span className="app-letter">{app.name.slice(0, 1).toUpperCase()}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="app-name">
                  <span className="ellipsis">{app.name}</span>
                  {app.version && <span className="app-version">{app.version}</span>}
                  <ExpiryBadge record={record} />
                </div>
                <div className="app-id ellipsis">{app.bundleId}</div>
              </div>
              <div className="app-actions">
                <button className="btn small" disabled={busy !== null} onClick={() => void act(app, "launch")}>
                  <Play size={11} /> {t("dev.launch")}
                </button>
                {record?.projectRoot && (
                  <button className="btn small" disabled={busy !== null} onClick={() => void reinstall(record)}>
                    <RotateCcw size={12} /> {t("installs.reinstall")}
                  </button>
                )}
                <button className="btn small ghost danger" title={t("dev.uninstall")} disabled={busy !== null} onClick={() => void act(app, "uninstall")}>
                  {busy === app.bundleId ? <span className="spinner" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DevicesSheet() {
  const devices = useStore((s) => s.devices);
  const devicesError = useStore((s) => s.devicesError);
  const connection = useStore((s) => s.settings?.iosConnection ?? "auto");
  const { refreshDevices, openSheet, toast, setDestination, pushLog, setTask, updateSettings } = useStore.getState();
  const [selected, setSelected] = useState<string | null>(null);
  const [wslCheck, setWslCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const close = () => openSheet(null);

  useEffect(() => {
    void refreshDevices();
    const timer = window.setInterval(() => void refreshDevices(), 3000);
    return () => window.clearInterval(timer);
  }, [refreshDevices]);

  const device = devices.find((d) => d.udid === selected) ?? devices[0];

  const install = async () => {
    if (!device) return;
    const path = await pickFile(t("dev.installDialog"), ["ipa", "app"], t("dev.iosApps"));
    if (!path) return;
    try {
      pushLog([{ stream: "system", text: `▸ ${t("task.install", { name: path })}` }]);
      setTask({ id: -1, label: t("action.install"), command: "", action: "install", status: "running", startedAt: Date.now() });
      close();
      const id = await api.installApp(device.udid, path);
      const current = useStore.getState().task;
      if (current && current.id === -1) setTask({ ...current, id });
    } catch (e) {
      setTask(null);
      toast("error", errorMessage(e));
    }
  };

  const checkFromWsl = async () => {
    setChecking(true);
    try {
      const text = await api.wslDeviceCheck();
      setWslCheck({ ok: !/error/i.test(text), text });
    } catch (e) {
      setWslCheck({ ok: false, text: errorMessage(e) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet devices-sheet">
        <div className="sheet-head" style={{ paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
          <h2>{t("dev.title")}</h2>
          <p>{t("dev.subtitle")}</p>
        </div>
        <div className="split">
          <div className="side-list">
            <div className="side-head">
              <span>{t("dev.connected")}</span>
              <span className="grow" />
              <button className="icon-btn" title={t("common.refresh")} onClick={() => void refreshDevices()}>
                <RefreshCw size={13} />
              </button>
            </div>
            {devices.map((d) => (
              <div key={d.udid} className={`side-item${device?.udid === d.udid ? " on" : ""}`} onClick={() => setSelected(d.udid)}>
                <Smartphone size={20} strokeWidth={1.6} />
                <div style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 600 }}>
                    {d.name}
                  </div>
                  <div className="sub">
                    {d.osVersion ? `iOS ${d.osVersion}` : (d.deviceClass ?? "iOS")} · {d.connection === "USB" ? "USB" : "Wi-Fi"}
                  </div>
                </div>
              </div>
            ))}
            {devices.length === 0 && <div className="empty-hint">{t("dev.none")}</div>}
          </div>
          <div className="sheet-body">
            {device ? (
              <>
                <div className="device-hero">
                  <div className="phone" />
                  <div style={{ minWidth: 0 }}>
                    <h3>{device.name}</h3>
                    <div className="muted" style={{ marginTop: 2 }}>
                      {device.deviceClass ?? "iPhone"}
                      {device.osVersion && ` · iOS ${device.osVersion}`}
                      {device.productType && ` · ${device.productType}`}
                    </div>
                    <div className="row" style={{ marginTop: 14 }}>
                      <button className="btn primary" onClick={() => void install()}>
                        <Download size={14} /> {t("dev.installApp")}
                      </button>
                      <button
                        className="btn"
                        onClick={() => {
                          setDestination({ kind: "device", udid: device.udid, name: device.name });
                          toast("success", t("dev.destinationSet", { name: device.name }));
                        }}
                      >
                        {t("dev.useAsDestination")}
                      </button>
                    </div>
                  </div>
                </div>
                <dl className="kv card" style={{ gridTemplateColumns: "110px 1fr", padding: "16px 18px" }}>
                  <dt>{t("dev.connection")}</dt>
                  <dd className="row" style={{ gap: 6 }}>
                    {device.connection === "USB" ? <Cable size={13} /> : <Wifi size={13} />}
                    {device.connection === "USB" ? t("dev.cable") : t("dev.network")}
                  </dd>
                  <dt>{t("dev.model")}</dt>
                  <dd>{device.productType ?? "—"}</dd>
                  <dt>{t("dev.version")}</dt>
                  <dd>{device.osVersion ? `iOS ${device.osVersion}` : "—"}</dd>
                  <dt>{t("dev.identifier")}</dt>
                  <dd className="row" style={{ gap: 6 }}>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {device.udid}
                    </span>
                    <button className="icon-btn" title={t("common.copy")} onClick={() => void navigator.clipboard.writeText(device.udid).then(() => toast("info", t("dev.udidCopied")))}>
                      <Copy size={12} />
                    </button>
                  </dd>
                </dl>
                <AppsSection key={device.udid} device={device} />
              </>
            ) : (
              <div style={{ padding: "30px 10px", textAlign: "center" }}>
                <Smartphone size={44} strokeWidth={1.3} className="faint" />
                <div style={{ fontWeight: 600, fontSize: 15, marginTop: 10 }}>{t("dev.plugTitle")}</div>
                <div className="muted" style={{ maxWidth: 440, margin: "8px auto 0", fontSize: 12.5 }}>
                  {t("dev.plugText")}
                </div>
                {devicesError && (
                  <div className="card" style={{ marginTop: 16, textAlign: "left", fontSize: 12 }}>
                    <div style={{ color: "var(--red)", fontWeight: 600, marginBottom: 6 }}>{devicesError}</div>
                    <button className="btn small" onClick={() => openSheet("settings", "tools")}>
                      {t("dev.openTools")}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="card dev-card">
              <div className="row">
                <Wifi size={15} className="faint" />
                <div className="grow">
                  <div className="dev-card-title">{t("dev.wifiTitle")}</div>
                  <div className="muted dev-card-text">{t("dev.wifiText")}</div>
                </div>
                <Seg
                  small
                  value={connection}
                  options={[
                    { value: "auto", label: t("dev.auto") },
                    { value: "usb", label: "USB" },
                    { value: "network", label: "Wi-Fi" },
                  ]}
                  onChange={(v) => void updateSettings({ iosConnection: v })}
                />
              </div>
            </div>

            <div className="card dev-card">
              <div className="row">
                <span className={`status-dot ${wslCheck ? (wslCheck.ok ? "ok" : "missing") : "idle"}`} style={{ margin: "0 4px" }} />
                <div className="grow">
                  <div className="dev-card-title">{t("dev.bridgeTitle")}</div>
                  <div className="muted dev-card-text">{t("dev.bridgeText")}</div>
                </div>
                <button className="btn small" disabled={checking} onClick={() => void checkFromWsl()}>
                  {checking ? t("dev.testing") : t("dev.bridgeTest")}
                </button>
              </div>
              {wslCheck && <pre className={`set-output${wslCheck.ok ? "" : " bad"}`} style={{ margin: "10px 0 0" }}>{wslCheck.text}</pre>}
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <span className="faint" style={{ fontSize: 11.5 }}>
            {t("dev.freeIdNote")}
          </span>
          <span className="grow" />
          <button className="btn" onClick={close}>
            {t("common.done")}
          </button>
        </div>
      </div>
    </div>
  );
}
