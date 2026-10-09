import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "../components/GameScreen";
import type { Chart } from "../types/chart";

vi.mock("../components/NoteFieldCanvas", () => ({ NoteFieldCanvas: () => <canvas /> }));

// Two long Holds (lanes 0 and 1), plus Tap / Flick notes on lanes 2 and 3.
const chart = { title: "TouchPause", artist: "", bpm: 120, offset: 0, difficulty: "hard", level: 5, platformProfile: "mobile", scoringVersion: 2, notes: [
  { time: 1, lane: 0, type: "hold", duration: 3 },   // 0
  { time: 1, lane: 1, type: "hold", duration: 3 },   // 1
  { time: 2, lane: 2, type: "tap" },                 // 2
  { time: 2.2, lane: 3, type: "flick" },             // 3
  { time: 6, lane: 2, type: "tap" },                 // 4
] } as Chart;

let root: Root;
let container: HTMLDivElement;
let frame: FrameRequestCallback | null;
type Debug = { state: { notes: { status: string; holdReleasedAt?: number }[]; holdTickScore: number; totalJudged: number }; paused: boolean; gameStarted: boolean };
const debug = () => (window as unknown as { __RHYTHM_DEBUG__: Debug }).__RHYTHM_DEBUG__;
const status = (index: number) => debug().state.notes[index].status;
const media = () => container.querySelector("audio,video") as HTMLMediaElement;
const lane = (index: number) => container.querySelector(`.touch-lane.lane-${index}`) as HTMLButtonElement;
const pressedCount = () => container.querySelectorAll(".lane-input-feedback i.pressed").length;

