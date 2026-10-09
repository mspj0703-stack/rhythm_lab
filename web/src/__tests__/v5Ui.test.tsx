import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NoticePanel } from "../components/v4/NoticePanel";
import { UploadScreen } from "../web/UploadScreen";
import { YouTubeEntry } from "../web/YouTubeEntry";
import { useInputManager } from "../engine/inputManager";
import { defaultChartPlatform, detectBeatdashPlatform } from "../platform/runtime";
import { parseChart } from "../engine/chartLoader";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

it("shows bundled notices, all notices and handles an empty feed", async () => {
  await act(async () => root.render(<NoticePanel />));
  expect(container.querySelector('[aria-label="공지"]')).toBeTruthy();
  expect(container.querySelector("summary")?.textContent).toContain("공지 전체보기");
  expect(container.textContent).toContain("D F J K");
  await act(async () => root.render(<NoticePanel notices={[]} />));
  expect(container.innerHTML).toBe("");
});

it("exposes MASTER (internal extreme) and both profiles in file upload", async () => {
  await act(async () => root.render(<UploadScreen onComplete={() => {}} />));
  // v5 Phase 2: the highest difficulty is displayed as MASTER; the internal value stays "extreme".
  expect(container.textContent).toContain("MASTER");
  expect(container.textContent).not.toContain("Extreme");
  const select = container.querySelector('select[aria-label="채보 플랫폼"]') as HTMLSelectElement;
  expect([...select.options].map(option => option.value)).toEqual(["mobile", "desktop"]);
});

it("passes the selected desktop profile and EXTREME to YouTube generation", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ title: "Title", duration: 30, thumbnail: "" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "test", chart: {} }) });
  vi.stubGlobal("fetch", fetcher);
  const completed = vi.fn();
  await act(async () => root.render(<YouTubeEntry onComplete={completed} />));
  const input = container.querySelector("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://youtu.be/abcdefghijk"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  const platform = container.querySelector('select[aria-label="채보 플랫폼"]') as HTMLSelectElement;
  const difficulty = [...container.querySelectorAll("select")].find(select => select !== platform)!;
  await act(async () => { platform.value = "desktop"; platform.dispatchEvent(new Event("change", { bubbles: true })); difficulty.value = "extreme"; difficulty.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => (container.querySelector(".primary-action") as HTMLButtonElement).click());
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ platform: "desktop", difficulty: "extreme" });
  expect(completed).toHaveBeenCalledOnce();
});

it("keeps Android/Desktop detection and uses touch preference on web", () => {
  expect(detectBeatdashPlatform("?platform=desktop")).toBe("DESKTOP");
  expect(detectBeatdashPlatform("?nativeVersion=4.8")).toBe("ANDROID");
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  expect(defaultChartPlatform()).toBe("mobile");
});

it("keeps legacy JSON and rejects invalid v5 metadata", () => {
  const legacy = { title: "Legacy", artist: "", bpm: 120, offset: 0, difficulty: "Hard", level: 1, version: 4, notes: [] };
  expect(parseChart(JSON.stringify(legacy)).version).toBe(4);
  expect(() => parseChart(JSON.stringify({ ...legacy, platformProfile: "invalid" }))).toThrow();
});

it("desktop lane keys remain usable while Space is held; legacy Flick combination remains available", async () => {
  const lane = vi.fn(), flick = vi.fn();
  const callbacks = { onLaneKeyDown: lane, onLaneKeyUp: vi.fn(), onFlick: flick, onPauseToggle: vi.fn() };
  function Input({ allowFlick }: { allowFlick: boolean }) { useInputManager(callbacks, true, false, allowFlick); return null; }
  await act(async () => root.render(<Input allowFlick={false} />));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
  expect(lane).toHaveBeenCalledWith(0); expect(flick).not.toHaveBeenCalled();
  await act(async () => root.render(<Input allowFlick={true} />));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }));
  expect(flick).toHaveBeenCalledWith(0);
});
