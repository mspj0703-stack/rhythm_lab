export type BeatdashPlatform = "WEB" | "ANDROID" | "DESKTOP";

/**
 * Minimal platform boundary shared by the Web core.
 * v4.8 keeps gameplay rules identical across platforms; v5 may branch UX/chart behavior here.
 */
export function detectBeatdashPlatform(search = window.location.search): BeatdashPlatform {
  const params = new URLSearchParams(search);
  const explicit = params.get("platform")?.toLowerCase();
  if (explicit === "desktop") return "DESKTOP";
  if (explicit === "android") return "ANDROID";
  if (params.has("desktopVersion")) return "DESKTOP";
  if (params.has("nativeVersion") || "BeatdashArtwork" in window) return "ANDROID";
  return "WEB";
}

export const BEATDASH_PLATFORM: BeatdashPlatform = detectBeatdashPlatform();
export const isDesktop = BEATDASH_PLATFORM === "DESKTOP";
export const isAndroid = BEATDASH_PLATFORM === "ANDROID";
