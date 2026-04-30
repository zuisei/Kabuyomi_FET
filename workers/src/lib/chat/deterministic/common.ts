import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../../../env";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../../metrics";

export function isLowSignalNarrativeSource(source: SourceChunkRecord): boolean {
  return /available information|forward-looking statements|private securities litigation reform act|investor relations website|corporate website|securities and exchange commission|should be read in conjunction/i.test(
    source.text
  );
}

export function buildMetricObservationSentence(metric: MetricSnapshot): string {
  const label = metricLabel(metric.logicalName);
  const current = formatMetricValue(metric.value, metric.unit);

  if (metric.yoyPercent !== undefined) {
    return `${label}は ${current} で、前年同期比 ${formatYoYDelta(metric.yoyPercent)} です。`;
  }

  if (metric.comparisonValue !== undefined) {
    return `${label}は ${current} で、比較値は ${formatMetricValue(metric.comparisonValue, metric.unit)} です。`;
  }

  return `${label}は ${current} です。`;
}

export function metricPriority(logicalName: MetricSnapshot["logicalName"]): number {
  switch (logicalName) {
    case "revenue":
      return 0;
    case "operatingIncome":
      return 1;
    case "netIncome":
      return 2;
    case "operatingCashFlow":
      return 3;
    case "epsBasic":
      return 4;
    default:
      return 10;
  }
}

export function findMetricSourceId(
  filing: FilingCacheRecord,
  logicalName: MetricSnapshot["logicalName"]
): string | undefined {
  const metric = filing.metrics.find((item) => item.logicalName === logicalName);
  if (!metric) {
    return undefined;
  }

  return filing.sourceChunks.find(
    (chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed
  )?.sourceId;
}
