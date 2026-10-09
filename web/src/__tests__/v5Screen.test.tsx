import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GameScreen } from "../components/GameScreen";
import { judgeLineYFor, JUDGE_LINE_Y, CANVAS_HEIGHT } from "../engine/highway";
import type { Chart } from "../types/chart";

vi.mock("../components/NoteFieldCanvas", () => ({
  NoteFieldCanvas: (props: { width: number; height: number; judgeLineY: number }) =>
    <canvas data-width={props.width} data-height={props.height} data-judge={props.judgeLineY} />,
}));

const chart = { title: "Screen", artist: "", bpm: 120, offset: 0, difficulty: "hard", level: 1, platformProfile: "mobile", notes: [
  { time: 1, lane: 0, type: "tap" }, { time: 2, lane: 1, type: "tap" },
] } as Chart;

let root: Root;
let container: HTMLDivElement;
let observers: { callback: ResizeObserverCallback; target: Element | null }[];
const bridge = { lock: vi.fn(), unlock: vi.fn() };

class FakeResizeObserver {
  entry: { callback: ResizeObserverCallback; target: Element | null };
  constructor(callback: ResizeObserverCallback) { this.entry = { callback, target: null }; observers.push(this.entry); }
  observe(target: Element) { this.entry.target = target; }
  unobserve() {}
  disconnect() { this.entry.target = null; }
}

