/// <reference types="node" />
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { MakerScreen } from "../maker/MakerScreen";
import { getLibrarySong, saveAnalysisToLibrary, saveEditedChart } from "../library/db";
import { createBlankDraft, isBlankDraft } from "../maker/blank";
import { checkShareEligibility, buildUploadPayload } from "../community/share";
import { getAuthorIdentity } from "../library/author";
import { SongDetailScreen } from "../components/v4/SongDetailScreen";
import type { LibraryBundle, LibraryChart } from "../library/types";
import type { AnalysisResponse } from "../web/types";
import { DEFAULT_AUDIO_SETTINGS } from "../audio/sfx";
import { DEFAULT_PREFERENCES } from "../settings/preferences";

let root: Root;
let container: HTMLDivElement;
const media = { url: "blob:maker-test", audioFallbackUrls: [], owned: false, revoke() {} };

function analysis(platformProfile: "mobile" | "desktop"): AnalysisResponse {
  return { id: "b".repeat(32), originalName: "song.wav", mediaUrl: "/api/media/b", mediaKind: "audio",
    chart: { title: "Song", artist: "", offset: 0, bpm: 120, difficulty: "hard", level: 10, version: 5, platformProfile, scoringVersion: 2,
      notes: [{ time: 1, lane: 0, type: "tap" }, { time: 1.5, lane: 1, type: "tap" }, { time: 2, lane: 2, type: "hold", duration: 0.5 }, { time: 3, lane: 3, type: "tap" }] },
    report: { duration: 20, bpm: 120, generatorVersion: "t", seed: 1 } as AnalysisResponse["report"] };
}

async function render(bundle: LibraryBundle, source: LibraryChart, onSaved = vi.fn(), onExit = vi.fn()) {
  await act(async () => root.render(<MakerScreen bundle={bundle} source={source} media={media} noteSpeed={3} timingOffsetMs={0}
    audioSettings={DEFAULT_AUDIO_SETTINGS} preferences={DEFAULT_PREFERENCES} onSaved={onSaved} onExit={onExit} />));
  return { onSaved, onExit };
}
const button = (label: string) => [...container.querySelectorAll("button")].find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label) as HTMLButtonElement;
const click = async (label: string) => { await act(async () => button(label).click()); };
const noteCount = () => container.querySelectorAll(".maker-note").length;
async function waitFor(check: () => boolean, label = "condition") {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new NodeBlob(["media"], { type: "audio/wav" }) })));
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function seed(platform: "mobile" | "desktop" = "mobile") {
  const saved = await saveAnalysisToLibrary(analysis(platform));
  return { bundle: (await getLibrarySong(saved.song.id))!, ai: saved.charts[0] };
}


vi.mock("../components/NoteFieldCanvas", () => ({ NoteFieldCanvas: () => <canvas /> }));

const manyNotes = Array.from({ length: 10 }, (_, i) => ({ time: 1 + i * 0.6, lane: (i % 4) as 0 | 1 | 2 | 3, type: "tap" as const }));

