import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "../components/GameScreen";
import { isMediaReady, preparationProgress } from "../engine/mediaReadiness";
import { resumeHolds, createInitialGameState, attemptLanePress, tick } from "../engine/gameState";
import { DEFAULT_PREFERENCES } from "../settings/preferences";
import type { Chart } from "../types/chart";

vi.mock("../components/NoteFieldCanvas", () => ({ NoteFieldCanvas: () => <canvas /> }));

const ID = "0123456789abcdef0123456789abcdef";
const chart = { title: "Pause", artist: "", bpm: 120, offset: 0, difficulty: "hard", level: 5, platformProfile: "mobile", scoringVersion: 2, notes: [
  { time: 1, lane: 0, type: "tap" }, { time: 2, lane: 1, type: "hold", duration: 2 }, { time: 5, lane: 2, type: "tap" }, { time: 9, lane: 3, type: "tap" },
] } as Chart;

let root: Root;
let container: HTMLDivElement;
let frame: FrameRequestCallback | null;
let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;
let load: ReturnType<typeof vi.fn>;
type Debug = { state: { notes: { status: string; holdReleasedAt?: number }[]; score: number; combo: number; holdTickScore: number; totalJudged: number }; paused: boolean; gameStarted: boolean; startupPhase: string };
const debug = () => (window as unknown as { __RHYTHM_DEBUG__: Debug }).__RHYTHM_DEBUG__;
const el = () => container.querySelector("video,audio") as HTMLMediaElement;
const buttons = (text: string) => [...container.querySelectorAll("button")].filter((node) => node.textContent?.trim() === text);
async function click(text: string) { const [b] = buttons(text); expect(b, text).toBeDefined(); await act(async () => b.click()); }
async function fire(name: string, target = el()) { await act(async () => { target.dispatchEvent(new Event(name)); }); }
async function wait(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function at(time: number) { el().currentTime = time; await act(async () => { frame?.(time * 1000); }); }
async function key(type: "keydown" | "keyup", k: string) { await act(async () => { window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true })); }); }
async function render(props: Partial<ComponentProps<typeof GameScreen>> = {}) {
  await act(async () => root.render(<GameScreen chart={chart} mediaUrl={`/api/video/${ID}`} mediaKind="video" mediaMuted={false} audioFallbackUrls={[`/api/media/${ID}`]} {...props} />));
}
async function start(props: Partial<ComponentProps<typeof GameScreen>> = {}) {
  await render(props); await fire("canplaythrough"); await wait(3200);
  expect(debug().gameStarted).toBe(true);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  frame = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as () => Promise<void>);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause as () => void);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(load as () => void);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Pause menu", () => {
  it("offers 계속하기 / 다시 시작 / MV 설정 / 곡 리스트로 돌아가기 and no in-play back or START button", async () => {
    await start({ onQuit: () => {} });
    expect(buttons("START")).toHaveLength(0);
    expect(container.querySelector(".play-toolbar, .visual-options")).toBeNull();
    await key("keydown", "Escape");
    for (const label of ["계속하기", "다시 시작", "MV 설정", "곡 리스트로 돌아가기"]) expect(buttons(label), label).toHaveLength(1);
  });

  it("Continue runs 3-2-1 with audio, clock, notes, input, ticks, score and combo frozen at the pause position", async () => {
    await start();
    await at(1); await key("keydown", "d"); await key("keyup", "d");
    await at(2); await key("keydown", "f");                       // Hold in progress
    await at(2.6);
    const before = { ...debug().state };
    await key("keydown", "Escape");
    const playsBefore = play.mock.calls.length;
    await click("계속하기");
    expect(container.querySelector(".resume-countdown")?.textContent).toBe("3");
    await wait(1000); expect(container.querySelector(".resume-countdown")?.textContent).toBe("2");
    // Input during the countdown is not judged; the clock does not move (media stays paused at 2.6).
    await key("keydown", "j");
    await act(async () => { frame?.(99999); });
    await wait(1000); expect(container.querySelector(".resume-countdown")?.textContent).toBe("1");
    expect(play.mock.calls.length).toBe(playsBefore);
    expect(el().currentTime).toBe(2.6);
    expect(debug().state.score).toBe(before.score);
    expect(debug().state.combo).toBe(before.combo);
    expect(debug().state.holdTickScore).toBe(before.holdTickScore);
    expect(debug().state.totalJudged).toBe(before.totalJudged);
    expect(debug().state.notes[1].status).toBe("holding");    // Hold during pause: no unfair Miss
    await wait(1000);
    expect(container.querySelector(".resume-countdown")).toBeNull();
    expect(play.mock.calls.length).toBe(playsBefore + 1);
    expect(el().currentTime).toBe(2.6);                         // resumes from the same position
    expect(debug().paused).toBe(false);
    // F is still physically held (keydown before the pause, no keyup): the Hold continues and completes.
    await at(4.01);
    expect(debug().state.notes[1].status).toBe("hit");
  });

  it("pressing Pause repeatedly never stacks countdowns or plays twice", async () => {
    await start();
    await key("keydown", "Escape");
    const plays = play.mock.calls.length;
    await key("keydown", "Escape");      // start countdown
    await key("keydown", "Escape");      // cancel it (back to the menu)
    await key("keydown", "Escape");      // start again
    await wait(3000);
    expect(play.mock.calls.length).toBe(plays + 1);
    expect(container.querySelectorAll(".resume-countdown")).toHaveLength(0);
    await wait(3000);
    expect(play.mock.calls.length).toBe(plays + 1);
  });

  it("Restart reuses the prepared media (seek 0, no reload) and starts after 3-2-1", async () => {
    await start(); await at(5);
    const element = el();
    await key("keydown", "Escape"); await click("다시 시작");
    expect(el()).toBe(element); expect(el().currentTime).toBe(0); expect(load).not.toHaveBeenCalled();
    expect(debug().startupPhase).toBe("countdown");
    expect(buttons("START")).toHaveLength(0);
    const plays = play.mock.calls.length;
    await wait(2900); expect(play.mock.calls.length).toBe(plays);
    await wait(400); expect(play.mock.calls.length).toBe(plays + 1);
    expect(debug().state.totalJudged).toBe(0);
  });

  it("Back to the song list confirms, stops media/countdown/pointers and never reports a result", async () => {
    const onQuit = vi.fn(); const onResult = vi.fn();
    await start({ onQuit, onResult });
    await at(2); await key("keydown", "f");
    await key("keydown", "Escape");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("곡 리스트로 돌아가기");
    expect(onQuit).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click("계속하기");                 // a running countdown must be cleaned up too
    await key("keydown", "Escape");
    await click("곡 리스트로 돌아가기");
    expect(confirm).toHaveBeenLastCalledWith("플레이를 종료하고 곡 리스트로 돌아갈까요?");
    expect(onQuit).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalled();
    const plays = play.mock.calls.length;
    await wait(5000);
    expect(play.mock.calls.length).toBe(plays);
    expect(onResult).not.toHaveBeenCalled();
  });

  it("MV settings in Pause apply immediately, persist through preferences and never move the audio", async () => {
    const onPreferencesChange = vi.fn();
    await start({ onPreferencesChange, preferences: DEFAULT_PREFERENCES });
    await at(3.3);
    const element = el();
    await key("keydown", "Escape"); await click("MV 설정");
    pause.mockClear();
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(element.style.opacity).toBe("0");
    expect(onPreferencesChange).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundVideo: false }));
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(element.style.opacity).not.toBe("0");
    expect(el()).toBe(element); expect(element.currentTime).toBe(3.3); expect(load).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
    await click("← 돌아가기");
    expect(buttons("계속하기")).toHaveLength(1);
  });

  it("Android Back during play opens Pause instead of leaving; on the result it returns to the list", async () => {
    const onLibrary = vi.fn();
    await start({ onLibrary });
    const back = () => (window as unknown as { __beatdashBack: () => boolean }).__beatdashBack();
    let handled = false;
    await act(async () => { handled = back(); });
    expect(handled).toBe(true); expect(debug().paused).toBe(true); expect(onLibrary).not.toHaveBeenCalled();
    await act(async () => { handled = back(); });
    expect(handled).toBe(true); expect(onLibrary).not.toHaveBeenCalled();
    await key("keydown", "Escape"); await wait(3000);
    await at(10); await fire("ended"); await wait(700);
    expect(container.querySelector(".result-screen")).toBeTruthy();
    await act(async () => { handled = back(); });
    expect(handled).toBe(true); expect(onLibrary).toHaveBeenCalledOnce();
  });
});

