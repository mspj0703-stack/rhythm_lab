import type { Chart, ChartPlatform } from "../types/chart";
import type { LibraryBundle, LibraryChart } from "../library/types";
import { chartVariantKey, labelForDifficulty } from "../library/db";
import { normalizeDifficulty } from "../constants/difficulty";

/** Starting level for a blank chart (the author can't be asked for one; it only groups the chart in lists). */
export const BLANK_LEVEL: Record<string, number> = { easy: 3, normal: 6, hard: 10, expert: 14, extreme: 18 };
export const BLANK_DRAFT_PREFIX = "draft-";

export function isBlankDraft(chart: Pick<LibraryChart, "id">): boolean {
  return chart.id.startsWith(BLANK_DRAFT_PREFIX);
}

/**
 * An in-memory (never stored) starting point for "empty chart on an existing Library song".
 * BPM / offset / metadata are reused from the song (and its first AI chart); nothing is written until the
 * author saves a chart with at least one note, so the AI originals of the song stay untouched.
 */
export function createBlankDraft(bundle: LibraryBundle, difficulty: string, platform: ChartPlatform): LibraryChart {
  const level = normalizeDifficulty(difficulty);
  if (!level) throw new Error("알 수 없는 난이도입니다.");
  const template = bundle.charts.find((chart) => chart.chart.platformProfile === platform) ?? bundle.charts[0];
  const song = bundle.song;
  const bpm = template?.chart.bpm && template.chart.bpm > 0 ? template.chart.bpm : song.bpm > 0 ? song.bpm : 120;
  const chart: Chart = {
    version: 5, platformProfile: platform, scoringVersion: 2,
    title: song.originalTitle || song.title, artist: template?.chart.artist ?? "",
    bpm, offset: template?.chart.offset ?? 0,
    difficulty: level[0].toUpperCase() + level.slice(1), level: BLANK_LEVEL[level] ?? 10, notes: [],
  } as Chart;
  const variantKey = chartVariantKey(level, platform);
  const now = Date.now();
  return {
    id: `${BLANK_DRAFT_PREFIX}${Math.random().toString(36).slice(2, 10)}`, songId: song.id, difficulty: level, level: chart.level,
    variantKey, slotKey: `${variantKey}:draft`, platformProfile: platform, scoringVersion: 2, noteCount: 0, chart,
    generatorVersion: "maker-blank", seed: 0, createdAt: now, updatedAt: now,
    origin: "MANUAL_EDITED", chartVersion: 1, cloudPublished: false, label: labelForDifficulty(level, "새 채보"),
  } as LibraryChart;
}
