import type { ColorSpec } from "./types";

type Pair = [string, string];

const SYSTEM: Record<string, Pair> = {
  red: ["#FF3B30", "#FF453A"],
  orange: ["#FF9500", "#FF9F0A"],
  yellow: ["#FFCC00", "#FFD60A"],
  green: ["#34C759", "#30D158"],
  mint: ["#00C7BE", "#63E6E2"],
  teal: ["#30B0C7", "#40C8E0"],
  cyan: ["#32ADE6", "#64D2FF"],
  blue: ["#007AFF", "#0A84FF"],
  indigo: ["#5856D6", "#5E5CE6"],
  purple: ["#AF52DE", "#BF5AF2"],
  pink: ["#FF2D55", "#FF375F"],
  brown: ["#A2845E", "#AC8E68"],
  gray: ["#8E8E93", "#8E8E93"],
  black: ["#000000", "#000000"],
  white: ["#FFFFFF", "#FFFFFF"],
  clear: ["transparent", "transparent"],
  primary: ["#000000", "#FFFFFF"],
  label: ["#000000", "#FFFFFF"],
  secondary: ["rgba(60,60,67,0.6)", "rgba(235,235,245,0.6)"],
  secondaryLabel: ["rgba(60,60,67,0.6)", "rgba(235,235,245,0.6)"],
  tertiaryLabel: ["rgba(60,60,67,0.3)", "rgba(235,235,245,0.3)"],
  systemBackground: ["#FFFFFF", "#000000"],
  secondarySystemBackground: ["#F2F2F7", "#1C1C1E"],
  tertiarySystemBackground: ["#FFFFFF", "#2C2C2E"],
  systemGroupedBackground: ["#F2F2F7", "#000000"],
  secondarySystemGroupedBackground: ["#FFFFFF", "#1C1C1E"],
  separator: ["rgba(60,60,67,0.29)", "rgba(84,84,88,0.6)"],
  systemFill: ["rgba(120,120,128,0.2)", "rgba(120,120,128,0.36)"],
};

let accentOverride: [string, string] | null = null;

export function setAccent(light: string | null, dark?: string | null) {
  accentOverride = light ? [light, dark ?? light] : null;
}

export function systemColor(name: string, dark: boolean, accent = "blue"): string {
  if (name === "accentColor") return accentOverride ? accentOverride[dark ? 1 : 0] : systemColor(accent, dark);
  return SYSTEM[name]?.[dark ? 1 : 0] ?? SYSTEM.gray[dark ? 1 : 0];
}

function withAlpha(css: string, alpha: number): string {
  if (alpha >= 1) return css;
  if (css === "transparent") return css;
  const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css.replace(/\s/g, ""));
  if (rgba) return `rgba(${rgba[1]},${rgba[2]},${rgba[3]},${Number(rgba[4]) * alpha})`;
  const hex = /^#([0-9a-f]{6})$/i.exec(css);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  return css;
}

export function cssColor(spec: ColorSpec | undefined | null, dark: boolean, tint = "blue"): string | undefined {
  if (!spec) return undefined;
  if ("rgba" in spec) {
    const [r, g, b, a] = dark && spec.dark ? spec.dark : spec.rgba;
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  }
  return withAlpha(systemColor(spec.name, dark, tint), spec.opacity ?? 1);
}
