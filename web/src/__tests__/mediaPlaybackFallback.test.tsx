import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GameScreen } from "../components/GameScreen";
import { buildMediaPlan, deriveAudioFallbackUrls, describeMediaSource } from "../engine/mediaSources";
import { openSongMedia, useMediaHandleRelease, type SongMediaHandle } from "../library/mediaSource";
import type { Chart } from "../types/chart";

vi.mock("../components/NoteFieldCanvas", () => ({ NoteFieldCanvas: () => <canvas /> }));

const ID = "0123456789abcdef0123456789abcdef";
const VIDEO_URL = `/api/video/${ID}`;
const AUDIO_URL = `/api/media/${ID}`;
const chart = { title: "P0", artist: "test", bpm: 120, difficulty: "hard", level: 1, notes: [
  { time: 1, lane: 0, type: "tap" }, { time: 2, lane: 1, type: "tap" }, { time: 8, lane: 3, type: "tap" },
] } as Chart;

let root: Root, container: HTMLDivElement;
let frame: FrameRequestCallback | null;
let play = vi.fn<() => Promise<void>>();
let pause = vi.fn<() => void>();
let pausedOn: unknown[] = [];
let load = vi.fn<() => void>();

type Props = Partial<ComponentProps<typeof GameScreen>>;
const debug = () => (window as unknown as { __RHYTHM_DEBUG__: { state: { notes: { status: string }[]; totalJudged: number }; paused: boolean; gameStarted: boolean; startupPhase: string } }).__RHYTHM_DEBUG__;
const el = (selector = "video,audio") => container.querySelector(selector) as HTMLMediaElement | null;
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? "";
const statusText = () => Array.from(container.querySelectorAll('[role="status"]')).map((node) => node.textContent).join("|");

async function render(props: Props = {}) {
  await act(async () => {
    root.render(<GameScreen chart={chart} mediaUrl={VIDEO_URL} mediaKind="video" mediaMuted={false} audioFallbackUrls={[AUDIO_URL, VIDEO_URL]} {...props} />);
  });
}
async function fire(name: string, target: HTMLMediaElement | null = el()) {
  await act(async () => { target!.dispatchEvent(new Event(name)); });
}
async function ready(target: HTMLMediaElement | null = el()) { await fire("canplay", target); }
async function countdown() {
  await act(async () => { await vi.advanceTimersByTimeAsync(2200); });
  await act(async () => Promise.resolve());
}
async function startPlaying() { await ready(); await countdown(); }
async function advance(time: number) {
  el()!.currentTime = time;
  await act(async () => { frame?.(time * 1000); });
}
async function key(type: "keydown" | "keyup", k: string) {
  await act(async () => { window.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true })); });
}
async function click(text: string) {
  const b = Array.from(container.querySelectorAll("button")).find((x) => x.textContent?.trim() === text);
  expect(b, `button ${text}`).toBeDefined();
  await act(async () => b!.click());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  frame = null; pausedOn = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (this: HTMLMediaElement) { pausedOn.push(this); pause(); });
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(function (this: HTMLMediaElement) { this.currentTime = 0; load(); });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("1. audio + video healthy", () => {
  it("plays the MV element and shows no fallback notice", async () => {
    await render(); await startPlaying();
    expect(el()!.tagName).toBe("VIDEO");
    expect(el()!.getAttribute("src")).toBe(VIDEO_URL);
    expect(debug().gameStarted).toBe(true); expect(play).toHaveBeenCalledTimes(1);
    expect(statusText()).not.toContain("오디오 모드"); expect(alertText()).toBe("");
  });
});

