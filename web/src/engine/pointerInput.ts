import type { Lane } from "../types/chart";

/**
 * v5 Phase 2 multi-touch input: every touch is tracked by its own pointerId.
 *
 * - A pointer belongs to the lane it went down on (implicit capture keeps it there).
 * - Hold ownership: the first active pointer on a lane owns that lane's press. Only the owner's
 *   pointerup/pointercancel releases the lane (the engine then applies its usual Hold grace); any
 *   other pointer ending never touches another lane or another pointer's press.
 * - Flick recognition is per pointer (start/current position, distance, direction, elapsed time).
 * - Ending one pointer never clears the others. `reset()` exists only for pause/leave.
 *
 * The tracker is pure bookkeeping: it returns the gameplay actions the caller must apply, so it can be
 * tested without a DOM and reused unchanged by every input surface.
 */
export const FLICK_MIN_DISTANCE_PX = 28;
/** A swipe slower than this is a drag, not a Flick. */
export const FLICK_MAX_DURATION_MS = 400;
export const MAX_TRACKED_POINTERS = 10;

export interface TrackedPointer {
  pointerId: number;
  lane: Lane;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startedAt: number;
  flicked: boolean;
}

export type PointerAction =
  | { type: "press"; lane: Lane; pointerId: number }
  | { type: "release"; lane: Lane; pointerId: number }
  | { type: "flick"; lane: Lane; pointerId: number };

export class PointerLaneTracker {
  private pointers = new Map<number, TrackedPointer>();
  /** lane -> pointerIds in press order; index 0 is the owner. */
  private laneOrder: number[][] = [[], [], [], []];

  /** pointerdown. Returns the press for the engine (a second pointer on an owned lane still presses for Tap/regrab). */
  down(pointerId: number, lane: Lane, x: number, y: number, at: number): PointerAction[] {
    if (this.pointers.has(pointerId)) return [];
    if (this.pointers.size >= MAX_TRACKED_POINTERS) return [];
    this.pointers.set(pointerId, { pointerId, lane, startX: x, startY: y, x, y, startedAt: at, flicked: false });
    this.laneOrder[lane].push(pointerId);
    return [{ type: "press", lane, pointerId }];
  }

  /** pointermove. Detects an upward Flick for this pointer only. */
  move(pointerId: number, x: number, y: number, at: number): PointerAction[] {
    const pointer = this.pointers.get(pointerId);
    if (!pointer) return [];
    pointer.x = x;
    pointer.y = y;
    if (pointer.flicked) return [];
    const up = pointer.startY - y;
    const sideways = Math.abs(x - pointer.startX);
    if (up >= FLICK_MIN_DISTANCE_PX && up > sideways && at - pointer.startedAt <= FLICK_MAX_DURATION_MS) {
      pointer.flicked = true;
      return [{ type: "flick", lane: pointer.lane, pointerId }];
    }
    return [];
  }

  /** pointerup / pointercancel / lostpointercapture: ends only this pointer. */
  end(pointerId: number): PointerAction[] {
    const pointer = this.pointers.get(pointerId);
    if (!pointer) return [];
    this.pointers.delete(pointerId);
    const order = this.laneOrder[pointer.lane];
    const wasOwner = order[0] === pointerId;
    order.splice(order.indexOf(pointerId), 1);
    // A non-owner ending never releases the lane. When the owner lifts while another finger still rests on
    // the same lane, ownership passes on and the lane stays pressed.
    if (!wasOwner || order.length > 0) return [];
    return [{ type: "release", lane: pointer.lane, pointerId }];
  }

  ownerOf(lane: Lane): number | null {
    return this.laneOrder[lane][0] ?? null;
  }

  isLaneHeld(lane: Lane): boolean {
    return this.laneOrder[lane].length > 0;
  }

  heldLanes(): Lane[] {
    return ([0, 1, 2, 3] as Lane[]).filter((lane) => this.isLaneHeld(lane));
  }

  get(pointerId: number): TrackedPointer | undefined {
    const pointer = this.pointers.get(pointerId);
    return pointer ? { ...pointer } : undefined;
  }

  get size(): number {
    return this.pointers.size;
  }

  /** Pause / leave: forget every physical pointer without generating releases (the game state is frozen). */
  reset(): void {
    this.pointers.clear();
    this.laneOrder = [[], [], [], []];
  }
}
