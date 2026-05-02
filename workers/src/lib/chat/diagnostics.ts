import type { FilingCacheRecord } from "../../env";
import type { GeminiChatAnswer } from "../../clients/gemini/types";
import type { ChatContextPack } from "./context-pack";
import type { ChatResponseDebug, ChatResponsePayload, ChatResponsePath } from "./grounding";

export function buildContextDebugFields(contextPack: ChatContextPack): Pick<
  ChatResponseDebug,
  | "contextTokenBudget"
  | "selectedSourceCount"
  | "selectedSourceCharCount"
  | "estimatedContextTokens"
  | "sourceSelectionStrategy"
  | "selectedSourceIds"
  | "selectedSourceLabels"
> {
  return {
    contextTokenBudget: contextPack.contextTokenBudget,
    selectedSourceCount: contextPack.selectedSourceCount,
    selectedSourceCharCount: contextPack.selectionDiagnostics.selectedSourceCharCount,
    estimatedContextTokens: contextPack.selectionDiagnostics.estimatedContextTokens,
    sourceSelectionStrategy: contextPack.sourceSelectionStrategy,
    selectedSourceIds: contextPack.sourceChunks.map((source) => source.sourceId),
    selectedSourceLabels: contextPack.sourceChunks.map((source) => source.sourceLabel)
  };
}

export function buildModelAttemptDebugFields(modelResponse: GeminiChatAnswer): Pick<
  ChatResponseDebug,
  | "retryAttempted"
  | "retryAllowed"
  | "retryBlockedReason"
  | "retryOutcome"
  | "retryWasted"
  | "firstCallFailureKind"
  | "sourceGateApplied"
  | "sourceGateSufficient"
  | "sourceGateMissingSourceTypes"
  | "sourceGateFailureLabels"
  | "sourceGateRetrievalRetryRecommended"
  | "retrievalRetryUsed"
  | "retrievalRetryOutcome"
  | "evidenceFallbackUsed"
  | "fallbackKind"
  | "fallbackKindSource"
  | "responsePathFallbackButKindNone"
  | "driverSlotsCount"
  | "marginDriverSlotsCount"
  | "followupTargetFound"
  | "genericFallbackPhraseDetected"
  | "hardRetrievalPlanUsed"
  | "hardRetrievalQueries"
  | "hardRetrievalQueryPurposes"
  | "hardRetrievalMissingSourceTypes"
  | "hardRetrievalAddedSourceCount"
  | "hardRetrievalAddedSourceLabels"
  | "hardRetrievalAddedSourceIds"
  | "hardRetrievalOutcome"
  | "sourceGateSufficientBeforeHardRetrieval"
  | "sourceGateSufficientAfterHardRetrieval"
  | "driverSlotsCountBeforeHardRetrieval"
  | "driverSlotsCountAfterHardRetrieval"
  | "marginDriverSlotsCountBeforeHardRetrieval"
  | "marginDriverSlotsCountAfterHardRetrieval"
  | "selectedSourceLabelsBeforeHardRetrieval"
  | "selectedSourceLabelsAfterHardRetrieval"
  | "hardRetrievalMode"
  | "hardSourceCoverageScore"
  | "hardSourceCoverageMissing"
  | "hardSourceCoverageSectorKpiHits"
  | "hardSourceCoverageHasMdaRevenueDiscussion"
  | "hardSourceCoverageHasSegmentResults"
  | "hardSourceCoverageHasSectorKpiWindow"
  | "geminiApiErrorKind"
  | "geminiApiErrorStatus"
  | "geminiApiErrorCode"
  | "geminiApiErrorMessageSample"
  | "geminiApiErrorRetryable"
  | "geminiRequestPromptCharCount"
  | "geminiRequestEstimatedTokens"
  | "geminiRequestSourceCount"
  | "geminiRequestContextCharCount"
  | "geminiModelName"
  | "geminiErrorOccurredBeforeResponse"
  | "modelName"
  | "modelProvider"
  | "modelApiErrorKind"
  | "modelApiErrorStatus"
  | "modelApiErrorCode"
  | "modelApiErrorMessageSample"
  | "modelApiErrorRetryable"
  | "modelRequestPromptCharCount"
  | "modelRequestEstimatedTokens"
  | "modelRequestSourceCount"
  | "modelRequestContextCharCount"
  | "modelErrorOccurredBeforeResponse"
