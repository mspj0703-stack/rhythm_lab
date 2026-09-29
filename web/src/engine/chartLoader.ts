import type { Chart, ChartNote, NoteRuntime } from "../types/chart";

/**
 * 매우 최소한의 형태 검증만 수행한다.
 * 엄격한 JSON 스키마 라이브러리는 v0.1 범위를 벗어나므로 사용하지 않는다.
 */
export function validateChart(data: unknown): data is Chart {
  if (typeof data !== "object" || data === null) return false;
  const c = data as Record<string, unknown>;

  if (typeof c.title !== "string") return false;
  if (typeof c.artist !== "string") return false;
  if (typeof c.bpm !== "number") return false;
  if (typeof c.offset !== "number") return false;
  if (typeof c.difficulty !== "string") return false;
  if (typeof c.level !== "number") return false;
  if (!Array.isArray(c.notes)) return false;

  for (const n of c.notes) {
    if (typeof n !== "object" || n === null) return false;
    const note = n as Record<string, unknown>;
    if (typeof note.time !== "number") return false;
    if (![0, 1, 2, 3].includes(note.lane as number)) return false;
    if (!["tap", "hold", "flick"].includes(note.type as string)) return false;
    if (note.type === "hold" && typeof note.duration !== "number") return false;
  }

  return true;
}

export class ChartLoadError extends Error {}

export function parseChart(raw: string): Chart {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new ChartLoadError("채보 JSON 파싱에 실패했습니다: " + (e as Error).message);
  }
  if (!validateChart(data)) {
    throw new ChartLoadError("채보 JSON 형식이 올바르지 않습니다.");
  }
  // offset을 각 노트 시간에 반영해두면 이후 로직에서 매번 더할 필요가 없다.
  const notes: ChartNote[] = data.notes
    .map((n) => ({ ...n, time: n.time + data.offset }))
    .sort((a, b) => a.time - b.time);

  return { ...data, notes };
}

export async function loadChartFromUrl(url: string): Promise<Chart> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new ChartLoadError(`채보 파일을 불러오지 못했습니다 (status ${res.status})`);
  }
  const text = await res.text();
  return parseChart(text);
}

/** 채보의 각 노트에 런타임 판정 상태를 붙인 배열을 만든다. */
export function createNoteRuntimes(chart: Chart): NoteRuntime[] {
  return chart.notes.map((note, index) => ({
    note,
    index,
    status: "pending",
    judgement: null,
  }));
}
