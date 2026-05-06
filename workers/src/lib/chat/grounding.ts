import type { SourceChunkRecord } from "../../env";
import { AppError } from "../errors";

export type ChatSourceKind = "sec_filing" | "historical_filing" | "web_supplement";
export type ChatSourceStrength = "filing_primary" | "supplement_article" | "supplement_snippet";
export type ChatResponsePath = "historical" | "deterministic" | "fallback" | "gemini" | "openai";
export type FallbackCategory =
  | "none"
  | "model_error"
  | "source_insufficient"
  | "answer_quality_guard"
  | "language_guard"
  | "sanitation_guard"
  | "company_resolution_error";

export type FallbackUserReason =
  | "none"
  | "model_unavailable"
  | "model_timeout"
  | "model_rate_limited"
  | "model_schema_invalid"
  | "business_model_sources_missing"
  | "management_discussion_sources_missing"
  | "revenue_driver_sources_missing"
  | "liquidity_sources_missing"
  | "risk_sources_missing"
  | "answer_too_metric_only"
  | "generic_watch_points"
  | "wrong_sector_wording"
  | "raw_english_detected"
  | "malformed_currency_detected"
  | "invalid_sources"
  | "company_not_resolved";

export interface ChatEvidenceSource {
  sourceId: string;
  sourceKind: ChatSourceKind;
  sourceStrength: ChatSourceStrength;
  sectionType: string;
  sourceLabel: string;
  excerpt: string;
  sourceUrl?: string;
}

export interface ChatResponsePayload {
  answer: string;
  sources: ChatEvidenceSource[];
  responsePath?: ChatResponsePath;
  chargeable?: boolean;
  debug?: ChatResponseDebug;
}

