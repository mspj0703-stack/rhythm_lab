export interface Preferences {
  fastSlow: boolean;
  judgementText: boolean;
  backgroundVideo: boolean;
  backgroundBrightness: number;
  effects: "low" | "normal" | "high";
  combo: boolean;
  vibration: boolean;
}
export const PREFERENCES_KEY = "beatdash.preferences.v475";
export const DEFAULT_PREFERENCES: Preferences = {
  fastSlow: true, judgementText: true, backgroundVideo: true,
  backgroundBrightness: 0.4, effects: "normal", combo: true, vibration: false,
};
export function normalizePreferences(raw: unknown): Preferences {
  const value = raw && typeof raw === "object" ? raw as Partial<Preferences> : {};
  const next = { ...DEFAULT_PREFERENCES };
  for (const key of ["fastSlow", "judgementText", "backgroundVideo", "combo", "vibration"] as const) {
    if (typeof value[key] === "boolean") next[key] = value[key];
  }
  if (typeof value.backgroundBrightness === "number" && Number.isFinite(value.backgroundBrightness)) next.backgroundBrightness = Math.max(0, Math.min(1, value.backgroundBrightness));
  if (["low", "normal", "high"].includes(value.effects ?? "")) next.effects = value.effects!;
  return next;
}
export function loadPreferences(): Preferences {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null")); }
  catch { return { ...DEFAULT_PREFERENCES }; }
}
export function savePreferences(value: Preferences): boolean {
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(value))); return true; }
  catch { return false; }
}
export function supportsVibration(): boolean {
  return /Android/i.test(navigator.userAgent) && typeof navigator.vibrate === "function";
}
