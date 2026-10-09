import type { ChartOrigin } from "../library/types";

export function originLabel(origin: ChartOrigin | undefined): string {
  if (origin === "MANUAL_EDITED") return "사람 편집본";
  if (origin === "COMMUNITY") return "커뮤니티";
  return "AI 원본";
}

export function originBadge(origin: ChartOrigin | undefined): string {
  if (origin === "MANUAL_EDITED") return "EDIT";
  if (origin === "COMMUNITY") return "COMMUNITY";
  return "AI";
}