> {
  const diagnostics = modelResponse.retryDiagnostics;
  const qualityControl = modelResponse.qualityControl;
  const geminiApiError = modelResponse.geminiApiError;
  const modelApiError = modelResponse.modelApiError;
  return {
    retryAttempted: diagnostics?.retryAttempted ?? false,
    retryAllowed: diagnostics?.retryAllowed ?? false,
    retryBlockedReason: diagnostics?.retryBlockedReason ?? null,
    retryOutcome: diagnostics?.retryOutcome ?? null,
    retryWasted: diagnostics?.retryWasted ?? false,
    firstCallFailureKind: diagnostics?.firstCallFailureKind ?? null,
    sourceGateApplied: qualityControl?.sourceGateApplied ?? false,
    sourceGateSufficient: qualityControl?.sourceGateSufficient ?? null,
    sourceGateMissingSourceTypes: qualityControl?.sourceGateMissingSourceTypes ?? [],
    sourceGateFailureLabels: qualityControl?.sourceGateFailureLabels ?? [],
    sourceGateRetrievalRetryRecommended: qualityControl?.sourceGateRetrievalRetryRecommended ?? false,
    retrievalRetryUsed: qualityControl?.retrievalRetryUsed ?? false,
    retrievalRetryOutcome: qualityControl?.retrievalRetryOutcome ?? "not_used",
    evidenceFallbackUsed: qualityControl?.evidenceFallbackUsed ?? false,
    fallbackKind: qualityControl?.fallbackKind ?? "none",
    fallbackKindSource: qualityControl?.fallbackKind ? "model_quality_control" : "finalizer",
    responsePathFallbackButKindNone: false,
    driverSlotsCount: qualityControl?.driverSlotsCount ?? 0,
    marginDriverSlotsCount: qualityControl?.marginDriverSlotsCount ?? 0,
    followupTargetFound: qualityControl?.followupTargetFound ?? null,
    genericFallbackPhraseDetected: qualityControl?.genericFallbackPhraseDetected ?? false,
    hardRetrievalPlanUsed: qualityControl?.hardRetrievalPlanUsed ?? false,
    hardRetrievalQueries: qualityControl?.hardRetrievalQueries ?? [],
    hardRetrievalQueryPurposes: qualityControl?.hardRetrievalQueryPurposes ?? [],
    hardRetrievalMissingSourceTypes: qualityControl?.hardRetrievalMissingSourceTypes ?? [],
    hardRetrievalAddedSourceCount: qualityControl?.hardRetrievalAddedSourceCount ?? 0,
    hardRetrievalAddedSourceLabels: qualityControl?.hardRetrievalAddedSourceLabels ?? [],
    hardRetrievalAddedSourceIds: qualityControl?.hardRetrievalAddedSourceIds ?? [],
    hardRetrievalOutcome: qualityControl?.hardRetrievalOutcome ?? "not_used",
    sourceGateSufficientBeforeHardRetrieval: qualityControl?.sourceGateSufficientBeforeHardRetrieval ?? null,
    sourceGateSufficientAfterHardRetrieval: qualityControl?.sourceGateSufficientAfterHardRetrieval ?? null,
    driverSlotsCountBeforeHardRetrieval: qualityControl?.driverSlotsCountBeforeHardRetrieval ?? null,
    driverSlotsCountAfterHardRetrieval: qualityControl?.driverSlotsCountAfterHardRetrieval ?? null,
    marginDriverSlotsCountBeforeHardRetrieval: qualityControl?.marginDriverSlotsCountBeforeHardRetrieval ?? null,
    marginDriverSlotsCountAfterHardRetrieval: qualityControl?.marginDriverSlotsCountAfterHardRetrieval ?? null,
    selectedSourceLabelsBeforeHardRetrieval: qualityControl?.selectedSourceLabelsBeforeHardRetrieval ?? [],
    selectedSourceLabelsAfterHardRetrieval: qualityControl?.selectedSourceLabelsAfterHardRetrieval ?? [],
    hardRetrievalMode: qualityControl?.hardRetrievalMode ?? "diagnostic",
    hardSourceCoverageScore: qualityControl?.hardSourceCoverageScore ?? null,
    hardSourceCoverageMissing: qualityControl?.hardSourceCoverageMissing ?? [],
    hardSourceCoverageSectorKpiHits: qualityControl?.hardSourceCoverageSectorKpiHits ?? [],
    hardSourceCoverageHasMdaRevenueDiscussion: qualityControl?.hardSourceCoverageHasMdaRevenueDiscussion ?? null,
    hardSourceCoverageHasSegmentResults: qualityControl?.hardSourceCoverageHasSegmentResults ?? null,
    hardSourceCoverageHasSectorKpiWindow: qualityControl?.hardSourceCoverageHasSectorKpiWindow ?? null,
    geminiApiErrorKind: geminiApiError?.geminiApiErrorKind ?? null,
    geminiApiErrorStatus: geminiApiError?.geminiApiErrorStatus ?? null,
    geminiApiErrorCode: geminiApiError?.geminiApiErrorCode ?? null,
    geminiApiErrorMessageSample: geminiApiError?.geminiApiErrorMessageSample ?? null,
    geminiApiErrorRetryable: geminiApiError?.geminiApiErrorRetryable ?? null,
    geminiRequestPromptCharCount: geminiApiError?.geminiRequestPromptCharCount ?? null,
    geminiRequestEstimatedTokens: geminiApiError?.geminiRequestEstimatedTokens ?? null,
    geminiRequestSourceCount: geminiApiError?.geminiRequestSourceCount ?? null,
    geminiRequestContextCharCount: geminiApiError?.geminiRequestContextCharCount ?? null,
    geminiModelName: geminiApiError?.geminiModelName ?? null,
    geminiErrorOccurredBeforeResponse: geminiApiError?.geminiErrorOccurredBeforeResponse ?? null,
    modelName: modelResponse.modelName ?? modelResponse.llmUsage?.[0]?.model ?? null,
    modelProvider: modelResponse.modelProvider ?? null,
    modelApiErrorKind: modelApiError?.modelApiErrorKind ?? geminiApiError?.geminiApiErrorKind ?? null,
    modelApiErrorStatus: modelApiError?.modelApiErrorStatus ?? geminiApiError?.geminiApiErrorStatus ?? null,
    modelApiErrorCode: modelApiError?.modelApiErrorCode ?? geminiApiError?.geminiApiErrorCode ?? null,
    modelApiErrorMessageSample: modelApiError?.modelApiErrorMessageSample ?? geminiApiError?.geminiApiErrorMessageSample ?? null,
    modelApiErrorRetryable: modelApiError?.modelApiErrorRetryable ?? geminiApiError?.geminiApiErrorRetryable ?? null,
    modelRequestPromptCharCount: modelApiError?.modelRequestPromptCharCount ?? geminiApiError?.geminiRequestPromptCharCount ?? null,
    modelRequestEstimatedTokens: modelApiError?.modelRequestEstimatedTokens ?? geminiApiError?.geminiRequestEstimatedTokens ?? null,
    modelRequestSourceCount: modelApiError?.modelRequestSourceCount ?? geminiApiError?.geminiRequestSourceCount ?? null,
    modelRequestContextCharCount: modelApiError?.modelRequestContextCharCount ?? geminiApiError?.geminiRequestContextCharCount ?? null,
    modelErrorOccurredBeforeResponse: modelApiError?.modelErrorOccurredBeforeResponse ?? geminiApiError?.geminiErrorOccurredBeforeResponse ?? null
  };
}

