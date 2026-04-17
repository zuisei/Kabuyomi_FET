import type { Env, SummaryRecord } from "../env";
import { logEvent } from "../lib/logging";
import { localChatFallback, localSummaryFallback, recoverBroaderFallbackIfNeeded } from "./gemini/fallback";
import {
  normalizeChatResponse,
  normalizeSummaryResponse,
  polishJapaneseText,
  stripEnglishParentheticals,
  isRecord
} from "./gemini/normalize";
import { buildChatPrompt, buildSummaryPrompt } from "./gemini/prompts";
import { invokeGemini } from "./gemini/request";
import type { ChatPromptInput, GeminiChatAnswer, SummaryPromptInput } from "./gemini/types";

export async function generateSummary(env: Env, input: SummaryPromptInput): Promise<SummaryRecord> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "missing_api_key" });
    return localSummaryFallback(input);
  }

  let response: unknown;
  try {
    response = await invokeGemini(env, buildSummaryPrompt(input), "summary");
  } catch {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "request_failed" });
    return localSummaryFallback(input);
  }

  const normalized = normalizeSummaryResponse(response);
  if (!normalized) {
    logSchemaMismatch("summary", response);
    logEvent("gemini_fallback_used", { kind: "summary", reason: "schema_validation_failed" });
    return localSummaryFallback(input);
  }

  return {
    verdict: stripEnglishParentheticals(polishJapaneseText(normalized.verdict)),
    highlights: normalized.highlights.map((line) => ({
      ...line,
      text: stripEnglishParentheticals(polishJapaneseText(line.text))
    })),
    changes: normalized.changes.map((line) => ({
      ...line,
      text: stripEnglishParentheticals(polishJapaneseText(line.text))
    }))
  };
}

export async function generateChatAnswer(env: Env, input: ChatPromptInput): Promise<GeminiChatAnswer> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "missing_api_key" });
    return localChatFallback(input);
  }

  let response: unknown;
  try {
    response = await invokeGemini(env, buildChatPrompt(input), "chat");
  } catch {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "request_failed" });
    return localChatFallback(input);
  }

  const normalized = normalizeChatResponse(response);
  if (!normalized) {
    logSchemaMismatch("chat", response);
    logEvent("gemini_fallback_used", { kind: "chat", reason: "schema_validation_failed" });
    return localChatFallback(input);
  }

  return recoverBroaderFallbackIfNeeded(input, {
    answer: stripEnglishParentheticals(polishJapaneseText(normalized.answer)),
    sourceIds: normalized.sourceIds
  });
}

function logSchemaMismatch(kind: "summary" | "chat", payload: unknown) {
  logEvent("gemini_schema_mismatch", {
    kind,
    keys: isRecord(payload) ? Object.keys(payload).slice(0, 12) : [],
    payloadType: Array.isArray(payload) ? "array" : typeof payload
  });
}
