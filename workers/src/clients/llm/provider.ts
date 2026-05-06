import type { Env } from "../../env";
import { generateQuoteTranslation as generateGeminiQuoteTranslation } from "../gemini";
import { buildQuoteTranslationPrompt } from "../gemini/prompts";
import { normalizeQuoteTranslationResponse, polishJapaneseText, stripAnswerFormattingArtifacts } from "../gemini/normalize";
import type { ChatPromptInput, GeminiChatAnswer, GeminiInvocationUsage, QuoteTranslationPromptInput } from "../gemini/types";
import {
  generateDisabledProviderFallback,
  generateGeminiLegacyChatAnswer
} from "./providers/gemini-legacy";
import { generateOpenAIChatAnswer, invokeOpenAIQuoteTranslation, resolveOpenAIChatModel } from "./providers/openai";
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

export function isQuoteTranslationAvailable(env: Env): boolean {
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return Boolean(env.OPENAI_API_KEY);
  }
  if (provider === "disabled") {
    return false;
  }
  return Boolean(env.GEMINI_API_KEY);
}

export async function generateModelQuoteTranslation(
  env: Env,
  input: QuoteTranslationPromptInput
): Promise<{ translatedText: string; modelName: string; providerName: LlmProviderName; llmUsage?: GeminiInvocationUsage[] }> {
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return generateOpenAIQuoteTranslation(env, input);
  }
  if (provider === "disabled") {
    throw new Error("Quote translation provider is disabled");
  }
  const result = await generateGeminiQuoteTranslation(env, input);
  return {
    ...result,
    providerName: "gemini-legacy"
  };
}

async function generateOpenAIQuoteTranslation(
  env: Env,
  input: QuoteTranslationPromptInput
): Promise<{ translatedText: string; modelName: string; providerName: "openai"; llmUsage?: GeminiInvocationUsage[] }> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OpenAI API key is missing");
  }

  const invocation = await invokeOpenAIQuoteTranslation(env, buildOpenAIQuoteTranslationPrompt(input));
  const translatedText = normalizeQuoteTranslationResponse(invocation.data);
  if (!translatedText) {
    throw new Error(invocation.failureReason ?? "Quote translation schema validation failed");
  }

  const guarded = guardQuoteTranslation(translatedText, input.text);
  return {
    translatedText: guarded,
    modelName: resolveOpenAIChatModel(env),
    providerName: "openai",
    ...(invocation.usage.length > 0 ? { llmUsage: invocation.usage } : {})
  };
}

function buildOpenAIQuoteTranslationPrompt(input: QuoteTranslationPromptInput): string {
  return [
    buildQuoteTranslationPrompt(input),
    "",
    "Additional Kabuyomi v1 guardrails:",
    "- Output Japanese only, except unavoidable company names, ticker symbols, product names, filing terms, numbers, percentages, and dates.",
    "- Do not include investment advice, buy/sell recommendations, forecasts, target prices, or extra analysis.",
    "- If the excerpt is too long or unclear, return a concise faithful Japanese translation of only the supplied excerpt.",
    "- Return no raw internal wording, debug text, markdown, or source labels."
  ].join("\n");
}

function guardQuoteTranslation(translatedText: string, sourceText: string): string {
  const cleaned = polishJapaneseText(stripAnswerFormattingArtifacts(translatedText));
  if (!containsJapanese(cleaned)) {
    throw new Error("Quote translation did not produce Japanese text");
  }
  if (cleaned.trim() === sourceText.trim()) {
    throw new Error("Quote translation returned unchanged text");
  }
  if (containsInvestmentAdvice(cleaned)) {
    throw new Error("Quote translation introduced investment advice");
  }
  return cleaned;
}

function containsJapanese(text: string): boolean {
  return /[ぁ-んァ-ヶ一-龠]/.test(text);
}

function containsInvestmentAdvice(text: string): boolean {
  return /(買い|売り|購入|売却|投資判断|推奨|目標株価|株価予想|buy|sell|target price|forecast)/i.test(text);
}
