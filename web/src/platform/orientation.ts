import { BEATDASH_PLATFORM } from "./runtime";

/**
 * Play-time rotation lock (v5 Phase 2).
 * The orientation at play start is kept until play ends/leaves; the app is never locked globally.
 * - Android: native bridge (PlayActivity.OrientationBridge) -> SCREEN_ORIENTATION_LOCKED.
 * - Web: Screen Orientation API, best effort (most browsers only allow it in fullscreen; failures are ignored).
 * - Desktop / mouse-only browsers: no-op.
 */
export type OrientationKind = "portrait" | "landscape";

interface NativeOrientationBridge {
  lock(kind: string): unknown;
  unlock(): unknown;
}

type LockableOrientation = ScreenOrientation & { lock?: (type: string) => Promise<void> };

function nativeBridge(): NativeOrientationBridge | null {
  const bridge = (window as Window & { BeatdashOrientation?: NativeOrientationBridge }).BeatdashOrientation;
  return bridge && typeof bridge.lock === "function" && typeof bridge.unlock === "function" ? bridge : null;
}

export function currentOrientation(): OrientationKind {
  const type = typeof screen !== "undefined" ? screen.orientation?.type : undefined;
  if (type) return type.startsWith("portrait") ? "portrait" : "landscape";
  if (typeof window.matchMedia === "function") return window.matchMedia("(orientation: portrait)").matches ? "portrait" : "landscape";
  return window.innerHeight >= window.innerWidth ? "portrait" : "landscape";
}

export function orientationLockApplies(): boolean {
  if (BEATDASH_PLATFORM === "DESKTOP") return false;
  if (BEATDASH_PLATFORM === "ANDROID" || nativeBridge()) return true;
  return typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

let activeLock: symbol | null = null;

/** Locks to the current orientation and returns the release function (idempotent; only the latest lock releases). */
export function lockPlayOrientation(): () => void {
  if (!orientationLockApplies()) return () => {};
  const token = Symbol("play-orientation");
  activeLock = token;
  const kind = currentOrientation();
  const bridge = nativeBridge();
  try {
    if (bridge) bridge.lock(kind);
    else {
      const orientation = screen.orientation as LockableOrientation | undefined;
      const exact = orientation?.type ?? kind;
      void orientation?.lock?.(exact)?.catch?.(() => { /* needs fullscreen or unsupported: keep playing */ });
    }
  } catch { /* best effort */ }
  return () => {
    if (activeLock !== token) return;
    activeLock = null;
    try {
      if (bridge) bridge.unlock();
      else screen.orientation?.unlock?.();
    } catch { /* best effort */ }
  };
}
