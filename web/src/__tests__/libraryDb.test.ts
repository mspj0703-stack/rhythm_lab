/// <reference types="node" />
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { deleteSong, getBestRecord, getLibrarySong, getRecordsForChart, listLibrary, saveAnalysisToLibrary, savePlayResult, updateSongTitle, updateSongOffset } from "../library/db";
import { makeSongFingerprint } from "../library/model";
import { combineTimingOffsets, loadTimingOffsetMs } from "../settings/timingOffset";
import { loadNoteSpeed } from "../settings/noteSpeed";
import { loadAudioSettings } from "../audio/sfx";
import type { AnalysisResponse } from "../web/types";
import type { LibraryBundle } from "../library/types";

function analysis(overrides: Partial<AnalysisResponse> = {}): AnalysisResponse {
  return { id: "a".repeat(32), originalName: "source.wav", mediaUrl: "/api/media/a", mediaKind: "audio",
    chart: { title: "Song", artist: "test", offset: 0, bpm: 120, difficulty: "normal", level: 1, notes: [{ time: 1, lane: 0, type: "tap" }] },
    report: { duration: 4, bpm: 120, generatorVersion: "test", seed: 42 } as AnalysisResponse["report"], ...overrides };
}
const result = { perfect: 1, great: 0, good: 0, miss: 0, score: 1000000, accuracyPercent: 100, maxCombo: 1, rank: "SSS" as const };
const input = (bundle: LibraryBundle) => ({ songId: bundle.song.id, chartId: bundle.charts[0].id, chartVersion: bundle.charts[0].chartVersion, difficulty: "normal", result, offsetMs: 72 });
let bytes: string;
beforeEach(() => {
  bytes = "first media";
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new NodeBlob([bytes], { type: "audio/wav" }) })));
  localStorage.clear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mutate(stores: string[], action: (tx: IDBTransaction) => void) {
  const request = indexedDB.open("BEATDASH_DB", 1);
  const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(stores, "readwrite"); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); action(tx); }); }
  finally { db.close(); }
}

