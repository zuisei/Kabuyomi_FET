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
> {
  const diagnostics = modelResponse.retryDiagnostics;
  const qualityControl = modelResponse.qualityControl;
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
    genericFallbackPhraseDetected: qualityControl?.genericFallbackPhraseDetected ?? false
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
