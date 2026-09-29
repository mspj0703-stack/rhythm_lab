import type { Chart } from "../types/chart";

export interface TempoCandidate {
  bpm: number;
  gridFit: number | null;
  confidence: number;
  ratioFromInitial: number;
  beatAccent?: number;
  selected: boolean;
}

export interface QualityReport {
  bpmConfidence?: number;
  gridAlignmentRatio?: number;
  offGridRatio?: number;
  clusterSuppressed?: number;
  filteredRawOnsetRatio?: number;
  averageNps?: number;
  peakNps1s?: number;
  phraseReuseRatio?: number;
  internalQualityScore?: number;
  extremeJumpRatio?: number;
  sameLaneRepeatRatio?: number;
}

export interface AnalysisReport {
  generatorVersion: string;
  difficulty: string;
  seed: number;
  bpm: number;
  bpmConfidence: number;
  tempoCandidates: TempoCandidate[];
  duration: number;
  rawOnsetCount: number;
  musicalEventCount: number;
  filteredEventCount: number;
  finalNoteCount: number;
  notesPerSecond: number;
  peakNotesIn1s: number;
  quality: QualityReport;
  warnings: string[];
}

export interface AnalysisResponse {
  id: string;
  originalName: string;
  mediaUrl: string;
  mediaKind: "audio" | "video";
  chart: Chart;
  report: AnalysisReport;
}
