import { useEffect, useRef } from "react";
import type { Lane } from "../types/chart";
import { LANE_KEYS, FLICK_MODIFIER_KEY, FLICK_COMBINE_WINDOW_MS } from "../constants/config";

export interface InputCallbacks {
  /** 레인 키를 누른 순간 (Space 없이 단독으로 눌렸을 때) */
  onLaneKeyDown: (lane: Lane) => void;
  /** 레인 키를 뗀 순간 */
  onLaneKeyUp: (lane: Lane) => void;
  /** 레인 키 + Space 조합이 FLICK_COMBINE_WINDOW_MS 이내에 함께 들어왔을 때 */
  onFlick: (lane: Lane) => void;
  onPauseToggle: () => void;
}

const KEY_TO_LANE: Record<string, Lane> = Object.entries(LANE_KEYS).reduce(
  (acc, [lane, key]) => {
    acc[key] = Number(lane) as Lane;
    return acc;
  },
  {} as Record<string, Lane>
);

/**
 * keydown/keyup을 구독해 콜백으로 변환하는 훅.
 * 입력 로직(여기)과 판정 로직(engine/gameState)을 분리하기 위해,
 * 이 훅은 "무엇을 어떻게 판정할지"는 전혀 모르고 이벤트만 전달한다.
 */
export function useInputManager(callbacks: InputCallbacks, enabled: boolean, paused = false, allowFlick = true) {
  const laneKeyDownAt = useRef<Partial<Record<Lane, number>>>({});
  const spaceDownAt = useRef<number | null>(null);
  const heldKeys = useRef<Set<string>>(new Set());
  const flickConsumed = useRef<Set<Lane>>(new Set());

  useEffect(() => {
    laneKeyDownAt.current = {};
    spaceDownAt.current = null;
    heldKeys.current.clear();
    flickConsumed.current.clear();
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && (e.target.matches("input, textarea, select") || e.target.isContentEditable)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (e.repeat) return;
        callbacks.onPauseToggle();
        return;
      }

      const key = e.key.toLowerCase();
      if (key in KEY_TO_LANE || key === " ") e.preventDefault();
      if (paused) return;

      // 키 반복 입력 방지 (누르고 있는 동안 계속 발생하는 keydown 무시)
      if (heldKeys.current.has(key)) return;
      heldKeys.current.add(key);

      const now = performance.now();

      if (key === FLICK_MODIFIER_KEY.toLowerCase() || e.key === " ") {
        if (!allowFlick) return;
        spaceDownAt.current = now;
        // 이미 어떤 레인 키가 눌려있는 상태에서 space가 나중에 들어온 경우 조합 체크
        for (const [laneStr, downAt] of Object.entries(laneKeyDownAt.current)) {
          const lane = Number(laneStr) as Lane;
          if (downAt !== undefined && now - downAt <= FLICK_COMBINE_WINDOW_MS && !flickConsumed.current.has(lane)) {
            flickConsumed.current.add(lane);
            callbacks.onFlick(lane);
          }
        }
        return;
      }

      const lane = KEY_TO_LANE[key];
      if (lane === undefined) return;

      laneKeyDownAt.current[lane] = now;

      // space가 먼저 눌려있는 상태에서 레인 키가 나중에 들어온 경우 조합 체크
      if (
        allowFlick && spaceDownAt.current !== null &&
        now - spaceDownAt.current <= FLICK_COMBINE_WINDOW_MS &&
        !flickConsumed.current.has(lane)
      ) {
        flickConsumed.current.add(lane);
        callbacks.onFlick(lane);
        return;
      }

      callbacks.onLaneKeyDown(lane);
    }

    function handleKeyUp(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (key in KEY_TO_LANE || key === " ") e.preventDefault();
      if (paused) return;
      heldKeys.current.delete(key);

      if (key === FLICK_MODIFIER_KEY.toLowerCase() || e.key === " ") {
        spaceDownAt.current = null;
        return;
      }

      const lane = KEY_TO_LANE[key];
      if (lane === undefined) return;

      delete laneKeyDownAt.current[lane];
      flickConsumed.current.delete(lane);
      callbacks.onLaneKeyUp(lane);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, callbacks, paused, allowFlick]);
}