export interface ChatResponseDebug {
  questionIntent?: string;
  rewrittenQuestion?: string;
  responsePath?: ChatResponsePath;
  fallbackReason?: string | null;
  fallbackCategory?: FallbackCategory;
  fallbackUserReason?: FallbackUserReason;
  missingEvidence?: string[];
  missingEvidenceLabelsJa?: string[];
  guardLabels?: string[];
  sourceCount?: number;
  sourceIds?: string[];
  sourceIdsValid?: boolean;
  contextApplied?: boolean;
  modelName?: string | null;
  modelProvider?: import("../../clients/gemini/types").ChatModelProviderName | null;
  modelApiErrorKind?: import("../../clients/gemini/types").GeminiApiErrorKind | null;
  modelApiErrorStatus?: number | null;
  modelApiErrorCode?: string | null;
  modelApiErrorMessageSample?: string | null;
  modelApiErrorRetryable?: boolean | null;
  modelRequestPromptCharCount?: number | null;
  modelRequestEstimatedTokens?: number | null;
  modelRequestSourceCount?: number | null;
  modelRequestContextCharCount?: number | null;
  modelErrorOccurredBeforeResponse?: boolean | null;
  promptTokenCount?: number | null;
  completionTokenCount?: number | null;
  totalTokenCount?: number | null;
  modelCallLatencyMs?: number | null;
  contentMode?: "full" | "metrics_only";
  geminiCalled?: boolean;
  geminiSucceeded?: boolean;
  schemaValid?: boolean;
  retryAttempt?: number;
  retryReason?: string | null;
  retryAttempted?: boolean;
  retryAllowed?: boolean;
  retryBlockedReason?: string | null;
  retryOutcome?: string | null;
  retryWasted?: boolean;
  firstCallFailureKind?: string | null;
  sourceGateApplied?: boolean;
  sourceGateSufficient?: boolean | null;
  sourceGateMissingSourceTypes?: string[];
  sourceGateFailureLabels?: string[];
  sourceGateRetrievalRetryRecommended?: boolean;
  retrievalRetryUsed?: boolean;
  retrievalRetryOutcome?: "improved" | "no_improvement" | "not_used";
  evidenceFallbackUsed?: boolean;
  fallbackKind?: import("../../clients/gemini/types").ChatFallbackKind;
  fallbackKindSource?: "model_quality_control" | "finalizer" | "language_guard" | "orchestrator";
  responsePathFallbackButKindNone?: boolean;
  driverSlotsCount?: number;
  marginDriverSlotsCount?: number;
  followupTargetFound?: boolean | null;
  genericFallbackPhraseDetected?: boolean;
  hardRetrievalPlanUsed?: boolean;
  hardRetrievalQueries?: string[];
  hardRetrievalQueryPurposes?: string[];
  hardRetrievalMissingSourceTypes?: string[];
  hardRetrievalAddedSourceCount?: number;
  hardRetrievalAddedSourceLabels?: string[];
  hardRetrievalAddedSourceIds?: string[];
  hardRetrievalOutcome?: "improved" | "no_improvement" | "not_used";
  sourceGateSufficientBeforeHardRetrieval?: boolean | null;
  sourceGateSufficientAfterHardRetrieval?: boolean | null;
  driverSlotsCountBeforeHardRetrieval?: number | null;
  driverSlotsCountAfterHardRetrieval?: number | null;
  marginDriverSlotsCountBeforeHardRetrieval?: number | null;
  marginDriverSlotsCountAfterHardRetrieval?: number | null;
  selectedSourceLabelsBeforeHardRetrieval?: string[];
  selectedSourceLabelsAfterHardRetrieval?: string[];
  hardRetrievalMode?: "off" | "diagnostic" | "active";
  hardSourceCoverageScore?: number | null;
  hardSourceCoverageMissing?: string[];
  hardSourceCoverageSectorKpiHits?: string[];
  hardSourceCoverageHasMdaRevenueDiscussion?: boolean | null;
  hardSourceCoverageHasSegmentResults?: boolean | null;
  hardSourceCoverageHasSectorKpiWindow?: boolean | null;
  geminiApiErrorKind?: import("../../clients/gemini/types").GeminiApiErrorKind | null;
  geminiApiErrorStatus?: number | null;
  geminiApiErrorCode?: string | null;
  geminiApiErrorMessageSample?: string | null;
  geminiApiErrorRetryable?: boolean | null;
  geminiRequestPromptCharCount?: number | null;
  geminiRequestEstimatedTokens?: number | null;
  geminiRequestSourceCount?: number | null;
  geminiRequestContextCharCount?: number | null;
  geminiModelName?: string | null;
  geminiErrorOccurredBeforeResponse?: boolean | null;
  finalAnswerJapaneseRatio?: number;
  finalAnswerEnglishSentenceCount?: number;
  finalAnswerRawExcerptLike?: boolean;
  finalAnswerLanguageLabels?: string[];
  finalAnswerLanguageViolations?: string[];
  languageGuardChecked?: boolean;
  languageGuardOk?: boolean;
  languageGuardViolationLabels?: string[];
  languageGuardFallbackUsed?: boolean;
  languageGuardFallbackKind?: import("../../clients/gemini/types").ChatFallbackKind | null;
  originalAnswerBeforeLanguageGuardLength?: number | null;
  originalAnswerBeforeLanguageGuardSample?: string | null;
  sourceRepairLabels?: string[];
  contextTokenBudget?: number | null;
  selectedSourceCount?: number | null;
  selectedSourceCharCount?: number | null;
  estimatedContextTokens?: number | null;
  sourceSelectionStrategy?: string | null;
  selectedSourceIds?: string[];
  selectedSourceLabels?: string[];
  answerQualityFlags?: string[];
  totalPipelineMs?: number;
  historicalLookupMs?: number;
  deterministicBuildMs?: number;
  contextBuildMs?: number;
  geminiFirstCallMs?: number;
  geminiRetryMs?: number;
  fallbackBuildMs?: number;
  webSupplementMs?: number;
  groundingMs?: number;
}

export const CONTEXT_UNAVAILABLE_ANSWER = "この決算資料の範囲では確認できません。";

export function dedupeChatSources(sources: ChatEvidenceSource[]): ChatEvidenceSource[] {
  const deduped: ChatEvidenceSource[] = [];
  for (const source of sources) {
    if (!deduped.some((entry) => entry.sourceId === source.sourceId)) {
      deduped.push(source);
    }
  }

  return deduped;
}

export function buildSecFilingSource(source: SourceChunkRecord): ChatEvidenceSource {
  return {
    sourceId: source.sourceId,
    sourceKind: "sec_filing",
    sourceStrength: "filing_primary",
    sectionType: source.sectionType,
    sourceLabel: source.sourceLabel,
    excerpt: source.text.slice(0, 220)
  };
}

export function attachCurrentFilingSourceUrls(
  response: ChatResponsePayload,
  primaryDocumentUrl: string
): ChatResponsePayload {
  if (!primaryDocumentUrl) {
    return response;
  }

  return {
    ...response,
    sources: response.sources.map((source) =>
      source.sourceKind === "sec_filing" && !source.sourceUrl
        ? {
            ...source,
            sourceUrl: primaryDocumentUrl
          }
        : source
    )
  };
}

export function ensureFilingGroundedResponse(response: ChatResponsePayload): ChatResponsePayload {
  if (response.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    return response;
  }

  if (!response.sources.some((source) => source.sourceKind === "sec_filing" || source.sourceKind === "historical_filing")) {
    throw new AppError(502, "Chat response must cite the filing", "No SEC filing source was attached");
  }

  return response;
}
