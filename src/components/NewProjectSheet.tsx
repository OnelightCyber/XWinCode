import { useEffect, useState } from "react";
import { Library, Smartphone, SquareTerminal } from "lucide-react";
import { t, type TKey } from "../i18n";
import { pickFolder } from "../lib/dialogs";
import { api, errorMessage } from "../lib/ipc";
import { useStore } from "../lib/store";
import { Seg } from "./Controls";

type Platform = "ios" | "windows" | "multi";

interface Template {
  id: "iosApp" | "executable" | "library";
  platform: Platform;
  title: TKey;
  desc: TKey;
  icon: React.ReactNode;
}

const TEMPLATES: Template[] = [
  { id: "iosApp", platform: "ios", title: "np.tpl.app.title", desc: "np.tpl.app.desc", icon: <Smartphone size={28} strokeWidth={1.7} /> },
  { id: "executable", platform: "windows", title: "np.tpl.cli.title", desc: "np.tpl.cli.desc", icon: <SquareTerminal size={28} strokeWidth={1.7} /> },
  { id: "library", platform: "multi", title: "np.tpl.lib.title", desc: "np.tpl.lib.desc", icon: <Library size={28} strokeWidth={1.7} /> },
];

const PLATFORMS: { id: Platform; label: TKey }[] = [
  { id: "ios", label: "np.platform.ios" },
  { id: "windows", label: "np.platform.windows" },
  { id: "multi", label: "np.platform.multi" },
];

export function NewProjectSheet() {
  const close = () => useStore.getState().openSheet(null);
  const settings = useStore((s) => s.settings);
  const [step, setStep] = useState<1 | 2>(1);
  const [platform, setPlatform] = useState<Platform>("ios");
  const [template, setTemplate] = useState<Template>(TEMPLATES[0]);
  const [name, setName] = useState("");
  const [org, setOrg] = useState(settings?.organizationId ?? "com.example");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.defaultProjectsDir().then(setLocation);
  }, []);

  const shown = TEMPLATES.filter((x) => x.platform === platform);
  const nameValid = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name);
  const bundleId = `${org}.${name.replace(/_/g, "-") || t("np.bundlePlaceholder")}`;

  const create = async () => {
    setError(null);
    if (!nameValid) return setError(t("np.invalidName"));
    setBusy(true);
    try {
      const info = await api.createProject({ template: template.id, name, organizationId: org, location });
      close();
      await useStore.getState().setProject(info);
      useStore.getState().toast("success", t("np.created", { name: info.name }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="sheet" style={{ width: 720 }}>
        <div className="sheet-head">
          <h2>{step === 1 ? t("np.chooseTemplate") : t("np.chooseOptions")}</h2>
          {step === 2 && (
            <p>
              {t(template.title)} · {t(PLATFORMS.find((p) => p.id === template.platform)!.label)}
            </p>
          )}
        </div>
        <div className="sheet-body" style={{ minHeight: 300 }}>
          {step === 1 ? (
            <>
              <div className="tpl-tabs">
                <Seg
                  value={platform}
                  options={PLATFORMS.map((p) => ({ value: p.id, label: t(p.label) }))}
                  onChange={(id) => {
                    setPlatform(id);
                    setTemplate(TEMPLATES.find((x) => x.platform === id)!);
                  }}
                />
              </div>
              <div className="tpl-section">{t("np.template")}</div>
              <div className="tpl-grid">
                {shown.map((x) => (
                  <button key={x.id} className={`tpl${template.id === x.id ? " on" : ""}`} onClick={() => setTemplate(x)} onDoubleClick={() => setStep(2)}>
                    <span className="tpl-icon">{x.icon}</span>
                    <span className="tpl-title">{t(x.title)}</span>
                    <span className="tpl-desc">{t(x.desc)}</span>
                  </button>
                ))}
              </div>
              {platform === "ios" && (
                <div className="card" style={{ marginTop: 16, fontSize: 12 }}>
                  <div className="pipeline">
                    <span className="step">Swift + SwiftUI</span>→<span className="step">xtool (WSL)</span>→<span className="step">{t("np.step.sdk")}</span>→
                    <span className="step">{t("np.step.signing")}</span>→<span className="step">{t("np.step.usb")}</span>
                  </div>
                  <div className="faint" style={{ marginTop: 10 }}>
                    {t("np.requires")}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="form-grid">
              <label>{t("np.productName")}</label>
              <input className="input" autoFocus value={name} placeholder={t("np.placeholderName")} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
              {template.id === "iosApp" && (
                <>
                  <label>{t("np.orgId")}</label>
                  <input className="input" value={org} onChange={(e) => setOrg(e.target.value)} />
                  <label>{t("np.bundleId")}</label>
                  <input className="input mono" readOnly value={bundleId} style={{ fontSize: 12 }} />
                </>
              )}
              <label>{t("np.interface")}</label>
              <input className="input" readOnly value={template.id === "iosApp" ? "SwiftUI" : t("np.console")} />
              <label>{t("np.language")}</label>
              <input className="input" readOnly value="Swift 6" />
              <label>{t("np.location")}</label>
              <div className="row">
                <input className="input grow" value={location} onChange={(e) => setLocation(e.target.value)} />
                <button
                  className="btn"
                  onClick={async () => {
                    const dir = await pickFolder(t("np.locationDialog"), location);
                    if (dir) setLocation(dir);
                  }}
                >
                  {t("common.choose")}
                </button>
              </div>
              <span />
              <span className="faint" style={{ fontSize: 11.5 }}>
                {t("np.willCreate", { path: `${location}\\${name || "…"}` })}
              </span>
              {error && (
                <>
                  <span />
                  <span className="form-error">{error}</span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="sheet-foot">
          <button className="btn" onClick={close}>
            {t("common.cancel")}
          </button>
          <span className="grow" />
          {step === 2 && (
            <button className="btn" onClick={() => setStep(1)}>
              {t("np.previous")}
            </button>
          )}
          {step === 1 ? (
            <button className="btn primary" onClick={() => setStep(2)}>
              {t("np.next")}
            </button>
          ) : (
            <button className="btn primary" disabled={!nameValid || busy} onClick={() => void create()}>
              {busy ? t("np.creating") : t("np.create")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
