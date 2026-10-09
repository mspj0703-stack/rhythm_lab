/// <reference types="node" />
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { MakerScreen } from "../maker/MakerScreen";
import { getChart, getLibrarySong, saveAnalysisToLibrary } from "../library/db";
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

describe("Maker screen", () => {
  it("adds, undoes, redoes and saves an edit as a separate human chart while the AI chart stays intact", async () => {
    const { bundle, ai } = await seed();
    const { onSaved } = await render(bundle, ai);
    expect(container.textContent).toContain("AI 원본");
    expect(button("변경 없음").disabled).toBe(true);
    const before = noteCount();
    await click("＋ K");
    expect(noteCount()).toBe(before + 1);
    expect(button("SAVE").disabled).toBe(false);
    await click("Undo");
    expect(noteCount()).toBe(before);
    expect(button("변경 없음").disabled).toBe(true);
    await click("Redo");
    expect(noteCount()).toBe(before + 1);
    await click("SAVE");
    await waitFor(() => onSaved.mock.calls.length === 1, "save");
    const saved = onSaved.mock.calls[0][0] as LibraryChart;
    expect(saved).toMatchObject({ origin: "MANUAL_EDITED", parentChartId: ai.id, chartVersion: 1 });
    expect(saved.authorId).toBe(localStorage.getItem("beatdash.authorId"));
    expect(await getChart(ai.id)).toEqual(ai);
    expect(container.textContent).toContain("저장됨");
    // The next save updates the same edit instead of cloning again.
    await click("＋ D");
    await click("SAVE");
    await waitFor(() => onSaved.mock.calls.length === 2, "second save");
    expect(onSaved.mock.calls[1][0]).toMatchObject({ id: saved.id, chartVersion: 2 });
    expect((await getLibrarySong(bundle.song.id))?.charts).toHaveLength(2);
  });

  it("selects a note, changes lane, type and Hold length, and deletes with keyboard undo", async () => {
    const { bundle, ai } = await seed();
    await render(bundle, ai);
    await click("＋ J");
    expect(container.textContent).toContain("1개 선택");
    await click("레인 오른쪽");
    expect(container.querySelector(".maker-note.selected")?.className).toContain("lane-3");
    await click("종류 Hold");
    expect(container.querySelector(".maker-note.selected")?.className).toContain("hold");
    const length = container.querySelector('input[aria-label="Hold 길이(초)"]') as HTMLInputElement;
    const start = Number(length.value);
    await click("Hold 길게");
    expect(Number((container.querySelector('input[aria-label="Hold 길이(초)"]') as HTMLInputElement).value)).toBeGreaterThan(start);
    const count = noteCount();
    await click("선택 삭제");
    expect(noteCount()).toBe(count - 1);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true })); });
    expect(noteCount()).toBe(count);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true })); });
    expect(noteCount()).toBe(count - 1);
  });

  it("disables Flick on desktop charts and keeps it on mobile charts", async () => {
    const desktop = await seed("desktop");
    await render(desktop.bundle, desktop.ai);
    expect(button("Flick").disabled).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    vi.stubGlobal("indexedDB", new IDBFactory());
    const mobile = await seed("mobile");
    await render(mobile.bundle, mobile.ai);
    expect(button("Flick").disabled).toBe(false);
  });

  it("shows validator results and still allows a confirmed local save with ERRORs", async () => {
    const { bundle, ai } = await seed();
    const { onSaved } = await render(bundle, ai);
    expect(container.querySelector(".maker-validation-summary")?.textContent).toContain("ERROR 0");
    // Two notes on the same lane at the same snapped time -> the second add is refused (no duplicate).
    await click("＋ D"); await click("＋ D");
    await click("레인 오른쪽");
    await click("＋ F");
    // Now force an ERROR: a note inside the Hold on lane 2.
    await act(async () => { const input = container.querySelector('input[aria-label="노트 시간"]') as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2.25"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("레인 오른쪽");
    expect(container.querySelector(".maker-validation-summary")?.textContent).toMatch(/ERROR [1-9]/);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("SAVE");
    expect(confirm).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click("SAVE");
    await waitFor(() => onSaved.mock.calls.length === 1, "save with errors");
    expect(container.textContent).toContain("공유 불가");
  });

  it("test-plays the current draft without saving records and returns to the Maker with edits intact", { timeout: 10000 }, async () => {
    const { bundle, ai } = await seed();
    await render(bundle, ai);
    await click("＋ K");
    const count = noteCount();
    await click("TEST PLAY");
    expect(container.querySelector(".game-screen")).toBeTruthy();
    expect(container.textContent).toContain("기록 저장 안 함");
    expect(container.querySelector(".play-page")?.className).toContain("play-fullscreen");
    // No in-play back button: the official exit is the Pause menu (here "Maker로 돌아가기").
    expect(button("← Maker")).toBeUndefined();
    const media = container.querySelector("audio,video")!;
    await act(async () => { media.dispatchEvent(new Event("canplaythrough")); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 3300)); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await click("Maker로 돌아가기");
    expect(container.querySelector(".maker-page")).toBeTruthy();
    expect(noteCount()).toBe(count);
  });

  it("asks before leaving with unsaved changes", async () => {
    const { bundle, ai } = await seed();
    const { onExit } = await render(bundle, ai);
    await click("＋ K");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("← 곡 상세");
    expect(onExit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click("← 곡 상세");
    expect(onExit).toHaveBeenCalledOnce();
  });
});
