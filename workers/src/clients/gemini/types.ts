import type { FilingCacheRecord, FilingFormType, MetricSnapshot, SourceChunkRecord } from "../../env";
import type { ChatContextPack } from "../../lib/chat/context-pack";
import type { QuestionIntent } from "../../lib/chat/intent";

export interface SummaryPromptInput {
  filingKey: string;
  ticker: string;
  companyName: string;
  formType: FilingFormType;
  filedAt: string;
  periodOfReport: string;
  metrics: MetricSnapshot[];
  sourceChunks: SourceChunkRecord[];
}

export interface ChatPromptInput {
  filing: FilingCacheRecord;
  question: string;
  questionIntent?: QuestionIntent;
  contextPack?: ChatContextPack;
  conversationContextSummary?: string;
  retryInstruction?: ChatRetryInstruction;
}

export type ChatFallbackReason =
  | "gemini_timeout"
  | "gemini_api_error"
  | "json_parse_failed"
  | "schema_invalid"
  | "invalid_source_id"
  | "no_sources"
  | "weak_grounding"
  | "low_quality_answer"
  | "deterministic_repair"
  | "metrics_only_insufficient";

export type ChatRetryOutcome = "accepted" | "blocked" | "fallback" | "invalid_source_ids" | "no_valid_sources";

export type GeminiApiErrorKind =
  | "rate_limit"
  | "auth_error"
  | "bad_request"
  | "payload_too_large"
  | "context_too_large"
  | "provider_server_error"
  | "network_error"
  | "timeout"
  | "unknown";

export type ChatModelProviderName = "gemini-legacy" | "gemini" | "openai" | "disabled";

export interface GeminiApiErrorDiagnostics {
  geminiApiErrorKind: GeminiApiErrorKind;
  geminiApiErrorStatus?: number | null;
  geminiApiErrorCode?: string | null;
  geminiApiErrorMessageSample?: string | null;
  geminiApiErrorRetryable: boolean;
  geminiRequestPromptCharCount?: number | null;
  geminiRequestEstimatedTokens?: number | null;
  geminiRequestSourceCount?: number | null;
  geminiRequestContextCharCount?: number | null;
  geminiModelName?: string | null;
  geminiErrorOccurredBeforeResponse?: boolean;
}

export interface ChatRetryDiagnostics {
  retryAttempted: boolean;
  retryAllowed: boolean;
  retryReason?: ChatFallbackReason | null;
  retryBlockedReason?: string | null;
  retryOutcome?: ChatRetryOutcome | null;
  retryWasted?: boolean;
  firstCallFailureKind?: ChatFallbackReason | null;
}

export interface QuoteTranslationPromptInput {
  text: string;
  sourceLanguage?: string;
  targetLanguage: "ja";
}

export interface GeminiChatAnswer {
  answer: string;
  sourceIds: string[];
  modelRawAnswerPreview?: string | null;
  lowQualityReason?: string | null;
  usedRemoteModel?: boolean;
  llmUsage?: GeminiInvocationUsage[];
  modelUsage?: GeminiInvocationUsage[];
  modelProvider?: ChatModelProviderName;
  modelName?: string | null;
  requestedModelName?: string | null;
  effectiveModelName?: string | null;
  requestedReasoningEffort?: string | null;
  effectiveReasoningEffort?: string | null;
  reasoningEffortInvalid?: boolean;
  modelApiError?: {
    modelApiErrorKind: GeminiApiErrorKind;
    modelApiErrorStatus?: number | null;
    modelApiErrorCode?: string | null;
    modelApiErrorMessageSample?: string | null;
    modelApiErrorRetryable: boolean;
    modelRequestPromptCharCount?: number | null;
    modelRequestEstimatedTokens?: number | null;
    modelRequestSourceCount?: number | null;
    modelRequestContextCharCount?: number | null;
    modelName?: string | null;
    modelProvider: ChatModelProviderName;
    modelErrorOccurredBeforeResponse?: boolean;
  };
  geminiCalled?: boolean;
  geminiSucceeded?: boolean;
  fallbackReason?: ChatFallbackReason;
  schemaValid?: boolean;
  retryAttempt?: number;
  retryReason?: ChatFallbackReason;
  retryDiagnostics?: ChatRetryDiagnostics;
  qualityControl?: ChatQualityControlDiagnostics;
  geminiApiError?: GeminiApiErrorDiagnostics;
}

