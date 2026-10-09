/// <reference types="node" />
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Blob as NodeBlob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DIFFICULTY_LABELS, DIFFICULTY_OPTIONS, difficultyLabel, difficultyShort, normalizeDifficulty } from "../constants/difficulty";
import { DIFFICULTIES } from "../types/chart";
import { UploadScreen } from "../web/UploadScreen";
import { YouTubeEntry } from "../web/YouTubeEntry";
import { SongDetailScreen } from "../components/v4/SongDetailScreen";
import { LibraryScreen } from "../components/v4/LibraryScreen";
import { ResultScreen } from "../components/ResultScreen";
import { CommunityScreen } from "../community/CommunityScreen";
import { getBestRecord, getLibrarySong, listLibrary, saveAnalysisToLibrary, savePlayResult } from "../library/db";
import type { AnalysisResponse } from "../web/types";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new NodeBlob(["m"], { type: "audio/wav" }), json: async () => ({ items: [], total: 0 }) })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const extremeAnalysis = (platformProfile: "mobile" | "desktop"): AnalysisResponse => ({ id: "e".repeat(32), originalName: "e.wav", mediaUrl: "/api/media/e", mediaKind: "audio",
  chart: { title: "E", artist: "", bpm: 150, offset: 0, difficulty: "Extreme", level: 18, version: 5, platformProfile, scoringVersion: 2, notes: [{ time: 1, lane: 0, type: "tap" }] },
  report: { duration: 30, bpm: 150, generatorVersion: "t", seed: 1 } as AnalysisResponse["report"] });