describe("2. audio ok + video load failure -> audio-only", () => {
  it("falls back before the countdown without stopping the game and without a manual retry", async () => {
    await render(); await fire("error");
    expect(container.querySelector("video")).toBeNull();
    expect(el()!.tagName).toBe("AUDIO");
    expect(el()!.getAttribute("src")).toBe(AUDIO_URL);
    expect(statusText()).toContain("영상 로드에 실패해 오디오 모드로 재생합니다.");
    expect(alertText()).toBe("");
    expect(play).not.toHaveBeenCalled(); expect(debug().gameStarted).toBe(false);
    await ready(); await countdown();
    expect(debug().gameStarted).toBe(true); expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector(".visual-options")).toBeNull();
  });
  it("keeps judgement on the audio clock and reaches the result screen", async () => {
    await render(); await fire("error"); await startPlaying();
    await advance(1); await key("keydown", "d");
    expect(debug().state.notes[0].status).toBe("hit");
    await advance(9);
    await act(async () => { el()!.dispatchEvent(new Event("ended")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    expect(container.querySelector(".result-screen")).not.toBeNull();
  });
  it("survives a video error that arrives while the game is already running", async () => {
    await render(); await startPlaying(); await advance(1);
    await fire("error");                       // one bounded reload of the same source
    expect(load).toHaveBeenCalledTimes(1); expect(debug().paused).toBe(true);
    await fire("error");                       // the same source fails again -> audio-only, not another reload
    expect(container.querySelector("video")).toBeNull();
    expect(el()!.tagName).toBe("AUDIO");
    await ready(); await fire("loadedmetadata"); await fire("seeked");
    expect(el()!.currentTime).toBe(1);
    expect(debug().paused).toBe(false); expect(debug().gameStarted).toBe(true);
    expect(load.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe("3. repeated video failure has no recovery loop", () => {
  it("handles each source once even when error events repeat", async () => {
    await render();
    const staleVideo = el()!;
    await fire("error"); await fire("error", staleVideo); await fire("error", staleVideo);
    expect(container.querySelectorAll("audio")).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
    expect(statusText().match(/오디오 모드/g)).toHaveLength(1);
  });
  it("stops with one clear fatal message when audio also fails, then stays quiet", async () => {
    await render(); await fire("error");           // video -> dedicated audio
    await fire("error");                           // dedicated audio -> same container as audio
    await fire("error");                           // nothing left
    expect(alertText()).toContain("다시 시도");
    expect(play).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) await fire("error");
    expect(load).not.toHaveBeenCalled();
    expect(debug().gameStarted).toBe(false);
  });
});

describe("5. retry re-initialises the media resource", () => {
  it("remounts a fresh element, asks the owner for a fresh URL and falls back again instead of looping", async () => {
    const onRetryMedia = vi.fn();
    await render({ audioFallbackUrls: [AUDIO_URL], onRetryMedia });
    await fire("error"); await fire("error");
    expect(alertText()).toContain("다시 시도");
    const failed = el();
    await click("재생 다시 시도");
    expect(onRetryMedia).toHaveBeenCalledTimes(1);
    expect(el()).not.toBe(failed);
    expect(el()!.tagName).toBe("VIDEO");           // the stored MV is tried once more
    expect(debug().gameStarted).toBe(false); expect(alertText()).toBe("");
    await fire("error");                           // same video fails again -> audio-only, no loop
    expect(el()!.tagName).toBe("AUDIO"); expect(alertText()).toBe("");
    await ready(); await countdown();
    expect(debug().gameStarted).toBe(true);
  });
});

describe("6. leaving the screen", () => {
  it("pauses the element that is currently in use, even after a fallback swapped it", async () => {
    await render(); await startPlaying();
    await fire("error"); await fire("error");
    const audio = el()!; expect(audio.tagName).toBe("AUDIO");
    pausedOn = [];
    await act(async () => root.render(null));
    expect(pausedOn).toContain(audio);
  });
  it("pauses the live element after Result -> RETRY (new element) when the screen is left", async () => {
    await render(); await startPlaying(); await advance(9);
    await act(async () => { el()!.dispatchEvent(new Event("ended")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    await click("RETRY");
    const live = el()!; pausedOn = [];
    await act(async () => root.render(null));
    expect(pausedOn).toContain(live);
  });
});

describe("7. restart creates a fresh playback session", () => {
  it("keeps the working audio-only source and restarts through preparing -> countdown", async () => {
    await render(); await fire("error"); await startPlaying(); await advance(9);
    await act(async () => { el()!.dispatchEvent(new Event("ended")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    await click("RETRY");
    expect(debug().gameStarted).toBe(false); expect(debug().startupPhase).toBe("preparing");
    expect(el()!.tagName).toBe("AUDIO"); expect(container.querySelector("video")).toBeNull();
    expect(play).toHaveBeenCalledTimes(1);
    await ready(); await countdown();
    expect(debug().gameStarted).toBe(true); expect(play).toHaveBeenCalledTimes(2);
  });
});

describe("8. genuinely fatal: nothing playable", () => {
  it("shows the fatal message only when no audio source exists", async () => {
    await render({ audioFallbackUrls: [] });
    await fire("error");
    expect(alertText()).toContain("다시 시도");
    expect(container.querySelector("audio")).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
  it("an audio-only song that cannot load is fatal as well", async () => {
    await render({ mediaKind: "audio", mediaUrl: AUDIO_URL, audioFallbackUrls: [] });
    await fire("error");
    expect(alertText()).toContain("다시 시도");
  });
});

describe("4. Library media restore and object URL lifecycle", () => {
  let created: string[]; let revoked: string[];
  beforeEach(() => {
    created = []; revoked = [];
    vi.stubGlobal("URL", Object.assign(Object.create(URL), {
      createObjectURL: () => { const url = `blob:test/${created.length}`; created.push(url); return url; },
      revokeObjectURL: (url: string) => { revoked.push(url); },
    }));
  });
  it("creates exactly one object URL per opened song and reuses it as the audio-only source", () => {
    const handle = openSongMedia({ mediaBlob: new Blob(["x"]), sourceUrl: undefined, mediaKind: "video" })!;
    expect(created).toHaveLength(1);
    expect(handle.url).toBe(created[0]);
    expect(handle.audioFallbackUrls).toEqual([created[0]]);
    expect(revoked).toEqual([]);
    handle.revoke(); handle.revoke();
    expect(revoked).toEqual([created[0]]);
  });
  it("native saved songs use the app media URL, derive the dedicated audio file and revoke nothing", () => {
    const handle = openSongMedia({ sourceUrl: VIDEO_URL, mediaKind: "video" })!;
    expect(handle.url).toBe(VIDEO_URL);
    expect(handle.audioFallbackUrls).toEqual([AUDIO_URL, VIDEO_URL]);
    handle.revoke(); expect(revoked).toEqual([]); expect(created).toEqual([]);
  });
  it("returns null only when neither Blob nor URL exists", () => {
    expect(openSongMedia({ mediaKind: "video" })).toBeNull();
  });
  it("releases a handle only after it is replaced or the screen is left", async () => {
    const a = openSongMedia({ mediaBlob: new Blob(["a"]), mediaKind: "video" })!;
    const b = openSongMedia({ mediaBlob: new Blob(["b"]), mediaKind: "video" })!;
    function Holder({ handle }: { handle: SongMediaHandle | null }) { useMediaHandleRelease(handle); return null; }
    await act(async () => root.render(<Holder handle={a} />));
    expect(revoked).toEqual([]);
    await act(async () => root.render(<Holder handle={a} />));
    expect(revoked).toEqual([]);                    // re-render with the same handle never revokes
    await act(async () => root.render(<Holder handle={b} />));
    expect(revoked).toEqual([a.url]);               // old one only after the new one is committed
    await act(async () => root.render(<Holder handle={null} />));
    expect(revoked).toEqual([a.url, b.url]);
  });
  it("Restart and Retry inside the game never revoke the URL", async () => {
    const handle = openSongMedia({ mediaBlob: new Blob(["v"]), mediaKind: "video" })!;
    await render({ mediaUrl: handle.url, audioFallbackUrls: handle.audioFallbackUrls });
    await startPlaying(); await advance(9);
    await act(async () => { el()!.dispatchEvent(new Event("ended")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    await click("RETRY");
    expect(revoked).toEqual([]);
  });
});

describe("media plan helpers", () => {
  it("builds ordered, de-duplicated candidates", () => {
    expect(buildMediaPlan(VIDEO_URL, "video", [AUDIO_URL, VIDEO_URL, AUDIO_URL]).map((c) => `${c.kind}:${c.url}`))
      .toEqual([`video:${VIDEO_URL}`, `audio:${AUDIO_URL}`, `audio:${VIDEO_URL}`]);
    expect(buildMediaPlan(AUDIO_URL, "audio")).toHaveLength(1);
  });
  it("derives audio fallbacks only for video songs", () => {
    expect(deriveAudioFallbackUrls(AUDIO_URL, "audio")).toEqual([]);
    expect(deriveAudioFallbackUrls(`https://x.example/api/video/${ID}`, "video")).toEqual([`https://x.example/api/media/${ID}`, `https://x.example/api/video/${ID}`]);
    expect(deriveAudioFallbackUrls("blob:abc", "video")).toEqual(["blob:abc"]);
    expect(deriveAudioFallbackUrls(null, "video")).toEqual([]);
  });
  it("diagnostics never expose object URLs or ids", () => {
    expect(describeMediaSource("blob:https://x/abc")).toBe("blob");
    expect(describeMediaSource(`https://x.example/api/video/${ID}?t=1`)).toBe("/api/video/<id>");
  });
});
