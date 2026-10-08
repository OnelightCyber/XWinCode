export interface DeviceSpec {
  id: string;
  name: string;
  family: string;
  inches: number;
  width: number;
  height: number;
  scale: number;
  safeTop: number;
  safeBottom: number;
  radius: number;
  cutout: "island" | "notch" | "none";
  chip: string;
  ram: number;
  hz: 60 | 120;
  power: number;
}

export const DEVICES: DeviceSpec[] = [
  { id: "iphone17promax", name: "iPhone 17 Pro Max", family: "17", inches: 6.9, width: 440, height: 956, scale: 3, safeTop: 62, safeBottom: 34, radius: 62, cutout: "island", chip: "A19 Pro", ram: 12, hz: 120, power: 1.25 },
  { id: "iphone17pro", name: "iPhone 17 Pro", family: "17", inches: 6.3, width: 402, height: 874, scale: 3, safeTop: 62, safeBottom: 34, radius: 62, cutout: "island", chip: "A19 Pro", ram: 12, hz: 120, power: 1.25 },
  { id: "iphoneair", name: "iPhone Air", family: "17", inches: 6.5, width: 420, height: 912, scale: 3, safeTop: 62, safeBottom: 34, radius: 62, cutout: "island", chip: "A19 Pro", ram: 12, hz: 120, power: 1.2 },
  { id: "iphone17", name: "iPhone 17", family: "17", inches: 6.3, width: 402, height: 874, scale: 3, safeTop: 62, safeBottom: 34, radius: 62, cutout: "island", chip: "A19", ram: 8, hz: 120, power: 1.1 },
  { id: "iphone16promax", name: "iPhone 16 Pro Max", family: "16", inches: 6.9, width: 440, height: 956, scale: 3, safeTop: 62, safeBottom: 34, radius: 62, cutout: "island", chip: "A18 Pro", ram: 8, hz: 120, power: 1.05 },
  { id: "iphone16pro", name: "iPhone 16 Pro", family: "16", inches: 6.3, width: 402, height: 874, scale: 3, safeTop: 62, safeBottom: 34, radius: 62, cutout: "island", chip: "A18 Pro", ram: 8, hz: 120, power: 1.05 },
  { id: "iphone16plus", name: "iPhone 16 Plus", family: "16", inches: 6.7, width: 430, height: 932, scale: 3, safeTop: 59, safeBottom: 34, radius: 55, cutout: "island", chip: "A18", ram: 8, hz: 60, power: 1 },
  { id: "iphone16", name: "iPhone 16", family: "16", inches: 6.1, width: 393, height: 852, scale: 3, safeTop: 59, safeBottom: 34, radius: 55, cutout: "island", chip: "A18", ram: 8, hz: 60, power: 1 },
  { id: "iphone16e", name: "iPhone 16e", family: "16", inches: 6.1, width: 390, height: 844, scale: 3, safeTop: 47, safeBottom: 34, radius: 47, cutout: "notch", chip: "A18", ram: 8, hz: 60, power: 1 },
  { id: "iphone15promax", name: "iPhone 15 Pro Max", family: "15", inches: 6.7, width: 430, height: 932, scale: 3, safeTop: 59, safeBottom: 34, radius: 55, cutout: "island", chip: "A17 Pro", ram: 8, hz: 120, power: 0.92 },
  { id: "iphone15pro", name: "iPhone 15 Pro", family: "15", inches: 6.1, width: 393, height: 852, scale: 3, safeTop: 59, safeBottom: 34, radius: 55, cutout: "island", chip: "A17 Pro", ram: 8, hz: 120, power: 0.92 },
  { id: "iphone15plus", name: "iPhone 15 Plus", family: "15", inches: 6.7, width: 430, height: 932, scale: 3, safeTop: 59, safeBottom: 34, radius: 55, cutout: "island", chip: "A16 Bionic", ram: 6, hz: 60, power: 0.8 },
  { id: "iphone15", name: "iPhone 15", family: "15", inches: 6.1, width: 393, height: 852, scale: 3, safeTop: 59, safeBottom: 34, radius: 55, cutout: "island", chip: "A16 Bionic", ram: 6, hz: 60, power: 0.8 },
  { id: "iphone14promax", name: "iPhone 14 Pro Max", family: "14", inches: 6.7, width: 430, height: 932, scale: 3, safeTop: 59, safeBottom: 34, radius: 55, cutout: "island", chip: "A16 Bionic", ram: 6, hz: 120, power: 0.8 },
  { id: "iphone14pro", name: "iPhone 14 Pro", family: "14", inches: 6.1, width: 393, height: 852, scale: 3, safeTop: 59, safeBottom: 34, radius: 55, cutout: "island", chip: "A16 Bionic", ram: 6, hz: 120, power: 0.8 },
  { id: "iphone14plus", name: "iPhone 14 Plus", family: "14", inches: 6.7, width: 428, height: 926, scale: 3, safeTop: 47, safeBottom: 34, radius: 53, cutout: "notch", chip: "A15 Bionic", ram: 6, hz: 60, power: 0.72 },
  { id: "iphone14", name: "iPhone 14", family: "14", inches: 6.1, width: 390, height: 844, scale: 3, safeTop: 47, safeBottom: 34, radius: 47, cutout: "notch", chip: "A15 Bionic", ram: 6, hz: 60, power: 0.72 },
  { id: "iphone13promax", name: "iPhone 13 Pro Max", family: "13", inches: 6.7, width: 428, height: 926, scale: 3, safeTop: 47, safeBottom: 34, radius: 53, cutout: "notch", chip: "A15 Bionic", ram: 6, hz: 120, power: 0.72 },
  { id: "iphone13pro", name: "iPhone 13 Pro", family: "13", inches: 6.1, width: 390, height: 844, scale: 3, safeTop: 47, safeBottom: 34, radius: 47, cutout: "notch", chip: "A15 Bionic", ram: 6, hz: 120, power: 0.72 },
  { id: "iphone13", name: "iPhone 13", family: "13", inches: 6.1, width: 390, height: 844, scale: 3, safeTop: 47, safeBottom: 34, radius: 47, cutout: "notch", chip: "A15 Bionic", ram: 4, hz: 60, power: 0.68 },
  { id: "iphone13mini", name: "iPhone 13 mini", family: "13", inches: 5.4, width: 375, height: 812, scale: 3, safeTop: 50, safeBottom: 34, radius: 44, cutout: "notch", chip: "A15 Bionic", ram: 4, hz: 60, power: 0.65 },
  { id: "iphone12promax", name: "iPhone 12 Pro Max", family: "12", inches: 6.7, width: 428, height: 926, scale: 3, safeTop: 47, safeBottom: 34, radius: 53, cutout: "notch", chip: "A14 Bionic", ram: 6, hz: 60, power: 0.6 },
  { id: "iphone12pro", name: "iPhone 12 Pro", family: "12", inches: 6.1, width: 390, height: 844, scale: 3, safeTop: 47, safeBottom: 34, radius: 47, cutout: "notch", chip: "A14 Bionic", ram: 6, hz: 60, power: 0.6 },
  { id: "iphone12", name: "iPhone 12", family: "12", inches: 6.1, width: 390, height: 844, scale: 3, safeTop: 47, safeBottom: 34, radius: 47, cutout: "notch", chip: "A14 Bionic", ram: 4, hz: 60, power: 0.58 },
  { id: "iphone12mini", name: "iPhone 12 mini", family: "12", inches: 5.4, width: 375, height: 812, scale: 3, safeTop: 50, safeBottom: 34, radius: 44, cutout: "notch", chip: "A14 Bionic", ram: 4, hz: 60, power: 0.56 },
  { id: "iphone11promax", name: "iPhone 11 Pro Max", family: "11", inches: 6.5, width: 414, height: 896, scale: 3, safeTop: 44, safeBottom: 34, radius: 39, cutout: "notch", chip: "A13 Bionic", ram: 4, hz: 60, power: 0.5 },
  { id: "iphone11pro", name: "iPhone 11 Pro", family: "11", inches: 5.8, width: 375, height: 812, scale: 3, safeTop: 44, safeBottom: 34, radius: 39, cutout: "notch", chip: "A13 Bionic", ram: 4, hz: 60, power: 0.5 },
  { id: "iphone11", name: "iPhone 11", family: "11", inches: 6.1, width: 414, height: 896, scale: 2, safeTop: 48, safeBottom: 34, radius: 41, cutout: "notch", chip: "A13 Bionic", ram: 4, hz: 60, power: 0.48 },
  { id: "iphonese", name: "iPhone SE", family: "SE", inches: 4.7, width: 375, height: 667, scale: 2, safeTop: 20, safeBottom: 0, radius: 0, cutout: "none", chip: "A15 Bionic", ram: 4, hz: 60, power: 0.6 },
  { id: "ipadpro13", name: "iPad Pro 13-inch", family: "iPad", inches: 13, width: 1032, height: 1376, scale: 2, safeTop: 24, safeBottom: 20, radius: 18, cutout: "none", chip: "M5", ram: 12, hz: 120, power: 2.2 },
  { id: "ipadpro11", name: "iPad Pro 11-inch", family: "iPad", inches: 11, width: 834, height: 1210, scale: 2, safeTop: 24, safeBottom: 20, radius: 18, cutout: "none", chip: "M5", ram: 12, hz: 120, power: 2.2 },
  { id: "ipadair13", name: "iPad Air 13-inch", family: "iPad", inches: 13, width: 1024, height: 1366, scale: 2, safeTop: 24, safeBottom: 20, radius: 18, cutout: "none", chip: "M3", ram: 8, hz: 60, power: 1.7 },
  { id: "ipadair11", name: "iPad Air 11-inch", family: "iPad", inches: 11, width: 820, height: 1180, scale: 2, safeTop: 24, safeBottom: 20, radius: 18, cutout: "none", chip: "M3", ram: 8, hz: 60, power: 1.7 },
  { id: "ipad", name: "iPad", family: "iPad", inches: 11, width: 820, height: 1180, scale: 2, safeTop: 24, safeBottom: 20, radius: 18, cutout: "none", chip: "A16", ram: 6, hz: 60, power: 0.8 },
  { id: "ipadmini", name: "iPad mini", family: "iPad", inches: 8.3, width: 744, height: 1133, scale: 2, safeTop: 24, safeBottom: 20, radius: 21, cutout: "none", chip: "A17 Pro", ram: 8, hz: 60, power: 0.92 },
];

