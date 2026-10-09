/**
 * v5 Phase 2 media readiness. A single `canplay` is not enough to start a song: on a weak network the
 * browser fires it with a few hundred milliseconds buffered and the song then skips or stalls.
 * A source is "ready" when the browser reports it can play through (readyState 4 / canplaythrough) or
 * when enough is buffered ahead of the start position. Local Blob / Android-served files satisfy this
 * almost immediately.
 */
export const READY_BUFFER_AHEAD_SEC = 15;

export function bufferedAheadSec(media: HTMLMediaElement, at = media.currentTime): number {
  const ranges = media.buffered;
  if (!ranges || typeof ranges.length !== "number") return 0;
  for (let i = 0; i < ranges.length; i++) {
    if (ranges.start(i) <= at + 0.05 && ranges.end(i) >= at) return ranges.end(i) - at;
  }
  return 0;
}

/** Seconds that must be buffered ahead of `at` before play can start (the rest of the song if shorter). */
export function requiredAheadSec(media: HTMLMediaElement, at = media.currentTime): number {
  const duration = media.duration;
  if (!Number.isFinite(duration) || duration <= 0) return READY_BUFFER_AHEAD_SEC;
  return Math.max(0, Math.min(READY_BUFFER_AHEAD_SEC, duration - at - 0.1));
}

export function isMediaReady(media: HTMLMediaElement | null): boolean {
  if (!media || media.error) return false;
  if (media.readyState >= 4) return true; // HAVE_ENOUGH_DATA = canplaythrough
  if (media.readyState < 2) return false;
  const duration = media.duration;
  if (!Number.isFinite(duration) || duration <= 0) return false;
  return bufferedAheadSec(media) >= requiredAheadSec(media);
}

/** 0..1 preparation progress for the loading UI. */
export function preparationProgress(media: HTMLMediaElement | null): number {
  if (!media) return 0;
  if (isMediaReady(media)) return 1;
  const need = requiredAheadSec(media);
  return need <= 0 ? 1 : Math.max(0, Math.min(0.99, bufferedAheadSec(media) / need));
}
