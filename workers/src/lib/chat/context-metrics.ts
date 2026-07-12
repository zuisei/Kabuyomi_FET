import type { MetricSnapshot, SourceChunkRecord } from "../../env";
import type { QuestionIntent } from "./intent";

export function selectIntentMetrics(metrics: MetricSnapshot[], questionIntent: QuestionIntent): MetricSnapshot[] {
  const logicalNames = new Set<MetricSnapshot["logicalName"]>();
  switch (questionIntent) {
    case "revenue_breakdown":
    case "segment_analysis":
    case "business_overview":
    case "stock_market_context":
    case "investment_view":
    case "yoy_change":
      logicalNames.add("revenue");
      break;
    case "margin_profitability":
      logicalNames.add("revenue");
      logicalNames.add("operatingIncome");
      logicalNames.add("netIncome");
      break;
    case "cash_flow":
      logicalNames.add("operatingCashFlow");
      logicalNames.add("cashAndCashEquivalents");
      logicalNames.add("revenue");
      logicalNames.add("netIncome");
      break;
    case "liquidity_debt":
      logicalNames.add("cashAndCashEquivalents");
      logicalNames.add("currentDebt");
      logicalNames.add("longTermDebt");
      logicalNames.add("operatingCashFlow");
      break;
    case "risk_factors":
      break;
    case "historical_comparison":
      logicalNames.add("revenue");
      logicalNames.add("operatingIncome");
      logicalNames.add("netIncome");
      break;
    case "mda_summary":
    case "unknown":
      logicalNames.add("revenue");
      logicalNames.add("operatingIncome");
      logicalNames.add("netIncome");
      break;
  }

  return metrics.filter((metric) => logicalNames.has(metric.logicalName));
}

export function findMetricSourceChunk(sourceChunks: SourceChunkRecord[], metric: MetricSnapshot): SourceChunkRecord | undefined {
  return findMetricSourceChunks(sourceChunks, metric)[0];
}

export function findMetricSourceChunks(sourceChunks: SourceChunkRecord[], metric: MetricSnapshot): SourceChunkRecord[] {
  return sourceChunks.filter((chunk) => {
    if (chunk.sectionType !== "xbrl_metric") return false;
    if (chunk.metricRole === "comparison") {
      return chunk.tagName === (metric.comparisonTagUsed ?? metric.tagUsed);
    }
    return chunk.tagName === metric.tagUsed;
  });
}
