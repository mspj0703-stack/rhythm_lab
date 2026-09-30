/** Reload metadata before seeking; abort/timeout always remove event listeners. */
export function reloadMediaAtTime(media: HTMLMediaElement, time: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let seeking = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      media.removeEventListener("loadedmetadata", metadata);
      media.removeEventListener("seeked", seeked);
      media.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error); else resolve();
    };
    const failed = () => finish(new Error("미디어를 다시 불러올 수 없습니다."));
    const aborted = () => finish(new DOMException("복구 취소", "AbortError"));
    const seeked = () => { if (seeking) finish(); };
    const metadata = () => {
      try {
        const target = Math.max(0, Number.isFinite(time) ? time : 0);
        if (Number.isFinite(media.duration) && target > media.duration) { finish(new Error("저장된 재생 위치가 영상 길이를 초과합니다.")); return; }
        if (target === 0) { media.currentTime = 0; finish(); return; }
        seeking = true;
        media.currentTime = target;
      } catch (error) { finish(error as Error); }
    };
    if (signal.aborted) { aborted(); return; }
    media.addEventListener("loadedmetadata", metadata);
    media.addEventListener("seeked", seeked);
    media.addEventListener("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(() => finish(new Error("미디어 복구 시간이 초과되었습니다.")), 10000);
    try { media.load(); } catch (error) { finish(error as Error); }
  });
}

/** A play() promise can remain pending while buffering; don't leave recovery stuck. */
export function playMediaWithTimeout(media: HTMLMediaElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => { media.pause(); finish(new DOMException("재생 취소", "AbortError")); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, {once:true});
    timer = setTimeout(() => { media.pause(); finish(new Error("미디어 재생 응답 시간이 초과되었습니다.")); }, 10000);
    try { Promise.resolve(media.play()).then(() => finish(), (error: Error) => finish(error)); }
    catch (error) { finish(error as Error); }
  });
}
