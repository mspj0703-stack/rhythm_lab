import { normalizeTimingOffsetMs } from "../settings/timingOffset";
import type { AnalysisResponse } from "../web/types";
import type { GameResult } from "../engine/resultCalculation";
import { buildRecordFeedback, getClearType, isAiOriginal, makeSongFingerprint, summarizeRecords } from "./model";
import type { BestRecord, LibraryBundle, LibraryChart, LibrarySong, PlayRecord, RecordFeedback } from "./types";
import { persistOriginalThumbnail } from "./artwork";
import { defaultChartPlatform } from "../platform/runtime";
import type { Chart, ChartNote, ChartPlatform } from "../types/chart";
import { validateChart } from "../engine/chartLoader";
import { notesEqual } from "./chartDiff";
import { difficultyLabel } from "../constants/difficulty";

const DB_NAME = "BEATDASH_DB";
const DB_VERSION = 5;
const SONGS = "songs";
const CHARTS = "charts";
const RECORDS = "playRecords";
const SETTINGS = "settings";

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!db.objectStoreNames.contains(SONGS)) {
        const store = db.createObjectStore(SONGS, { keyPath: "id" });
        store.createIndex("fingerprint", "fingerprint", { unique: true });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(CHARTS)) {
        const store = db.createObjectStore(CHARTS, { keyPath: "id" });
        store.createIndex("songId", "songId");
        store.createIndex("songDifficulty", ["songId", "difficulty"], { unique: true });
      }
      if (!db.objectStoreNames.contains(RECORDS)) {
        const store = db.createObjectStore(RECORDS, { keyPath: "id" });
        store.createIndex("songId", "songId");
        store.createIndex("chartId", "chartId");
        store.createIndex("playedAt", "playedAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: "key" });
      if (event.oldVersion < 5 && tx) {
        const store = tx.objectStore(CHARTS);
        // Only uniqueness constraints change; every chart ID, record reference and chart body is retained.
        // v3: songDifficulty(unique) -> v4: songChartVariant(unique) -> v5: songChartVariant(shared) + songChartSlot(unique).
        if (store.indexNames.contains("songDifficulty")) store.deleteIndex("songDifficulty");
        if (store.indexNames.contains("songChartVariant")) store.deleteIndex("songChartVariant");
        store.createIndex("songChartVariant", ["songId", "variantKey"], { unique: false });
        if (!store.indexNames.contains("songChartSlot")) store.createIndex("songChartSlot", ["songId", "slotKey"], { unique: true });
        // One cursor backfills both keys so two concurrent cursors never write stale copies of the same row.
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const chart = row.value as LibraryChart;
          const variantKey = chart.variantKey ?? chartVariantKey(chart.difficulty, chart.chart.platformProfile);
          // Every pre-v5 chart occupied the single (difficulty, platform) slot, so it keeps that slot.
          row.update({ ...chart, variantKey, slotKey: chart.slotKey ?? variantKey });
          row.continue();
        };
      }
      // v2/v3 are additive: preserve all Library data and backfill artwork metadata in place.
      if (event.oldVersion < 3 && tx && db.objectStoreNames.contains(SONGS)) {
        const store = tx.objectStore(SONGS);
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          const row = cursor.result;
          if (!row) return;
          const song = row.value as LibrarySong;
          row.update({
            ...song,
            originalTitle: song.originalTitle || song.title || song.originalName,
            originalThumbnail: song.originalThumbnail || song.thumbnailUrl,
          });
          row.continue();
        };
      }
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error ?? new Error("BEATDASH library could not be opened"));
  });
}

