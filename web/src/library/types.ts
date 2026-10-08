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

export interface LibraryChart {
  variantKey?: string;
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
  origin: "AI_GENERATED" | "MANUAL_EDITED";
  chartVersion: number;
  cloudPublished: boolean;
  authorId?: string;
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
