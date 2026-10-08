import type { ChartPlatform } from "../types/chart";

export function ChartPlatformSelect({ value, onChange, disabled = false }: {
  value: ChartPlatform; onChange: (value: ChartPlatform) => void; disabled?: boolean;
}) {
  return <label className="chart-platform-select">채보 플랫폼 <select aria-label="채보 플랫폼" value={value}
    disabled={disabled} onChange={event => onChange(event.target.value as ChartPlatform)}>
    <option value="mobile">Mobile · 터치</option><option value="desktop">Desktop · D F J K</option>
  </select></label>;
}
