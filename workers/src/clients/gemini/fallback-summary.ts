import type { MetricSnapshot, SourceChunkRecord, SummaryRecord } from "../../env";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../../lib/metrics";
import type { SummaryPromptInput } from "./types";

export function localSummaryFallback(input: SummaryPromptInput): SummaryRecord {
  const highlightSources = input.sourceChunks.filter((chunk) => chunk.sectionType === "md_a").slice(0, 2);
  const rankedMetrics = input.metrics
    .filter((metric) => metric.yoyPercent !== undefined || metric.comparisonValue !== undefined)
    .slice(0, 2);
  const headlineMetric = input.metrics.find((metric) => metric.yoyPercent !== undefined) ?? input.metrics[0];
  const verdict = headlineMetric
    ? `${input.companyName}の最新${input.formType}では、${metricLabel(
        headlineMetric.logicalName
      )}を中心に提出資料ベースで確認できます。`
    : `${input.companyName}の最新${input.formType}を日本語で確認できます。`;

  const metricLines = rankedMetrics
    .map((metric) => {
      const sourceId = findMetricSourceIdFromSummaryInput(input, metric);
      if (!sourceId) {
        return null;
      }

      return {
        text: buildSummaryMetricLine(metric),
        sourceIds: [sourceId]
      };
    })
    .filter((value): value is SummaryRecord["changes"][number] => value !== null);

  const narrativeLines = highlightSources.map((source) => ({
    text: buildSummaryNarrativeLine(source, input.formType),
    sourceIds: [source.sourceId]
  }));

  return {
    verdict,
    highlights: [...metricLines.slice(0, 1), ...narrativeLines].slice(0, 2),
    changes: metricLines.length > 0 ? metricLines : narrativeLines
  };
}

function findMetricSourceIdFromSummaryInput(
  input: SummaryPromptInput,
  metric: MetricSnapshot
): string | undefined {
  return input.sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed)?.sourceId;
}

function buildSummaryMetricLine(metric: MetricSnapshot): string {
  const current = formatMetricValue(metric.value, metric.unit);

  if (metric.yoyPercent !== undefined) {
    return `${metricLabel(metric.logicalName)}は ${current} で、前年同期比 ${formatYoYDelta(metric.yoyPercent)} でした。`;
  }

  if (metric.comparisonValue !== undefined) {
    return `${metricLabel(metric.logicalName)}は ${current} で、比較値は ${formatMetricValue(metric.comparisonValue, metric.unit)} でした。`;
  }

  return `${metricLabel(metric.logicalName)}は ${current} でした。`;
}

function buildSummaryNarrativeLine(source: SourceChunkRecord, formType: string): string {
  const label = normalizeSummarySourceLabel(source.sectionTitle || source.sourceLabel, formType);

  if (label.includes("MD&A")) {
    return "MD&A に、今回の増減要因や事業動向の説明があります。";
  }

  if (label.includes("リスク")) {
    return "リスク要因の欄に、注意したい論点の説明があります。";
  }

  return `${label} の記述を確認できます。`;
}

function normalizeSummarySourceLabel(rawLabel: string, formType: string): string {
  const raw = rawLabel.trim();
  const lowered = raw.toLowerCase();

  if (lowered.includes("management's discussion") || lowered.includes("results of operations") || lowered.includes("md&a")) {
    return `${formType} MD&A`;
  }

  if (lowered.includes("risk factors") || lowered.includes("business risks") || lowered.includes("risk")) {
    return `${formType} リスク要因`;
  }

  const itemMatch = raw.match(/Item\s+(\d+[A-Za-z]?)/i);
  if (itemMatch?.[1]) {
    return `${formType} 項目${itemMatch[1]}`;
  }

  return "提出資料";
}
