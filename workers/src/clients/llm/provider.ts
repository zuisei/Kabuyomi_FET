import type { Env } from "../../env";
import type { ChatPromptInput, GeminiChatAnswer } from "../gemini/types";
import {
  generateDisabledProviderFallback,
  generateGeminiLegacyChatAnswer
} from "./providers/gemini-legacy";
import { generateOpenAIChatAnswer } from "./providers/openai";
import type { LlmProviderName } from "./types";

export function resolveLlmProvider(env: Env): LlmProviderName {
  const raw = env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === "openai" || raw === "disabled" || raw === "gemini-legacy") {
    return raw;
  }
  if (raw === "gemini") {
    return "gemini-legacy";
  }
  return "gemini-legacy";
}

export async function generateModelChatAnswer(env: Env, input: ChatPromptInput): Promise<GeminiChatAnswer> {
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return generateOpenAIChatAnswer(env, input);
  }
  if (provider === "disabled") {
    return generateDisabledProviderFallback(input);
  }
  return generateGeminiLegacyChatAnswer(env, input);
}