function uuid(prefix: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${id}`;
}

// All lookups and writes share one transaction. Network/hash work finishes before it.
async function transaction<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(stores, mode);
    const done = transactionDone(tx);
    // Attach a rejection handler immediately, including failures during an awaited request.
    void done.catch(() => {});
    try { const result = await action(tx); await done; return result; }
    catch (error) { try { tx.abort(); } catch { /* already completed */ } await done.catch(() => {}); throw error; }
  } finally { db.close(); }
}

async function mediaFingerprint(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return `v2:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

interface SaveOptions { cacheMedia?: boolean; nativeMedia?: boolean; songId?: string; }

export function chartVariantKey(difficulty: string, profile?: "mobile" | "desktop"): string {
  return `${difficulty.toLowerCase()}:${profile ?? "legacy"}`;
}

export async function saveAnalysisToLibrary(analysis: AnalysisResponse, options: SaveOptions = {}): Promise<LibraryBundle> {
  let mediaBlob: Blob | undefined;
  let fingerprint = `native:${analysis.id}`;
  let legacyId: string | undefined;
  if (!options.songId && !options.nativeMedia) {
    if (options.cacheMedia === false) throw new Error("저장된 곡 ID가 필요합니다.");
    const response = await fetch(analysis.mediaUrl);
    if (!response.ok) throw new Error(`미디어 저장 실패 (${response.status})`);
    mediaBlob = await response.blob();
    if (mediaBlob.size === 0) throw new Error("미디어 파일이 비어 있습니다.");
    fingerprint = await mediaFingerprint(mediaBlob);
    // Preserve an existing v4 entry only when its actual cached bytes match.
    const legacy = await transaction([SONGS], "readonly", async (tx) =>
      await requestToPromise(tx.objectStore(SONGS).index("fingerprint").get(makeSongFingerprint(analysis.originalName, analysis.report.duration, analysis.chart.bpm || analysis.report.bpm))) as LibrarySong | undefined);
    if (legacy?.mediaBlob && await mediaFingerprint(legacy.mediaBlob) === fingerprint) legacyId = legacy.id;
  }
  const sourceThumbnailUrl = (typeof analysis.originalThumbnailUrl === "string" ? analysis.originalThumbnailUrl.trim() : "") || undefined;
  const persistentThumbnail = await persistOriginalThumbnail(sourceThumbnailUrl);
  return transaction([SONGS, CHARTS], "readwrite", async (tx) => {
    const songs = tx.objectStore(SONGS);
    const existing = await requestToPromise(options.songId ? songs.get(options.songId) : songs.index("fingerprint").get(fingerprint)) as LibrarySong | undefined;
    const old = existing ?? (legacyId ? await requestToPromise(songs.get(legacyId)) as LibrarySong | undefined : undefined);
    if (options.songId && !old) throw new Error("곡이 삭제되었습니다. Library에서 다시 선택해 주세요.");
    const now = Date.now();
    const sourceOriginalTitle = (typeof analysis.originalTitle === "string" ? analysis.originalTitle.trim() : "") || analysis.chart.title?.trim() || analysis.originalName;
    const sourceThumbnail = persistentThumbnail;
    const song: LibrarySong = old ? {
      ...old,
      fingerprint: options.songId ? old.fingerprint : fingerprint,
      originalTitle: old.originalTitle || sourceOriginalTitle,
      originalThumbnail: old.originalThumbnail || old.thumbnailUrl || sourceThumbnail,
      updatedAt: now,
    } : {
      id: uuid("song"), fingerprint,
      title: sourceOriginalTitle,
      originalTitle: sourceOriginalTitle,
      originalName: analysis.originalName,
      bpm: analysis.chart.bpm || analysis.report.bpm || 0,
      durationSec: analysis.report.duration || 0,
      mediaKind: analysis.mediaKind, mediaName: analysis.originalName,
      mediaType: mediaBlob?.type ?? "", mediaBlob, sourceUrl: analysis.mediaUrl,
      originalThumbnail: sourceThumbnail, thumbnailUrl: sourceThumbnail,
      timingOffsetMs: 0, createdAt: now, updatedAt: now,
    };
    const difficulty = analysis.chart.difficulty.toLowerCase();
    const charts = tx.objectStore(CHARTS);
    const variantKey = chartVariantKey(difficulty, analysis.chart.platformProfile);
    // The AI slot only: Maker edits and Community downloads of the same difficulty/platform are never replaced.
    const oldChart = await requestToPromise(charts.index("songChartSlot").get([song.id, variantKey])) as LibraryChart | undefined;
    const sameChart = oldChart && JSON.stringify({ ...oldChart.chart, title: "" }) === JSON.stringify({ ...analysis.chart, title: "" });
    const chart: LibraryChart = {
      ...(oldChart ?? {}),
      id: oldChart?.id ?? uuid("chart"), songId: song.id, difficulty,
      variantKey, slotKey: variantKey, platformProfile: analysis.chart.platformProfile,
      scoringVersion: analysis.chart.scoringVersion ?? 1,
      level: analysis.chart.level, noteCount: analysis.chart.notes.length, chart: analysis.chart,
      generatorVersion: analysis.report.generatorVersion, seed: analysis.report.seed,
      createdAt: oldChart?.createdAt ?? now, updatedAt: now,
      origin: oldChart?.origin ?? "AI_GENERATED",
      chartVersion: oldChart ? oldChart.chartVersion + (sameChart ? 0 : 1) : 1,
      cloudPublished: oldChart?.cloudPublished ?? false, authorId: oldChart?.authorId,
    };
    songs.put(song); charts.put(chart);
    return { song, charts: [chart] };
  });
}

export async function listLibrary(): Promise<LibraryBundle[]> {
  return transaction([SONGS, CHARTS], "readonly", async (tx) => {
    const songs = await requestToPromise(tx.objectStore(SONGS).getAll()) as LibrarySong[];
    const charts = await requestToPromise(tx.objectStore(CHARTS).getAll()) as LibraryChart[];
    return songs.map((song) => ({ song, charts: charts.filter((chart) => chart.songId === song.id) }))
      .sort((a, b) => (b.song.lastPlayedAt ?? b.song.updatedAt) - (a.song.lastPlayedAt ?? a.song.updatedAt));
  });
}

export async function getLibrarySong(songId: string): Promise<LibraryBundle | null> {
  return transaction([SONGS, CHARTS], "readonly", async (tx) => {
    const song = await requestToPromise(tx.objectStore(SONGS).get(songId)) as LibrarySong | undefined;
    if (!song) return null;
    const charts = await requestToPromise(tx.objectStore(CHARTS).index("songId").getAll(songId)) as LibraryChart[];
    return { song, charts };
  });
}

async function updateSong(songId: string, changes: Partial<LibrarySong>): Promise<void> {
  return transaction([SONGS], "readwrite", async (tx) => {
    const store = tx.objectStore(SONGS);
    const song = await requestToPromise(store.get(songId)) as LibrarySong | undefined;
    if (!song) throw new Error("곡을 찾을 수 없습니다.");
    store.put({ ...song, ...changes, updatedAt: Date.now() });
  });
}

export async function updateSongTitle(songId: string, title: string): Promise<void> {
  if (title.trim()) await updateSong(songId, { title: title.trim() });
}

export async function updateSongOffset(songId: string, timingOffsetMs: number): Promise<void> {
  await updateSong(songId, { timingOffsetMs: normalizeTimingOffsetMs(timingOffsetMs) });
}

export async function deleteSong(songId: string): Promise<void> {
  return transaction([SONGS, CHARTS, RECORDS], "readwrite", async (tx) => {
    const charts = await requestToPromise(tx.objectStore(CHARTS).index("songId").getAll(songId)) as LibraryChart[];
    const records = await requestToPromise(tx.objectStore(RECORDS).index("songId").getAll(songId)) as PlayRecord[];
    tx.objectStore(SONGS).delete(songId);
    for (const chart of charts) tx.objectStore(CHARTS).delete(chart.id);
    for (const record of records) tx.objectStore(RECORDS).delete(record.id);
  });
}

export async function getRecordsForChart(chartId: string): Promise<PlayRecord[]> {
  return transaction([CHARTS, RECORDS], "readonly", async (tx) => {
    const chart = await requestToPromise(tx.objectStore(CHARTS).get(chartId)) as LibraryChart | undefined;
    if (!chart) return [];
    const records = await requestToPromise(tx.objectStore(RECORDS).index("chartId").getAll(chartId)) as PlayRecord[];
    return records.filter((record) => (record.chartVersion ?? 1) === chart.chartVersion &&
      (record.scoringVersion ?? 1) === (chart.chart.scoringVersion ?? 1)).sort((a, b) => b.playedAt - a.playedAt);
  });
}

export async function getBestRecord(chartId: string): Promise<BestRecord | null> {
  return summarizeRecords(await getRecordsForChart(chartId));
}

export async function savePlayResult(input: {
  songId: string; chartId: string; chartVersion?: number; difficulty: string;
  result: GameResult; offsetMs: number; practice?: boolean;
}): Promise<RecordFeedback> {
  return transaction([SONGS, CHARTS, RECORDS], "readwrite", async (tx) => {
    const chart = await requestToPromise(tx.objectStore(CHARTS).get(input.chartId)) as LibraryChart | undefined;
    const song = await requestToPromise(tx.objectStore(SONGS).get(input.songId)) as LibrarySong | undefined;
    if (!song || !chart || chart.songId !== song.id) throw new Error("곡 또는 채보가 삭제되어 기록을 저장할 수 없습니다.");
    if (input.chartVersion !== undefined && input.chartVersion !== chart.chartVersion) throw new Error("채보가 변경되어 기록을 저장할 수 없습니다.");
    const records = await requestToPromise(tx.objectStore(RECORDS).index("chartId").getAll(chart.id)) as PlayRecord[];
    const scoringVersion = input.result.scoringVersion ?? chart.chart.scoringVersion ?? 1;
    if (scoringVersion !== (chart.chart.scoringVersion ?? 1)) throw new Error("점수 규칙이 변경되어 기록을 저장할 수 없습니다.");
    const previous = summarizeRecords(records.filter((record) => (record.chartVersion ?? 1) === chart.chartVersion && (record.scoringVersion ?? 1) === scoringVersion));
    const feedback = buildRecordFeedback(previous, input.result);
    const record: PlayRecord = {
      id: uuid("play"), songId: song.id, chartId: chart.id, chartVersion: chart.chartVersion,
      scoringVersion, platform: defaultChartPlatform(), chartProfile: chart.chart.platformProfile,
      holdTickScore: input.result.holdTickScore ?? 0,
      difficulty: chart.difficulty, playedAt: Date.now(), score: input.result.score,
      accuracy: input.result.accuracyPercent, maxCombo: input.result.maxCombo,
      perfect: input.result.perfect, great: input.result.great, good: input.result.good, miss: input.result.miss,
      clearType: getClearType(input.result), practice: input.practice ?? false,
      offsetMs: normalizeTimingOffsetMs(input.offsetMs),
    };
    tx.objectStore(RECORDS).put(record);
    tx.objectStore(SONGS).put({ ...song, lastPlayedAt: record.playedAt, updatedAt: record.playedAt });
    return feedback;
  });
}

export async function getBestRecordsForSong(songId: string): Promise<Record<string, BestRecord | null>> {
  const bundle = await getLibrarySong(songId);
  if (!bundle) return {};
  const entries = await Promise.all(bundle.charts.map(async (chart) => [chart.id, await getBestRecord(chart.id)] as const));
  return Object.fromEntries(entries);
}

export function mediaUrlForSong(song: LibrarySong): string | null {
  if (song.mediaBlob) return URL.createObjectURL(song.mediaBlob);
  return song.sourceUrl ?? null;
}

export async function updateSongThumbnail(songId: string, thumbnailUrl: string): Promise<void> {
  // Read/check/write atomically so a delayed frame capture cannot replace source artwork.
  await transaction([SONGS], "readwrite", async (tx) => {
    const store = tx.objectStore(SONGS);
    const song = await requestToPromise(store.get(songId)) as LibrarySong | undefined;
    if (!song) throw new Error("곡을 찾을 수 없습니다.");
    if (song.originalThumbnail || song.thumbnailUrl) return;
    store.put({ ...song, originalThumbnail: thumbnailUrl, thumbnailUrl });
  });
}

export async function updateSongCustomCover(songId: string, customCover?: string): Promise<void> {
  await updateSong(songId, { customCover });
}

export function artworkForSong(song: LibrarySong): string | undefined {
  return song.customCover || song.originalThumbnail || song.thumbnailUrl;
}

// ===== v5 Phase 2: Maker edits and Community downloads =====

function sortNotes(notes: readonly ChartNote[]): ChartNote[] {
  return notes.map((note) => ({ ...note })).sort((a, b) => a.time - b.time || a.lane - b.lane);
}

/** Structural sanity only (playability is the validator's job): corrupt data must never reach the Library. */
function assertStorableChart(chart: Chart): void {
  if (!validateChart(chart)) throw new Error("채보 형식이 올바르지 않아 저장할 수 없습니다.");
  for (const note of chart.notes) {
    if (!Number.isFinite(note.time) || (note.type === "hold" && !(Number.isFinite(note.duration) && note.duration > 0))) {
      throw new Error("시간 값이 올바르지 않은 노트가 있어 저장할 수 없습니다.");
    }
  }
}

export function labelForDifficulty(difficulty: string, suffix: string): string {
  return `${difficultyLabel(difficulty)} ${suffix}`;
}

export interface SaveEditedChartInput {
  songId: string;
  /** Update this MANUAL_EDITED chart in place. */
  chartId?: string;
  /** Create a new MANUAL_EDITED chart derived from this chart (AI original, Community or another edit). */
  parentChartId?: string;
  notes: readonly ChartNote[];
  authorId: string;
  label?: string;
}

/**
 * Saves a Maker edit without touching its source: a new edit always gets its own chart ID and slot.
 * A note list identical to the source is refused - an untouched AI chart never becomes "human edited".
 */
export async function saveEditedChart(input: SaveEditedChartInput): Promise<LibraryChart> {
  const notes = sortNotes(input.notes);
  return transaction([SONGS, CHARTS], "readwrite", async (tx) => {
    const songs = tx.objectStore(SONGS);
    const charts = tx.objectStore(CHARTS);
    const song = await requestToPromise(songs.get(input.songId)) as LibrarySong | undefined;
    if (!song) throw new Error("곡이 삭제되었습니다. Library에서 다시 선택해 주세요.");
    const now = Date.now();
    if (input.chartId) {
      const existing = await requestToPromise(charts.get(input.chartId)) as LibraryChart | undefined;
      if (!existing || existing.songId !== song.id) throw new Error("편집 중인 채보가 삭제되었습니다.");
      if (existing.origin !== "MANUAL_EDITED") throw new Error("AI 원본이나 다운로드 채보는 직접 덮어쓸 수 없습니다.");
      const parent = existing.parentChartId ? await requestToPromise(charts.get(existing.parentChartId)) as LibraryChart | undefined : undefined;
      if (parent && notesEqual(parent.chart.notes, notes)) throw new Error("원본과 같은 채보입니다. 노트를 수정한 뒤 저장해 주세요.");
      const changed = !notesEqual(existing.chart.notes, notes);
      const chart: Chart = { ...existing.chart, notes };
      assertStorableChart(chart);
      const updated: LibraryChart = {
        ...existing, chart, noteCount: notes.length, updatedAt: changed ? now : existing.updatedAt,
        chartVersion: existing.chartVersion + (changed ? 1 : 0),
        // Local changes are not on the server until the author shares them again.
        cloudPublished: changed ? false : existing.cloudPublished,
        label: input.label?.trim() || existing.label,
      };
      charts.put(updated);
      return updated;
    }
    if (!input.parentChartId) throw new Error("편집할 원본 채보가 필요합니다.");
    const parent = await requestToPromise(charts.get(input.parentChartId)) as LibraryChart | undefined;
    if (!parent || parent.songId !== song.id) throw new Error("원본 채보가 삭제되었습니다.");
    if (notesEqual(parent.chart.notes, notes)) throw new Error("원본과 같은 채보입니다. 노트를 수정한 뒤 저장해 주세요.");
    const id = uuid("chart");
    const variantKey = parent.variantKey ?? chartVariantKey(parent.difficulty, parent.chart.platformProfile);
    const chart: Chart = { ...parent.chart, notes };
    assertStorableChart(chart);
    const created: LibraryChart = {
      id, songId: song.id, difficulty: parent.difficulty.toLowerCase(), level: parent.level,
      variantKey, slotKey: `${variantKey}:edit:${id}`, platformProfile: parent.chart.platformProfile,
      scoringVersion: parent.chart.scoringVersion ?? 1,
      noteCount: notes.length, chart, generatorVersion: parent.generatorVersion, seed: parent.seed,
      createdAt: now, updatedAt: now, origin: "MANUAL_EDITED", chartVersion: 1, cloudPublished: false,
      authorId: input.authorId, parentChartId: parent.id,
      label: input.label?.trim() || labelForDifficulty(parent.difficulty, "편집본"),
    };
    charts.put(created);
    return created;
  });
}

export interface CommunityChartImport {
  cloudChartId: string;
  authorId: string;
  title: string;
  description?: string;
  difficulty: string;
  level: number;
  platformProfile: ChartPlatform;
  chart: Chart;
}

/** Adds a downloaded chart to an existing Library song. Re-downloading updates that copy only. */
export async function saveCommunityChart(songId: string, item: CommunityChartImport): Promise<LibraryChart> {
  const chart: Chart = { ...item.chart, platformProfile: item.platformProfile, notes: sortNotes(item.chart.notes) };
  assertStorableChart(chart);
  return transaction([SONGS, CHARTS], "readwrite", async (tx) => {
    const song = await requestToPromise(tx.objectStore(SONGS).get(songId)) as LibrarySong | undefined;
    if (!song) throw new Error("연결할 곡이 Library에 없습니다.");
    const charts = tx.objectStore(CHARTS);
    const difficulty = item.difficulty.toLowerCase();
    const variantKey = chartVariantKey(difficulty, item.platformProfile);
    const slotKey = `${variantKey}:community:${item.cloudChartId}`;
    const existing = await requestToPromise(charts.index("songChartSlot").get([song.id, slotKey])) as LibraryChart | undefined;
    const now = Date.now();
    const changed = !existing || !notesEqual(existing.chart.notes, chart.notes);
    const saved: LibraryChart = {
      ...(existing ?? {}),
      id: existing?.id ?? uuid("chart"), songId: song.id, difficulty, level: item.level,
      variantKey, slotKey, platformProfile: item.platformProfile, scoringVersion: chart.scoringVersion ?? 1,
      noteCount: chart.notes.length, chart: existing && !changed ? existing.chart : chart,
      createdAt: existing?.createdAt ?? now, updatedAt: changed ? now : existing!.updatedAt,
      origin: "COMMUNITY", chartVersion: existing ? existing.chartVersion + (changed ? 1 : 0) : 1,
      cloudPublished: false, authorId: item.authorId, cloudChartId: item.cloudChartId,
      label: item.title.trim() || labelForDifficulty(difficulty, "커뮤니티"), description: item.description,
    };
    charts.put(saved);
    return saved;
  });
}

export async function getChart(chartId: string): Promise<LibraryChart | null> {
  return transaction([CHARTS], "readonly", async (tx) => (await requestToPromise(tx.objectStore(CHARTS).get(chartId)) as LibraryChart | undefined) ?? null);
}

export async function markChartPublished(chartId: string, cloudChartId: string): Promise<LibraryChart> {
  return transaction([CHARTS], "readwrite", async (tx) => {
    const store = tx.objectStore(CHARTS);
    const chart = await requestToPromise(store.get(chartId)) as LibraryChart | undefined;
    if (!chart) throw new Error("채보를 찾을 수 없습니다.");
    if (chart.origin !== "MANUAL_EDITED") throw new Error("사람이 편집한 채보만 공유할 수 있습니다.");
    const updated = { ...chart, cloudChartId, cloudPublished: true };
    store.put(updated);
    return updated;
  });
}

/** Removes one Maker/Community chart and its own records. AI originals are never deleted here. */
export async function deleteDerivedChart(chartId: string): Promise<void> {
  return transaction([CHARTS, RECORDS], "readwrite", async (tx) => {
    const chart = await requestToPromise(tx.objectStore(CHARTS).get(chartId)) as LibraryChart | undefined;
    if (!chart) return;
    if (isAiOriginal(chart)) throw new Error("AI 원본 채보는 삭제할 수 없습니다.");
    const records = await requestToPromise(tx.objectStore(RECORDS).index("chartId").getAll(chartId)) as PlayRecord[];
    tx.objectStore(CHARTS).delete(chartId);
    for (const record of records) tx.objectStore(RECORDS).delete(record.id);
  });
}
