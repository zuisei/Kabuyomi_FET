import type { FilingCacheRecord } from "../../env";
import type { QuestionIntent } from "./intent";

export type ChatContextPackMode = "standard" | "expanded" | "compact";

export interface ContextProfile {
  tokenBudget: number;
  minSources: number;
  maxSources: number;
  supplementalSources: number;
  sourceExcerptChars: number;
  supplementalWindowChars: number;
}

export function contextProfile(questionIntent: QuestionIntent, mode: ChatContextPackMode): ContextProfile {
  const base = baseContextProfile(questionIntent);
  switch (mode) {
    case "expanded":
      return {
        tokenBudget: base.tokenBudget + 2_000,
        minSources: Math.min(base.minSources + 1, base.maxSources + 1),
        maxSources: base.maxSources + 2,
        supplementalSources: base.supplementalSources + 2,
        sourceExcerptChars: Math.min(base.sourceExcerptChars + 300, 2_200),
        supplementalWindowChars: Math.min(base.supplementalWindowChars + 500, 3_600)
      };
    case "compact":
      return {
        tokenBudget: Math.min(base.tokenBudget, 5_500),
        minSources: Math.min(base.minSources, 3),
        maxSources: Math.min(base.maxSources, 5),
        supplementalSources: Math.min(base.supplementalSources, 2),
        sourceExcerptChars: Math.min(base.sourceExcerptChars, 1_100),
        supplementalWindowChars: Math.min(base.supplementalWindowChars, 1_800)
      };
    case "standard":
      return base;
  }
}

export function shouldLeadWithMetrics(questionIntent: QuestionIntent): boolean {
  return (
    questionIntent === "cash_flow" ||
    questionIntent === "historical_comparison"
  );
}

export function shouldLeadWithDriverNarrative(questionIntent: QuestionIntent): boolean {
  return questionIntent === "yoy_change" || questionIntent === "mda_summary";
}

export function resolveContentMode(filing: FilingCacheRecord): "full" | "metrics_only" {
  if (filing.contentMode === "full" || filing.contentMode === "metrics_only") {
    return filing.contentMode;
  }

  return filing.sourceChunks.some((chunk) => chunk.sectionType === "md_a") || filing.mdaText.trim()
    ? "full"
    : "metrics_only";
}

function baseContextProfile(questionIntent: QuestionIntent): ContextProfile {
  switch (questionIntent) {
    case "risk_factors":
      return {
        tokenBudget: 10_000,
        minSources: 5,
        maxSources: 7,
        supplementalSources: 6,
        sourceExcerptChars: 1_800,
        supplementalWindowChars: 3_100
      };
    case "mda_summary":
      return {
        tokenBudget: 9_000,
        minSources: 4,
        maxSources: 7,
        supplementalSources: 5,
        sourceExcerptChars: 1_400,
        supplementalWindowChars: 2_600
      };
    case "segment_analysis":
      return {
        tokenBudget: 8_000,
        minSources: 4,
        maxSources: 7,
        supplementalSources: 5,
        sourceExcerptChars: 1_200,
        supplementalWindowChars: 2_400
      };
    case "investment_view":
      return {
        tokenBudget: 8_000,
        minSources: 4,
        maxSources: 7,
        supplementalSources: 5,
        sourceExcerptChars: 1_300,
        supplementalWindowChars: 2_600
      };
    case "business_overview":
      return {
        tokenBudget: 7_000,
        minSources: 5,
        maxSources: 7,
        supplementalSources: 5,
        sourceExcerptChars: 1_200,
        supplementalWindowChars: 2_500
      };
    case "revenue_breakdown":
      return {
        tokenBudget: 7_000,
        minSources: 3,
        maxSources: 7,
        supplementalSources: 4,
        sourceExcerptChars: 1_100,
        supplementalWindowChars: 2_200
      };
    case "stock_market_context":
      return {
        tokenBudget: 7_000,
        minSources: 3,
        maxSources: 6,
        supplementalSources: 4,
        sourceExcerptChars: 1_200,
        supplementalWindowChars: 2_400
      };
    case "margin_profitability":
    case "cash_flow":
    case "yoy_change":
    case "historical_comparison":
    case "unknown":
      return {
        tokenBudget: questionIntent === "yoy_change" ? 8_000 : 6_000,
        minSources: questionIntent === "yoy_change" ? 4 : 2,
        maxSources: questionIntent === "yoy_change" ? 7 : 6,
        supplementalSources: questionIntent === "yoy_change" ? 5 : 2,
        sourceExcerptChars: questionIntent === "yoy_change" ? 1_300 : 900,
        supplementalWindowChars: questionIntent === "yoy_change" ? 2_700 : 1_800
      };
  }
}