export const DEFAULT_DEVICE = "iphone17pro";

export const FAMILIES = ["17", "16", "15", "14", "13", "12", "11", "SE", "iPad"];

export const TYPE_SIZES: [string, number][] = [
  ["xSmall", 14 / 17],
  ["small", 15 / 17],
  ["medium", 16 / 17],
  ["large", 1],
  ["xLarge", 19 / 17],
  ["xxLarge", 21 / 17],
  ["xxxLarge", 23 / 17],
  ["accessibility1", 28 / 17],
  ["accessibility2", 33 / 17],
  ["accessibility3", 40 / 17],
  ["accessibility4", 47 / 17],
  ["accessibility5", 53 / 17],
];

export const typeScale = (size: string) => TYPE_SIZES.find(([n]) => n === size)?.[1] ?? 1;

export interface Screen {
  width: number;
  height: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  landscape: boolean;
  ipad: boolean;
}

export function screenOf(d: DeviceSpec, landscape: boolean): Screen {
  const ipad = d.family === "iPad";
  if (!landscape) return { width: d.width, height: d.height, top: d.safeTop, bottom: d.safeBottom, left: 0, right: 0, landscape, ipad };
  if (ipad) return { width: d.height, height: d.width, top: d.safeTop, bottom: d.safeBottom, left: 0, right: 0, landscape, ipad };
  const side = d.cutout === "none" ? 0 : d.safeTop;
  return { width: d.height, height: d.width, top: 0, bottom: d.cutout === "none" ? 0 : 21, left: side, right: side, landscape, ipad };
}