export function resolveChatResponsePath(answer: ChatResponsePayload): ChatResponsePath {
  return answer.responsePath ?? answer.debug?.responsePath ?? "fallback";
}

export function buildAnswerQualityFlags(
  answer: ChatResponsePayload,
  options: { contextApplied: boolean }
): string[] {
  const flags = new Set<string>();
  const debug = answer.debug;

  if (options.contextApplied) {
    flags.add("context_rewritten");
  }
  if (resolveChatResponsePath(answer) === "fallback") {
    flags.add("fallback_path");
  }
  if (debug?.fallbackReason) {
    flags.add(`fallback:${debug.fallbackReason}`);
  }
  if (debug?.sourceIdsValid === false) {
    flags.add("invalid_source_ids");
  }
  if (answer.sources.length === 0) {
    flags.add("no_final_sources");
  }
  if (debug?.contentMode === "metrics_only") {
    flags.add("metrics_only_context");
  }
  if ((debug?.retryAttempt ?? 0) > 0) {
    flags.add("model_retry_used");
  }
  if (debug?.retryAttempted === true) {
    flags.add("retry_attempted");
  }
  if (debug?.retryWasted === true) {
    flags.add("retry_wasted");
  }
  if (debug?.retryBlockedReason) {
    flags.add(`retry_blocked:${debug.retryBlockedReason}`);
  }
  if (debug?.sourceGateApplied === true) {
    flags.add("source_gate_applied");
  }
  if (debug?.sourceGateSufficient === false) {
    flags.add("source_gate_failed");
  }
  for (const label of debug?.sourceGateFailureLabels ?? []) {
    flags.add(label);
  }
  if (debug?.retrievalRetryUsed === true) {
    flags.add("retrieval_retry_used");
  }
  if (debug?.retrievalRetryOutcome === "no_improvement") {
    flags.add("retrieval_retry_no_improvement");
  }
  if (debug?.evidenceFallbackUsed === true) {
    flags.add("evidence_fallback_used");
  }
  if (debug?.genericFallbackPhraseDetected === true) {
    flags.add("generic_fallback_phrase");
  }
  if (debug?.hardRetrievalPlanUsed === true) {
    flags.add("hard_retrieval_used");
  }
  if (debug?.hardRetrievalOutcome === "improved") {
    flags.add("hard_retrieval_improved");
  }
  if (debug?.hardRetrievalOutcome === "no_improvement") {
    flags.add("hard_retrieval_no_improvement");
  }
  if ((debug?.hardRetrievalAddedSourceCount ?? 0) > 0) {
    flags.add("hard_retrieval_added_driver_source");
  }
  if (debug?.hardRetrievalPlanUsed === true && (debug.hardRetrievalQueries?.length ?? 0) === 0) {
    flags.add("hard_retrieval_query_builder_empty");
  }
  if (debug?.sourceGateSufficientBeforeHardRetrieval === false && debug?.sourceGateSufficientAfterHardRetrieval === true) {
    flags.add("source_gate_sufficient_after_retrieval");
  }
  if (debug?.sourceGateSufficientBeforeHardRetrieval === false && debug?.sourceGateSufficientAfterHardRetrieval === false) {
    flags.add("source_gate_still_insufficient_after_retrieval");
  }
  if ((debug?.hardSourceCoverageScore ?? 100) < 45) {
    flags.add("hard_source_asset_coverage_low");
  }
  for (const missing of debug?.hardSourceCoverageMissing ?? []) {
    if (/md&a revenue/i.test(missing)) flags.add("hard_source_asset_missing_mda_revenue");
    if (/segment/i.test(missing)) flags.add("hard_source_asset_missing_segment_results");
    if (/sector kpi/i.test(missing)) flags.add("hard_source_asset_missing_sector_kpi");
  }
  if (debug?.geminiApiErrorKind) {
    flags.add(`gemini_api_error_${debug.geminiApiErrorKind}`);
  }
  if (debug?.modelApiErrorKind) {
    flags.add(`model_api_error_${debug.modelApiErrorKind}`);
  }
  if (debug?.responsePath === "fallback" && (debug.fallbackKind === undefined || debug.fallbackKind === "none")) {
    flags.add("fallback_kind_missing");
  }
  if (debug?.responsePathFallbackButKindNone === true) {
    flags.add("fallback_kind_missing");
  }
  for (const label of debug?.finalAnswerLanguageLabels ?? []) {
    flags.add(label);
  }
  if (debug?.languageGuardFallbackUsed === true) {
    flags.add("language_guard_fallback_used");
  }
  for (const label of debug?.languageGuardViolationLabels ?? []) {
    flags.add(label);
  }
  for (const label of debug?.sourceRepairLabels ?? []) {
    flags.add(label);
  }
  if (debug?.geminiCalled === true && debug.geminiSucceeded === false) {
    flags.add("gemini_failed");
  }
  if (/この決算資料の範囲では確認できません/.test(answer.answer)) {
    flags.add("context_unavailable_answer");
  }

  return [...flags];
}

