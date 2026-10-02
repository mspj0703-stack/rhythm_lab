export interface AudioSettings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  sfxEnabled: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  masterVolume: 0.9,
  musicVolume: 1,
  sfxVolume: 0.65,
  sfxEnabled: true,
};

const KEY = "beatdash.audio.v4";
let context: AudioContext | null = null;

function clamp(value: number): number { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }

export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_AUDIO_SETTINGS;
    const value = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      masterVolume: clamp(value.masterVolume ?? DEFAULT_AUDIO_SETTINGS.masterVolume),
      musicVolume: clamp(value.musicVolume ?? DEFAULT_AUDIO_SETTINGS.musicVolume),
      sfxVolume: clamp(value.sfxVolume ?? DEFAULT_AUDIO_SETTINGS.sfxVolume),
      sfxEnabled: typeof value.sfxEnabled === "boolean" ? value.sfxEnabled : true,
    };
  } catch { return DEFAULT_AUDIO_SETTINGS; }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* best effort */ }
}

export function initializeSfx(): boolean { return getContext() !== null; }

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext;
  if (!AudioCtx) return null;
  context ??= new AudioCtx();
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

function tone(settings: AudioSettings, frequency: number, duration = 0.05, gain = 0.12, slideTo?: number): void {
  if (!settings.sfxEnabled) return;
  const ctx = getContext();
  if (!ctx) return;
  const volume = clamp(settings.masterVolume * settings.sfxVolume) * gain;
  if (volume <= 0) return;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const now = ctx.currentTime;
  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, now);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
  amp.gain.setValueAtTime(volume, now);
  amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration + 0.01);
}

export function playUiSfx(settings: AudioSettings): void { tone(settings, 620, 0.035, 0.07, 760); }
export function playStartSfx(settings: AudioSettings): void { tone(settings, 440, 0.12, 0.10, 880); }
export function playHitSfx(settings: AudioSettings, kind: "perfect" | "great" | "good" | "miss" | "flick" | "holdStart" | "holdComplete"): void {
  // Short synthesized voices overlap naturally; no shared <audio> element means fast streams cannot cut each other off.
  const spec = {
    perfect: [1080, .038, .075, 1380], great: [880, .042, .068, 1080], good: [690, .046, .06, 760], miss: [170, .08, .04, 120],
    flick: [1320, .055, .085, 2100], holdStart: [540, .055, .06, 680], holdComplete: [720, .075, .065, 1080],
  } as const;
  const [frequency, duration, gain, slide] = spec[kind];
  tone(settings, frequency, duration, gain, slide);
}
export function playFullComboSfx(settings: AudioSettings): void { tone(settings, 660, 0.16, 0.12, 1320); setTimeout(() => tone(settings, 990, 0.18, 0.11, 1760), 90); }
export function playPerfectComboSfx(settings: AudioSettings): void { tone(settings, 780, 0.18, 0.13, 1560); setTimeout(() => tone(settings, 1170, 0.22, 0.13, 2200), 90); setTimeout(() => tone(settings, 1560, 0.25, 0.12, 2600), 180); }

export function playNoticeSfx(settings: AudioSettings, kind: "complete" | "error" | "best" | "result"): void {
  const frequency = { complete: 740, error: 200, best: 1200, result: 550 }[kind];
  tone(settings, frequency, 0.14, 0.09, kind === "error" ? 140 : frequency * 1.5);
}
