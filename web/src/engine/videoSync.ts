/**
 * 게임의 "진짜 시계"는 항상 media.currentTime이다.
 * performance.now() 등 독립 타이머는 노트 위치/판정 계산에 사용하지 않는다.
 * HTMLVideoElement와 HTMLAudioElement 모두 HTMLMediaElement이므로 같은 동기화 코어를 쓴다.
 */

export function getCurrentTimeSec(media: HTMLMediaElement | null): number {
  return media?.currentTime ?? 0;
}

export function pauseVideo(media: HTMLMediaElement | null) {
  media?.pause();
}

export function playVideo(media: HTMLMediaElement | null) {
  return media?.play() ?? Promise.resolve();
}

export function restartVideo(media: HTMLMediaElement | null) {
  if (!media) return;
  media.pause();
  media.currentTime = 0;
}

export function isVideoPlaying(media: HTMLMediaElement | null): boolean {
  if (!media) return false;
  return !media.paused && !media.ended;
}