async function resizeField(width: number, height: number) {
  await act(async () => {
    for (const observer of observers) {
      if (observer.target?.classList.contains("playfield")) {
        observer.callback([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver);
      }
    }
  });
}
const canvas = () => container.querySelector("canvas") as HTMLCanvasElement;
const media = () => container.querySelector("audio,video") as HTMLMediaElement;

async function render() {
  await act(async () => root.render(<GameScreen chart={chart} mediaUrl="/api/media/x" mediaKind="audio" mediaMuted={false} />));
}
async function playToResult() {
  await act(async () => { media().dispatchEvent(new Event("canplaythrough")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3300); });
  await act(async () => { media().dispatchEvent(new Event("ended")); });
  await act(async () => { await vi.advanceTimersByTimeAsync(700); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  observers = [];
  bridge.lock.mockReset(); bridge.unlock.mockReset();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  delete (window as { BeatdashOrientation?: unknown }).BeatdashOrientation;
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("playfield sizing", () => {
  it("draws the note field at the real playfield size for portrait, landscape and desktop", async () => {
    await render();
    for (const [width, height] of [[360, 766], [412, 881], [800, 1246], [800, 326], [1280, 686], [1920, 1046], [2560, 1406]]) {
      await resizeField(width, height);
      expect(container.querySelector(".playfield")?.getAttribute("data-field-size")).toBe(`${width}x${height}`);
      expect(Number(canvas().dataset.width)).toBe(width);
      expect(Number(canvas().dataset.height)).toBe(height);
      const judge = Number(canvas().dataset.judge);
      // Judge line stays inside the field with the v3 touch-lane band below it.
      expect(judge).toBeGreaterThan(height * 0.85);
      expect(judge).toBeLessThan(height);
    }
  });

  it("keeps the v3 judge-line proportion so CSS lanes/effects stay aligned", () => {
    expect(judgeLineYFor(CANVAS_HEIGHT)).toBeCloseTo(JUDGE_LINE_Y);
    expect(judgeLineYFor(1000)).toBeCloseTo(1000 - 1000 * 62 / 560);
  });

  it("ignores empty resize entries (hidden page) instead of collapsing the canvas", async () => {
    await render();
    await resizeField(500, 700);
    await resizeField(0, 0);
    expect(Number(canvas().dataset.width)).toBe(500);
  });

  it("puts lanes, judgement and touch input inside the playfield; HUD and Pause stay at the stage edges", async () => {
    await render();
    const field = container.querySelector(".playfield")!;
    for (const selector of [".note-field-layer", ".touch-lanes", ".lane-input-feedback"]) expect(field.querySelector(selector), selector).toBeTruthy();
    const stage = container.querySelector(".stage")!;
    for (const selector of [".game-hud-left", ".game-hud-right", ".combo-display"]) expect(stage.querySelector(`:scope > ${selector}`), selector).toBeTruthy();
    expect(stage.querySelector(".pause-button")).toBeTruthy();
  });
});

describe("orientation lock lifecycle", () => {
  it("locks on play entry and keeps the lock through pause, resume countdown, result and RETRY", async () => {
    (window as { BeatdashOrientation?: unknown }).BeatdashOrientation = bridge;
    await render();
    expect(bridge.lock).toHaveBeenCalledTimes(1);
    expect(["portrait", "landscape"]).toContain(bridge.lock.mock.calls[0][0]);
    await act(async () => { media().dispatchEvent(new Event("canplaythrough")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3300); });
    await act(async () => (container.querySelector(".pause-button") as HTMLButtonElement).click());
    expect(container.querySelector(".pause-overlay")).toBeTruthy();
    expect(bridge.unlock).not.toHaveBeenCalled();
    const resume = [...container.querySelectorAll("button")].find((node) => node.textContent === "계속하기")!;
    await act(async () => resume.click());
    expect(container.querySelector(".resume-countdown")).toBeTruthy();
    expect(bridge.unlock).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    await act(async () => { window.dispatchEvent(new Event("beatdash:pause")); window.dispatchEvent(new Event("beatdash:resume")); });
    expect(bridge.unlock).not.toHaveBeenCalled();
    await act(async () => { media().dispatchEvent(new Event("ended")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(700); });
    expect(container.querySelector(".result-screen")).toBeTruthy();
    expect(bridge.unlock).not.toHaveBeenCalled();
    const retry = [...container.querySelectorAll("button")].find((node) => node.textContent === "RETRY")!;
    await act(async () => { retry.click(); });
    expect(bridge.lock).toHaveBeenCalledTimes(1);
    expect(bridge.unlock).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(bridge.unlock).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("releases the lock when the play screen unmounts mid-song (home / back / abnormal exit)", async () => {
    (window as { BeatdashOrientation?: unknown }).BeatdashOrientation = bridge;
    await render();
    await act(async () => root.unmount());
    expect(bridge.unlock).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("uses the Screen Orientation API on touch web and survives a rejected lock", async () => {
    const lock = vi.fn().mockRejectedValue(new Error("NotSupportedError"));
    const unlock = vi.fn();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("coarse"), media: query, addEventListener() {}, removeEventListener() {} }));
    const original = Object.getOwnPropertyDescriptor(window.screen, "orientation");
    Object.defineProperty(window.screen, "orientation", { configurable: true, value: { type: "landscape-primary", lock, unlock } });
    try {
      await render();
      expect(lock).toHaveBeenCalledWith("landscape-primary");
      await playToResult();
      expect(container.querySelector(".result-screen")).toBeTruthy();
      expect(unlock).not.toHaveBeenCalled();
      await act(async () => root.unmount());
      expect(unlock).toHaveBeenCalledTimes(1);
      root = createRoot(container);
    } finally {
      if (original) Object.defineProperty(window.screen, "orientation", original); else delete (window.screen as { orientation?: unknown }).orientation;
    }
  });

  it("does nothing on a mouse-only browser without the native bridge", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
    const lock = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(window.screen, "orientation");
    Object.defineProperty(window.screen, "orientation", { configurable: true, value: { type: "landscape-primary", lock, unlock: vi.fn() } });
    try {
      await render();
      expect(lock).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window.screen, "orientation", original); else delete (window.screen as { orientation?: unknown }).orientation;
    }
  });
});

describe("desktop runtime", () => {
  it("skips orientation logic entirely on the Tauri desktop build", async () => {
    vi.resetModules();
    window.history.replaceState({}, "", "/?platform=desktop");
    try {
      const orientation = await import("../platform/orientation");
      (window as { BeatdashOrientation?: unknown }).BeatdashOrientation = bridge;
      expect(orientation.orientationLockApplies()).toBe(false);
      orientation.lockPlayOrientation()();
      expect(bridge.lock).not.toHaveBeenCalled();
      expect(bridge.unlock).not.toHaveBeenCalled();
    } finally { window.history.replaceState({}, "", "/"); vi.resetModules(); }
  });
});

describe("safe-area and viewport CSS", () => {
  const css = readFileSync(join(__dirname, "..", "App.css"), "utf8");
  const block = css.slice(css.indexOf("v5 Phase 2 · Gameplay screen maximization"));
  it("uses the full dynamic viewport with safe-area padding only on the play screen", () => {
    expect(block).toContain("height: 100dvh");
    expect(block).toContain("width: 100vw");
    for (const side of ["top", "right", "bottom", "left"]) expect(block).toContain(`env(safe-area-inset-${side}`);
    expect(block).toMatch(/\.play-fullscreen \.stage \{[^}]*aspect-ratio: auto/);
    expect(block).toMatch(/\.play-fullscreen \.playfield \{ width: min\(100%, 880px\)/);
  });
  it("keeps Library/Home/Maker pages out of the fullscreen rules", () => {
    expect(block).not.toMatch(/\.v4-shell|\.maker-page|\.library-page/);
  });
});
