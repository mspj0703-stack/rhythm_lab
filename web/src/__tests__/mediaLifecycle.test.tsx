import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "../components/GameScreen";
import type { Chart } from "../types/chart";

vi.mock("../components/NoteFieldCanvas", () => ({ NoteFieldCanvas: () => <canvas /> }));
const chart = { title: "Regression", artist: "test", bpm: 120, difficulty: "hard", level: 1, notes: [
  { time: 1, lane: 0, type: "tap" }, { time: 2, lane: 1, type: "hold", duration: 1 },
  { time: 4, lane: 2, type: "flick" }, { time: 8, lane: 3, type: "tap" },
] } as Chart;
let root: Root, container: HTMLDivElement;
let frame: FrameRequestCallback | null;
let play = vi.fn<() => Promise<void>>();
let pause = vi.fn<() => void>();
const debug = () => (window as unknown as { __RHYTHM_DEBUG__: { state: { notes: { status: string }[]; totalJudged: number }; paused: boolean; gameStarted: boolean } }).__RHYTHM_DEBUG__;
async function render(kind: "audio" | "video" = "video", offset = 0) {
  await act(async () => { root.render(<GameScreen chart={chart} mediaUrl="/local" mediaKind={kind} mediaMuted={false} requireStartGesture timingOffsetMs={offset} />); });
}
async function click(text: string) {
  const b = Array.from(container.querySelectorAll("button")).find(b => b.textContent?.trim() === text);
  expect(b).toBeDefined();
  await act(async () => b!.click());
}
async function key(type: "keydown" | "keyup", key: string) {
  await act(async () => { window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true })); });
}
async function advance(time: number) {
  (container.querySelector("video,audio") as HTMLMediaElement).currentTime = time;
  await act(async () => { frame?.(time * 1000); });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  frame = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("media lifecycle and input integration", () => {
  it("leaving gameplay stops the media element", async () => {
    await render(); await click("START");
    await act(async () => root.render(null));
    expect(pause).toHaveBeenCalled();
  });
  it("does not start before gesture; rejected play is visible and retry works", async () => {
    await render(); expect(play).not.toHaveBeenCalled();
    play.mockRejectedValueOnce(new Error("blocked")); await click("START");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("blocked");
    expect(debug().gameStarted).toBe(false);
    await click("재생 다시 시도"); expect(debug().gameStarted).toBe(true); expect(debug().paused).toBe(false);
  });
  it("pause freezes judgement, releases Hold, clears stale keys and allows regrab", async () => {
    await render(); await click("START"); await advance(2); await key("keydown", "f");
    expect(debug().state.notes[1].status).toBe("holding");
    await key("keydown", "Escape"); expect(debug().paused).toBe(true); expect(pause).toHaveBeenCalled();
    await key("keyup", "f");
    await key("keydown", "Escape"); expect(debug().paused).toBe(false);
    await key("keydown", "f"); await advance(3.01);
    expect(debug().state.notes[1].status).toBe("hit");
  });
  it("Hold cannot complete hands-free after pause", async () => {
    await render(); await click("START"); await advance(2); await key("keydown", "f");
    await key("keydown", "Escape"); await key("keyup", "f"); await key("keydown", "Escape"); await advance(2.11);
    expect(debug().state.notes[1].status).toBe("hold_broken");
  });
  it("restart resets score, media time, gesture gate and stale inputs", async () => {
    await render(); await click("START"); await advance(1); await key("keydown", "d");
    await key("keydown", "Escape"); await click("Restart");
    expect(debug().state.totalJudged).toBe(0); expect(debug().gameStarted).toBe(false);
    expect((container.querySelector("video") as HTMLVideoElement).currentTime).toBe(0);
    await click("START"); await advance(1); await key("keydown", "d"); expect(debug().state.notes[0].status).toBe("hit");
  });
  it("legacy audio-only playback uses audio clock with no iframe or MV settings", async () => {
    await render("audio"); await click("START"); await advance(1); await key("keydown", "d");
    expect(debug().state.notes[0].status).toBe("hit"); expect(container.querySelector("video,iframe,.visual-options")).toBeNull();
  });
  it("MV off keeps the same audible video element and does not pause it", async () => {
    await render(); await click("START"); const video = container.querySelector("video")!;
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(container.querySelector("video")).toBe(video); expect(video.muted).toBe(false); expect(video.style.opacity).toBe("0"); expect(pause).not.toHaveBeenCalled();
  });
  it("native background event pauses gameplay and media", async () => {
    await render(); await click("START"); await act(async () => { window.dispatchEvent(new Event("beatdash:pause")); });
    expect(debug().paused).toBe(true); expect(pause).toHaveBeenCalled();
  });
  it.each([80, -60, 250])("offset %ims aligns actual input to the media clock", async offset => {
    await render("video", offset); await click("START"); await advance(1 + offset / 1000); await key("keydown", "d");
    expect(debug().state.notes[0].status).toBe("hit");
  });
  it("Flick lane+Space input works and prevents default scrolling", async () => {
    await render(); await click("START"); await advance(4); await key("keydown", "j");
    const event = new KeyboardEvent("keydown", { key: " ", cancelable: true });
    await act(async () => { window.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true); expect(debug().state.notes[2].status).toBe("hit");
  });
});


describe("v4 asynchronous result persistence", () => {
  it("reports a finished run when library caching completes later", async () => {
    await render(); await click("START"); await advance(10);
    const onResult = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<GameScreen chart={chart} mediaUrl="/local" mediaKind="video" requireStartGesture onResult={onResult} />));
    expect(onResult).toHaveBeenCalledTimes(1);
  });
  it("shows save failure and retries without replaying", async () => {
    const onResult = vi.fn().mockRejectedValueOnce(new Error("QuotaExceeded")).mockResolvedValueOnce(undefined);
    await act(async () => root.render(<GameScreen chart={chart} mediaUrl="/local" mediaKind="video" requireStartGesture onResult={onResult} />));
    await click("START"); await advance(10);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("QuotaExceeded");
    await click("기록 저장 다시 시도"); expect(onResult).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("does not attach old asynchronous achievements after restart", async () => {
    let complete!: (value: { clearType: "PERFECT_COMBO"; newHighScore: boolean }) => void;
    const onResult = vi.fn(() => new Promise(resolve => { complete = resolve; }));
    await act(async () => root.render(<GameScreen chart={chart} mediaUrl="/local" mediaKind="video" requireStartGesture onResult={onResult as never} />));
    await click("START"); await advance(10); await click("RETRY");
    await act(async () => complete({ clearType: "PERFECT_COMBO", newHighScore: true }));
    expect(container.textContent).not.toContain("NEW HIGH SCORE"); expect(debug().gameStarted).toBe(false);
  });
});

describe("hotfix bounded media recovery", () => {
  const media = () => container.querySelector("video,audio") as HTMLMediaElement;
  const dispatch = async (name: string) => { await act(async () => { media().dispatchEvent(new Event(name)); }); };
  it("preload errors do not bypass the START gesture", async () => {
    await render(); await dispatch("error");
    expect(play).not.toHaveBeenCalled(); expect(debug().gameStarted).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("다시 시도");
  });
  it("freezes judgement during reload and restores position after metadata/seek", async () => {
    await render(); await click("START"); await advance(1);
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(function(this: HTMLMediaElement) { this.currentTime = 0; });
    await dispatch("error"); expect(debug().paused).toBe(true);
    await advance(0); expect(debug().state.totalJudged).toBe(0);
    const calls=play.mock.calls.length;
    await dispatch("loadedmetadata"); expect(media().currentTime).toBe(1); expect(play).toHaveBeenCalledTimes(calls);
    await dispatch("seeked"); expect(play).toHaveBeenCalledTimes(calls+1); expect(debug().paused).toBe(false);
    await key("keydown", "d"); expect(debug().state.notes[0].status).toBe("hit");
  });
  it("background pause cancels pending recovery; explicit resume retains checkpoint", async () => {
    await render(); await click("START"); await advance(1);
    vi.mocked(HTMLMediaElement.prototype.load).mockImplementation(function(this: HTMLMediaElement) { this.currentTime=0; });
    await dispatch("error");
    await act(async () => { window.dispatchEvent(new Event("beatdash:pause")); });
    await dispatch("loadedmetadata"); await dispatch("seeked"); expect(play).toHaveBeenCalledTimes(1); expect(debug().paused).toBe(true);
    await key("keydown", "Escape"); await dispatch("loadedmetadata"); expect(media().currentTime).toBe(1);
    await dispatch("seeked"); expect(debug().paused).toBe(false);
  });
  it("restart cancels recovery and never restores the old position", async () => {
    await render(); await click("START"); await advance(2);
    await dispatch("error"); await click("Restart");
    await dispatch("loadedmetadata"); await dispatch("seeked");
    expect(media().currentTime).toBe(0); expect(play).toHaveBeenCalledTimes(1); expect(debug().gameStarted).toBe(false);
  });
  it("leaving gameplay removes recovery listeners and prevents later play", async () => {
    await render(); await click("START"); await advance(2); await dispatch("error"); const element=media();
    await act(async () => root.render(null));
    await act(async () => { element.dispatchEvent(new Event("loadedmetadata")); element.dispatchEvent(new Event("seeked")); });
    expect(play).toHaveBeenCalledTimes(1);
  });
  it("a persistent media error stops at one failed load without an error loop", async () => {
    await render(); await click("START"); await dispatch("error");
    await dispatch("error"); await dispatch("error");
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1); expect(play).toHaveBeenCalledTimes(1);
    expect(debug().paused).toBe(true);
  });
  it("stalled timer does nothing after pause or before START", async () => {
    vi.useFakeTimers();
    try {
      await render(); await dispatch("waiting"); await act(async () => vi.advanceTimersByTime(3001));
      expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
      await click("START"); await dispatch("stalled"); await key("keydown", "Escape");
      await act(async () => vi.advanceTimersByTime(3001)); expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("automatically recovers stalled playback only after the 3 second threshold", async () => {
    vi.useFakeTimers();
    try {
      await render(); await click("START"); await advance(1); await dispatch("waiting");
      await act(async () => vi.advanceTimersByTime(2999)); expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(1)); expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
      await dispatch("loadedmetadata"); await dispatch("seeked"); expect(debug().paused).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("limits repeated automatic recoveries to two per run", async () => {
    await render(); await click("START"); await advance(1);
    for (let i=0;i<2;i++) { await dispatch("error"); await dispatch("loadedmetadata"); await dispatch("seeked"); }
    await dispatch("error"); expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("한도"); expect(debug().paused).toBe(true);
  });
});

it("recovery timeout leaves a visible retry action and paused judgement", async () => {
  vi.useFakeTimers();
  try {
    await render(); await click("START"); await advance(1);
    await act(async () => { container.querySelector('video')!.dispatchEvent(new Event('error')); });
    await act(async () => vi.advanceTimersByTime(10001));
    expect(debug().paused).toBe(true); expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("초과");
  } finally { vi.useRealTimers(); }
});

it("a hung play promise becomes a retryable error instead of freezing recovery forever", async () => {
  vi.useFakeTimers();
  try {
    await render(); await click("START"); await advance(1);
    play.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => { container.querySelector('video')!.dispatchEvent(new Event('error')); });
    await act(async () => { container.querySelector('video')!.dispatchEvent(new Event('loadedmetadata')); });
    await act(async () => { container.querySelector('video')!.dispatchEvent(new Event('seeked')); });
    await act(async () => vi.advanceTimersByTime(10001));
    expect(debug().paused).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("재생 응답 시간이 초과");
  } finally { vi.useRealTimers(); }
});
