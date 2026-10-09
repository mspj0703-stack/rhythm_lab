/** mm:ss.mmm clock used by the Maker timeline. */
export function formatClock(sec: number): string {
  const safe = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(3).padStart(6, "0")}`;
}
