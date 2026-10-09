import type { LibraryBundle } from "../library/types";
import type { CommunitySongRef } from "./api";

export type MatchLevel = "exact" | "likely" | "possible";

export interface SongMatch {
  bundle: LibraryBundle;
  level: MatchLevel;
  reason: string;
}

const DURATION_TOLERANCE_SEC = 2;

export function normalizeTitle(value: string | undefined): string {
  return (value ?? "").toLocaleLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * Library songs a downloaded chart may belong to. Only an identical media hash is "exact"; anything else
 * must be confirmed by the user, so a chart is never silently attached to the wrong song.
 * Songs too short for the chart are never offered.
 */
export function findSongMatches(library: readonly LibraryBundle[], ref: CommunitySongRef, chartEndSec: number): SongMatch[] {
  const wanted = new Set([normalizeTitle(ref.originalTitle), normalizeTitle(ref.title)].filter(Boolean));
  const out: SongMatch[] = [];
  for (const bundle of library) {
    const song = bundle.song;
    if (song.durationSec > 0 && chartEndSec > song.durationSec + 1) continue;
    if (ref.fingerprint && song.fingerprint === ref.fingerprint) { out.push({ bundle, level: "exact", reason: "같은 미디어 파일" }); continue; }
    const durationKnown = song.durationSec > 0 && ref.durationSec > 0;
    const durationClose = durationKnown && Math.abs(song.durationSec - ref.durationSec) <= DURATION_TOLERANCE_SEC;
    if (!durationClose) continue;
    const titleMatch = [normalizeTitle(song.originalTitle), normalizeTitle(song.title)].some((title) => title && wanted.has(title));
    out.push(titleMatch
      ? { bundle, level: "likely", reason: "제목·길이 일치 (확인 필요)" }
      : { bundle, level: "possible", reason: "길이만 비슷함 (확인 필요)" });
  }
  const rank: Record<MatchLevel, number> = { exact: 0, likely: 1, possible: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || Math.abs(a.bundle.song.durationSec - ref.durationSec) - Math.abs(b.bundle.song.durationSec - ref.durationSec));
}
