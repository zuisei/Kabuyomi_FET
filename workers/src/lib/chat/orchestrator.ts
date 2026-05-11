import type { Env, FilingCacheRecord } from "../../env";
import type { GeminiChatAnswer } from "../../clients/gemini/types";
import { AppError } from "../errors";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
import { DEFAULT_REMOTE_CONFIG, type RemoteConfig } from "../remote-config";
import { resolveContentMode } from "./context-pack";
import { buildContextDebugFields, buildModelAttemptDebugFields } from "./diagnostics";
import { logChatLlmUsage, logChatPathDecision } from "./decision-log";
import { buildDeterministicMetricAnswer, shouldRecoverFromWeakModelSources } from "./deterministic";
import { buildLocalFallbackResponse } from "./fallback-response";
import {
  CONTEXT_UNAVAILABLE_ANSWER,
  type ChatResponsePayload
} from "./grounding";
import { maybeBuildHistoricalChatResponseWithHydration } from "./historical";
import { classifyQuestionIntent } from "./intent";
import { buildValidatedModelAnswer } from "./model-attempt";
import { finalizeChatResponse } from "./response-finalizer";
import {
  fallbackReasonForMissingValidSourceIds,
  fallbackReasonForNoSources,
  shouldLetModelTryBeforeDeterministic,
  shouldPreferDeterministicBusinessOverview
} from "./route-policy";
import {
  buildFallbackValidSourceIds,
  buildSourceLookup,
  mapSourceIdsToSecFilingSources
} from "./source-validation";
import { createChatTimingTracker } from "./timing";

