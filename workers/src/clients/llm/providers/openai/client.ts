import type { Env } from "../../../../env";
import { logEvent } from "../../../../lib/logging";
import { classifyLowQualityChatAnswer, polishChatAnswerForQuestion } from "../../../gemini/chat-quality";
import { localChatFallback, recoverBroaderFallbackIfNeeded } from "../../../gemini/fallback";
import {
  normalizeChatResponse,
  polishJapaneseText,
  stripAnswerFormattingArtifacts,
  stripEnglishParentheticals
} from "../../../gemini/normalize";
import { buildChatPrompt, buildChatPromptTemplateVariables } from "../../../gemini/prompts";
import type { ChatPromptInput, GeminiChatAnswer } from "../../../gemini/types";
import { classifyOpenAIError } from "./errors";
import { invokeOpenAIChat, invokeOpenAIDashboardPrompt, resolveOpenAIChatModel, resolveOpenAIPromptId } from "./request";

export async function generateOpenAIChatAnswer(env: Env, input: ChatPromptInput): Promise<GeminiChatAnswer> {
  if (!env.OPENAI_API_KEY) {
    logEvent("openai_fallback_used", { kind: "chat", reason: "missing_api_key" });
    return attachProviderMeta(attachChatDecisionMeta(localChatFallback(input), {
      geminiCalled: false,
      geminiSucceeded: false,
      schemaValid: false
    }), false);
  }

  const prompt = buildChatPrompt(input);
  const promptVariables = buildChatPromptTemplateVariables(input);
  let invocation: Awaited<ReturnType<typeof invokeOpenAIChat>>;
  try {
    invocation = resolveOpenAIPromptId(env) !== null
      ? await invokeOpenAIDashboardPrompt(env, prompt, promptVariables)
      : await invokeOpenAIChat(env, prompt);
  } catch (error) {
    const classified = classifyOpenAIError(error);
    const fallbackReason = classified.modelApiErrorKind === "timeout" ? "gemini_timeout" : "gemini_api_error";
    const modelApiError = {
      ...classified,
      modelRequestPromptCharCount: prompt.length,
      modelRequestEstimatedTokens: Math.ceil(prompt.length / 4),
      modelRequestSourceCount: input.contextPack?.sourceChunks.length ?? null,
      modelRequestContextCharCount: input.contextPack?.sourceChunks.reduce((sum, source) => sum + source.text.length, 0) ?? null,
      modelName: classified.modelName ?? resolveOpenAIChatModel(env)
    };
    logEvent("openai_fallback_used", { kind: "chat", reason: fallbackReason });
    return attachOpenAIErrorDiagnostics({
      ...attachProviderMeta(attachChatDecisionMeta(localChatFallback(input), {
        geminiCalled: true,
        geminiSucceeded: false,
        fallbackReason,
        schemaValid: false
      }), false),
      modelApiError
    });
  }

  const normalized = normalizeChatResponse(invocation.data);
  if (!normalized) {
    logEvent("openai_fallback_used", { kind: "chat", reason: invocation.failureReason ?? "schema_invalid" });
    return attachProviderMeta(attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), invocation.usage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason: invocation.failureReason ?? "schema_invalid",
      schemaValid: false,
      retryAttempt: input.retryInstruction?.attempt ?? 0,
      retryReason: input.retryInstruction?.reason
    }), false);
  }

  const remoteAnswer: GeminiChatAnswer = {
    answer: polishChatAnswerForQuestion(
      input.question,
      stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.answer)))
    ),
    sourceIds: normalized.sourceIds,
    usedRemoteModel: normalized.usedRemoteModel,
    modelProvider: "openai",
    modelName: resolveOpenAIChatModel(env)
  };
  const recoveredWithoutUsage = recoverBroaderFallbackIfNeeded(input, remoteAnswer);
  const recovered = attachProviderMeta(attachChatDecisionMeta(attachLlmUsage(recoveredWithoutUsage, invocation.usage), {
    geminiCalled: true,
    geminiSucceeded: true,
    fallbackReason: didRecoverWithLocalFallback(remoteAnswer, recoveredWithoutUsage)
      ? remoteAnswer.sourceIds.length === 0
        ? "no_sources"
        : "weak_grounding"
      : undefined,
    schemaValid: true
  }), recoveredWithoutUsage.usedRemoteModel === true);

  const lowQualityReason = classifyLowQualityChatAnswer(input, recovered.answer, recovered.sourceIds);
  if (lowQualityReason) {
    logEvent("openai_fallback_used", { kind: "chat", reason: "low_quality_answer" });
    return attachProviderMeta(attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), invocation.usage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason: "low_quality_answer",
      schemaValid: true
    }), false, {
      modelRawAnswerPreview: recovered.answer.slice(0, 500),
      lowQualityReason
    });
  }

  return recovered;
}

function attachLlmUsage(answer: GeminiChatAnswer, usage: GeminiChatAnswer["llmUsage"]): GeminiChatAnswer {
  return usage && usage.length > 0
    ? {
        ...answer,
        llmUsage: usage,
        modelUsage: usage
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

function attachProviderMeta(
  answer: GeminiChatAnswer,
  usedRemoteModel: boolean,
  diagnostics: Pick<GeminiChatAnswer, "modelRawAnswerPreview" | "lowQualityReason"> = {}
): GeminiChatAnswer {
  return {
    ...answer,
    ...diagnostics,
    modelProvider: "openai",
    modelName: usedRemoteModel ? answer.modelName ?? answer.llmUsage?.[0]?.model ?? null : answer.modelName ?? null
  };
}

function attachOpenAIErrorDiagnostics(answer: GeminiChatAnswer): GeminiChatAnswer {
  const modelApiError = answer.modelApiError;
  if (!modelApiError) {
    return answer;
  }
  return {
    ...answer,
    geminiApiError: {
      geminiApiErrorKind: modelApiError.modelApiErrorKind,
      geminiApiErrorStatus: modelApiError.modelApiErrorStatus ?? null,
      geminiApiErrorCode: modelApiError.modelApiErrorCode ?? null,
      geminiApiErrorMessageSample: modelApiError.modelApiErrorMessageSample ?? null,
      geminiApiErrorRetryable: modelApiError.modelApiErrorRetryable,
      geminiRequestPromptCharCount: modelApiError.modelRequestPromptCharCount ?? null,
      geminiRequestEstimatedTokens: modelApiError.modelRequestEstimatedTokens ?? null,
      geminiRequestSourceCount: modelApiError.modelRequestSourceCount ?? null,
      geminiRequestContextCharCount: modelApiError.modelRequestContextCharCount ?? null,
      geminiModelName: modelApiError.modelName ?? null,
      geminiErrorOccurredBeforeResponse: modelApiError.modelErrorOccurredBeforeResponse
    }
  };
}

function didRecoverWithLocalFallback(remoteAnswer: GeminiChatAnswer, recovered: GeminiChatAnswer): boolean {
  return (
    remoteAnswer.answer !== recovered.answer ||
    remoteAnswer.sourceIds.length !== recovered.sourceIds.length ||
    remoteAnswer.sourceIds.some((sourceId, index) => recovered.sourceIds[index] !== sourceId)
  );
}
