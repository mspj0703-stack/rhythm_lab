/// <reference types="node" />
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { getBestRecord, getChart, getLibrarySong, listLibrary, saveAnalysisToLibrary, saveEditedChart, savePlayResult } from "../library/db";
import { checkShareEligibility, buildUploadPayload } from "../community/share";
import { shareChart } from "../community/shareFlow";
import { communityQueryString, type CommunityChartDetail, type CommunityChartSummary } from "../community/api";
import { findSongMatches } from "../community/matchSong";
import { CommunityScreen } from "../community/CommunityScreen";
import { SongDetailScreen } from "../components/v4/SongDetailScreen";
import { getAuthorIdentity } from "../library/author";
import type { AnalysisResponse } from "../web/types";
import type { LibraryBundle, LibraryChart } from "../library/types";
import type { ChartNote } from "../types/chart";

let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

function analysis(platformProfile?: "mobile" | "desktop", id = "a"): AnalysisResponse {
  return { id: id.repeat(32), originalName: `${id}.wav`, mediaUrl: `/api/media/${id}`, mediaKind: "audio", originalTitle: "Blue Sky",
    chart: { title: "Blue Sky", artist: "", offset: 0, bpm: 120, difficulty: "hard", level: 10, notes: [{ time: 1, lane: 0, type: "tap" }, { time: 2, lane: 1, type: "tap" }],
      ...(platformProfile ? { platformProfile, scoringVersion: 2 as const, version: 5 } : {}) },
    report: { duration: 30, bpm: 120, generatorVersion: "t", seed: 1 } as AnalysisResponse["report"] };
}
const extra: ChartNote = { time: 3, lane: 2, type: "tap" };
const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });

function summary(overrides: Partial<CommunityChartSummary> = {}): CommunityChartSummary {
  return { cloudChartId: "c".repeat(32), title: "Shared HARD", difficulty: "hard", level: 11, platformProfile: "mobile", chartVersion: 1, scoringVersion: 2,
    authorId: "11111111-2222-4333-8444-555555555555", createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z", downloadCount: 3, noteCount: 3, lastNoteSec: 3,
    song: { title: "Blue Sky", originalTitle: "Blue Sky", durationSec: 30, bpm: 120 }, ...overrides };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/media/")) return { ok: true, blob: async () => new NodeBlob([url], { type: "audio/wav" }) };
    return json({ items: [], total: 0 });
  });
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function waitFor(check: () => boolean, label: string) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error(`timed out: ${label}`);
}
async function seedHuman(platform: "mobile" | "desktop" | "legacy" = "mobile") {
  const ai = (await saveAnalysisToLibrary(analysis(platform === "legacy" ? undefined : platform))).charts[0];
  const human = await saveEditedChart({ songId: ai.songId, parentChartId: ai.id, notes: [...ai.chart.notes, extra], authorId: getAuthorIdentity().authorId });
  return { ai, human, bundle: (await getLibrarySong(ai.songId))! };
}