async function at(time: number) { media().currentTime = time; await act(async () => { frame?.(time * 1000); }); }
async function wait(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function pointer(type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", laneIndex: number, pointerId: number, y = 600) {
  await act(async () => { lane(laneIndex).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, clientX: laneIndex * 100 + 50, clientY: y, pointerType: "touch" })); });
}
const down = (l: number, id: number) => pointer("pointerdown", l, id);
const up = (l: number, id: number) => pointer("pointerup", l, id);
async function flick(l: number, id: number) { await down(l, id); await pointer("pointermove", l, id, 560); await up(l, id); }
async function pause() { await act(async () => { (window as unknown as { __beatdashBack: () => boolean }).__beatdashBack(); }); expect(debug().paused).toBe(true); }
async function resume() {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === "계속하기")!;
  await act(async () => button.click());
  await wait(3000);
  expect(container.querySelector(".resume-countdown")).toBeNull();
  expect(debug().paused).toBe(false);
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  frame = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<GameScreen chart={chart} mediaUrl="/api/media/x" mediaKind="audio" mediaMuted={false} />));
  await act(async () => { media().dispatchEvent(new Event("canplaythrough")); });
  await wait(3200);
  expect(debug().gameStarted).toBe(true);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Touch Hold across Pause / Resume (real pointer state)", () => {
  it("a finger held continuously through Pause and the 3-2-1 countdown keeps the Hold, with no re-grab needed", async () => {
    await at(1); await down(0, 1);
    expect(status(0)).toBe("holding");
    await at(1.5); await pause();
    expect(pressedCount()).toBe(1);                       // the pointer was kept, not forgotten
    expect(status(0)).toBe("holding");
    await resume();
    expect(debug().state.notes[0].holdReleasedAt).toBeUndefined();
    await at(3.9);                                       // far beyond the 400ms grace: only a truly held finger survives
    expect(status(0)).toBe("holding");
    await at(4.01);
    expect(status(0)).toBe("hit");
    await up(0, 1);
    expect(pressedCount()).toBe(0);
  });

  it("no judgement happens while paused or counting down, even for fingers that land on a lane", async () => {
    await at(1.9); await pause();
    const judgedBefore = debug().state.totalJudged;
    await down(2, 7);                                    // Tap note at 2.0 is near, but the game is frozen
    expect(status(2)).toBe("pending");
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === "계속하기")!;
    await act(async () => button.click());
    await wait(1000);
    await down(3, 8);
    expect(status(2)).toBe("pending");
    expect(debug().state.totalJudged).toBe(judgedBefore);
    await wait(2000);
    await up(2, 7); await up(3, 8);
    expect(pressedCount()).toBe(0);
    expect(status(2)).toBe("pending");
    expect(debug().state.totalJudged).toBe(judgedBefore);
  });

  it("a finger lifted during Pause gets the one-time re-grab window; re-touching inside it continues the Hold", async () => {
    await at(1); await down(0, 1);
    await at(1.5); await pause();
    await up(0, 1);                                      // lifted while paused
    expect(pressedCount()).toBe(0);
    await resume();
    expect(debug().state.notes[0].holdReleasedAt).toBeDefined();
    expect(status(0)).toBe("holding");
    await down(0, 2);                                    // re-grab immediately after resume
    expect(debug().state.notes[0].holdReleasedAt).toBeUndefined();
    await at(3);
    expect(status(0)).toBe("holding");
  });

  it("without a re-grab the lifted Hold breaks once the window ends and no lane stays stuck", async () => {
    await at(1); await down(0, 1);
    await at(1.5); await pause();
    await up(0, 1);
    await resume();
    await at(2.2);
    expect(status(0)).toBe("hold_broken");
    expect(pressedCount()).toBe(0);
  });

  it("a finger lifted during the resume countdown is treated the same way", async () => {
    await at(1); await down(0, 1);
    await at(1.5); await pause();
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === "계속하기")!;
    await act(async () => button.click());
    await wait(1500);
    await up(0, 1);
    await wait(1500);
    expect(debug().state.notes[0].holdReleasedAt).toBeDefined();
    await at(2.3);
    expect(status(0)).toBe("hold_broken");
  });

  it("two Holds: the finger that stays keeps its Hold, the finger lifted during Pause only affects its own lane", async () => {
    await at(1); await down(0, 1); await down(1, 2);
    expect(status(0)).toBe("holding"); expect(status(1)).toBe("holding");
    await at(1.5); await pause();
    await up(1, 2);
    await resume();
    expect(debug().state.notes[0].holdReleasedAt).toBeUndefined();
    expect(debug().state.notes[1].holdReleasedAt).toBeDefined();
    await at(2.4);
    expect(status(0)).toBe("holding");
    expect(status(1)).toBe("hold_broken");
    expect(pressedCount()).toBe(1);
  });

  it("two Holds both kept through Pause survive together", async () => {
    await at(1); await down(0, 1); await down(1, 2);
    await at(1.5); await pause();
    expect(pressedCount()).toBe(2);
    await resume();
    await at(3.5);
    expect(status(0)).toBe("holding"); expect(status(1)).toBe("holding");
    await at(4.01);
    expect(status(0)).toBe("hit"); expect(status(1)).toBe("hit");
  });

  it("Hold + another finger's Tap/Flick, then Pause: the Hold stays, the finished Tap/Flick fingers leave nothing stuck", async () => {
    await at(1); await down(0, 1);
    await at(2); await down(2, 3); await up(2, 3);       // Tap with another finger
    await at(2.2); await flick(3, 4);                    // Flick with a third finger
    expect(status(2)).toBe("hit"); expect(status(3)).toBe("hit");
    await pause();
    expect(pressedCount()).toBe(1);
    await resume();
    expect(pressedCount()).toBe(1);
    await at(3.5);
    expect(status(0)).toBe("holding");
    await up(0, 1);
    expect(pressedCount()).toBe(0);
  });

  it("another finger still resting on a different lane is not disturbed when the Hold finger lifts during Pause", async () => {
    await at(1); await down(0, 1); await down(2, 5);
    await at(1.5); await pause();
    await up(0, 1);
    expect(pressedCount()).toBe(1);
    await resume();
    expect(pressedCount()).toBe(1);
    expect(debug().state.notes[0].holdReleasedAt).toBeDefined();
    await up(2, 5);
    expect(pressedCount()).toBe(0);
  });

  it("pointercancel during Pause releases that finger's lane exactly like a lift (no ghost pointer)", async () => {
    await at(1); await down(0, 1);
    await at(1.5); await pause();
    await pointer("pointercancel", 0, 1);
    expect(pressedCount()).toBe(0);
    await resume();
    expect(debug().state.notes[0].holdReleasedAt).toBeDefined();
    await up(0, 1);                                      // a late up for the cancelled pointer is ignored
    expect(pressedCount()).toBe(0);
    await at(2.4);
    expect(status(0)).toBe("hold_broken");
  });

  it("a pointer that lost its capture without an event is dropped at resume instead of leaving a stuck lane", async () => {
    let captured = true;
    const proto = HTMLElement.prototype as unknown as { setPointerCapture?: (id: number) => void; hasPointerCapture?: (id: number) => boolean };
    proto.setPointerCapture = () => {};
    proto.hasPointerCapture = () => captured;
    try {
      await at(1); await down(0, 1);
      await at(1.5); await pause();
      captured = false;                                  // the browser silently lost the touch
      await resume();
      expect(pressedCount()).toBe(0);
      expect(debug().state.notes[0].holdReleasedAt).toBeDefined();
      await at(2.4);
      expect(status(0)).toBe("hold_broken");
    } finally {
      delete proto.setPointerCapture; delete proto.hasPointerCapture;
    }
  });

  it("losing window focus forgets every touch (pointer events are unreliable then) and resume needs a fresh grab", async () => {
    await at(1); await down(0, 1);
    await at(1.5);
    await act(async () => { window.dispatchEvent(new Event("blur")); });
    expect(debug().paused).toBe(true);
    expect(pressedCount()).toBe(0);
    await resume();
    expect(debug().state.notes[0].holdReleasedAt).toBeDefined();
    await down(0, 9);                                    // fresh finger inside the window continues the Hold
    expect(debug().state.notes[0].holdReleasedAt).toBeUndefined();
  });

  it("the keyboard Hold behaves the same way across Pause", async () => {
    await at(1);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true })); });
    expect(status(0)).toBe("holding");
    await at(1.5); await pause();
    await resume();
    expect(debug().state.notes[0].holdReleasedAt).toBeUndefined();
    await at(3.9);
    expect(status(0)).toBe("holding");
  });

  it("restart after a Pause starts clean: no inherited pointer, no stuck lane", async () => {
    await at(1); await down(0, 1);
    await at(1.5); await pause();
    const restart = [...container.querySelectorAll("button")].find((node) => node.textContent?.trim() === "다시 시작")!;
    await act(async () => restart.click());
    expect(pressedCount()).toBe(0);
    await up(0, 1);
    expect(pressedCount()).toBe(0);
  });
});
