/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import {
  deleteDerivedChart, getBestRecord, getChart, getLibrarySong, getRecordsForChart, markChartPublished, saveAnalysisToLibrary,
  saveCommunityChart, saveEditedChart, savePlayResult,
} from "../library/db";
import type { AnalysisResponse } from "../web/types";
import type { LibraryBundle, LibraryChart } from "../library/types";
import type { ChartNote } from "../types/chart";

function analysis(platformProfile?: "mobile" | "desktop", notes: ChartNote[] = [{ time: 1, lane: 0, type: "tap" }, { time: 2, lane: 1, type: "tap" }]): AnalysisResponse {
  return { id: "a".repeat(32), originalName: "source.wav", mediaUrl: "/api/media/a", mediaKind: "audio",
    chart: { title: "Song", artist: "test", offset: 0, bpm: 120, difficulty: "hard", level: 10, notes, ...(platformProfile ? { platformProfile, scoringVersion: 2 as const, version: 5 } : {}) },
    report: { duration: 30, bpm: 120, generatorVersion: "test", seed: 42 } as AnalysisResponse["report"] };
}
const result = { perfect: 2, great: 0, good: 0, miss: 0, score: 1000000, accuracyPercent: 100, maxCombo: 2, rank: "SSS" as const };
const play = (chart: LibraryChart, scoringVersion?: 1 | 2) => savePlayResult({ songId: chart.songId, chartId: chart.id, chartVersion: chart.chartVersion, difficulty: chart.difficulty, result: { ...result, scoringVersion }, offsetMs: 0 });
const edited = (chart: LibraryChart): ChartNote[] => [...chart.chart.notes, { time: 3, lane: 2, type: "tap" }];

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new NodeBlob(["media"], { type: "audio/wav" }) })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Maker save keeps the AI original", () => {
  it("creates a separate human-edited chart and never modifies the AI source", async () => {
    const saved = await saveAnalysisToLibrary(analysis("mobile"));
    const ai = saved.charts[0];
    const human = await saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: edited(ai), authorId: "author-1" });
    expect(human).toMatchObject({ origin: "MANUAL_EDITED", parentChartId: ai.id, authorId: "author-1", chartVersion: 1, cloudPublished: false,
      difficulty: "hard", platformProfile: "mobile", variantKey: "hard:mobile", scoringVersion: 2 });
    expect(human.id).not.toBe(ai.id);
    expect(human.slotKey).toBe(`hard:mobile:edit:${human.id}`);
    expect(human.chart.notes).toHaveLength(3);
    const reloaded = await getLibrarySong(ai.songId);
    expect(reloaded?.charts).toHaveLength(2);
    expect(reloaded?.charts.find((chart) => chart.id === ai.id)).toEqual(ai);
  });

  it("refuses to save an unmodified copy as human edited", async () => {
    const ai = (await saveAnalysisToLibrary(analysis("mobile"))).charts[0];
    await expect(saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: ai.chart.notes, authorId: "a" })).rejects.toThrow("원본과 같은");
    // Reordered or float-noise copies are still the original.
    await expect(saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: [...ai.chart.notes].reverse().map((n) => ({ ...n, time: n.time + 0.0002 })), authorId: "a" })).rejects.toThrow("원본과 같은");
    expect((await getLibrarySong(ai.songId))?.charts).toHaveLength(1);
  });

  it("updates an existing edit in place, bumping chartVersion only when notes change, and reloads", async () => {
    const ai = (await saveAnalysisToLibrary(analysis("desktop"))).charts[0];
    const first = await saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: edited(ai), authorId: "a" });
    const same = await saveEditedChart({ songId: ai.songId, chartId: first.id, notes: first.chart.notes, authorId: "a" });
    expect(same.chartVersion).toBe(1);
    const changed = await saveEditedChart({ songId: ai.songId, chartId: first.id, notes: [...first.chart.notes, { time: 4, lane: 3, type: "hold", duration: 0.5 }], authorId: "a" });
    expect(changed).toMatchObject({ id: first.id, chartVersion: 2 });
    expect((await getChart(first.id))?.chart.notes).toHaveLength(4);
    // Editing it back to the AI original is refused.
    await expect(saveEditedChart({ songId: ai.songId, chartId: first.id, notes: ai.chart.notes, authorId: "a" })).rejects.toThrow("원본과 같은");
  });

  it("AI regeneration replaces only the AI slot; edits, community charts and their records survive", async () => {
    const ai = (await saveAnalysisToLibrary(analysis("mobile"))).charts[0];
    const human = await saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: edited(ai), authorId: "a" });
    const community = await saveCommunityChart(ai.songId, { cloudChartId: "c".repeat(32), authorId: "someone", title: "Shared", difficulty: "Hard", level: 11, platformProfile: "mobile",
      chart: { ...ai.chart, notes: [{ time: 5, lane: 0, type: "tap" }] } });
    await play(ai, 2); await play(human, 2); await play(community, 2); await play(community, 2);
    const regenerated = await saveAnalysisToLibrary(analysis("mobile", [{ time: 7, lane: 3, type: "tap" }]), { songId: ai.songId });
    expect(regenerated.charts[0]).toMatchObject({ id: ai.id, chartVersion: 2, origin: "AI_GENERATED" });
    expect((await getChart(human.id))?.chart.notes).toEqual(human.chart.notes);
    expect((await getChart(community.id))?.chart.notes).toEqual(community.chart.notes);
    // Records stay per chart ID: none are mixed or lost.
    expect((await getRecordsForChart(human.id))).toHaveLength(1);
    expect((await getBestRecord(community.id))?.playCount).toBe(2);
    expect(await getBestRecord(ai.id)).toBeNull(); // AI chart changed -> new chartVersion starts fresh
  });

  it("protects AI originals and an unsupported overwrite path", async () => {
    const ai = (await saveAnalysisToLibrary(analysis("mobile"))).charts[0];
    await expect(saveEditedChart({ songId: ai.songId, chartId: ai.id, notes: edited(ai), authorId: "a" })).rejects.toThrow("덮어쓸 수 없습니다");
    await expect(deleteDerivedChart(ai.id)).rejects.toThrow("AI 원본");
    await expect(markChartPublished(ai.id, "x")).rejects.toThrow("사람이 편집한");
    expect(await getChart(ai.id)).toEqual(ai);
  });

  it("re-downloading a community chart updates that copy and separates its records by version", async () => {
    const ai = (await saveAnalysisToLibrary(analysis("desktop"))).charts[0];
    const item = { cloudChartId: "d".repeat(32), authorId: "other", title: "Remix", difficulty: "hard", level: 12, platformProfile: "desktop" as const,
      chart: { ...ai.chart, notes: [{ time: 2, lane: 1, type: "tap" }] as ChartNote[] } };
    const first = await saveCommunityChart(ai.songId, item);
    expect(first).toMatchObject({ origin: "COMMUNITY", cloudChartId: item.cloudChartId, authorId: "other", label: "Remix", chartVersion: 1 });
    await play(first, 2);
    const same = await saveCommunityChart(ai.songId, item);
    expect(same).toMatchObject({ id: first.id, chartVersion: 1 });
    const updated = await saveCommunityChart(ai.songId, { ...item, chart: { ...item.chart, notes: [{ time: 2.5, lane: 1, type: "tap" }] } });
    expect(updated).toMatchObject({ id: first.id, chartVersion: 2 });
    expect(await getBestRecord(first.id)).toBeNull();
    expect((await getLibrarySong(ai.songId))?.charts).toHaveLength(2);
    await deleteDerivedChart(first.id);
    expect((await getLibrarySong(ai.songId))?.charts.map((chart) => chart.id)).toEqual([ai.id]);
  });

  it("rejects corrupt note data before it reaches the Library", async () => {
    const ai = (await saveAnalysisToLibrary(analysis("mobile"))).charts[0];
    await expect(saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: [{ time: Number.NaN, lane: 0, type: "tap" }], authorId: "a" })).rejects.toThrow();
    await expect(saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: [{ time: 1, lane: 0, type: "hold", duration: 0 }], authorId: "a" })).rejects.toThrow();
    await expect(saveCommunityChart("missing-song", { cloudChartId: "e".repeat(32), authorId: "x", title: "", difficulty: "hard", level: 1, platformProfile: "mobile", chart: ai.chart })).rejects.toThrow();
  });
});

