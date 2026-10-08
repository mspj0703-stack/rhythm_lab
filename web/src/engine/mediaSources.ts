export type MediaElementKind = "audio" | "video";

export interface MediaCandidate {
  url: string;
  kind: MediaElementKind;
  /** primary = the stored MV/audio; audio-only = same song played without decoding video. */
  role: "primary" | "audio-only";
}

const NATIVE_VIDEO_PATH = /^(.*\/api\/)video\/([a-f0-9]{32})(\?.*)?$/;

/**
 * Audio-only candidates for a song whose primary source is a video.
 * 1) the dedicated audio file when the native companion serves one (`/api/video/<id>` -> `/api/media/<id>`),
 * 2) the same container opened with an <audio> element, which never decodes the video track.
 * Audio songs have no fallback: their primary source already is audio.
 */
export function deriveAudioFallbackUrls(mediaUrl: string | null | undefined, mediaKind: MediaElementKind): string[] {
  if (!mediaUrl || mediaKind !== "video") return [];
  const urls: string[] = [];
  const native = NATIVE_VIDEO_PATH.exec(mediaUrl);
  if (native) urls.push(`${native[1]}media/${native[2]}`);
  urls.push(mediaUrl);
  return [...new Set(urls)];
}

/** Ordered sources the player may use. Duplicate (kind,url) pairs are removed. */
export function buildMediaPlan(primaryUrl: string, primaryKind: MediaElementKind, audioFallbackUrls: readonly string[] = []): MediaCandidate[] {
  const plan: MediaCandidate[] = [{ url: primaryUrl, kind: primaryKind, role: "primary" }];
  for (const url of audioFallbackUrls) {
    if (!url) continue;
    if (plan.some((candidate) => candidate.kind === "audio" && candidate.url === url)) continue;
    plan.push({ url, kind: "audio", role: "audio-only" });
  }
  return plan;
}

/** Diagnostic text that never contains an object URL token or a query string. */
export function describeMediaSource(url: string): string {
  if (url.startsWith("blob:")) return "blob";
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "");
  return path.replace(/[a-f0-9]{32}/g, "<id>");
}