export interface GeminiInvocationUsage {
  model: string;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  latencyMs: number;
  requestedModelName?: string | null;
  effectiveModelName?: string | null;
  requestedReasoningEffort?: string | null;
  effectiveReasoningEffort?: string | null;
  reasoningEffortInvalid?: boolean;
}

export type ChatFallbackKind =
  | "none"
  | "legacy_template"
  | "evidence_slot"
  | "model_timeout"
  | "hard_model_timeout_evidence"
  | "non_hard_model_timeout"
  | "context_unavailable"
  | "api_error"
  | "deterministic_metric"
  | "weak_grounding"
  | "low_quality"
  | "language_guard_fallback"
  | "unknown_fallback";

export interface ChatQualityControlDiagnostics {
  sourceGateApplied: boolean;
  sourceGateSufficient: boolean | null;
  sourceGateMissingSourceTypes: string[];
  sourceGateFailureLabels: string[];
  sourceGateEvidenceSlots?: Record<string, unknown>;
  followupPreviousAnswer?: string | null;
  sourceGateRetrievalRetryRecommended: boolean;
  retrievalRetryUsed: boolean;
  retrievalRetryOutcome: "improved" | "no_improvement" | "not_used";
  evidenceFallbackUsed: boolean;
  fallbackKind: ChatFallbackKind;
  driverSlotsCount: number;
  marginDriverSlotsCount: number;
  followupTargetFound: boolean | null;
  genericFallbackPhraseDetected: boolean;
  hardRetrievalPlanUsed: boolean;
  hardRetrievalQueries: string[];
  hardRetrievalQueryPurposes: string[];
  hardRetrievalMissingSourceTypes: string[];
  hardRetrievalAddedSourceCount: number;
  hardRetrievalAddedSourceLabels: string[];
  hardRetrievalAddedSourceIds: string[];
  hardRetrievalOutcome: "improved" | "no_improvement" | "not_used";
  sourceGateSufficientBeforeHardRetrieval: boolean | null;
  sourceGateSufficientAfterHardRetrieval: boolean | null;
  driverSlotsCountBeforeHardRetrieval: number | null;
  driverSlotsCountAfterHardRetrieval: number | null;
  marginDriverSlotsCountBeforeHardRetrieval: number | null;
  marginDriverSlotsCountAfterHardRetrieval: number | null;
  selectedSourceLabelsBeforeHardRetrieval: string[];
  selectedSourceLabelsAfterHardRetrieval: string[];
  hardRetrievalMode: "off" | "diagnostic" | "active";
  hardSourceCoverageScore: number | null;
  hardSourceCoverageMissing: string[];
  hardSourceCoverageSectorKpiHits: string[];
  hardSourceCoverageHasMdaRevenueDiscussion: boolean | null;
  hardSourceCoverageHasSegmentResults: boolean | null;
  hardSourceCoverageHasSectorKpiWindow: boolean | null;
}

export interface ChatLanguageGuardDiagnostics {
  languageGuardChecked?: boolean;
  languageGuardOk?: boolean;
  languageGuardViolationLabels?: string[];
  languageGuardFallbackUsed?: boolean;
  languageGuardFallbackKind?: ChatFallbackKind | null;
  originalAnswerBeforeLanguageGuardLength?: number | null;
  originalAnswerBeforeLanguageGuardSample?: string | null;
}

export interface ChatRetryInstruction {
  attempt: 1;
  reason: ChatFallbackReason;
  previousResponse?: unknown;
}
