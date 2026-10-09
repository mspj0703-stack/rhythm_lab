import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "../components/GameScreen";
import { PointerLaneTracker } from "../engine/pointerInput";
import type { Chart, Lane } from "../types/chart";

vi.mock("../components/NoteFieldCanvas", () => ({ NoteFieldCanvas: () => <canvas /> }));

describe("PointerLaneTracker (per-pointer bookkeeping)", () => {
  it("F/G/H: only the owner pointer releases its lane; other pointers' up/cancel never touch it", () => {
    const tracker = new PointerLaneTracker();
    expect(tracker.down(11, 0, 10, 500, 0)).toEqual([{ type: "press", lane: 0, pointerId: 11 }]);
    expect(tracker.down(12, 2, 300, 500, 10)).toEqual([{ type: "press", lane: 2, pointerId: 12 }]);
    expect(tracker.end(12)).toEqual([{ type: "release", lane: 2, pointerId: 12 }]);
    expect(tracker.isLaneHeld(0)).toBe(true);
    expect(tracker.down(13, 1, 200, 500, 20)).toHaveLength(1);
    expect(tracker.end(13)).toEqual([{ type: "release", lane: 1, pointerId: 13 }]); // pointercancel goes through end() too
    expect(tracker.ownerOf(0)).toBe(11);
    expect(tracker.end(11)).toEqual([{ type: "release", lane: 0, pointerId: 11 }]);
    expect(tracker.size).toBe(0);
  });

  it("a second finger on an owned lane neither steals nor ends the owner's press", () => {
    const tracker = new PointerLaneTracker();
    tracker.down(1, 3, 0, 0, 0);
    tracker.down(2, 3, 0, 0, 5);
    expect(tracker.end(2)).toEqual([]);       // non-owner up: no release
    expect(tracker.ownerOf(3)).toBe(1);
    tracker.down(4, 3, 0, 0, 9);
    expect(tracker.end(1)).toEqual([]);       // owner lifts while another finger rests: ownership passes on
    expect(tracker.ownerOf(3)).toBe(4);
    expect(tracker.end(4)).toEqual([{ type: "release", lane: 3, pointerId: 4 }]);
  });

  it("I/J: four pointers coexist; a Flick move only affects its own pointer, once", () => {
    const tracker = new PointerLaneTracker();
    for (const lane of [0, 1, 2, 3] as Lane[]) tracker.down(100 + lane, lane, lane * 100, 600, lane);
    expect(tracker.heldLanes()).toEqual([0, 1, 2, 3]);
    expect(tracker.move(103, 300, 590, 20)).toEqual([]);
    expect(tracker.move(103, 300, 560, 30)).toEqual([{ type: "flick", lane: 3, pointerId: 103 }]);
    expect(tracker.move(103, 300, 500, 40)).toEqual([]);
    expect(tracker.get(100)).toMatchObject({ lane: 0, startY: 600, y: 600, flicked: false });
    expect(tracker.move(999, 0, 0, 0)).toEqual([]);
    expect(tracker.end(999)).toEqual([]);
    expect(tracker.down(100, 1, 0, 0, 0)).toEqual([]); // duplicate pointerdown ignored
  });

  it("reset() drops every pointer without generating releases (pause)", () => {
    const tracker = new PointerLaneTracker();
    tracker.down(1, 0, 0, 0, 0); tracker.down(2, 1, 0, 0, 0);
    tracker.reset();
    expect(tracker.size).toBe(0);
    expect(tracker.end(1)).toEqual([]);
  });
});

// ---- Integration through the real GameScreen + engine ----
const chart = { title: "Multi", artist: "", bpm: 120, offset: 0, difficulty: "hard", level: 5, platformProfile: "mobile", scoringVersion: 2, notes: [
  { time: 1, lane: 0, type: "hold", duration: 3 },     // 0: long Hold, lane D
  { time: 1.5, lane: 1, type: "tap" },                 // 1
  { time: 1.8, lane: 2, type: "tap" },                 // 2
  { time: 2.1, lane: 3, type: "flick" },               // 3
  { time: 2.4, lane: 1, type: "hold", duration: 1 },   // 4: second Hold, lane F
  { time: 2.7, lane: 2, type: "tap" },                 // 5
  { time: 2.9, lane: 3, type: "flick" },               // 6
  { time: 3.1, lane: 2, type: "tap" },                 // 7
  { time: 3.25, lane: 2, type: "tap" },                // 8 (rapid)
  { time: 3.45, lane: 3, type: "flick" },              // 9
  { time: 3.6, lane: 3, type: "flick" },               // 10 (rapid)
] } as Chart;

let root: Root;
let container: HTMLDivElement;
let frame: FrameRequestCallback | null;
type Debug = { state: { notes: { status: string; holdReleasedAt?: number; judgement: string | null }[]; combo: number; holdTickScore: number; judgementCounts: Record<string, number> }; gameStarted: boolean };
const debug = () => (window as unknown as { __RHYTHM_DEBUG__: Debug }).__RHYTHM_DEBUG__;
const status = (index: number) => debug().state.notes[index].status;
const media = () => container.querySelector("audio,video") as HTMLMediaElement;
const lane = (index: number) => container.querySelector(`.touch-lane.lane-${index}`) as HTMLButtonElement;

