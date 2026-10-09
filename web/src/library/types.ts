import type { Chart, ChartPlatform } from "../types/chart";

export type ClearType = "CLEAR" | "FULL_COMBO" | "PERFECT_COMBO";
export type MediaKind = "audio" | "video";

export interface LibrarySong {
  id: string;
  fingerprint: string;
  title: string;
  originalTitle: string;
  originalName: string;
  bpm: number;
  durationSec: number;
  mediaKind: MediaKind;
  mediaName: string;
  mediaType: string;
  mediaBlob?: Blob;
  sourceUrl?: string;
  /** Legacy v4 artwork field; retained for migration compatibility. */
  thumbnailUrl?: string;
  originalThumbnail?: string;
  customCover?: string;
  timingOffsetMs: number;
  createdAt: number;
  updatedAt: number;
  lastPlayedAt?: number;
}

/**
 * AI_GENERATED = analyzer output (protected original), MANUAL_EDITED = saved from Maker after a real edit,
 * COMMUNITY = downloaded from Community. Only MANUAL_EDITED may be uploaded.
 */
export type ChartOrigin = "AI_GENERATED" | "MANUAL_EDITED" | "COMMUNITY";

export interface LibraryChart {
  /** `difficulty:platform` (Phase 1). Shared by every chart of that difficulty/platform, AI or not. */
  variantKey?: string;
  /**
   * v5 Phase 2 unique slot per song. The AI chart keeps `slotKey === variantKey`, so regeneration still
   * replaces only the AI original; Maker/Community charts get their own `variantKey:origin:id` slot.
   */
  slotKey?: string;
  platformProfile?: ChartPlatform;
  id: string;
  songId: string;
  difficulty: string;
  level: number;
  noteCount: number;
  chart: Chart;
  generatorVersion?: string;
  seed?: number;
  createdAt: number;
  updatedAt: number;
  origin: ChartOrigin;
  chartVersion: number;
  cloudPublished: boolean;
  /** MANUAL_EDITED: this device's anonymous author ID. COMMUNITY: the uploader's public author ID. */
  authorId?: string;
  /** Chart this one was derived from (Maker edit of an AI/Community chart). */
  parentChartId?: string;
  /** Mirrors chart.chart.scoringVersion for display/queries; the chart body stays authoritative. */
  scoringVersion?: 1 | 2;
  /** Short user-facing name of a non-AI chart, e.g. "HARD 편집본". */
  label?: string;
  description?: string;
  /** Community ID: the uploaded copy (MANUAL_EDITED) or the downloaded source (COMMUNITY). */
  cloudChartId?: string;
}

export interface PlayRecord {
  platform?: ChartPlatform;
  chartProfile?: ChartPlatform;
  scoringVersion?: 1 | 2;
  holdTickScore?: number;
  id: string;
  songId: string;
  chartId: string;
  chartVersion?: number;
  difficulty: string;
  playedAt: number;
  score: number;
  accuracy: number;
  maxCombo: number;
  perfect: number;
  great: number;
  good: number;
  miss: number;
  clearType: ClearType;
  practice: boolean;
  offsetMs: number;
}

export interface BestRecord {
  bestScore: number;
  bestAccuracy: number;
  bestMaxCombo: number;
  bestClearType: ClearType;
  playCount: number;
  lastPlayedAt?: number;
}

export interface RecordFeedback {
  clearType: ClearType;
  newHighScore: boolean;
  newAccuracyBest: boolean;
  newComboBest: boolean;
  firstFullCombo: boolean;
  firstPerfectCombo: boolean;
}

export interface LibraryBundle {
  song: LibrarySong;
  charts: LibraryChart[];
}
