import type { Env, FilingCacheRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import { AppError } from "../errors";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
import { DEFAULT_REMOTE_CONFIG, type RemoteConfig } from "../remote-config";
import { buildDeterministicMetricAnswer, shouldRecoverFromWeakModelSources } from "./deterministic";
import {
  attachCurrentFilingSourceUrls,
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
  config?: Partial<RemoteConfig>,
  options: { executionContext?: Pick<ExecutionContext, "waitUntil"> } = {}
): Promise<ChatResponsePayload> {
  const resolvedConfig: RemoteConfig = {
    ...DEFAULT_REMOTE_CONFIG,
    ...config
  };
  let historical = null;
  try {
    historical = await maybeBuildHistoricalChatResponseWithHydration(filing, question, env, resolvedConfig, options);
  } catch (error) {
    logErrorEvent("chat_historical_answer_failed", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
  if (historical) {
    const responsePath = historical.responsePath ?? (
      historical.sources.some((source) => source.sourceKind === "historical_filing") ? "historical" : "fallback"
    );
    logEvent("chat_path_selected", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      path: responsePath
    });
    const responseWithUrls = attachCurrentFilingSourceUrls(
      ensureFilingGroundedResponse(historical),
      filing.primaryDocumentUrl
    );
    return {
      ...responseWithUrls,
      responsePath
    };
  }

  const deterministic = buildDeterministicMetricAnswer(filing, question);
  const letModelTryFirst = deterministic?.strategy === "business_overview" && Boolean(env.GEMINI_API_KEY);
  if (deterministic && !letModelTryFirst) {
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
    const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
    return {
      ...responseWithUrls,
      responsePath: "deterministic"
    };
  }

  const modelResponse = await generateChatAnswer(env, { filing, question });
  const validSourceIds = new Set(filing.sourceChunks.map((chunk) => chunk.sourceId));
  const approvedSourceIds = modelResponse.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

  if (
    deterministic?.strategy === "business_overview" &&
    shouldPreferDeterministicBusinessOverview(modelResponse.answer, modelResponse.usedRemoteModel === true)
  ) {
    logWarnEvent("chat_grounding_repair_used", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: modelResponse.usedRemoteModel === true ? "weak_business_overview_answer" : "business_overview_remote_fallback"
    });
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
    const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
    return {
      ...responseWithUrls,
      responsePath: "deterministic"
    };
  }

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
      const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
      return {
        ...responseWithUrls,
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
      const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
      return {
        ...responseWithUrls,
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
      const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
      return {
        ...responseWithUrls,
        responsePath: "fallback"
      };
    }
  }

  const responsePath = modelResponse.usedRemoteModel === true ? "gemini" : "fallback";

  logEvent("chat_path_selected", {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    path: responsePath,
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
  const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
  return {
    ...responseWithUrls,
    responsePath
  };
}

function shouldPreferDeterministicBusinessOverview(answer: string, usedRemoteModel: boolean): boolean {
  if (!usedRemoteModel) {
    return true;
  }

  return (
    answer === CONTEXT_UNAVAILABLE_ANSWER ||
    /売上高は|revenue|net sales|前年同期比|一般的な注意書き|案内文|材料としては弱め/i.test(answer) ||
    /historically experienced higher net sales|forward-looking statements|available information|investor relations website/i.test(
      answer
    )
  );
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
