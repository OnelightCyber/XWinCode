import { Library, Package, Smartphone, SquareTerminal } from "lucide-react";
import { t } from "../i18n";
import type { ProjectKind } from "../lib/types";

export function AppGlyph({ kind, size = 20 }: { kind: ProjectKind; size?: number }) {
  const icon = Math.round(size * 0.58);
  const stroke = size >= 28 ? 1.8 : 2;
  return (
    <span className="app-glyph" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}>
      {kind === "executable" ? (
        <SquareTerminal size={icon} strokeWidth={stroke} />
      ) : kind === "library" ? (
        <Library size={icon} strokeWidth={stroke} />
      ) : kind === "iosApp" ? (
        <Smartphone size={icon} strokeWidth={stroke} />
      ) : (
        <Package size={icon} strokeWidth={stroke} />
      )}
    </span>
  );
}

export function kindLabel(kind: ProjectKind): string {
  switch (kind) {
    case "iosApp":
      return t("kind.iosApp");
    case "executable":
      return t("kind.executable");
    case "library":
      return t("kind.library");
    default:
      return t("kind.package");
  }
}