describe("Hold resume policy (engine)", () => {
  const holdChart = { ...chart, notes: [{ time: 1, lane: 1, type: "hold", duration: 2 }] } as Chart;
  const holding = () => tick(attemptLanePress(createInitialGameState(holdChart, { failEnabled: false }), 1, 1), 1.5);
  it("a lane still pressed at resume keeps holding; a lifted lane gets one re-grab window, then breaks", () => {
    expect(resumeHolds(holding(), 1.5, [1]).notes[0]).toMatchObject({ status: "holding", holdReleasedAt: undefined });
    const lifted = resumeHolds(holding(), 1.5, []);
    expect(tick(lifted, 1.85).notes[0].status).toBe("holding");
    expect(tick(attemptLanePress(lifted, 1, 1.8), 2.5).notes[0]).toMatchObject({ status: "holding", holdReleasedAt: undefined });
    expect(tick(lifted, 1.95).notes[0].status).toBe("hold_broken");
  });
});

describe("Media preparation before gameplay", () => {
  it("A/C/G: a bare canplay never starts; the countdown begins only when the media can play through", async () => {
    await render();
    await fire("loadedmetadata"); await fire("canplay");
    await wait(10000);
    expect(debug().startupPhase).toBe("preparing"); expect(play).not.toHaveBeenCalled();
    expect(container.textContent).toContain("MV를 불러오는 중");
    await fire("canplaythrough");
    expect(debug().startupPhase).toBe("countdown");
    await wait(3100);
    expect(debug().gameStarted).toBe(true);
  });

  it("B: an audio song (or MV off) waits only for the audio element", async () => {
    await render({ mediaKind: "audio", mediaUrl: `/api/media/${ID}`, audioFallbackUrls: [] });
    expect(container.textContent).toContain("곡을 준비하는 중");
    await fire("canplaythrough"); await wait(3100);
    expect(debug().gameStarted).toBe(true);
  });

  it("D/E/F: MV failure explains itself, Retry re-tries the MV, 'MV 없이 플레이' continues on audio after it is ready", async () => {
    const onRetryMedia = vi.fn();
    await render({ onRetryMedia });
    await fire("error");
    expect(container.querySelector(".mv-choice")?.textContent).toContain("MV를 불러오지 못했습니다.");
    await click("다시 시도");
    expect(onRetryMedia).toHaveBeenCalledOnce(); expect(el().tagName).toBe("VIDEO");
    await fire("error");
    await click("MV 없이 플레이");
    expect(el().tagName).toBe("AUDIO");
    await wait(5000); expect(play).not.toHaveBeenCalled();   // still waits for audio readiness
    await fire("canplaythrough"); await wait(3100);
    expect(debug().gameStarted).toBe(true);
  });

  it("a slow MV offers 계속 기다리기 / MV 없이 플레이 instead of an endless spinner", async () => {
    await render();
    await wait(20100);
    expect(container.querySelector(".mv-choice")?.textContent).toContain("지연");
    await click("계속 기다리기");
    expect(container.querySelector(".mv-choice")).toBeNull();
    await fire("canplaythrough"); await wait(3100);
    expect(debug().gameStarted).toBe(true);
  });

  it("I/J: Resume reuses the element without reloading and the game clock is the media clock", async () => {
    await start();
    const element = el(); const src = element.getAttribute("src");
    await at(4); await key("keydown", "Escape"); await key("keydown", "Escape"); await wait(3000);
    expect(el()).toBe(element); expect(element.getAttribute("src")).toBe(src); expect(load).not.toHaveBeenCalled();
    await at(5); await key("keydown", "j");
    expect(debug().state.notes[2].status).toBe("hit");
  });

  it("K: while the media buffers, judgement is suspended and the timeline does not run ahead", async () => {
    await start();
    await at(4.9); await fire("waiting");
    expect(container.querySelector(".buffering-status")).toBeTruthy();
    await key("keydown", "j");                           // not judged against a stalled clock
    expect(debug().state.notes[2].status).toBe("pending");
    await act(async () => { frame?.(60000); });          // frames keep coming, media time stays 4.9
    expect(debug().state.notes[2].status).toBe("pending");
    await key("keyup", "j");
    await fire("playing");
    expect(container.querySelector(".buffering-status")).toBeNull();
    await at(5); await key("keydown", "j");
    expect(debug().state.notes[2].status).toBe("hit");
  });

  it("readiness helper: readyState 4 or enough buffered ahead; errors and missing metadata are not ready", () => {
    const fake = (props: Partial<HTMLMediaElement> & { ranges?: [number, number][] }) => ({
      error: null, readyState: 2, duration: 120, currentTime: 0,
      buffered: { length: props.ranges?.length ?? 0, start: (i: number) => props.ranges![i][0], end: (i: number) => props.ranges![i][1] },
      ...props,
    }) as unknown as HTMLMediaElement;
    expect(isMediaReady(fake({ readyState: 4 }))).toBe(true);
    expect(isMediaReady(fake({ ranges: [[0, 3]] }))).toBe(false);
    expect(preparationProgress(fake({ ranges: [[0, 3]] }))).toBeCloseTo(0.2);
    expect(isMediaReady(fake({ ranges: [[0, 16]] }))).toBe(true);
    expect(isMediaReady(fake({ duration: 8, ranges: [[0, 7.95]] }))).toBe(true);
    expect(isMediaReady(fake({ duration: Number.NaN, ranges: [[0, 60]] }))).toBe(false);
    expect(isMediaReady(fake({ readyState: 4, error: { code: 4 } as MediaError }))).toBe(false);
    expect(isMediaReady(null)).toBe(false);
  });
});