describe("v4 persisted Library regression", () => {
  it("does not merge different bytes with the same filename, duration and BPM", async () => {
    const first = await saveAnalysisToLibrary(analysis()); bytes = "different media";
    const second = await saveAnalysisToLibrary(analysis());
    expect(first.song.id).not.toBe(second.song.id); expect(await listLibrary()).toHaveLength(2);
  });
  it("deduplicates the same bytes despite renaming and preserves edited title and offset", async () => {
    const first = await saveAnalysisToLibrary(analysis());
    await updateSongTitle(first.song.id, "Custom"); await updateSongOffset(first.song.id, 20);
    const next = await saveAnalysisToLibrary(analysis({ originalName: "renamed.wav" }));
    expect(next.song.id).toBe(first.song.id); expect(next.song.title).toBe("Custom"); expect(next.song.timingOffsetMs).toBe(20);
    expect(next.song.originalTitle).toBe("Song"); expect(next.charts[0].chartVersion).toBe(1);
  });
  it("migrates matching legacy fingerprint without losing version-1 records", async () => {
    const first = await saveAnalysisToLibrary(analysis()); await savePlayResult(input(first));
    await mutate(["songs", "playRecords"], tx => {
      tx.objectStore("songs").put({ ...first.song, fingerprint: makeSongFingerprint("source.wav", 4, 120) });
      const req = tx.objectStore("playRecords").getAll(); req.onsuccess = () => req.result.forEach(record => { delete record.chartVersion; tx.objectStore("playRecords").put(record); });
    });
    const migrated = await saveAnalysisToLibrary(analysis()); expect(migrated.song.id).toBe(first.song.id);
    expect((await getBestRecord(first.charts[0].id))?.playCount).toBe(1);
  });
  it("keeps records on identical reimport, separates records on changed chart", async () => {
    const first = await saveAnalysisToLibrary(analysis()); await savePlayResult(input(first));
    await saveAnalysisToLibrary(analysis()); expect((await getRecordsForChart(first.charts[0].id))).toHaveLength(1);
    const changed = analysis(); changed.chart.notes[0].time = 2;
    const next = await saveAnalysisToLibrary(changed); expect(next.charts[0].chartVersion).toBe(2);
    expect(await getBestRecord(next.charts[0].id)).toBeNull();
    await expect(savePlayResult(input(first))).rejects.toThrow("변경");
    await savePlayResult(input(next)); expect(await getRecordsForChart(next.charts[0].id)).toHaveLength(1);
  });
  it("adds difficulty to explicit song despite changed metadata, keeping original media", async () => {
    const first = await saveAnalysisToLibrary(analysis());
    const other = analysis({ originalName: "video.mp4", mediaUrl: "/temporary", mediaKind: "video" }); other.chart.difficulty = "hard"; other.chart.bpm = 121;
    const added = await saveAnalysisToLibrary(other, { songId: first.song.id });
    expect(added.song.id).toBe(first.song.id); expect(added.song.sourceUrl).toBe(first.song.sourceUrl);
    expect((await getLibrarySong(first.song.id))?.charts).toHaveLength(2); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("concurrent saves create one song and one chart", async () => {
    const saved = await Promise.all([saveAnalysisToLibrary(analysis()), saveAnalysisToLibrary(analysis())]);
    expect(saved[0].song.id).toBe(saved[1].song.id); expect((await listLibrary())[0].charts).toHaveLength(1);
  });
  it("does not claim persistent save when media fetch fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);
    await expect(saveAnalysisToLibrary(analysis())).rejects.toThrow("404"); expect(await listLibrary()).toHaveLength(0);
  });
  it("rolls back both stores on quota/write failure and allows a later retry", async () => {
    const original = IDBObjectStore.prototype.put;
    const write = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "charts") throw new DOMException("Storage full", "QuotaExceededError");
      return original.call(this, value, key);
    });
    await expect(saveAnalysisToLibrary(analysis())).rejects.toThrow("Storage full");
    expect(await listLibrary()).toHaveLength(0);
    write.mockRestore();
    await saveAnalysisToLibrary(analysis()); expect(await listLibrary()).toHaveLength(1);
  });
  it("rejects an empty media file", async () => {
    bytes = ""; await expect(saveAnalysisToLibrary(analysis())).rejects.toThrow("비어");
  });
  it("native saved media uses stable local endpoint without duplicating large Blob", async () => {
    const saved = await saveAnalysisToLibrary(analysis({ mediaKind: "video", mediaUrl: `/api/video/${"a".repeat(32)}` }), { nativeMedia: true });
    expect(fetch).not.toHaveBeenCalled(); expect(saved.song.mediaBlob).toBeUndefined();
    expect(saved.song.sourceUrl).toContain("/api/video/");
    expect((await saveAnalysisToLibrary(analysis(), { nativeMedia: true })).song.id).toBe(saved.song.id);
  });
  it("deletes song, charts and all record versions atomically and rejects orphan writes", async () => {
    const saved = await saveAnalysisToLibrary(analysis()); await savePlayResult(input(saved));
    await deleteSong(saved.song.id); expect(await listLibrary()).toHaveLength(0);
    expect(await getRecordsForChart(saved.charts[0].id)).toHaveLength(0);
    await expect(savePlayResult(input(saved))).rejects.toThrow("삭제");
    await expect(saveAnalysisToLibrary(analysis(), { songId: saved.song.id })).rejects.toThrow("삭제");
  });
  it("preserves v3 note speed and device offset keys during library initialization", async () => {
    localStorage.setItem("rhythm-lab.note-speed.v1", "1.7");
    localStorage.setItem("rhythm-lab.timing-offset.v1", "72");
    await saveAnalysisToLibrary(analysis());
    expect(loadNoteSpeed()).toBeCloseTo(1.7); expect(loadTimingOffsetMs()).toBe(72);
  });
  it("combines device and song offsets and clamps both limits", () => {
    expect(combineTimingOffsets(72, 0)).toBe(72); expect(combineTimingOffsets(72, -20)).toBe(52);
    expect(combineTimingOffsets(280, 40)).toBe(300); expect(combineTimingOffsets(-280, -40)).toBe(-300);
  });
  it("guards corrupt audio settings against NaN volume and nonboolean enabled flag", () => {
    localStorage.setItem("beatdash.audio.v4", JSON.stringify({ masterVolume: "broken", sfxEnabled: "false" }));
    expect(Number.isFinite(loadAudioSettings().masterVolume)).toBe(true); expect(loadAudioSettings().sfxEnabled).toBe(true);
  });
});
