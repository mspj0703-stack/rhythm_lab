import { useEffect, useRef } from "react";

/**
 * 매 프레임 onFrame(callback)을 호출하는 단순한 루프.
 * 노트 이동/판정 자체는 video.currentTime을 기준으로 계산되므로,
 * 이 루프는 "언제 다시 계산할지"만 담당하고 시간의 기준이 되지는 않는다.
 */
export function useGameLoop(onFrame: () => void, active: boolean) {
  const rafRef = useRef<number | null>(null);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!active) return;

    function loop() {
      onFrameRef.current();
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);
}