/** Builds an on-disk database exactly as an older release left it, then opens it with the current code. */
async function seedLegacyDb(version: 3 | 4, bundle: LibraryBundle, records: unknown[]) {
  vi.stubGlobal("indexedDB", new IDBFactory());
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("BEATDASH_DB", version);
    req.onupgradeneeded = () => {
      const db = req.result;
      const songs = db.createObjectStore("songs", { keyPath: "id" });
      songs.createIndex("fingerprint", "fingerprint", { unique: true }); songs.createIndex("updatedAt", "updatedAt");
      const charts = db.createObjectStore("charts", { keyPath: "id" });
      charts.createIndex("songId", "songId");
      if (version === 3) charts.createIndex("songDifficulty", ["songId", "difficulty"], { unique: true });
      else charts.createIndex("songChartVariant", ["songId", "variantKey"], { unique: true });
      const plays = db.createObjectStore("playRecords", { keyPath: "id" });
      plays.createIndex("songId", "songId"); plays.createIndex("chartId", "chartId"); plays.createIndex("playedAt", "playedAt");
      const settings = db.createObjectStore("settings", { keyPath: "key" });
      songs.put({ ...bundle.song, customCover: "data:image/png;base64,cover", originalThumbnail: "data:image/jpeg;base64,thumb", timingOffsetMs: 23 });
      for (const chart of bundle.charts) {
        const old: Partial<LibraryChart> = { ...chart };
        delete old.slotKey; delete old.scoringVersion;
        if (version === 3) delete old.variantKey;
        charts.put(old);
      }
      for (const record of records) plays.put(record);
      settings.put({ key: "legacy-setting", value: 7 });
    };
    req.onsuccess = () => { req.result.close(); resolve(); };
    req.onerror = () => reject(req.error);
  });
}