export function sizeClasses(d: DeviceSpec, landscape: boolean): { h: "compact" | "regular"; v: "compact" | "regular" } {
  if (d.family === "iPad") return { h: "regular", v: "regular" };
  if (!landscape) return { h: "compact", v: "regular" };
  return { h: d.width >= 414 ? "regular" : "compact", v: "compact" };
}

export function frameOf(d: DeviceSpec, screen: Screen): { width: number; height: number } {
  if (d.cutout === "none" && !screen.ipad) return screen.landscape ? { width: screen.width + 128, height: screen.height + 28 } : { width: screen.width + 28, height: screen.height + 128 };
  const pad = screen.ipad ? 36 : 24;
  return { width: screen.width + pad, height: screen.height + pad };
}

export function deviceById(id: string | null | undefined): DeviceSpec {
  return DEVICES.find((d) => d.id === id) ?? DEVICES.find((d) => d.id === DEFAULT_DEVICE)!;
}

export function deviceForScreen(width: number, height: number): DeviceSpec | undefined {
  const w = Math.round(Math.min(width, height));
  const h = Math.round(Math.max(width, height));
  return DEVICES.find((d) => d.width === w && d.height === h);
}

const MACHINES: Record<string, [string, string?]> = {
  "iPhone18,1": ["iPhone 17 Pro", "iphone17pro"],
  "iPhone18,2": ["iPhone 17 Pro Max", "iphone17promax"],
  "iPhone18,3": ["iPhone 17", "iphone17"],
  "iPhone18,4": ["iPhone Air", "iphoneair"],
  "iPhone17,1": ["iPhone 16 Pro", "iphone16pro"],
  "iPhone17,2": ["iPhone 16 Pro Max", "iphone16promax"],
  "iPhone17,3": ["iPhone 16", "iphone16"],
  "iPhone17,4": ["iPhone 16 Plus", "iphone16plus"],
  "iPhone17,5": ["iPhone 16e", "iphone16e"],
  "iPhone16,1": ["iPhone 15 Pro", "iphone15pro"],
  "iPhone16,2": ["iPhone 15 Pro Max", "iphone15promax"],
  "iPhone15,4": ["iPhone 15", "iphone15"],
  "iPhone15,5": ["iPhone 15 Plus", "iphone15plus"],
  "iPhone15,2": ["iPhone 14 Pro", "iphone14pro"],
  "iPhone15,3": ["iPhone 14 Pro Max", "iphone14promax"],
  "iPhone14,7": ["iPhone 14", "iphone14"],
  "iPhone14,8": ["iPhone 14 Plus", "iphone14plus"],
  "iPhone14,6": ["iPhone SE", "iphonese"],
  "iPhone14,2": ["iPhone 13 Pro", "iphone13pro"],
  "iPhone14,3": ["iPhone 13 Pro Max", "iphone13promax"],
  "iPhone14,4": ["iPhone 13 mini", "iphone13mini"],
  "iPhone14,5": ["iPhone 13", "iphone13"],
  "iPhone13,1": ["iPhone 12 mini", "iphone12mini"],
  "iPhone13,2": ["iPhone 12", "iphone12"],
  "iPhone13,3": ["iPhone 12 Pro", "iphone12pro"],
  "iPhone13,4": ["iPhone 12 Pro Max", "iphone12promax"],
  "iPhone12,8": ["iPhone SE", "iphonese"],
  "iPhone12,1": ["iPhone 11", "iphone11"],
  "iPhone12,3": ["iPhone 11 Pro", "iphone11pro"],
  "iPhone12,5": ["iPhone 11 Pro Max", "iphone11promax"],
  "iPhone11,8": ["iPhone XR"],
  "iPhone11,2": ["iPhone XS"],
  "iPhone11,4": ["iPhone XS Max"],
  "iPhone11,6": ["iPhone XS Max"],
};

export function modelName(machine: string | null | undefined): string | undefined {
  return machine ? MACHINES[machine]?.[0] : undefined;
}

export function deviceForMachine(machine: string | null | undefined, width: number, height: number): DeviceSpec | undefined {
  const id = machine ? MACHINES[machine]?.[1] : undefined;
  return DEVICES.find((d) => d.id === id) ?? deviceForScreen(width, height);
}

export interface PerfEstimate {
  frameMs: number;
  budgetMs: number;
  level: "smooth" | "ok" | "heavy";
}

export function estimatePerf(device: DeviceSpec, stats: { views: number; depth: number; heavy: number }): PerfEstimate {
  const work = stats.views * 0.018 + stats.depth * 0.04 + stats.heavy * 0.35;
  const frameMs = Math.round((work / device.power) * 100) / 100;
  const budgetMs = Math.round((1000 / device.hz) * 10) / 10;
  const ratio = frameMs / budgetMs;
  return { frameMs, budgetMs, level: ratio < 0.5 ? "smooth" : ratio < 0.9 ? "ok" : "heavy" };
}
