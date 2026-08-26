export type ParityEventSummary = {
  id: string;
  lastActivityAt: string;
  agency: { code: string };
  status: string;
  instrumentType: string;
  hasMarketData: boolean;
  translation: { titleStatus?: string; factualSummaryStatus?: string; translatedAt?: string } | null;
  analysis: { analysisStatus: string; presentationTier: string; marketAnalysisMode: string; reviewedAt?: string | null; publishedAt?: string | null };
};

export type EnvironmentSnapshot = {
  label: string;
  total: number;
  revision: string;
  ids: string[];
  agencyCounts: Record<string, number>;
  instrumentCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  translationCounts: Record<string, number>;
  analysisCounts: Record<string, number>;
  tierCounts: Record<string, number>;
  marketModeCounts: Record<string, number>;
  marketDataCount: number;
};

export type EnvironmentParity = {
  matches: boolean;
  left: EnvironmentSnapshot;
  right: EnvironmentSnapshot;
  missingFromLeft: string[];
  missingFromRight: string[];
  differences: string[];
};

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildEnvironmentSnapshot(label: string, events: ParityEventSummary[]): EnvironmentSnapshot {
  const agencyCounts: Record<string, number> = {};
  const instrumentCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const translationCounts: Record<string, number> = {};
  const analysisCounts: Record<string, number> = {};
  const tierCounts: Record<string, number> = {};
  const marketModeCounts: Record<string, number> = {};
  for (const event of events) {
    increment(agencyCounts, event.agency.code);
    increment(instrumentCounts, event.instrumentType);
    increment(statusCounts, event.status);
    increment(translationCounts, event.translation?.titleStatus ?? "untranslated");
    increment(analysisCounts, event.analysis.analysisStatus);
    increment(tierCounts, event.analysis.presentationTier);
    increment(marketModeCounts, event.analysis.marketAnalysisMode);
  }
  const ids = events.map((event) => event.id.toLowerCase()).sort();
  const revisionInput = events
    .map((event) => [
      event.id.toLowerCase(), event.lastActivityAt, event.translation?.translatedAt ?? "",
      event.translation?.titleStatus ?? "untranslated", event.translation?.factualSummaryStatus ?? "untranslated",
      event.agency.code, event.instrumentType, event.status, event.hasMarketData ? "market" : "no-market",
      event.analysis.analysisStatus, event.analysis.presentationTier, event.analysis.marketAnalysisMode,
      event.analysis.reviewedAt ?? "", event.analysis.publishedAt ?? ""
    ].join("|"))
    .sort()
    .join("\n");
  return {
    label,
    total: events.length,
    revision: stableHash(revisionInput),
    ids,
    agencyCounts,
    instrumentCounts,
    statusCounts,
    translationCounts,
    analysisCounts,
    tierCounts,
    marketModeCounts,
    marketDataCount: events.filter((event) => event.hasMarketData).length
  };
}

export function compareEnvironmentSnapshots(left: EnvironmentSnapshot, right: EnvironmentSnapshot): EnvironmentParity {
  const leftIDs = new Set(left.ids);
  const rightIDs = new Set(right.ids);
  const missingFromLeft = right.ids.filter((id) => !leftIDs.has(id));
  const missingFromRight = left.ids.filter((id) => !rightIDs.has(id));
  const differences: string[] = [];
  if (left.total !== right.total) differences.push("total");
  if (missingFromLeft.length > 0 || missingFromRight.length > 0) differences.push("event_ids");
  if (left.revision !== right.revision) differences.push("dataset_revision");
  if (!sameCounts(left.agencyCounts, right.agencyCounts)) differences.push("agency_counts");
  if (!sameCounts(left.instrumentCounts, right.instrumentCounts)) differences.push("instrument_counts");
  if (!sameCounts(left.statusCounts, right.statusCounts)) differences.push("status_counts");
  if (!sameCounts(left.translationCounts, right.translationCounts)) differences.push("translation_counts");
  if (!sameCounts(left.analysisCounts, right.analysisCounts)) differences.push("analysis_counts");
  if (!sameCounts(left.tierCounts, right.tierCounts)) differences.push("tier_counts");
  if (!sameCounts(left.marketModeCounts, right.marketModeCounts)) differences.push("market_mode_counts");
  if (left.marketDataCount !== right.marketDataCount) differences.push("market_data_count");
  return {
    matches: differences.length === 0,
    left,
    right,
    missingFromLeft,
    missingFromRight,
    differences
  };
}

function sameCounts(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => (left[key] ?? 0) === (right[key] ?? 0));
}
