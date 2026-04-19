import type { Env, FilingCacheRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import { AppError } from "../errors";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
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
    logErrorEvent("chat_historical_answer_failed", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
  if (historical) {
    logEvent("chat_path_selected", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      path: "historical"
    });
    return {
      ...ensureFilingGroundedResponse(historical),
      responsePath: "historical"
    };
  }

  const deterministic = buildDeterministicMetricAnswer(filing, question);
  if (deterministic) {
    logEvent("chat_path_selected", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      path: "deterministic",
      strategy: deterministic.strategy
    });
    const response = await maybeAppendWebSupplement(
      filing,
      question,
      ensureFilingGroundedResponse(deterministic.response),
      env,
      resolvedConfig
    );
    return {
      ...response,
      responsePath: "deterministic"
    };
  }

  const modelResponse = await generateChatAnswer(env, { filing, question });
  const validSourceIds = new Set(filing.sourceChunks.map((chunk) => chunk.sourceId));
  const approvedSourceIds = modelResponse.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

  if (approvedSourceIds.length !== modelResponse.sourceIds.length) {
    logWarnEvent("chat_grounding_repair_used", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "filtered_invalid_source_ids",
      droppedSourceCount: modelResponse.sourceIds.length - approvedSourceIds.length
    });
  }

  if (approvedSourceIds.length === 0 && modelResponse.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    const recovered = await buildFallbackResponse(filing, question, env, validSourceIds);
    if (recovered) {
      logWarnEvent("chat_grounding_repair_used", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        reason: "model_context_unavailable_recovered"
      });
      logEvent("chat_path_selected", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        path: "fallback",
        reason: "model_context_unavailable"
      });

      const response = await maybeAppendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      return {
        ...response,
        responsePath: "fallback"
      };
    }

    logWarnEvent("chat_unsupported_due_to_source_gap", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "model_context_unavailable"
    });
    return {
      answer: modelResponse.answer,
      sources: [],
      responsePath: modelResponse.usedRemoteModel === true ? "gemini" : "fallback"
    };
  }

  if (approvedSourceIds.length === 0) {
    const recovered = await buildFallbackResponse(filing, question, env, validSourceIds);
    if (recovered) {
      logWarnEvent("chat_grounding_repair_used", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        reason: "missing_valid_source_ids"
      });
      logEvent("chat_path_selected", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        path: "fallback",
        reason: "missing_valid_source_ids"
      });

      const response = await maybeAppendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      return {
        ...response,
        responsePath: "fallback"
      };
    }

    throw new AppError(502, "Chat response is temporarily unavailable", "Model returned no valid sourceIds");
  }

  if (shouldRecoverFromWeakModelSources(filing, question, approvedSourceIds)) {
    const recovered = await buildFallbackResponse(filing, question, env, validSourceIds);
    if (recovered) {
      logWarnEvent("chat_grounding_repair_used", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        reason: "weak_model_sources"
      });
      logEvent("chat_path_selected", {
        filingKey: filing.filingKey,
        ticker: filing.ticker,
        path: "fallback",
        reason: "weak_model_sources"
      });

      const response = await maybeAppendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      return {
        ...response,
        responsePath: "fallback"
      };
    }
  }

  logEvent("chat_path_selected", {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    path: "gemini",
    sourceCount: approvedSourceIds.length
  });

  const response = await maybeAppendWebSupplement(
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
  return {
    ...response,
    responsePath: modelResponse.usedRemoteModel === true ? "gemini" : "fallback"
  };
}

async function buildFallbackResponse(
  filing: FilingCacheRecord,
  question: string,
  env: Env,
  validSourceIds: Set<string>
): Promise<ChatResponsePayload | null> {
  const fallback = await generateChatAnswer({ ...env, GEMINI_API_KEY: undefined } as Env, { filing, question });
  const approvedSourceIds = fallback.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

  if (approvedSourceIds.length === 0) {
    return null;
  }

  return {
    answer: fallback.answer,
    sources: approvedSourceIds.map((sourceId) => {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId)!;
      return buildSecFilingSource(source);
    })
  };
}
