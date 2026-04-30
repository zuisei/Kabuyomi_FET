import type { Env, SummaryRecord } from "../env";
import { logEvent } from "../lib/logging";
import { polishChatAnswerForQuestion, shouldRecoverLowQualityChatAnswer } from "./gemini/chat-quality";
import { localChatFallback, recoverBroaderFallbackIfNeeded } from "./gemini/fallback";
import { localSummaryFallback } from "./gemini/fallback-summary";
import {
  normalizeChatResponse,
  normalizeQuoteTranslationResponse,
  normalizeSummaryResponse,
  polishJapaneseText,
  stripAnswerFormattingArtifacts,
  stripEnglishParentheticals,
  isRecord
} from "./gemini/normalize";
import { buildChatPrompt, buildQuoteTranslationPrompt, buildSummaryPrompt } from "./gemini/prompts";
import { invokeGemini, resolveGeminiTranslationModel } from "./gemini/request";
import type {
  ChatFallbackReason,
  ChatPromptInput,
  ChatRetryInstruction,
  GeminiChatAnswer,
  GeminiInvocationUsage,
  QuoteTranslationPromptInput,
  SummaryPromptInput
} from "./gemini/types";

export async function generateSummary(
  env: Env,
  input: SummaryPromptInput
): Promise<{ summary: SummaryRecord; provider: "gemini" | "fallback"; llmUsage?: GeminiInvocationUsage[] }> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "missing_api_key" });
    return {
      summary: localSummaryFallback(input),
      provider: "fallback"
    };
  }

  let invocation: Awaited<ReturnType<typeof invokeGemini>>;
  try {
    invocation = await invokeGemini(env, buildSummaryPrompt(input), "summary");
  } catch {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "request_failed" });
    return {
      summary: localSummaryFallback(input),
      provider: "fallback"
    };
  }

  const response = invocation.data;
  const normalized = normalizeSummaryResponse(response);
  if (!normalized) {
    logSchemaMismatch("summary", response);
    logEvent("gemini_fallback_used", { kind: "summary", reason: "schema_validation_failed" });
    return {
      summary: localSummaryFallback(input),
      provider: "fallback",
      ...usagePayload(invocation.usage)
    };
  }

  return {
    summary: {
      verdict: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.verdict))),
      highlights: normalized.highlights.map((line) => ({
        ...line,
        text: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(line.text)))
      })),
      changes: normalized.changes.map((line) => ({
        ...line,
        text: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(line.text)))
      }))
    },
    provider: "gemini",
    ...usagePayload(invocation.usage)
  };
}

export async function generateChatAnswer(env: Env, input: ChatPromptInput): Promise<GeminiChatAnswer> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "missing_api_key" });
    return attachChatDecisionMeta(localChatFallback(input), {
      geminiCalled: false,
      geminiSucceeded: false,
      schemaValid: false
    });
  }

  let invocation: Awaited<ReturnType<typeof invokeGemini>>;
  try {
    invocation = await invokeGemini(env, buildChatPrompt(input), "chat");
  } catch (error) {
    const fallbackReason = isGeminiTimeout(error) ? "gemini_timeout" : "gemini_api_error";
    logEvent("gemini_fallback_used", { kind: "chat", reason: fallbackReason });
    return attachChatDecisionMeta(localChatFallback(input), {
      geminiCalled: true,
      geminiSucceeded: false,
      fallbackReason,
      schemaValid: false
    });
  }

  const normalized = normalizeChatResponse(invocation.data);
  if (!normalized) {
    logSchemaMismatch("chat", invocation.data);
    const fallbackReason: ChatFallbackReason = invocation.failureReason ?? "schema_invalid";
    const repaired = await maybeRepairChatSchema(env, input, invocation.data, invocation.usage, fallbackReason);
    if (repaired) {
      return repaired;
    }

    logEvent("gemini_fallback_used", { kind: "chat", reason: fallbackReason });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), invocation.usage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason,
      schemaValid: false,
      retryAttempt: input.retryInstruction?.attempt ?? 0,
      retryReason: input.retryInstruction?.reason
    });
  }

  const remoteAnswer: GeminiChatAnswer = {
    answer: polishChatAnswerForQuestion(
      input.question,
      stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.answer)))
    ),
    sourceIds: normalized.sourceIds,
    usedRemoteModel: normalized.usedRemoteModel
  };
  const recoveredWithoutUsage = recoverBroaderFallbackIfNeeded(input, remoteAnswer);
  const recovered = attachChatDecisionMeta(attachLlmUsage(recoveredWithoutUsage, invocation.usage), {
    geminiCalled: true,
    geminiSucceeded: true,
    fallbackReason: didRecoverWithLocalFallback(remoteAnswer, recoveredWithoutUsage)
      ? remoteAnswer.sourceIds.length === 0
        ? "no_sources"
        : "weak_grounding"
      : undefined,
    schemaValid: true
  });

  if (shouldRecoverLowQualityChatAnswer(input, recovered.answer, recovered.sourceIds)) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "low_quality_answer" });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), invocation.usage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason: "low_quality_answer",
      schemaValid: true
    });
  }

  return recovered;
}