export async function buildChatResponse(
  filing: FilingCacheRecord,
  question: string,
  env: Env,
  config?: Partial<RemoteConfig>,
  options: {
    executionContext?: Pick<ExecutionContext, "waitUntil">;
    followupContext?: {
      previousQuestion?: string;
      previousAnswer?: string;
    };
    conversationContextSummary?: string;
  } = {}
): Promise<ChatResponsePayload> {
  const resolvedConfig: RemoteConfig = {
    ...DEFAULT_REMOTE_CONFIG,
    ...config
  };
  const timings = createChatTimingTracker();
  const logDecision = (fields: Parameters<typeof logChatPathDecision>[0]): void => {
    logChatPathDecision({
      ...fields,
      timings: timings.snapshot()
    });
  };
  const finalize = (
    response: ChatResponsePayload,
    responsePath: Parameters<typeof finalizeChatResponse>[0]["responsePath"],
    debug: Parameters<typeof finalizeChatResponse>[0]["debug"],
    options: Pick<Parameters<typeof finalizeChatResponse>[0], "includeWebSupplement" | "attachSourceUrls"> = {}
  ): Promise<ChatResponsePayload> => finalizeChatResponse({
    filing,
    question,
    response,
    responsePath,
    debug,
    env,
    config: resolvedConfig,
    timings,
    ...options
  });
  const resolveRemoteResponsePath = (modelResponse: GeminiChatAnswer): Parameters<typeof finalizeChatResponse>[0]["responsePath"] => {
    if (modelResponse.usedRemoteModel !== true) {
      return "fallback";
    }
    return modelResponse.modelProvider === "openai" ? "openai" : "gemini";
  };
  const questionIntent = classifyQuestionIntent(question);
  const contentMode = resolveContentMode(filing);
  let historical = null;
  try {
    const historicalStartedAt = Date.now();
    historical = await maybeBuildHistoricalChatResponseWithHydration(filing, question, env, resolvedConfig, options);
    timings.add("historicalLookupMs", Date.now() - historicalStartedAt);
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
    const finalResponse = await finalize(
      historical,
      responsePath,
      {
        questionIntent,
        responsePath,
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode,
        geminiCalled: false,
        geminiSucceeded: false,
        schemaValid: true
      },
      { includeWebSupplement: false }
    );
    logDecision({
      filing,
      questionIntent,
      responsePath,
      geminiCalled: false,
      geminiSucceeded: false,
      fallbackReason: null,
      schemaValid: true,
      sourceIdsValid: true,
      sourceCount: finalResponse.sources.length,
      contentMode
    });
    return finalResponse;
  }

  const deterministic = timings.timeSync("deterministicBuildMs", () => buildDeterministicMetricAnswer(filing, question));
  const letModelTryFirst = shouldLetModelTryBeforeDeterministic(env, deterministic);
  if (deterministic && !letModelTryFirst) {
    logEvent("chat_path_selected", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      path: "deterministic",
      strategy: deterministic.strategy
    });
    const finalResponse = await finalize(
      deterministic.response,
      "deterministic",
      {
        questionIntent,
        responsePath: "deterministic",
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode,
        geminiCalled: false,
        geminiSucceeded: false,
        schemaValid: true
      }
    );
    logDecision({
      filing,
      questionIntent,
      responsePath: "deterministic",
      geminiCalled: false,
      geminiSucceeded: false,
      fallbackReason: null,
      schemaValid: true,
      sourceIdsValid: true,
      sourceCount: finalResponse.sources.length,
      contentMode
    });
    return finalResponse;
  }

  const modelAttempt = await buildValidatedModelAnswer({
    filing,
    question,
    env,
    questionIntent,
    timings,
    previousQuestion: options.followupContext?.previousQuestion,
    previousAnswer: options.followupContext?.previousAnswer,
    conversationContextSummary: options.conversationContextSummary
  });
  const { contextPack, modelResponse, sourceValidation } = modelAttempt;
  const fallbackValidSourceIds = buildFallbackValidSourceIds(filing, contextPack);
  const sourceById = buildSourceLookup(filing, contextPack);
  const approvedSourceIds = sourceValidation.approvedSourceIds;
  const modelSourceIdsValid = sourceValidation.modelSourceIdsValid;

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
    logChatLlmUsage(modelResponse, filing, "deterministic");

    const finalResponse = await finalize(
      deterministic.response,
      "deterministic",
      {
        questionIntent,
        responsePath: "deterministic",
        fallbackReason: modelResponse.fallbackReason ?? "deterministic_repair",
        sourceIdsValid: deterministic.response.sources.length > 0,
        contentMode,
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        schemaValid: modelResponse.schemaValid ?? true,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        ...buildModelAttemptDebugFields(modelResponse),
        ...buildContextDebugFields(contextPack)
      }
    );
    logDecision({
      filing,
      questionIntent,
      responsePath: "deterministic",
      geminiCalled: modelResponse.geminiCalled ?? true,
      geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
      fallbackReason: modelResponse.fallbackReason ?? "deterministic_repair",
      schemaValid: modelResponse.schemaValid ?? true,
      sourceIdsValid: finalResponse.sources.length > 0,
      sourceCount: finalResponse.sources.length,
      contentMode,
      contextPack,
      retryAttempt: modelResponse.retryAttempt ?? 0,
      retryReason: modelResponse.retryReason ?? null,
      llmUsage: modelResponse.llmUsage
    });
    return finalResponse;
  }

  if (approvedSourceIds.length !== modelResponse.sourceIds.length) {
    logWarnEvent("chat_grounding_repair_used", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "filtered_invalid_source_ids",
      droppedSourceCount: modelResponse.sourceIds.length - approvedSourceIds.length
    });
  }

  if (!modelSourceIdsValid && approvedSourceIds.length > 0) {
    const recovered = await timings.timeAsync("fallbackBuildMs", () => buildLocalFallbackResponse({
      filing,
      question,
      env,
      validSourceIds: fallbackValidSourceIds,
      contextPack
    }));
    const fallbackResponse = recovered ?? {
      answer: "選択された資料だけでは、この回答の根拠を安全に確認できません。回答に使う資料IDが不正だったため、確認できる資料だけに基づく回答へ切り替えます。",
      sources: mapSourceIdsToSecFilingSources(approvedSourceIds.slice(0, 2), sourceById)
    };
    const repairedSourceIdsValid = fallbackResponse.sources.length > 0;

    logWarnEvent("chat_grounding_repair_used", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "invalid_source_ids_guarded_fallback",
      recoveredByLocalFallback: recovered != null
    });
    logEvent("chat_path_selected", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      path: "fallback",
      reason: "invalid_source_id"
    });
    logChatLlmUsage(modelResponse, filing, "fallback");

    const finalResponse = await finalize(
      fallbackResponse,
      "fallback",
      {
        questionIntent,
        responsePath: "fallback",
        fallbackReason: "invalid_source_id",
        sourceIdsValid: repairedSourceIdsValid,
        contentMode,
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        schemaValid: modelResponse.schemaValid ?? true,
        fallbackKind: recovered ? "evidence_slot" : "weak_grounding",
        fallbackKindSource: "orchestrator",
        sourceRepairLabels: repairedSourceIdsValid
          ? ["invalid_sources", "fallback_source_repaired", "source_ids_invalid_prevented"]
          : ["invalid_sources", "no_final_sources"],
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        ...buildModelAttemptDebugFields(modelResponse),
        ...buildContextDebugFields(contextPack)
      }
    );
    logDecision({
      filing,
      questionIntent,
      responsePath: "fallback",
      geminiCalled: modelResponse.geminiCalled ?? true,
      geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
      fallbackReason: "invalid_source_id",
      schemaValid: modelResponse.schemaValid ?? true,
      sourceIdsValid: repairedSourceIdsValid,
      sourceCount: finalResponse.sources.length,
      contentMode,
      contextPack,
      retryAttempt: modelResponse.retryAttempt ?? 0,
      retryReason: modelResponse.retryReason ?? null,
      llmUsage: modelResponse.llmUsage
    });
    return finalResponse;
  }

  if (approvedSourceIds.length === 0 && modelResponse.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    const recovered = await timings.timeAsync("fallbackBuildMs", () => buildLocalFallbackResponse({
      filing,
      question,
      env,
      validSourceIds: fallbackValidSourceIds,
      contextPack
    }));
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
      logChatLlmUsage(modelResponse, filing, "fallback");

      const fallbackReason = fallbackReasonForNoSources(modelResponse, contentMode);
      const repairedSourceIdsValid = recovered.sources.length > 0;
      const finalResponse = await finalize(
        recovered,
        "fallback",
        {
          questionIntent,
          responsePath: "fallback",
          fallbackReason,
          sourceIdsValid: repairedSourceIdsValid,
          contentMode,
          geminiCalled: modelResponse.geminiCalled ?? true,
          geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
          schemaValid: modelResponse.schemaValid ?? true,
          fallbackKind: "context_unavailable",
          fallbackKindSource: "orchestrator",
          sourceRepairLabels: repairedSourceIdsValid
            ? ["context_unavailable_fallback", "fallback_source_repaired", "source_ids_invalid_prevented"]
            : ["context_unavailable_fallback", "no_final_sources"],
          retryAttempt: modelResponse.retryAttempt ?? 0,
          retryReason: modelResponse.retryReason ?? null,
          ...buildModelAttemptDebugFields(modelResponse),
          ...buildContextDebugFields(contextPack)
        }
      );
      logDecision({
        filing,
        questionIntent,
        responsePath: "fallback",
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        fallbackReason,
        schemaValid: modelResponse.schemaValid ?? true,
        sourceIdsValid: repairedSourceIdsValid,
        sourceCount: finalResponse.sources.length,
        contentMode,
        contextPack,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        llmUsage: modelResponse.llmUsage
      });
      return finalResponse;
    }

    logWarnEvent("chat_unsupported_due_to_source_gap", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "model_context_unavailable"
    });
    const responsePath = resolveRemoteResponsePath(modelResponse);
    const repairedSources = mapSourceIdsToSecFilingSources([...fallbackValidSourceIds].slice(0, 2), sourceById);
    const repairedSourceIdsValid = repairedSources.length > 0;
    logChatLlmUsage(modelResponse, filing, responsePath);
    logDecision({
      filing,
      questionIntent,
      responsePath,
      geminiCalled: modelResponse.geminiCalled ?? true,
      geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
      fallbackReason: fallbackReasonForNoSources(modelResponse, contentMode),
      schemaValid: modelResponse.schemaValid ?? true,
      sourceIdsValid: repairedSourceIdsValid,
      sourceCount: repairedSources.length,
      contentMode,
      contextPack,
      retryAttempt: modelResponse.retryAttempt ?? 0,
      retryReason: modelResponse.retryReason ?? null,
      llmUsage: modelResponse.llmUsage
    });
    return finalize(
      {
        answer: modelResponse.answer,
        sources: repairedSources,
        responsePath
      },
      responsePath,
      {
        questionIntent,
        responsePath,
        fallbackReason: fallbackReasonForNoSources(modelResponse, contentMode),
        sourceIdsValid: repairedSourceIdsValid,
        contentMode,
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        schemaValid: modelResponse.schemaValid ?? true,
        fallbackKind: "context_unavailable",
        fallbackKindSource: "orchestrator",
        sourceRepairLabels: repairedSourceIdsValid
          ? ["context_unavailable_fallback", "fallback_source_repaired", "source_ids_invalid_prevented"]
          : ["context_unavailable_fallback", "no_final_sources"],
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        ...buildModelAttemptDebugFields(modelResponse),
        ...buildContextDebugFields(contextPack)
      },
      { includeWebSupplement: false, attachSourceUrls: false }
    );
  }

  if (approvedSourceIds.length === 0) {
    const recovered = await timings.timeAsync("fallbackBuildMs", () => buildLocalFallbackResponse({
      filing,
      question,
      env,
      validSourceIds: fallbackValidSourceIds,
      contextPack
    }));
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
      logChatLlmUsage(modelResponse, filing, "fallback");

      const fallbackReason = fallbackReasonForMissingValidSourceIds(modelResponse, contentMode);
      const repairedSourceIdsValid = recovered.sources.length > 0;
      const finalResponse = await finalize(
        recovered,
        "fallback",
        {
          questionIntent,
          responsePath: "fallback",
          fallbackReason,
          sourceIdsValid: repairedSourceIdsValid,
          contentMode,
          geminiCalled: modelResponse.geminiCalled ?? true,
          geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
          schemaValid: modelResponse.schemaValid ?? true,
          fallbackKind: "context_unavailable",
          fallbackKindSource: "orchestrator",
          sourceRepairLabels: repairedSourceIdsValid
            ? ["fallback_source_repaired", "source_ids_invalid_prevented"]
            : ["no_final_sources"],
          retryAttempt: modelResponse.retryAttempt ?? 0,
          retryReason: modelResponse.retryReason ?? null,
          ...buildModelAttemptDebugFields(modelResponse),
          ...buildContextDebugFields(contextPack)
        }
      );
      logDecision({
        filing,
        questionIntent,
        responsePath: "fallback",
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        fallbackReason,
        schemaValid: modelResponse.schemaValid ?? true,
        sourceIdsValid: repairedSourceIdsValid,
        sourceCount: finalResponse.sources.length,
        contentMode,
        contextPack,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        llmUsage: modelResponse.llmUsage
      });
      return finalResponse;
    }

    logDecision({
      filing,
      questionIntent,
      responsePath: "fallback",
      geminiCalled: modelResponse.geminiCalled ?? true,
      geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
      fallbackReason: fallbackReasonForMissingValidSourceIds(modelResponse, contentMode),
      schemaValid: modelResponse.schemaValid ?? true,
      sourceIdsValid: false,
      sourceCount: 0,
      contentMode,
      contextPack,
      retryAttempt: modelResponse.retryAttempt ?? 0,
      retryReason: modelResponse.retryReason ?? null,
      llmUsage: modelResponse.llmUsage
    });
    throw new AppError(502, "Chat response is temporarily unavailable", "Model returned no valid sourceIds");
  }

  if (shouldRecoverFromWeakModelSources(filing, question, approvedSourceIds)) {
    const recovered = await timings.timeAsync("fallbackBuildMs", () => buildLocalFallbackResponse({
      filing,
      question,
      env,
      validSourceIds: fallbackValidSourceIds,
      contextPack
    }));
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
      logChatLlmUsage(modelResponse, filing, "fallback");

      const finalResponse = await finalize(
        recovered,
        "fallback",
        {
          questionIntent,
          responsePath: "fallback",
          fallbackReason: "weak_grounding",
          sourceIdsValid: modelSourceIdsValid,
          contentMode,
          geminiCalled: modelResponse.geminiCalled ?? true,
          geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
          schemaValid: modelResponse.schemaValid ?? true,
          fallbackKind: "weak_grounding",
          fallbackKindSource: "orchestrator",
          retryAttempt: modelResponse.retryAttempt ?? 0,
          retryReason: modelResponse.retryReason ?? null,
          ...buildModelAttemptDebugFields(modelResponse),
          ...buildContextDebugFields(contextPack)
        }
      );
      logDecision({
        filing,
        questionIntent,
        responsePath: "fallback",
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        fallbackReason: "weak_grounding",
        schemaValid: modelResponse.schemaValid ?? true,
        sourceIdsValid: modelSourceIdsValid,
        sourceCount: finalResponse.sources.length,
        contentMode,
        contextPack,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        llmUsage: modelResponse.llmUsage
      });
      return finalResponse;
    }
  }

  const responsePath = resolveRemoteResponsePath(modelResponse);

  logEvent("chat_path_selected", {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    path: responsePath,
    sourceCount: approvedSourceIds.length
  });
  logChatLlmUsage(modelResponse, filing, responsePath);

  const finalResponse = await finalize(
    {
      answer: modelResponse.answer,
      sources: mapSourceIdsToSecFilingSources(approvedSourceIds, sourceById)
    },
    responsePath,
    {
      questionIntent,
      responsePath,
      fallbackReason: modelResponse.fallbackReason ?? null,
      sourceIdsValid: modelSourceIdsValid,
      contentMode,
      geminiCalled: modelResponse.geminiCalled ?? true,
      geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
      schemaValid: modelResponse.schemaValid ?? true,
      retryAttempt: modelResponse.retryAttempt ?? 0,
      retryReason: modelResponse.retryReason ?? null,
      ...buildModelAttemptDebugFields(modelResponse),
      ...buildContextDebugFields(contextPack)
    }
  );
  logDecision({
    filing,
    questionIntent,
    responsePath,
    geminiCalled: modelResponse.geminiCalled ?? true,
    geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
    fallbackReason: modelResponse.fallbackReason ?? null,
    schemaValid: modelResponse.schemaValid ?? true,
    sourceIdsValid: modelSourceIdsValid,
    sourceCount: finalResponse.sources.length,
    contentMode,
    contextPack,
    retryAttempt: modelResponse.retryAttempt ?? 0,
    retryReason: modelResponse.retryReason ?? null,
    llmUsage: modelResponse.llmUsage
  });
  return finalResponse;
}