describe("MASTER display name for internal extreme", () => {
  it("maps every internal difficulty through one table", () => {
    expect(DIFFICULTIES).toEqual(["easy", "normal", "hard", "expert", "extreme"]);
    expect(DIFFICULTY_OPTIONS.map((option) => option.label)).toEqual(["EASY", "NORMAL", "HARD", "EXPERT", "MASTER"]);
    expect(difficultyLabel("extreme")).toBe("MASTER");
    expect(difficultyLabel("Extreme")).toBe("MASTER");
    expect(difficultyLabel("Hard")).toBe("HARD");
    expect(difficultyShort("extreme")).toBe("MAS");
    expect(normalizeDifficulty("MASTER")).toBe("extreme");
    expect(normalizeDifficulty("expert")).toBe("expert");
    expect(normalizeDifficulty("insane")).toBeNull();
    expect(DIFFICULTY_LABELS.expert).toBe("EXPERT");
  });

  it("Upload UI shows MASTER and sends extreme to the backend", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ id: "x" }) }));
    vi.stubGlobal("fetch", fetcher);
    await act(async () => root.render(<UploadScreen onComplete={() => {}} />));
    const master = [...container.querySelectorAll(".difficulty-grid button")].find((node) => node.textContent === "MASTER") as HTMLButtonElement;
    expect(master).toBeTruthy();
    expect(container.textContent).not.toMatch(/extreme/i);
    await act(async () => master.click());
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [new File(["x"], "a.wav")] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => (container.querySelector(".primary-action") as HTMLButtonElement).click());
    const form = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get("difficulty")).toBe("extreme");
  });

  it("YouTube UI lists all five with MASTER = extreme", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ title: "T", duration: 30, thumbnail: "" }) }));
    await act(async () => root.render(<YouTubeEntry onComplete={() => {}} />));
    const input = container.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://youtu.be/abcdefghijk"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const select = [...container.querySelectorAll("select")].find((node) => node.getAttribute("aria-label") !== "채보 플랫폼")!;
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ["easy", "EASY"], ["normal", "NORMAL"], ["hard", "HARD"], ["expert", "EXPERT"], ["extreme", "MASTER"]]);
  });

  it("saved-song regeneration offers ＋ MASTER and requests extreme; existing extreme charts and records load as MASTER", async () => {
    const mobile = await saveAnalysisToLibrary(extremeAnalysis("mobile"));
    await savePlayResult({ songId: mobile.song.id, chartId: mobile.charts[0].id, chartVersion: 1, difficulty: "extreme", offsetMs: 0,
      result: { perfect: 1, great: 0, good: 0, miss: 0, score: 777, accuracyPercent: 100, maxCombo: 1, rank: "SSS", scoringVersion: 2 } });
    const desktop = await saveAnalysisToLibrary(extremeAnalysis("desktop"), { songId: mobile.song.id });
    expect(desktop.charts[0]).toMatchObject({ difficulty: "extreme", variantKey: "extreme:desktop" });
    expect((await getBestRecord(mobile.charts[0].id))?.bestScore).toBe(777);
    const bundle = (await getLibrarySong(mobile.song.id))!;
    const generate = vi.fn(async () => {});
    await act(async () => root.render(<SongDetailScreen bundle={bundle} onBack={() => {}} onPlay={() => {}} onDelete={() => {}} onChanged={() => {}} onGenerateDifficulty={generate} />));
    expect(container.querySelector(".difficulty-select")?.textContent).toContain("MASTER");
    expect(container.textContent).not.toMatch(/EXTREME/);
    const add = [...container.querySelectorAll("button")].find((node) => node.textContent === "＋ EXPERT")!;
    expect(add).toBeTruthy();
    expect([...container.querySelectorAll("button")].some((node) => node.textContent === "＋ MASTER")).toBe(false); // already exists for mobile
    await act(async () => add.click());
    expect(generate).toHaveBeenCalledWith("expert", expect.anything());
    await act(async () => root.render(<LibraryScreen library={await listLibrary()} onBack={() => {}} onAddSong={() => {}} onOpenSong={() => {}} />));
    expect(container.querySelector(".library-difficulties")?.textContent).toContain("MAS");
  });

  it("offers ＋ MASTER for a song that lacks it and passes extreme", async () => {
    const saved = await saveAnalysisToLibrary({ ...extremeAnalysis("mobile"), chart: { ...extremeAnalysis("mobile").chart, difficulty: "hard" } });
    const generate = vi.fn(async () => {});
    await act(async () => root.render(<SongDetailScreen bundle={(await getLibrarySong(saved.song.id))!} onBack={() => {}} onPlay={() => {}} onDelete={() => {}} onChanged={() => {}} onGenerateDifficulty={generate} />));
    await act(async () => ([...container.querySelectorAll("button")].find((node) => node.textContent === "＋ MASTER") as HTMLButtonElement).click());
    expect(generate).toHaveBeenCalledWith("extreme", expect.stringMatching(/^(mobile|desktop)$/));
  });

  it("Result and Community show MASTER; the Community filter value stays extreme", async () => {
    await act(async () => root.render(<ResultScreen title="t" difficulty={`${difficultyLabel("Extreme")} · mobile`} result={{ perfect: 1, great: 0, good: 0, miss: 0, score: 1, accuracyPercent: 100, maxCombo: 1, rank: "SSS" }} onRestart={() => {}} />));
    expect(container.textContent).toContain("MASTER · mobile");
    await act(async () => root.render(<CommunityScreen library={[]} onBack={() => {}} onAddSong={() => {}} onImported={() => {}} />));
    const select = container.querySelector('select[aria-label="난이도"]') as HTMLSelectElement;
    expect([...select.options].at(-1)).toMatchObject({ value: "extreme", textContent: "MASTER" });
  });

  it("no user-facing source string still says EXTREME", () => {
    const files = ["notices.ts", "maker/MakerScreen.tsx", "community/CommunityScreen.tsx", "components/v4/SongDetailScreen.tsx", "components/v4/LibraryScreen.tsx", "web/UploadScreen.tsx", "web/YouTubeEntry.tsx", "components/GameScreen.tsx"];
    for (const file of files) expect(readFileSync(join(__dirname, "..", file), "utf8"), file).not.toMatch(/["'>`][^"'<`]*EXTREME/);
  });
});
