import type { Env, FilingCacheRecord, SourceChunkRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import { AppError } from "../errors";
import { maybeBuildHistoricalChatResponse } from "../history-store";
import { logEvent } from "../logging";
import type { RemoteConfig } from "../remote-config";
import { buildDeterministicMetricAnswer, shouldRecoverFromWeakModelSources } from "./deterministic";
import {
  buildSecFilingSource,
  CONTEXT_UNAVAILABLE_ANSWER,
  ensureFilingGroundedResponse,
  type ChatResponsePayload
} from "./grounding";
import { maybeAppendWebSupplement } from "./web-supplement";

export async function buildChatResponse(
  filing: FilingCacheRecord,
  question: string,
  env: Env,
  config?: Pick<RemoteConfig, "webSupplementEnabled">
): Promise<ChatResponsePayload> {
  const historical = await maybeBuildHistoricalChatResponse(filing, question, env);
  if (historical) {
    logEvent("chat_historical_answer_used", {
      filingKey: filing.filingKey,
      ticker: filing.ticker
    });
    return ensureFilingGroundedResponse(historical);
  }

  const deterministic = buildDeterministicMetricAnswer(filing, question);
  if (deterministic) {
    logEvent("chat_deterministic_answer_used", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      strategy: deterministic.strategy
    });
    return maybeAppendWebSupplement(
      filing,
      question,
      ensureFilingGroundedResponse(deterministic.response),
      env,
      config
    );
  }

  const modelResponse = await generateChatAnswer(env, { filing, question });
  const validSourceIds = new Set(filing.sourceChunks.map((chunk) => chunk.sourceId));
  const approvedSourceIds = modelResponse.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

  if (approvedSourceIds.length !== modelResponse.sourceIds.length) {
    logEvent("chat_grounding_repair_used", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "filtered_invalid_source_ids",
      droppedSourceCount: modelResponse.sourceIds.length - approvedSourceIds.length
    });
  }

  if (approvedSourceIds.length === 0 && modelResponse.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    logEvent("chat_unsupported_due_to_source_gap", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "model_context_unavailable"
    });
    return {
      answer: modelResponse.answer,
      sources: []
    };
  }

  if (approvedSourceIds.length === 0) {
    throw new AppError(502, "Chat response is temporarily unavailable", "Model returned no valid sourceIds");
  }

  if (shouldRecoverFromWeakModelSources(filing, question, approvedSourceIds)) {
    const fallback = await generateChatAnswer({ ...env, GEMINI_API_KEY: undefined } as Env, { filing, question });
    const fallbackApprovedSourceIds = fallback.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

    if (fallbackApprovedSourceIds.length > 0) {
      logEvent("chat_grounding_repair_used", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        reason: "weak_model_sources"
      });

      return maybeAppendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse({
          answer: fallback.answer,
          sources: fallbackApprovedSourceIds.map((sourceId) => {
            const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId)!;
            return buildSecFilingSource(source);
          })
        }),
        env,
        config
      );
    }
  }

  return maybeAppendWebSupplement(
    filing,
    question,
    ensureFilingGroundedResponse({
      answer: modelResponse.answer,
      sources: approvedSourceIds.map((sourceId) => {
        const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId)!;
        return buildSecFilingSource(source);
      })
    }),
    env,
    config
  );
}
