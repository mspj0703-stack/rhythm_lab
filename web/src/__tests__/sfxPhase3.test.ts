import { expect, it, vi } from "vitest";
import { initializeSfx, playHitSfx, DEFAULT_AUDIO_SETTINGS } from "../audio/sfx";
it("initializes WebAudio and permits overlapping hit voices", () => {
  const osc = () => ({ type:"sine", frequency:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()}, connect:vi.fn().mockReturnThis(), start:vi.fn(), stop:vi.fn() });
  const gain = () => ({ gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()}, connect:vi.fn().mockReturnThis() });
  const ctx = { state:"running", currentTime:0, destination:{}, createOscillator:vi.fn(osc), createGain:vi.fn(gain), resume:vi.fn() };
  class MockAudioContext {
    state = ctx.state; currentTime = ctx.currentTime; destination = ctx.destination;
    createOscillator = ctx.createOscillator; createGain = ctx.createGain; resume = ctx.resume;
  }
  vi.stubGlobal("AudioContext", MockAudioContext);
  expect(initializeSfx()).toBe(true);
  playHitSfx(DEFAULT_AUDIO_SETTINGS,"perfect"); playHitSfx(DEFAULT_AUDIO_SETTINGS,"flick"); playHitSfx(DEFAULT_AUDIO_SETTINGS,"holdStart"); playHitSfx(DEFAULT_AUDIO_SETTINGS,"holdComplete");
  expect(ctx.createOscillator).toHaveBeenCalledTimes(4);
});
