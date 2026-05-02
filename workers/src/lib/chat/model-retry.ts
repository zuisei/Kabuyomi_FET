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
  previousModelResponse
}: {
  filing: FilingCacheRecord;
  question: string;
  env: Env;
  questionIntent: QuestionIntent;
  retryReason: ChatFallbackReason;
  previousModelResponse: GeminiChatAnswer;
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
    retryInstruction: {
      attempt: 1,
      reason: retryReason
    }
  });

  return {
    contextPack,
    modelResponse: {
      ...modelResponse,
      llmUsage: combineLlmUsage(previousModelResponse.llmUsage, modelResponse.llmUsage),
      retryAttempt: modelResponse.retryAttempt ?? 1,
      retryReason: modelResponse.retryReason ?? retryReason
    }
  };
}