describe("share eligibility", () => {
  it("allows only validated human edits", async () => {
    const { ai, human, bundle } = await seedHuman();
    expect(checkShareEligibility(human, bundle)).toMatchObject({ ok: true, editSummary: { added: 1, removed: 0, unchanged: 2 } });
    expect(checkShareEligibility(ai, bundle).reasons.join()).toContain("AI가 생성한 원본");
    const community: LibraryChart = { ...human, origin: "COMMUNITY" };
    expect(checkShareEligibility(community, bundle).ok).toBe(false);
    const untouched: LibraryChart = { ...human, chart: { ...human.chart, notes: ai.chart.notes } };
    expect(checkShareEligibility(untouched, bundle).reasons.join()).toContain("원본과 같은");
    const broken: LibraryChart = { ...human, chart: { ...human.chart, notes: [...human.chart.notes, { time: 3, lane: 2, type: "tap" }] } };
    expect(checkShareEligibility(broken, bundle).reasons.join()).toContain("ERROR");
    const future: LibraryChart = { ...human, chart: { ...human.chart, version: 9 } };
    expect(checkShareEligibility(future, bundle).reasons.join()).toContain("버전");
  });

  it("refuses legacy charts without a platform profile", async () => {
    const { human, bundle } = await seedHuman("legacy");
    expect(checkShareEligibility(human, bundle).reasons.join()).toContain("Legacy");
  });

  it("builds an upload with chart JSON and song identity only - never media", async () => {
    const { human, bundle } = await seedHuman();
    const identity = getAuthorIdentity();
    const payload = buildUploadPayload(human, bundle, identity, checkShareEligibility(human, bundle), " 설명 ");
    expect(payload).toMatchObject({ origin: "human-edited", authorId: identity.authorId, description: "설명", chartVersion: 1,
      song: { title: "Blue Sky", durationSec: 30, bpm: 120 } });
    expect(payload.song.fingerprint).toMatch(/^v2:[0-9a-f]{64}$/);
    const text = JSON.stringify(payload);
    expect(text).not.toContain("mediaBlob");
    expect(text).not.toContain("blob:");
    expect(payload.chart.notes).toHaveLength(3);
  });

  it("uploads once, then updates the same cloud chart for later edits by the same author", async () => {
    const { human, bundle } = await seedHuman();
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => json(summary({ cloudChartId: "f".repeat(32), chartVersion: JSON.parse(String(init?.body)).chartVersion })));
    const shared = await shareChart(human, bundle, "first");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/community/charts", expect.objectContaining({ method: "POST" }));
    expect(shared).toMatchObject({ cloudChartId: "f".repeat(32), cloudPublished: true });
    const next = await saveEditedChart({ songId: human.songId, chartId: human.id, notes: [...human.chart.notes, { time: 5, lane: 3, type: "tap" }], authorId: human.authorId! });
    expect(next.cloudPublished).toBe(false);
    await shareChart(next, (await getLibrarySong(human.songId))!);
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/community/charts/${"f".repeat(32)}`, expect.objectContaining({ method: "PUT" }));
    expect(JSON.parse(String(fetchMock.mock.lastCall![1].body)).chartVersion).toBe(2);
  });

  it("does not call the server for an ineligible chart", async () => {
    const { ai, bundle } = await seedHuman();
    fetchMock.mockClear();
    await expect(shareChart(ai, bundle)).rejects.toThrow("AI");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("community browsing and download", () => {
  it("encodes search, sort, difficulty and platform filters", () => {
    expect(communityQueryString({ q: " blue ", sort: "downloads", difficulty: "extreme", platform: "desktop" })).toBe("q=blue&difficulty=extreme&platform=desktop&sort=downloads&limit=30");
    expect(communityQueryString({ difficulty: "all", platform: "all" })).toBe("sort=latest&limit=30");
  });

  it("matches Library songs by media hash first and never offers a too-short song", async () => {
    await saveAnalysisToLibrary(analysis("mobile", "a"));
    await saveAnalysisToLibrary(analysis("mobile", "b"));
    const library = await listLibrary();
    const hashed = library.find((item) => item.song.originalName === "a.wav")!;
    const exact = findSongMatches(library, { title: "x", durationSec: 30, bpm: 120, fingerprint: hashed.song.fingerprint }, 3);
    expect(exact[0]).toMatchObject({ level: "exact" });
    expect(exact[0].bundle.song.id).toBe(hashed.song.id);
    expect(findSongMatches(library, { title: "blue sky!", durationSec: 31, bpm: 120 }, 3).map((match) => match.level)).toEqual(["likely", "likely"]);
    expect(findSongMatches(library, { title: "Other", durationSec: 29, bpm: 120 }, 3).map((match) => match.level)).toEqual(["possible", "possible"]);
    expect(findSongMatches(library, { title: "Blue Sky", durationSec: 30, bpm: 120 }, 45)).toEqual([]);
    expect(findSongMatches(library, { title: "Blue Sky", durationSec: 90, bpm: 120 }, 3)).toEqual([]);
  });

  it("lists, filters and downloads into the matching Library song; records stay separate from the AI chart", async () => {
    const ai = (await saveAnalysisToLibrary(analysis("mobile"))).charts[0];
    await savePlayResult({ songId: ai.songId, chartId: ai.id, chartVersion: ai.chartVersion, difficulty: "hard", result: { perfect: 2, great: 0, good: 0, miss: 0, score: 999, accuracyPercent: 100, maxCombo: 2, rank: "SSS", scoringVersion: 2 }, offsetMs: 0 });
    const library = await listLibrary();
    const item = summary({ song: { title: "Blue Sky", durationSec: 30, bpm: 120, fingerprint: library[0].song.fingerprint } });
    const detail: CommunityChartDetail = { ...item, chartData: { ...ai.chart, notes: [{ time: 1, lane: 3, type: "tap" }, { time: 2, lane: 2, type: "hold", duration: 0.5 }, { time: 3, lane: 1, type: "flick" }] } };
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => init?.method === "POST" ? json(detail) : json({ items: [item], total: 1 }));
    const onImported = vi.fn();
    await act(async () => root.render(<CommunityScreen library={library} onBack={() => {}} onAddSong={() => {}} onImported={onImported} />));
    await waitFor(() => container.textContent!.includes("Shared HARD"), "list");
    const platform = [...container.querySelectorAll('[role="radio"]')].find((node) => node.textContent === "DESKTOP") as HTMLButtonElement;
    await act(async () => platform.click());
    await waitFor(() => String(fetchMock.mock.lastCall?.[0]).includes("platform=desktop"), "platform filter");
    const difficulty = container.querySelector('select[aria-label="난이도"]') as HTMLSelectElement;
    await act(async () => { difficulty.value = "hard"; difficulty.dispatchEvent(new Event("change", { bubbles: true })); });
    await waitFor(() => String(fetchMock.mock.lastCall?.[0]).includes("difficulty=hard"), "difficulty filter");
    const sort = container.querySelector('select[aria-label="정렬"]') as HTMLSelectElement;
    await act(async () => { sort.value = "downloads"; sort.dispatchEvent(new Event("change", { bubbles: true })); });
    await waitFor(() => String(fetchMock.mock.lastCall?.[0]).includes("sort=downloads"), "sort");
    const search = container.querySelector('input[aria-label="곡명 검색"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "blue"); search.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await waitFor(() => String(fetchMock.mock.lastCall?.[0]).includes("q=blue"), "search");
    await waitFor(() => container.querySelector(".community-row") !== null, "rows");
    await act(async () => (container.querySelector(".community-row") as HTMLButtonElement).click());
    expect(container.textContent).toContain("같은 미디어 파일");
    const download = container.querySelector(".community-download") as HTMLButtonElement;
    expect(download.disabled).toBe(false);
    await act(async () => download.click());
    await waitFor(() => onImported.mock.calls.length === 1, "import");
    const imported = onImported.mock.calls[0][1] as LibraryChart;
    expect(imported).toMatchObject({ origin: "COMMUNITY", cloudChartId: item.cloudChartId, authorId: item.authorId, songId: ai.songId });
    expect(fetchMock).toHaveBeenCalledWith(`/api/community/charts/${item.cloudChartId}/download`, { method: "POST" });
    expect(await getChart(ai.id)).toEqual(ai);
    expect(await getBestRecord(imported.id)).toBeNull();
    expect((await getBestRecord(ai.id))?.bestScore).toBe(999);
  });

  it("requires explicit confirmation for a non-exact song and explains a missing song", async () => {
    await saveAnalysisToLibrary(analysis("mobile"));
    const library = await listLibrary();
    const item = summary();
    fetchMock.mockImplementation(async () => json({ items: [item, summary({ cloudChartId: "d".repeat(32), title: "Unknown song chart", song: { title: "Nope", durationSec: 200, bpm: 90 } })], total: 2 }));
    await act(async () => root.render(<CommunityScreen library={library} onBack={() => {}} onAddSong={() => {}} onImported={() => {}} />));
    await waitFor(() => container.querySelectorAll(".community-row").length === 2, "rows");
    await act(async () => (container.querySelectorAll(".community-row")[0] as HTMLButtonElement).click());
    expect(container.textContent).toContain("확인 필요");
    const radio = container.querySelector('.community-matches input[type="radio"]') as HTMLInputElement;
    await act(async () => radio.click());
    expect((container.querySelector(".community-download") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => (container.querySelector('.community-confirm input') as HTMLInputElement).click());
    expect((container.querySelector(".community-download") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => (container.querySelectorAll(".community-row")[1] as HTMLButtonElement).click());
    expect(container.textContent).toContain("Library에서 이 곡을 찾지 못했습니다");
  });

  it("shows a readable error when the server is unreachable", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
    await act(async () => root.render(<CommunityScreen library={[]} onBack={() => {}} onAddSong={() => {}} onImported={() => {}} />));
    await waitFor(() => container.querySelector('[role="alert"]') !== null, "error");
    expect(container.textContent).toContain("연결할 수 없습니다");
  });
});

describe("song detail chart tools", () => {
  async function renderDetail(bundle: LibraryBundle, initialChartId?: string) {
    const handlers = { onEdit: vi.fn(), onShare: vi.fn(async () => {}), onDeleteChart: vi.fn(async () => {}) };
    await act(async () => root.render(<SongDetailScreen bundle={bundle} initialChartId={initialChartId} onBack={() => {}} onPlay={() => {}} onDelete={() => {}} onChanged={() => {}} onGenerateDifficulty={async () => {}} {...handlers} />));
    return handlers;
  }
  const findButton = (text: string) => [...container.querySelectorAll("button")].find((node) => node.textContent?.includes(text)) as HTMLButtonElement | undefined;

  it("labels origins, offers EDIT for every chart and SHARE only for human edits", async () => {
    const { ai, human, bundle } = await seedHuman();
    const handlers = await renderDetail(bundle, ai.id);
    expect(container.querySelectorAll(".origin-badge.ai").length).toBe(1);
    expect(container.querySelectorAll(".origin-badge.edit").length).toBe(1);
    expect(findButton("복제본 생성")).toBeTruthy();
    expect(findButton("COMMUNITY 공유")).toBeUndefined();
    expect(findButton("이 채보 삭제")).toBeUndefined();
    expect(findButton("REGENERATE")).toBeTruthy();
    await act(async () => findButton("복제본 생성")!.click());
    expect(handlers.onEdit).toHaveBeenCalledWith(ai);
    await act(async () => root.unmount()); root = createRoot(container);
    const again = await renderDetail(bundle, human.id);
    expect(findButton("REGENERATE")).toBeUndefined();
    vi.spyOn(window, "prompt").mockReturnValue("설명");
    await act(async () => findButton("COMMUNITY 공유")!.click());
    expect(again.onShare).toHaveBeenCalledWith(human, "설명");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await act(async () => findButton("이 채보 삭제")!.click());
    expect(again.onDeleteChart).toHaveBeenCalledWith(human);
  });

  it("disables SHARE and lists the reasons for a chart with validator ERRORs", async () => {
    const { human } = await seedHuman();
    const broken = await saveEditedChart({ songId: human.songId, chartId: human.id, notes: [...human.chart.notes, { time: 3.01, lane: 2, type: "tap" }], authorId: "a" });
    const refreshed = (await getLibrarySong(human.songId))!;
    await renderDetail(refreshed, broken.id);
    expect(findButton("COMMUNITY 공유")!.disabled).toBe(true);
    expect(container.querySelector(".share-reasons")?.textContent).toContain("ERROR");
  });
});
