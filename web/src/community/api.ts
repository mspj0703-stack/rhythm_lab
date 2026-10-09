import type { Chart, ChartPlatform } from "../types/chart";
import type { EditSummary } from "../library/chartDiff";

/** Song identity shared with a chart. Media itself is never uploaded. */
export interface CommunitySongRef {
  title: string;
  originalTitle?: string;
  durationSec: number;
  bpm: number;
  /** Content hash of the media bytes (`v2:<sha256>`) when the uploader had the file; enables exact matching. */
  fingerprint?: string;
}

export interface CommunityChartSummary {
  cloudChartId: string;
  title: string;
  description?: string;
  difficulty: string;
  level: number;
  platformProfile: ChartPlatform;
  chartVersion: number;
  scoringVersion: 1 | 2;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  downloadCount: number;
  noteCount: number;
  /** End of the last note (seconds); a Library song shorter than this cannot host the chart. */
  lastNoteSec: number;
  song: CommunitySongRef;
}

export interface CommunityChartDetail extends CommunityChartSummary {
  chartData: Chart;
}

export type CommunitySort = "latest" | "downloads";
export type CommunityPlatformFilter = "all" | ChartPlatform;

export interface CommunityQuery {
  q?: string;
  difficulty?: string;
  platform?: CommunityPlatformFilter;
  sort?: CommunitySort;
  limit?: number;
  offset?: number;
}

export interface CommunityUploadPayload {
  authorId: string;
  authorSecret: string;
  origin: "human-edited";
  editSummary: EditSummary;
  title: string;
  description?: string;
  chartVersion: number;
  song: CommunitySongRef;
  chart: Chart;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch { throw new Error("Community 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요."); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = (payload as { detail?: unknown }).detail;
    throw new Error(typeof detail === "string" ? detail : `Community 요청 실패 (${response.status})`);
  }
  return payload as T;
}

export function communityQueryString(query: CommunityQuery): string {
  const params = new URLSearchParams();
  if (query.q?.trim()) params.set("q", query.q.trim());
  if (query.difficulty && query.difficulty !== "all") params.set("difficulty", query.difficulty);
  if (query.platform && query.platform !== "all") params.set("platform", query.platform);
  params.set("sort", query.sort ?? "latest");
  params.set("limit", String(query.limit ?? 30));
  if (query.offset) params.set("offset", String(query.offset));
  return params.toString();
}

export function listCommunityCharts(query: CommunityQuery = {}): Promise<{ items: CommunityChartSummary[]; total: number }> {
  return request(`/api/community/charts?${communityQueryString(query)}`);
}

export function getCommunityChart(id: string): Promise<CommunityChartDetail> {
  return request(`/api/community/charts/${encodeURIComponent(id)}`);
}

/** Fetches the chart for import and counts one download. */
export function downloadCommunityChart(id: string): Promise<CommunityChartDetail> {
  return request(`/api/community/charts/${encodeURIComponent(id)}/download`, { method: "POST" });
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function uploadCommunityChart(payload: CommunityUploadPayload): Promise<CommunityChartSummary> {
  return request("/api/community/charts", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(payload) });
}

export function updateCommunityChart(id: string, payload: CommunityUploadPayload): Promise<CommunityChartSummary> {
  return request(`/api/community/charts/${encodeURIComponent(id)}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(payload) });
}

export function deleteCommunityChart(id: string, identity: { authorId: string; authorSecret: string }): Promise<{ ok: boolean }> {
  return request(`/api/community/charts/${encodeURIComponent(id)}`, { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify(identity) });
}
