import { normalizeTimingOffsetMs } from "../settings/timingOffset";
import type { AnalysisResponse } from "../web/types";
import type { GameResult } from "../engine/resultCalculation";
import { buildRecordFeedback, getClearType, makeSongFingerprint, summarizeRecords } from "./model";
import type { BestRecord, LibraryBundle, LibraryChart, LibrarySong, PlayRecord, RecordFeedback } from "./types";

const DB_NAME = "BEATDASH_DB";
const DB_VERSION = 2;
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
      // v2 is additive: preserve all v3/v4 data and backfill artwork metadata in place.
      if (event.oldVersion < 2 && tx && db.objectStoreNames.contains(SONGS)) {
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
  return transaction([SONGS, CHARTS], "readwrite", async (tx) => {
    const songs = tx.objectStore(SONGS);
    const existing = await requestToPromise(options.songId ? songs.get(options.songId) : songs.index("fingerprint").get(fingerprint)) as LibrarySong | undefined;
    const old = existing ?? (legacyId ? await requestToPromise(songs.get(legacyId)) as LibrarySong | undefined : undefined);
    if (options.songId && !old) throw new Error("곡이 삭제되었습니다. Library에서 다시 선택해 주세요.");
    const now = Date.now();
    const sourceOriginalTitle = (typeof analysis.originalTitle === "string" ? analysis.originalTitle.trim() : "") || analysis.chart.title?.trim() || analysis.originalName;
    const sourceThumbnail = (typeof analysis.originalThumbnailUrl === "string" ? analysis.originalThumbnailUrl.trim() : "") || undefined;
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
    const oldChart = await requestToPromise(charts.index("songDifficulty").get([song.id, difficulty])) as LibraryChart | undefined;
    const sameChart = oldChart && JSON.stringify({ ...oldChart.chart, title: "" }) === JSON.stringify({ ...analysis.chart, title: "" });
    const chart: LibraryChart = {
      id: oldChart?.id ?? uuid("chart"), songId: song.id, difficulty,
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
    return records.filter((record) => (record.chartVersion ?? 1) === chart.chartVersion).sort((a, b) => b.playedAt - a.playedAt);
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
    const previous = summarizeRecords(records.filter((record) => (record.chartVersion ?? 1) === chart.chartVersion));
    const feedback = buildRecordFeedback(previous, input.result);
    const record: PlayRecord = {
      id: uuid("play"), songId: song.id, chartId: chart.id, chartVersion: chart.chartVersion,
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
  const entries = await Promise.all(bundle.charts.map(async (chart) => [chart.difficulty, await getBestRecord(chart.id)] as const));
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
