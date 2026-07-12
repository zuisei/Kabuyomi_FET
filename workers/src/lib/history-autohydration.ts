import type { FilingReference } from "../env";
import type { HistoricalComparisonMode } from "./history-question";

const AUTO_HYDRATION_YEARS = 3;
const AUTO_HYDRATION_MAX_PRIOR_FILINGS = 2;
const SAME_QUARTER_MATCH_WINDOW_DAYS = 45;

export function selectHistoricalAutohydrationCandidates(
  current: Pick<FilingReference, "formType" | "accessionNumber" | "periodOfReport">,
  filings: FilingReference[],
  mode: HistoricalComparisonMode = "multi_period_trend"
): FilingReference[] {
  const currentAccession = normalizeAccession(current.accessionNumber);
  const windowStart = subtractYearsIsoDate(current.periodOfReport, AUTO_HYDRATION_YEARS);
  const candidates = filings
    .filter((candidate) => candidate.formType === current.formType)
    .filter((candidate) => normalizeAccession(candidate.accessionNumber) !== currentAccession)
    .filter((candidate) => candidate.periodOfReport < current.periodOfReport)
    .filter((candidate) => candidate.periodOfReport >= windowStart)
    .sort((left, right) => right.periodOfReport.localeCompare(left.periodOfReport));

  if (mode === "immediate_prior") {
    return candidates.slice(0, 1);
  }

  if (current.formType === "10-K") {
    return candidates.slice(0, AUTO_HYDRATION_MAX_PRIOR_FILINGS);
  }

  const selected: FilingReference[] = [];
  const remaining = [...candidates];
  for (let yearOffset = 1; yearOffset <= AUTO_HYDRATION_MAX_PRIOR_FILINGS; yearOffset += 1) {
    const targetDate = subtractYearsIsoDate(current.periodOfReport, yearOffset);
    const bestIndex = findClosestQuarterMatchIndex(remaining, targetDate);
    if (bestIndex === -1) {
      continue;
    }

    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }

  return selected;
}

function findClosestQuarterMatchIndex(candidates: FilingReference[], targetDate: string): number {
  const targetMs = Date.parse(targetDate);
  if (!Number.isFinite(targetMs)) {
    return -1;
  }

  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidateMs = Date.parse(candidates[index]?.periodOfReport ?? "");
    if (!Number.isFinite(candidateMs)) {
      continue;
    }

    const distanceDays = Math.abs(candidateMs - targetMs) / (24 * 60 * 60 * 1000);
    if (distanceDays > SAME_QUARTER_MATCH_WINDOW_DAYS) {
      continue;
    }

    if (distanceDays < bestDistance) {
      bestDistance = distanceDays;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function subtractYearsIsoDate(isoDate: string, years: number): string {
  const parsed = Date.parse(isoDate);
  if (!Number.isFinite(parsed)) {
    return isoDate;
  }

  const date = new Date(parsed);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

function normalizeAccession(accessionNumber: string): string {
  return accessionNumber.replaceAll("-", "");
}
