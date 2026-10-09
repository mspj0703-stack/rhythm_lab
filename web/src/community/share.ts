import type { LibraryBundle, LibraryChart } from "../library/types";
import { summarizeEdit, isEdited, type EditSummary } from "../library/chartDiff";
import { validatePlayability, type ValidationResult } from "../maker/validator";
import type { AuthorIdentity } from "../library/author";
import type { CommunityUploadPayload } from "./api";
import { difficultyLabel } from "../constants/difficulty";

/** Newest chart JSON version this client (and the server) understands. */
export const SUPPORTED_CHART_VERSION = 5;

export interface ShareEligibility {
  ok: boolean;
  reasons: string[];
  validation: ValidationResult;
  editSummary: EditSummary;
}

/** Only real human edits that pass the validator may be shared (AI output is never uploaded as-is). */
export function checkShareEligibility(chart: LibraryChart, bundle: LibraryBundle): ShareEligibility {
  const reasons: string[] = [];
  const validation = validatePlayability(chart.chart.notes, { platformProfile: chart.chart.platformProfile, difficulty: chart.difficulty, durationSec: bundle.song.durationSec });
  const parent = chart.parentChartId ? bundle.charts.find((item) => item.id === chart.parentChartId) : undefined;
  // A deleted parent cannot be compared; such a chart was already proven different when it was first saved.
  const editSummary = parent ? summarizeEdit(parent.chart.notes, chart.chart.notes) : { added: chart.chart.notes.length, removed: 0, unchanged: 0 };
  if (chart.origin !== "MANUAL_EDITED") reasons.push(chart.origin === "COMMUNITY" ? "다운로드한 채보는 다시 공유할 수 없습니다. Maker에서 수정한 편집본만 공유됩니다." : "AI가 생성한 원본은 공유할 수 없습니다. Maker에서 수정해 편집본으로 저장하세요.");
  else if (!isEdited(editSummary)) reasons.push("원본과 같은 채보입니다. 노트를 수정해야 공유할 수 있습니다.");
  if (chart.chart.platformProfile !== "mobile" && chart.chart.platformProfile !== "desktop") reasons.push("플랫폼 정보가 없는 Legacy 채보는 공유할 수 없습니다.");
  if ((chart.chart.version ?? 1) > SUPPORTED_CHART_VERSION) reasons.push("지원하지 않는 채보 버전입니다.");
  if (!validation.ok) reasons.push(`검사 ERROR ${validation.errors}개를 먼저 해결해야 합니다.`);
  return { ok: reasons.length === 0, reasons, validation, editSummary };
}

export function buildUploadPayload(chart: LibraryChart, bundle: LibraryBundle, identity: AuthorIdentity, eligibility: ShareEligibility, description?: string): CommunityUploadPayload {
  const song = bundle.song;
  const lastNoteEnd = chart.chart.notes.reduce((end, note) => Math.max(end, note.time + (note.type === "hold" ? note.duration : 0)), 0);
  return {
    authorId: identity.authorId,
    authorSecret: identity.authorSecret,
    origin: "human-edited",
    editSummary: eligibility.editSummary,
    title: (chart.label?.trim() || `${difficultyLabel(chart.difficulty)} 편집본`).slice(0, 80),
    description: description?.trim().slice(0, 500) || undefined,
    chartVersion: chart.chartVersion,
    song: {
      title: song.title.slice(0, 200),
      originalTitle: song.originalTitle?.slice(0, 200) || undefined,
      // Some native songs never recorded a length; the chart's own end is the safe lower bound.
      durationSec: song.durationSec > 0 ? song.durationSec : Math.ceil(lastNoteEnd + 1),
      bpm: song.bpm,
      fingerprint: song.fingerprint.startsWith("v2:") ? song.fingerprint : undefined,
    },
    chart: { ...chart.chart, title: song.originalTitle || song.title, difficulty: chart.difficulty, level: chart.level },
  };
}
