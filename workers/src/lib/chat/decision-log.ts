import type { FilingCacheRecord } from "../../env";
import type { ChatFallbackReason, GeminiInvocationUsage } from "../../clients/gemini/types";
import { logLlmUsage } from "../llm-usage";
import { logEvent } from "../logging";
import type { ChatContextPack } from "./context-pack";
import type { ChatResponseDebug, ChatResponsePath } from "./grounding";
import type { QuestionIntent } from "./intent";

type ChatTimingFields = Pick<
  ChatResponseDebug,
  | "totalPipelineMs"
  | "historicalLookupMs"
  | "deterministicBuildMs"
  | "contextBuildMs"
  | "geminiFirstCallMs"
  | "geminiRetryMs"
  | "fallbackBuildMs"
  | "webSupplementMs"
  | "groundingMs"
>;

export function logChatContextSelection(
  filing: FilingCacheRecord,
  contextPack: ChatContextPack,
  retry?: { retryAttempt: number; retryReason: ChatFallbackReason }
): void {
  const diagnostics = contextPack.selectionDiagnostics;
  logEvent("chat_context_selection", {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    questionIntent: contextPack.questionIntent,
    candidateSourceCount: diagnostics.candidateSourceCount,
    selectedSourceCount: diagnostics.selectedSourceCount,
    selectedSourceCharCount: diagnostics.selectedSourceCharCount,
    avgSelectedSourceChars: diagnostics.avgSelectedSourceChars,
    contextTokenBudget: diagnostics.contextTokenBudget,
    estimatedContextTokens: diagnostics.estimatedContextTokens,
    sourceSelectionStrategy: diagnostics.sourceSelectionStrategy,
    rejectedShortCount: diagnostics.rejectedShortCount,
    rejectedTableFragmentCount: diagnostics.rejectedTableFragmentCount,
    rejectedLowTextQualityCount: diagnostics.rejectedLowTextQualityCount,
    sectionHitCountBusiness: diagnostics.sectionHitCountBusiness,
    sectionHitCountRisk: diagnostics.sectionHitCountRisk,
    sectionHitCountMda: diagnostics.sectionHitCountMda,
    retryAttempt: retry?.retryAttempt ?? 0,
    retryReason: retry?.retryReason ?? null
  });
}

export function logChatLlmUsage(
  modelResponse: { llmUsage?: GeminiInvocationUsage[] },
  filing: FilingCacheRecord,
  responsePath: ChatResponsePath
): void {
  logLlmUsage(modelResponse.llmUsage, {
    aiTask: "chat",
    route: "/v1/chat",
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    responsePath
  });
}

export function logChatPathDecision({
  filing,
  questionIntent,
  responsePath,
  geminiCalled,
  geminiSucceeded,
  fallbackReason,
  schemaValid,
  sourceIdsValid,
  sourceCount,
  contentMode,
  contextPack,
  retryAttempt,
  retryReason,
  llmUsage,
  timings
}: {
  filing: FilingCacheRecord;
  questionIntent: QuestionIntent;
  responsePath: ChatResponsePath;
  geminiCalled: boolean;
  geminiSucceeded: boolean;
  fallbackReason: ChatFallbackReason | null;
  schemaValid: boolean;
  sourceIdsValid: boolean;
  sourceCount: number;
  contentMode: "full" | "metrics_only";
  contextPack?: ChatContextPack;
  retryAttempt?: number;
  retryReason?: ChatFallbackReason | null;
  llmUsage?: GeminiInvocationUsage[];
  timings?: Partial<ChatTimingFields>;
}): void {
  const usage = summarizeLlmUsage(llmUsage);
  logEvent("chat_path_decision", {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    questionIntent,
    responsePath,
    geminiCalled,
    geminiSucceeded,
    fallbackReason,
    schemaValid,
    sourceIdsValid,
    sourceCount,
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount: usage.totalTokenCount,
    latencyMs: usage.latencyMs,
    contentMode,
    retryAttempt: retryAttempt ?? 0,
    retryReason: retryReason ?? null,
    finalFallbackReason: fallbackReason,
    contextTokenBudget: contextPack?.contextTokenBudget ?? null,
    selectedSourceCount: contextPack?.selectedSourceCount ?? null,
    selectedSourceCharCount: contextPack?.selectionDiagnostics.selectedSourceCharCount ?? null,
    estimatedContextTokens: contextPack?.selectionDiagnostics.estimatedContextTokens ?? null,
    sourceSelectionStrategy: contextPack?.sourceSelectionStrategy ?? null,
    selectedSourceIds: contextPack?.sourceChunks.map((source) => source.sourceId) ?? [],
    selectedSourceLabels: contextPack?.sourceChunks.map((source) => source.sourceLabel) ?? [],
    totalPipelineMs: timings?.totalPipelineMs ?? null,
    historicalLookupMs: timings?.historicalLookupMs ?? null,
    deterministicBuildMs: timings?.deterministicBuildMs ?? null,
    contextBuildMs: timings?.contextBuildMs ?? null,
    geminiFirstCallMs: timings?.geminiFirstCallMs ?? null,
    geminiRetryMs: timings?.geminiRetryMs ?? null,
    fallbackBuildMs: timings?.fallbackBuildMs ?? null,
    webSupplementMs: timings?.webSupplementMs ?? null,
    groundingMs: timings?.groundingMs ?? null
  });
}

function summarizeLlmUsage(llmUsage: GeminiInvocationUsage[] | undefined): {
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  latencyMs: number | null;
} {
  if (!llmUsage || llmUsage.length === 0) {
    return {
      promptTokenCount: null,
      candidatesTokenCount: null,
      totalTokenCount: null,
      latencyMs: null
    };
  }

  return {
    promptTokenCount: sumNullableCounts(llmUsage.map((usage) => usage.promptTokenCount)),
    candidatesTokenCount: sumNullableCounts(llmUsage.map((usage) => usage.candidatesTokenCount)),
    totalTokenCount: sumNullableCounts(llmUsage.map((usage) => usage.totalTokenCount)),
    latencyMs: llmUsage.reduce((sum, usage) => sum + usage.latencyMs, 0)
  };
}

function sumNullableCounts(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
}
