import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, loadPreferences, normalizePreferences, PREFERENCES_KEY, savePreferences } from '../settings/preferences';
import { loadNoteSpeed, saveNoteSpeed } from '../settings/noteSpeed';
import { loadTimingOffsetMs, saveTimingOffsetMs } from '../settings/timingOffset';
import { isYouTubeUrl } from '../web/youtubeUrl';
beforeEach(() => localStorage.clear());
it('loads defaults safely from absent, malformed or incompatible saved preferences', () => {
  expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  localStorage.setItem(PREFERENCES_KEY, '{broken'); expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  expect(normalizePreferences({ fastSlow: 'false', backgroundBrightness: NaN, effects: 'ultra' })).toEqual(DEFAULT_PREFERENCES);
});
it('persists all phase1 preferences across reload and clamps brightness', () => {
  const value = { ...DEFAULT_PREFERENCES, combo: false, fastSlow: false, judgementText: false, vibration: true, backgroundVideo: false, effects: 'high' as const, backgroundBrightness: 2 };
  expect(savePreferences(value)).toBe(true);
  expect(loadPreferences()).toEqual({ ...value, backgroundBrightness: 1 });
});
it('does not replace legacy speed and offset storage', () => {
  saveNoteSpeed(12.3); saveTimingOffsetMs(-82); savePreferences({ ...DEFAULT_PREFERENCES, combo: false });
  expect(loadNoteSpeed()).toBeCloseTo(12.3); expect(loadTimingOffsetMs()).toBe(-82);
});
it.each(['https://youtu.be/abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk','https://music.youtube.com/watch?v=abcdefghijk'])('accepts a YouTube link: %s', u => expect(isYouTubeUrl(u)).toBe(true));
it.each(['javascript:alert(1)','https://youtube.com.evil.test/watch?v=x','https://user:pass@youtube.com/watch?v=x','https://youtube.com:8080/watch?v=x','https://example.com'])('rejects unsafe/non-YouTube URL: %s', u => expect(isYouTubeUrl(u)).toBe(false));
