import type { FilingCacheRecord } from "../../env";
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
