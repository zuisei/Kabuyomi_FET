import type { Env, FilingCacheRecord, SourceChunkRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import { AppError } from "../errors";
import { logEvent } from "../logging";
import { DEFAULT_REMOTE_CONFIG, type RemoteConfig } from "../remote-config";
import { buildDeterministicMetricAnswer, shouldRecoverFromWeakModelSources } from "./deterministic";
import {
  buildSecFilingSource,
  CONTEXT_UNAVAILABLE_ANSWER,
  ensureFilingGroundedResponse,
  type ChatResponsePayload
} from "./grounding";
import { maybeBuildHistoricalChatResponseWithHydration } from "./historical";
import { maybeAppendWebSupplement } from "./web-supplement";

export async function buildChatResponse(
  filing: FilingCacheRecord,
  question: string,
  env: Env,
  config?: Partial<RemoteConfig>
): Promise<ChatResponsePayload> {
  const resolvedConfig: RemoteConfig = {
    ...DEFAULT_REMOTE_CONFIG,
    ...config
  };
  let historical = null;
  try {
    historical = await maybeBuildHistoricalChatResponseWithHydration(filing, question, env, resolvedConfig);
  } catch (error) {
    logEvent("chat_historical_answer_failed", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
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
      resolvedConfig
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
        resolvedConfig
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
      resolvedConfig
    );
}
