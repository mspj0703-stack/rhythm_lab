import { BEATDASH_PLATFORM } from "./runtime";

/** Optional Fullscreen API toggle for Web/Desktop. Never forced; Android uses the native WebView screen. */
export function fullscreenAvailable(): boolean {
  return BEATDASH_PLATFORM !== "ANDROID" && typeof document !== "undefined" && Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
}

export function isFullscreen(): boolean {
  return typeof document !== "undefined" && Boolean(document.fullscreenElement);
}

export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch { /* refused (no user gesture, iframe policy...): play continues windowed */ }
  return isFullscreen();
}
