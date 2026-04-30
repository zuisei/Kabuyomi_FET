import type { Env, FilingCacheRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import type { GeminiChatAnswer } from "../../clients/gemini/types";
import { buildChatContextPack, type ChatContextPack } from "./context-pack";
import { logChatContextSelection } from "./decision-log";
import type { QuestionIntent } from "./intent";
import { retryModelAnswer } from "./model-retry";
import { chooseRetryReason, shouldRetryModelAnswer } from "./route-policy";
import { validateModelSources, type ChatSourceValidationResult } from "./source-validation";
import type { ChatTimingTracker } from "./timing";

export async function buildValidatedModelAnswer({
  filing,
  question,
  env,
  questionIntent,
  timings
}: {
  filing: FilingCacheRecord;
  question: string;
  env: Env;
  questionIntent: QuestionIntent;
  timings: ChatTimingTracker;
}): Promise<{
  contextPack: ChatContextPack;
  modelResponse: GeminiChatAnswer;
  sourceValidation: ChatSourceValidationResult;
}> {
  let contextPack = timings.timeSync("contextBuildMs", () => buildChatContextPack(filing, questionIntent));
  logChatContextSelection(filing, contextPack);
  let modelResponse = await timings.timeAsync("geminiFirstCallMs", () =>
    generateChatAnswer(env, { filing, question, questionIntent, contextPack })
  );
  let sourceValidation = validateModelSources(modelResponse, contextPack);
  const retryReason = chooseRetryReason({
    filing,
    question,
    modelResponse,
    approvedSourceIds: sourceValidation.approvedSourceIds
  });

  if (shouldRetryModelAnswer(modelResponse, retryReason)) {
    const retryResult = await timings.timeAsync("geminiRetryMs", () => retryModelAnswer({
      filing,
      question,
      env,
      questionIntent,
      retryReason: retryReason!,
      previousModelResponse: modelResponse
    }));
    contextPack = retryResult.contextPack;
    modelResponse = retryResult.modelResponse;
    sourceValidation = validateModelSources(modelResponse, contextPack);
  }

  return {
    contextPack,
    modelResponse,
    sourceValidation
  };
}
