import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

interface YTPlayerLike {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  mute(): void;
  destroy(): void;
}

interface YTReadyEvent { target: YTPlayerLike; }
interface YTPlayerCtor {
  new(target: HTMLElement, options: {
    videoId: string;
    width?: string | number;
    height?: string | number;
    playerVars?: Record<string, string | number>;
    events?: { onReady?: (event: YTReadyEvent) => void };
  }): YTPlayerLike;
}
interface YTNamespace { Player: YTPlayerCtor; }

declare global {
  interface Window { YT?: YTNamespace; }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-rhythm-youtube-api="1"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.dataset.rhythmYoutubeApi = "1";
      script.onerror = () => reject(new Error("YouTube Player API 로드 실패"));
      document.head.appendChild(script);
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.YT?.Player) {
        window.clearInterval(timer);
        resolve(window.YT);
      } else if (Date.now() - started > 15_000) {
        window.clearInterval(timer);
        reject(new Error("YouTube Player API 응답 시간 초과"));
      }
    }, 100);
  });
  return apiPromise;
}

export interface YouTubeBackdropHandle {
  playAt(timeSec: number): void;
  pause(): void;
  restart(): void;
  syncTo(timeSec: number, thresholdSec?: number): void;
}

interface Props {
  videoId: string;
  visible: boolean;
  brightness: number;
  blurPx: number;
}

export const YouTubeBackdrop = forwardRef<YouTubeBackdropHandle, Props>(function YouTubeBackdrop(
  { videoId, visible, brightness, blurPx },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YTPlayerLike | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let created: YTPlayerLike | null = null;
    const host = hostRef.current;
    if (!host) return;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      created = new YT.Player(hostRef.current, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          rel: 0,
          iv_load_policy: 3,
          modestbranding: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => {
            readyRef.current = true;
            event.target.mute();
          },
        },
      });
      playerRef.current = created;
    }).catch(() => {
      // Audio remains the authoritative clock, so a failed MV must never stop gameplay.
    });

    return () => {
      cancelled = true;
      readyRef.current = false;
      created?.destroy();
      if (playerRef.current === created) playerRef.current = null;
    };
  }, [videoId]);

  useImperativeHandle(ref, () => ({
    playAt(timeSec: number) {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      player.mute();
      player.seekTo(Math.max(0, timeSec), true);
      player.playVideo();
    },
    pause() {
      if (readyRef.current) playerRef.current?.pauseVideo();
    },
    restart() {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      player.pauseVideo();
      player.seekTo(0, true);
    },
    syncTo(timeSec: number, thresholdSec = 0.35) {
      const player = playerRef.current;
      if (!player || !readyRef.current) return;
      const ytTime = player.getCurrentTime();
      if (Number.isFinite(ytTime) && Math.abs(ytTime - timeSec) > thresholdSec) {
        player.seekTo(Math.max(0, timeSec), true);
      }
    },
  }), []);

  return (
    <div
      className="youtube-backdrop"
      style={{
        display: visible ? "block" : "none",
        filter: `brightness(${brightness}) blur(${blurPx}px)`,
      }}
      aria-hidden="true"
    >
      <div ref={hostRef} className="youtube-player-host" />
    </div>
  );
});
