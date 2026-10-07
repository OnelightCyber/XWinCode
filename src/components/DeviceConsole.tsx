import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, Play, RotateCcw, Smartphone } from "lucide-react";
import { t } from "../i18n";
import { api, errorMessage } from "../lib/ipc";
import { useStore } from "../lib/store";
import type { DeviceLine } from "../lib/types";

const LINE_H = 18;

export function installIphoneTools() {
  const { runTask } = useStore.getState();
  void runTask(t("task.installImd"), "setup", () => api.runSetupTask("install-imobiledevice")).catch((e) =>
    useStore.getState().toast("error", errorMessage(e)),
  );
}

function Lines({ lines }: { lines: DeviceLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 300 });
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = ref.current!;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < LINE_H * 2;
    setScroll({ top: el.scrollTop, height: el.clientHeight });
  };

  const first = Math.max(0, Math.floor(scroll.top / LINE_H) - 20);
  const last = Math.min(lines.length, Math.ceil((scroll.top + scroll.height) / LINE_H) + 20);

  return (
    <div className="console device-console" ref={ref} onScroll={onScroll}>
      <div style={{ height: first * LINE_H }} />
      {lines.slice(first, last).map((l) => (
        <div key={l.id} className={`dev-line ${l.level}`}>
          {l.time && <span className="dev-time">{l.time}</span>}
          {l.process && <span className="dev-proc">{l.process}</span>}
          <span className="dev-msg">{l.message}</span>
        </div>
      ))}
      <div style={{ height: (lines.length - last) * LINE_H }} />
    </div>
  );
}

export function DeviceConsole({ filter }: { filter: string }) {
  const lines = useStore((s) => s.deviceLog);
  const state = useStore((s) => s.deviceLogState);
  const error = useStore((s) => s.deviceLogError);
  const hasDevice = useStore((s) => s.devices.length > 0);
  const deviceName = useStore((s) => s.devices.find((d) => d.udid === s.deviceLogUdid)?.name ?? s.devices[0]?.name ?? "iPhone");
  const { startDeviceLog } = useStore.getState();

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? lines.filter((l) => l.message.toLowerCase().includes(q) || l.process.toLowerCase().includes(q)) : lines;
  }, [lines, filter]);

  if (shown.length) return <Lines lines={shown} />;

  let body: React.ReactNode;
  if (state === "missing")
    body = (
      <>
        <div className="t">{t("devlog.missingTitle")}</div>
        <div className="d">{t("devlog.missingText")}</div>
        <button className="btn small primary" onClick={installIphoneTools}>
          <Download size={13} /> {t("devlog.installTools")}
        </button>
      </>
    );
  else if (state === "error")
    body = (
      <>
        <div className="t">{t("devlog.errorTitle")}</div>
        <div className="d">{error}</div>
        <button className="btn small" onClick={() => void startDeviceLog()}>
          <RotateCcw size={13} /> {t("devlog.retry")}
        </button>
      </>
    );
  else if (!hasDevice)
    body = (
      <>
        <div className="t">{t("devlog.noDeviceTitle")}</div>
        <div className="d">{t("devlog.noDeviceText")}</div>
      </>
    );
  else if (state === "starting")
    body = (
      <div className="row">
        <span className="spinner" /> {t("devlog.connecting", { device: deviceName })}
      </div>
    );
  else if (state === "live")
    body = (
      <>
        <div className="t">{filter ? t("devlog.noMatch") : t("devlog.listening", { device: deviceName })}</div>
        <div className="d">{t("devlog.printHint")}</div>
      </>
    );
  else
    body = (
      <>
        <div className="t">{t("devlog.offTitle")}</div>
        <div className="d">{t("devlog.offText")}</div>
        <button className="btn small primary" onClick={() => void startDeviceLog()}>
          <Play size={12} /> {t("devlog.start")}
        </button>
      </>
    );

  return (
    <div className="device-empty">
      <Smartphone size={26} strokeWidth={1.4} className="faint" />
      {body}
    </div>
  );
}
