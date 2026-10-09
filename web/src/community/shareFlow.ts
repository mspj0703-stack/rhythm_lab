import type { LibraryBundle, LibraryChart } from "../library/types";
import { getAuthorIdentity } from "../library/author";
import { markChartPublished } from "../library/db";
import { updateCommunityChart, uploadCommunityChart } from "./api";
import { buildUploadPayload, checkShareEligibility } from "./share";

/**
 * Uploads (or, for an already shared chart of this author, updates) one human-edited chart.
 * Throws with every blocking reason when the chart is not eligible.
 */
export async function shareChart(chart: LibraryChart, bundle: LibraryBundle, description?: string): Promise<LibraryChart> {
  const eligibility = checkShareEligibility(chart, bundle);
  if (!eligibility.ok) throw new Error(eligibility.reasons.join(" "));
  const identity = getAuthorIdentity();
  const payload = buildUploadPayload(chart, bundle, identity, eligibility, description);
  const ownCopy = chart.cloudChartId && chart.authorId === identity.authorId;
  const summary = ownCopy ? await updateCommunityChart(chart.cloudChartId!, payload) : await uploadCommunityChart(payload);
  return markChartPublished(chart.id, summary.cloudChartId);
}
