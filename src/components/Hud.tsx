import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useStore } from "../lib/store";

export function Hud() {
  const hud = useStore((s) => s.hud);
  const [shown, setShown] = useState<typeof hud>(null);

  useEffect(() => {
    if (!hud) return;
    setShown(hud);
    const timer = window.setTimeout(() => setShown(null), 1700);
    return () => window.clearTimeout(timer);
  }, [hud]);

  if (!shown) return null;
  return (
    <div key={shown.nonce} className={`hud ${shown.kind}`}>
      <span className="hud-icon">{shown.kind === "success" ? <Check size={40} strokeWidth={2.6} /> : <X size={38} strokeWidth={2.6} />}</span>
      <span className="hud-text">{shown.text}</span>
    </div>
  );
}

export function Ambient() {
  return (
    <div className="ambient" aria-hidden>
      <i />
      <i />
      <i />
    </div>
  );
}