export async function generateQuoteTranslation(
  env: Env,
  input: QuoteTranslationPromptInput
): Promise<{ translatedText: string; modelName: string; llmUsage?: GeminiInvocationUsage[] }> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is missing");
  }

  const invocation = await invokeGemini(env, buildQuoteTranslationPrompt(input), "quote_translation");
  const response = invocation.data;
  const translatedText = normalizeQuoteTranslationResponse(response);

  if (!translatedText) {
    logSchemaMismatch("quote_translation", response);
    throw new Error("Quote translation schema validation failed");
  }

  return {
    translatedText,
    modelName: resolveGeminiTranslationModel(env),
    ...usagePayload(invocation.usage)
  };
}

function attachLlmUsage(answer: GeminiChatAnswer, usage: GeminiChatAnswer["llmUsage"]): GeminiChatAnswer {
  return usage && usage.length > 0
    ? {
        ...answer,
        llmUsage: usage
      }
    : answer;
}

function attachChatDecisionMeta(
  answer: GeminiChatAnswer,
  meta: Pick<GeminiChatAnswer, "geminiCalled" | "geminiSucceeded" | "fallbackReason" | "schemaValid"> &
    Pick<Partial<GeminiChatAnswer>, "retryAttempt" | "retryReason">
): GeminiChatAnswer {
  return {
    ...answer,
    ...meta
  };
}

async function maybeRepairChatSchema(
  env: Env,
  input: ChatPromptInput,
  previousResponse: unknown,
  previousUsage: GeminiInvocationUsage[],
  fallbackReason: ChatFallbackReason
): Promise<GeminiChatAnswer | null> {
  if (input.retryInstruction || (fallbackReason !== "schema_invalid" && fallbackReason !== "json_parse_failed")) {
    return null;
  }

  const retryInstruction: ChatRetryInstruction = {
    attempt: 1,
    reason: fallbackReason,
    previousResponse
  };
  let repairInvocation: Awaited<ReturnType<typeof invokeGemini>>;
  try {
    repairInvocation = await invokeGemini(
      env,
      buildChatPrompt({
        ...input,
        retryInstruction
      }),
      "chat"
    );
  } catch {
    logEvent("gemini_fallback_used", { kind: "chat", reason: fallbackReason, retryAttempt: 1 });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), previousUsage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason,
      schemaValid: false,
      retryAttempt: 1,
      retryReason: fallbackReason
    });
  }

  const combinedUsage = [...previousUsage, ...repairInvocation.usage];
  const normalized = normalizeChatResponse(repairInvocation.data);
  if (!normalized) {
    logSchemaMismatch("chat", repairInvocation.data);
    logEvent("gemini_fallback_used", { kind: "chat", reason: fallbackReason, retryAttempt: 1 });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), combinedUsage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason,
      schemaValid: false,
      retryAttempt: 1,
      retryReason: fallbackReason
    });
  }

  const remoteAnswer: GeminiChatAnswer = {
    answer: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.answer))),
    sourceIds: normalized.sourceIds,
    usedRemoteModel: normalized.usedRemoteModel
  };
  const recoveredWithoutUsage = recoverBroaderFallbackIfNeeded(input, remoteAnswer);
  const recovered = attachChatDecisionMeta(attachLlmUsage(recoveredWithoutUsage, combinedUsage), {
    geminiCalled: true,
    geminiSucceeded: true,
    fallbackReason: didRecoverWithLocalFallback(remoteAnswer, recoveredWithoutUsage)
      ? remoteAnswer.sourceIds.length === 0
        ? "no_sources"
        : "weak_grounding"
      : undefined,
    schemaValid: true,
    retryAttempt: 1,
    retryReason: fallbackReason
  });

  if (shouldRecoverLowQualityChatAnswer(input, recovered.answer, recovered.sourceIds)) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "low_quality_answer", retryAttempt: 1 });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), combinedUsage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason: "low_quality_answer",
      schemaValid: true,
      retryAttempt: 1,
      retryReason: fallbackReason
    });
  }

  return recovered;
}

function usagePayload(usage: GeminiInvocationUsage[]): { llmUsage?: GeminiInvocationUsage[] } {
  return usage.length > 0 ? { llmUsage: usage } : {};
}

function didRecoverWithLocalFallback(remoteAnswer: GeminiChatAnswer, recovered: GeminiChatAnswer): boolean {
  return (
    remoteAnswer.answer !== recovered.answer ||
    remoteAnswer.sourceIds.length !== recovered.sourceIds.length ||
    remoteAnswer.sourceIds.some((sourceId, index) => recovered.sourceIds[index] !== sourceId)
  );
}

function isGeminiTimeout(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /timeout|timed out|aborted/i.test(error.message))
  );
}

function logSchemaMismatch(kind: "summary" | "chat" | "quote_translation", payload: unknown) {
  logEvent("gemini_schema_mismatch", {
    kind,
    keys: isRecord(payload) ? Object.keys(payload).slice(0, 12) : [],
    payloadType: Array.isArray(payload) ? "array" : typeof payload
  });
}
