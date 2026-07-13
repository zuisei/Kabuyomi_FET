import type { Env, FilingCacheRecord } from "../../env";
import { generateModelChatAnswer } from "../../clients/llm/provider";
import type { ChatFallbackReason, GeminiChatAnswer } from "../../clients/gemini/types";
import { logEvent } from "../logging";
import { buildChatContextPack, type ChatContextPack } from "./context-pack";
import { logChatContextSelection } from "./decision-log";
import type { QuestionIntent } from "./intent";
import { combineLlmUsage, retryContextMode } from "./route-policy";

export async function retryModelAnswer({
  filing,
  question,
  env,
  questionIntent,
  retryReason,
  previousModelResponse,
  conversationContextSummary
}: {
  filing: FilingCacheRecord;
  question: string;
  env: Env;
  questionIntent: QuestionIntent;
  retryReason: ChatFallbackReason;
  previousModelResponse: GeminiChatAnswer;
  conversationContextSummary?: string;
}): Promise<{ contextPack: ChatContextPack; modelResponse: GeminiChatAnswer }> {
  const contextPack = buildChatContextPack(filing, questionIntent, {
    mode: retryContextMode(retryReason),
    retryReason
  });
  logChatContextSelection(filing, contextPack, {
    retryAttempt: 1,
    retryReason
  });
  logEvent("chat_model_retry", {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    questionIntent,
    retryAttempt: 1,
    retryReason,
    contextTokenBudget: contextPack.contextTokenBudget,
    selectedSourceCount: contextPack.selectedSourceCount,
    selectedSourceCharCount: contextPack.selectionDiagnostics.selectedSourceCharCount,
    estimatedContextTokens: contextPack.selectionDiagnostics.estimatedContextTokens,
    sourceSelectionStrategy: contextPack.sourceSelectionStrategy,
    selectedSourceIds: contextPack.sourceChunks.map((source) => source.sourceId),
    selectedSourceLabels: contextPack.sourceChunks.map((source) => source.sourceLabel)
  });
  const modelResponse = await generateModelChatAnswer(env, {
    filing,
    question,
    questionIntent,
    contextPack,
    conversationContextSummary,
    retryInstruction: {
      attempt: 1,
      reason: retryReason
    }
  });

  return {
    contextPack,
    modelResponse: mergeRetryModelResponse(previousModelResponse, modelResponse, retryReason)
  };
}

export function mergeRetryModelResponse(
  previousModelResponse: GeminiChatAnswer,
  retryModelResponse: GeminiChatAnswer,
  retryReason: ChatFallbackReason
): GeminiChatAnswer {
  const previousQualityControl = previousModelResponse.qualityControl;
  const retryQualityControl = retryModelResponse.qualityControl;
  const qualityControl = retryQualityControl
    ? {
        ...previousQualityControl,
        ...retryQualityControl,
        followupPreviousAnswer:
          retryQualityControl?.followupPreviousAnswer ?? previousQualityControl?.followupPreviousAnswer ?? null
      }
    : previousQualityControl;

  return {
    ...retryModelResponse,
    ...(qualityControl ? { qualityControl } : {}),
    llmUsage: combineLlmUsage(previousModelResponse.llmUsage, retryModelResponse.llmUsage),
    retryAttempt: retryModelResponse.retryAttempt ?? 1,
    retryReason: retryModelResponse.retryReason ?? retryReason
  };
}