export function buildChatQualityPipelinePayload({
  filing,
  originalQuestion,
  rewrittenQuestion,
  answer,
  latencyMs,
  modelName,
  contextMessageCount
}: {
  filing: FilingCacheRecord;
  originalQuestion: string;
  rewrittenQuestion: string;
  answer: ChatResponsePayload;
  latencyMs: number;
  modelName: string | null;
  contextMessageCount: number;
}): Record<string, unknown> {
  const contextApplied = rewrittenQuestion !== originalQuestion;
  const responsePath = resolveChatResponsePath(answer);
  const selectedSourceChars = selectedResponseSourceCharCount(answer);
  const answerQualityFlags = buildAnswerQualityFlags(answer, { contextApplied });

  return {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    originalQuestion,
    rewrittenQuestion,
    questionIntent: answer.debug?.questionIntent ?? null,
    responsePath,
    fallbackReason: answer.debug?.fallbackReason ?? null,
    selectedSourceCount: answer.debug?.selectedSourceCount ?? answer.sources.length,
    selectedSourceCharCount: answer.debug?.selectedSourceCharCount ?? selectedSourceChars,
    estimatedContextTokens: answer.debug?.estimatedContextTokens ?? estimateTokenCountFromChars(selectedSourceChars),
    modelName,
    modelProvider: answer.debug?.modelProvider ?? null,
    latencyMs,
    selectedSourceIds: answer.debug?.selectedSourceIds ?? answer.sources.map((source) => source.sourceId),
    selectedSourceLabels: answer.debug?.selectedSourceLabels ?? answer.sources.map((source) => source.sourceLabel),
    answerQualityFlags,
    sourceIdsValid: answer.debug?.sourceIdsValid ?? null,
    geminiCalled: answer.debug?.geminiCalled ?? false,
    geminiSucceeded: answer.debug?.geminiSucceeded ?? false,
    schemaValid: answer.debug?.schemaValid ?? null,
    retryAttempt: answer.debug?.retryAttempt ?? 0,
    retryReason: answer.debug?.retryReason ?? null,
    retryAttempted: answer.debug?.retryAttempted ?? false,
    retryAllowed: answer.debug?.retryAllowed ?? false,
    retryBlockedReason: answer.debug?.retryBlockedReason ?? null,
    retryOutcome: answer.debug?.retryOutcome ?? null,
    retryWasted: answer.debug?.retryWasted ?? false,
    firstCallFailureKind: answer.debug?.firstCallFailureKind ?? null,
    sourceGateApplied: answer.debug?.sourceGateApplied ?? false,
    sourceGateSufficient: answer.debug?.sourceGateSufficient ?? null,
    sourceGateMissingSourceTypes: answer.debug?.sourceGateMissingSourceTypes ?? [],
    sourceGateFailureLabels: answer.debug?.sourceGateFailureLabels ?? [],
    sourceGateRetrievalRetryRecommended: answer.debug?.sourceGateRetrievalRetryRecommended ?? false,
    retrievalRetryUsed: answer.debug?.retrievalRetryUsed ?? false,
    retrievalRetryOutcome: answer.debug?.retrievalRetryOutcome ?? "not_used",
    evidenceFallbackUsed: answer.debug?.evidenceFallbackUsed ?? false,
    fallbackKind: answer.debug?.fallbackKind ?? "none",
    driverSlotsCount: answer.debug?.driverSlotsCount ?? 0,
    marginDriverSlotsCount: answer.debug?.marginDriverSlotsCount ?? 0,
    followupTargetFound: answer.debug?.followupTargetFound ?? null,
    genericFallbackPhraseDetected: answer.debug?.genericFallbackPhraseDetected ?? false,
    hardRetrievalPlanUsed: answer.debug?.hardRetrievalPlanUsed ?? false,
    hardRetrievalQueries: answer.debug?.hardRetrievalQueries ?? [],
    hardRetrievalQueryPurposes: answer.debug?.hardRetrievalQueryPurposes ?? [],
    hardRetrievalMissingSourceTypes: answer.debug?.hardRetrievalMissingSourceTypes ?? [],
    hardRetrievalAddedSourceCount: answer.debug?.hardRetrievalAddedSourceCount ?? 0,
    hardRetrievalAddedSourceLabels: answer.debug?.hardRetrievalAddedSourceLabels ?? [],
    hardRetrievalAddedSourceIds: answer.debug?.hardRetrievalAddedSourceIds ?? [],
    hardRetrievalOutcome: answer.debug?.hardRetrievalOutcome ?? "not_used",
    sourceGateSufficientBeforeHardRetrieval: answer.debug?.sourceGateSufficientBeforeHardRetrieval ?? null,
    sourceGateSufficientAfterHardRetrieval: answer.debug?.sourceGateSufficientAfterHardRetrieval ?? null,
    driverSlotsCountBeforeHardRetrieval: answer.debug?.driverSlotsCountBeforeHardRetrieval ?? null,
    driverSlotsCountAfterHardRetrieval: answer.debug?.driverSlotsCountAfterHardRetrieval ?? null,
    marginDriverSlotsCountBeforeHardRetrieval: answer.debug?.marginDriverSlotsCountBeforeHardRetrieval ?? null,
    marginDriverSlotsCountAfterHardRetrieval: answer.debug?.marginDriverSlotsCountAfterHardRetrieval ?? null,
    selectedSourceLabelsBeforeHardRetrieval: answer.debug?.selectedSourceLabelsBeforeHardRetrieval ?? [],
    selectedSourceLabelsAfterHardRetrieval: answer.debug?.selectedSourceLabelsAfterHardRetrieval ?? [],
    hardRetrievalMode: answer.debug?.hardRetrievalMode ?? "diagnostic",
    hardSourceCoverageScore: answer.debug?.hardSourceCoverageScore ?? null,
    hardSourceCoverageMissing: answer.debug?.hardSourceCoverageMissing ?? [],
    hardSourceCoverageSectorKpiHits: answer.debug?.hardSourceCoverageSectorKpiHits ?? [],
    hardSourceCoverageHasMdaRevenueDiscussion: answer.debug?.hardSourceCoverageHasMdaRevenueDiscussion ?? null,
    hardSourceCoverageHasSegmentResults: answer.debug?.hardSourceCoverageHasSegmentResults ?? null,
    hardSourceCoverageHasSectorKpiWindow: answer.debug?.hardSourceCoverageHasSectorKpiWindow ?? null,
    geminiApiErrorKind: answer.debug?.geminiApiErrorKind ?? null,
    geminiApiErrorStatus: answer.debug?.geminiApiErrorStatus ?? null,
    geminiApiErrorCode: answer.debug?.geminiApiErrorCode ?? null,
    geminiApiErrorMessageSample: answer.debug?.geminiApiErrorMessageSample ?? null,
    geminiApiErrorRetryable: answer.debug?.geminiApiErrorRetryable ?? null,
    geminiRequestPromptCharCount: answer.debug?.geminiRequestPromptCharCount ?? null,
    geminiRequestEstimatedTokens: answer.debug?.geminiRequestEstimatedTokens ?? null,
    geminiRequestSourceCount: answer.debug?.geminiRequestSourceCount ?? null,
    geminiRequestContextCharCount: answer.debug?.geminiRequestContextCharCount ?? null,
    geminiModelName: answer.debug?.geminiModelName ?? null,
    geminiErrorOccurredBeforeResponse: answer.debug?.geminiErrorOccurredBeforeResponse ?? null,
    modelApiErrorKind: answer.debug?.modelApiErrorKind ?? null,
    modelApiErrorStatus: answer.debug?.modelApiErrorStatus ?? null,
    modelApiErrorCode: answer.debug?.modelApiErrorCode ?? null,
    modelApiErrorMessageSample: answer.debug?.modelApiErrorMessageSample ?? null,
    modelApiErrorRetryable: answer.debug?.modelApiErrorRetryable ?? null,
    modelRequestPromptCharCount: answer.debug?.modelRequestPromptCharCount ?? null,
    modelRequestEstimatedTokens: answer.debug?.modelRequestEstimatedTokens ?? null,
    modelRequestSourceCount: answer.debug?.modelRequestSourceCount ?? null,
    modelRequestContextCharCount: answer.debug?.modelRequestContextCharCount ?? null,
    modelErrorOccurredBeforeResponse: answer.debug?.modelErrorOccurredBeforeResponse ?? null,
    fallbackKindSource: answer.debug?.fallbackKindSource ?? null,
    responsePathFallbackButKindNone: answer.debug?.responsePathFallbackButKindNone ?? false,
    finalAnswerJapaneseRatio: answer.debug?.finalAnswerJapaneseRatio ?? null,
    finalAnswerEnglishSentenceCount: answer.debug?.finalAnswerEnglishSentenceCount ?? null,
    finalAnswerRawExcerptLike: answer.debug?.finalAnswerRawExcerptLike ?? false,
    finalAnswerLanguageLabels: answer.debug?.finalAnswerLanguageLabels ?? [],
    finalAnswerLanguageViolations: answer.debug?.finalAnswerLanguageViolations ?? [],
    languageGuardChecked: answer.debug?.languageGuardChecked ?? false,
    languageGuardOk: answer.debug?.languageGuardOk ?? null,
    languageGuardViolationLabels: answer.debug?.languageGuardViolationLabels ?? [],
    languageGuardFallbackUsed: answer.debug?.languageGuardFallbackUsed ?? false,
    languageGuardFallbackKind: answer.debug?.languageGuardFallbackKind ?? null,
    originalAnswerBeforeLanguageGuardLength: answer.debug?.originalAnswerBeforeLanguageGuardLength ?? null,
    originalAnswerBeforeLanguageGuardSample: answer.debug?.originalAnswerBeforeLanguageGuardSample ?? null,
    sourceRepairLabels: answer.debug?.sourceRepairLabels ?? [],
    totalPipelineMs: answer.debug?.totalPipelineMs ?? null,
    historicalLookupMs: answer.debug?.historicalLookupMs ?? null,
    deterministicBuildMs: answer.debug?.deterministicBuildMs ?? null,
    contextBuildMs: answer.debug?.contextBuildMs ?? null,
    geminiFirstCallMs: answer.debug?.geminiFirstCallMs ?? null,
    geminiRetryMs: answer.debug?.geminiRetryMs ?? null,
    fallbackBuildMs: answer.debug?.fallbackBuildMs ?? null,
    webSupplementMs: answer.debug?.webSupplementMs ?? null,
    groundingMs: answer.debug?.groundingMs ?? null,
    contextApplied,
    contextMessageCount,
    finalSourceIds: answer.sources.map((source) => source.sourceId),
    finalSourceLabels: answer.sources.map((source) => source.sourceLabel)
  };
}

export function selectedResponseSourceCharCount(answer: ChatResponsePayload): number {
  return answer.sources.reduce((sum, source) => sum + source.excerpt.length, 0);
}

export function estimateTokenCountFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}