async function at(time: number) {
  media().currentTime = time;
  await act(async () => { frame?.(time * 1000); });
}
async function pointer(type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel", laneIndex: number, pointerId: number, y = 600) {
  await act(async () => { lane(laneIndex).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, clientX: laneIndex * 100 + 50, clientY: y, pointerType: "touch" })); });
}
const down = (l: number, id: number) => pointer("pointerdown", l, id);
const up = (l: number, id: number) => pointer("pointerup", l, id);
async function flick(l: number, id: number) { await down(l, id); await pointer("pointermove", l, id, 560); await up(l, id); }

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
  await act(async () => { await vi.advanceTimersByTimeAsync(3200); });
  expect(debug().gameStarted).toBe(true);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Hold + Tap/Flick multi-touch through GameScreen", () => {
  it("A/B/F/G/J/K/L: other fingers tap, flick, lift and cancel while the D Hold keeps holding and ticking", async () => {
    await at(1); await down(0, 1);
    expect(status(0)).toBe("holding");
    await at(1.5); await down(1, 2); await up(1, 2);          // A + F: tap, then that finger lifts
    expect(status(1)).toBe("hit"); expect(status(0)).toBe("holding");
    expect(debug().state.notes[0].holdReleasedAt).toBeUndefined();
    await at(1.8); await down(2, 3); await pointer("pointercancel", 2, 3); // G: another pointer is cancelled
    expect(status(2)).toBe("hit"); expect(status(0)).toBe("holding");
    await at(2.1); await flick(3, 4);                         // B + J: Flick on another lane
    expect(status(3)).toBe("hit"); expect(status(0)).toBe("holding");
    await at(2.7); await down(2, 5); await up(2, 5);
    await at(3.1); await down(2, 6); await up(2, 6);          // K: rapid taps
    await at(3.25); await down(2, 7); await up(2, 7);
    await at(3.45); await flick(3, 8);                         // L: rapid flicks
    await at(3.6); await flick(3, 9);
    for (const index of [5, 7, 8, 9, 10]) expect(status(index), `note ${index}`).toBe("hit");
    expect(status(0)).toBe("holding");
    await at(4.01);
    expect(status(0)).toBe("hit");                            // completed by the owner holding to the end
    expect(debug().state.holdTickScore).toBeGreaterThan(0);
    await up(0, 1);
    expect(debug().state.judgementCounts.Miss).toBe(2);       // only the skipped second Hold (4) and its lane-3 flick (6)
  });

  it("C/D/E/H: two Holds with independent owners, plus Tap and Flick; each owner releases only its own Hold", async () => {
    await at(1); await down(0, 1);
    await at(1.5); await down(1, 2); await up(1, 2);
    await at(1.8); await down(2, 3); await up(2, 3);
    await at(2.1); await flick(3, 4);
    await at(2.4); await down(1, 5);                           // C: second Hold on F by another finger
    expect(status(0)).toBe("holding"); expect(status(4)).toBe("holding");
    await at(2.7); await down(2, 6); await up(2, 6);          // D: Hold + Hold + Tap
    await at(2.9); await flick(3, 7);                          // E: Hold + Hold + Flick
    expect(status(5)).toBe("hit"); expect(status(6)).toBe("hit");
    expect(status(0)).toBe("holding"); expect(status(4)).toBe("holding");
    await at(3.0); await up(1, 5);                             // H: owner of the F Hold lifts early
    expect(debug().state.notes[4].holdReleasedAt).toBeDefined();
    expect(debug().state.notes[0].holdReleasedAt).toBeUndefined();
    await at(3.2);
    expect(status(4)).toBe("hold_broken");
    expect(status(0)).toBe("holding");
  });

  it("I: four simultaneous pointers keep four independent lane presses", async () => {
    await at(1); await down(0, 1);
    await at(1.5); await down(1, 2);
    await at(1.8); await down(2, 3);
    await at(2.1); await down(3, 4);
    expect(container.querySelectorAll(".lane-input-feedback i.pressed")).toHaveLength(4);
    await up(3, 4); await up(1, 2);
    expect(container.querySelectorAll(".lane-input-feedback i.pressed")).toHaveLength(2);
    expect(status(0)).toBe("holding");
    await up(2, 3);
    expect(status(0)).toBe("holding");
  });

  it("a long press does not open the context menu inside the gameplay area", async () => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    await act(async () => { lane(0).dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
  });

  it("one touch is one input: there are no Touch Events listeners that could double-handle a tap", async () => {
    await at(1.5);
    const touchstart = new Event("touchstart", { bubbles: true });
    await act(async () => { lane(1).dispatchEvent(touchstart); });
    expect(status(1)).toBe("pending");
    await down(1, 2);
    expect(debug().state.judgementCounts.Perfect + debug().state.judgementCounts.Great + debug().state.judgementCounts.Good).toBe(1);
  });
});