describe("Blank chart on an existing Library song", () => {
  it("builds an in-memory draft that reuses the song's BPM/offset and is never stored", async () => {
    const { bundle } = await seed("mobile");
    const draft = createBlankDraft(bundle, "extreme", "desktop");
    expect(isBlankDraft(draft)).toBe(true);
    expect(draft).toMatchObject({ songId: bundle.song.id, difficulty: "extreme", origin: "MANUAL_EDITED", noteCount: 0, platformProfile: "desktop" });
    expect(draft.chart).toMatchObject({ notes: [], bpm: 120, offset: 0, platformProfile: "desktop", scoringVersion: 2, difficulty: "Extreme" });
    expect(draft.parentChartId).toBeUndefined();
    expect((await getLibrarySong(bundle.song.id))!.charts).toHaveLength(1);
    expect(() => createBlankDraft(bundle, "insane", "mobile")).toThrow();
  });

  it("starts empty, needs a note to save, then stores a separate user chart without touching the AI original", async () => {
    const { bundle, ai } = await seed("mobile");
    const draft = createBlankDraft(bundle, "normal", "mobile");
    const onSaved = vi.fn();
    await act(async () => root.render(<MakerScreen blank bundle={bundle} source={draft} media={media} noteSpeed={3} timingOffsetMs={0}
      audioSettings={DEFAULT_AUDIO_SETTINGS} preferences={DEFAULT_PREFERENCES} onSaved={onSaved} onExit={vi.fn()} />));
    expect(noteCount()).toBe(0);
    expect(button("SAVE").disabled).toBe(true);
    await click("＋ F");
    expect(noteCount()).toBe(1);
    await click("SAVE");
    await waitFor(() => onSaved.mock.calls.length === 1, "save");
    const saved = onSaved.mock.calls[0][0] as LibraryChart;
    expect(saved).toMatchObject({ origin: "MANUAL_EDITED", difficulty: "normal", noteCount: 1, chartVersion: 1, platformProfile: "mobile" });
    expect(saved.id).not.toBe(draft.id);
    expect(saved.parentChartId).toBeUndefined();
    expect(saved.authorId).toBe(getAuthorIdentity().authorId);
    // Saving again updates the same chart instead of creating duplicates.
    await click("＋ J");
    await click("SAVE");
    await waitFor(() => onSaved.mock.calls.length === 2, "second save");
    const after = (await getLibrarySong(bundle.song.id))!;
    expect(after.charts).toHaveLength(2);
    const stored = after.charts.find((chart) => chart.id === saved.id)!;
    expect(stored).toMatchObject({ noteCount: 2, chartVersion: 2 });
    expect(after.charts.find((chart) => chart.id === ai.id)).toEqual(ai);
  });

  it("the saved chart survives an app restart: it reopens in the Maker with its notes", async () => {
    const { bundle } = await seed("mobile");
    const saved = await saveEditedChart({ songId: bundle.song.id, draft: createBlankDraft(bundle, "hard", "mobile"), notes: manyNotes, authorId: getAuthorIdentity().authorId });
    await act(async () => root.unmount()); root = createRoot(container);
    const reloaded = (await getLibrarySong(bundle.song.id))!;
    const chart = reloaded.charts.find((item) => item.id === saved.id)!;
    expect(chart.chart.notes).toHaveLength(10);
    await render(reloaded, chart);
    expect(noteCount()).toBeGreaterThan(0);          // the timeline only draws the visible window
    expect(container.textContent).toContain("저장됨");
    expect(button("SAVE").disabled).toBe(true);        // nothing changed since the stored version
  });

  it("refuses to store an empty chart and a draft for another song", async () => {
    const { bundle } = await seed("mobile");
    const draft = createBlankDraft(bundle, "easy", "mobile");
    await expect(saveEditedChart({ songId: bundle.song.id, draft, notes: [], authorId: "a" })).rejects.toThrow("노트를 하나 이상");
    await expect(saveEditedChart({ songId: bundle.song.id, draft: { ...draft, songId: "other" }, notes: manyNotes, authorId: "a" })).rejects.toThrow();
    expect((await getLibrarySong(bundle.song.id))!.charts).toHaveLength(1);
  });

  it("TEST PLAY works on an unsaved blank chart once it has notes and records nothing", async () => {
    const { bundle } = await seed("mobile");
    await act(async () => root.render(<MakerScreen blank bundle={bundle} source={createBlankDraft(bundle, "normal", "mobile")} media={media} noteSpeed={3} timingOffsetMs={0}
      audioSettings={DEFAULT_AUDIO_SETTINGS} preferences={DEFAULT_PREFERENCES} onSaved={vi.fn()} onExit={vi.fn()} />));
    await click("TEST PLAY");
    expect(container.textContent).toContain("노트가 없어 테스트할 수 없습니다");
    await click("＋ D");
    await click("TEST PLAY");
    expect(container.textContent).toContain("TEST PLAY · 기록 저장 안 함");
  });

  it("a saved blank chart with a playable layout passes the Community share conditions", async () => {
    const { bundle } = await seed("mobile");
    const saved = await saveEditedChart({ songId: bundle.song.id, draft: createBlankDraft(bundle, "normal", "mobile"), notes: manyNotes, authorId: getAuthorIdentity().authorId });
    const fresh = (await getLibrarySong(bundle.song.id))!;
    const eligibility = checkShareEligibility(saved, fresh);
    expect(eligibility.reasons).toEqual([]);
    expect(eligibility.ok).toBe(true);
    const payload = buildUploadPayload(saved, fresh, getAuthorIdentity(), eligibility);
    expect(payload).toMatchObject({ origin: "human-edited", editSummary: { added: 10, removed: 0 }, chart: { difficulty: "normal", platformProfile: "mobile" } });
  });

  it("Desktop blank charts cannot place Flick", async () => {
    const { bundle } = await seed("mobile");
    await act(async () => root.render(<MakerScreen blank bundle={bundle} source={createBlankDraft(bundle, "hard", "desktop")} media={media} noteSpeed={3} timingOffsetMs={0}
      audioSettings={DEFAULT_AUDIO_SETTINGS} preferences={DEFAULT_PREFERENCES} onSaved={vi.fn()} onExit={vi.fn()} />));
    expect(button("Flick").disabled).toBe(true);
    expect(container.textContent).toContain("PC");
  });

  it("Song detail offers platform + difficulty (MASTER included) and starts the Maker with them", async () => {
    const { bundle } = await seed("mobile");
    const onCreateBlank = vi.fn();
    await act(async () => root.render(<SongDetailScreen bundle={bundle} onBack={() => {}} onPlay={() => {}} onDelete={() => {}} onChanged={() => {}} onGenerateDifficulty={async () => {}} onCreateBlank={onCreateBlank} />));
    const platform = container.querySelector('select[aria-label="새 채보 플랫폼"]') as HTMLSelectElement;
    const difficulty = container.querySelector('select[aria-label="새 채보 난이도"]') as HTMLSelectElement;
    expect([...difficulty.options].map((option) => option.textContent)).toEqual(["EASY", "NORMAL", "HARD", "EXPERT", "MASTER"]);
    const set = (select: HTMLSelectElement, value: string) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); };
    await act(async () => { set(platform, "desktop"); set(difficulty, "extreme"); });
    await click("빈 채보로 Maker 시작");
    expect(onCreateBlank).toHaveBeenCalledWith("extreme", "desktop");
  });
});
