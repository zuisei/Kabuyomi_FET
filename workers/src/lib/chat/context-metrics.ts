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
      logicalNames.add("revenue");
      logicalNames.add("netIncome");
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
  return sourceChunks.find((chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed);
}

