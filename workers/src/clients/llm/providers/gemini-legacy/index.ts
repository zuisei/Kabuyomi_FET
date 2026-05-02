import type { Env } from "../../../../env";
import { generateChatAnswer } from "../../../gemini";
import { localChatFallback } from "../../../gemini/fallback";
import type { ChatPromptInput, GeminiChatAnswer } from "../../../gemini/types";

export { resolveGeminiModel } from "../../../gemini/request";
export { localChatFallback } from "../../../gemini/fallback";

export async function generateGeminiLegacyChatAnswer(env: Env, input: ChatPromptInput): Promise<GeminiChatAnswer> {
  const answer = await generateChatAnswer(env, input);
  return {
    ...answer,
    modelProvider: "gemini-legacy",
    modelName: answer.modelName ?? answer.llmUsage?.[0]?.model ?? null
  };
}

export function generateDisabledProviderFallback(input: ChatPromptInput): GeminiChatAnswer {
  return {
    ...localChatFallback(input),
    usedRemoteModel: false,
    geminiCalled: false,
    geminiSucceeded: false,
    schemaValid: false,
    fallbackReason: "gemini_api_error",
    modelProvider: "disabled",
    modelName: null
  };
}