describe("DB v5 migration", () => {
  for (const version of [3, 4] as const) {
    it(`upgrades a v${version} Library without losing songs, charts, records, media, cover, thumbnail, offset or settings`, async () => {
      const legacyChart = await saveAnalysisToLibrary(analysis());
      const mobile = await saveAnalysisToLibrary(analysis("mobile"), { songId: legacyChart.song.id });
      await play(legacyChart.charts[0]); await play(mobile.charts[0], 2);
      const bundle = (await getLibrarySong(legacyChart.song.id))!;
      const records = [...await getRecordsForChart(legacyChart.charts[0].id), ...await getRecordsForChart(mobile.charts[0].id)];
      const charts = version === 3 ? bundle.charts.filter((chart) => chart.chart.platformProfile === undefined) : bundle.charts;
      await seedLegacyDb(version, { ...bundle, charts }, records);

      const migrated = (await getLibrarySong(bundle.song.id))!;
      expect(migrated.song.mediaBlob?.size).toBe(bundle.song.mediaBlob?.size);
      expect(migrated.song).toMatchObject({ customCover: "data:image/png;base64,cover", originalThumbnail: "data:image/jpeg;base64,thumb", timingOffsetMs: 23 });
      expect(migrated.charts.map((chart) => chart.id).sort()).toEqual(charts.map((chart) => chart.id).sort());
      for (const chart of migrated.charts) {
        const before = charts.find((item) => item.id === chart.id)!;
        expect(chart.chart).toEqual(before.chart);
        expect(chart.slotKey).toBe(chart.variantKey);
        expect(chart.chartVersion).toBe(before.chartVersion);
        expect((await getBestRecord(chart.id))?.playCount).toBe(1);
      }
      // Settings store survives.
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open("BEATDASH_DB"); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      expect(db.version).toBe(5);
      const setting = await new Promise<{ value: number }>((resolve) => { const req = db.transaction("settings").objectStore("settings").get("legacy-setting"); req.onsuccess = () => resolve(req.result); });
      db.close();
      expect(setting.value).toBe(7);

      // After migration Maker edits coexist with the migrated AI chart of the same difficulty/platform.
      const target = migrated.charts[0];
      const human = await saveEditedChart({ songId: target.songId, parentChartId: target.id, notes: edited(target), authorId: "a" });
      expect((await getLibrarySong(bundle.song.id))?.charts).toHaveLength(charts.length + 1);
      expect(human.variantKey).toBe(target.variantKey);
      // And regeneration still finds the migrated AI slot instead of creating a duplicate.
      const regenerated = await saveAnalysisToLibrary(target.chart.platformProfile ? analysis(target.chart.platformProfile) : analysis(), { songId: target.songId });
      expect(regenerated.charts[0].id).toBe(target.id);
    });
  }
});
