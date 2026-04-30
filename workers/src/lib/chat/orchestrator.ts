import type { Env, FilingCacheRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import { AppError } from "../errors";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
import { DEFAULT_REMOTE_CONFIG, type RemoteConfig } from "../remote-config";
import { buildChatContextPack, resolveContentMode } from "./context-pack";
import { buildContextDebugFields } from "./diagnostics";
import { logChatContextSelection, logChatLlmUsage, logChatPathDecision } from "./decision-log";
import { buildDeterministicMetricAnswer, shouldRecoverFromWeakModelSources } from "./deterministic";
import { buildLocalFallbackResponse } from "./fallback-response";
import {
  attachCurrentFilingSourceUrls,
  CONTEXT_UNAVAILABLE_ANSWER,
  ensureFilingGroundedResponse,
  type ChatResponseDebug,
  type ChatResponsePayload
} from "./grounding";
import { maybeBuildHistoricalChatResponseWithHydration } from "./historical";
import { classifyQuestionIntent } from "./intent";
import { retryModelAnswer } from "./model-retry";
import { attachChatDebug } from "./response-payload";
import {
  chooseRetryReason,
  fallbackReasonForMissingValidSourceIds,
  fallbackReasonForNoSources,
  shouldLetModelTryBeforeDeterministic,
  shouldPreferDeterministicBusinessOverview,
  shouldRetryModelAnswer
} from "./route-policy";
import {
  buildFallbackValidSourceIds,
  buildSourceLookup,
  mapSourceIdsToSecFilingSources,
  validateModelSources
} from "./source-validation";
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
  const timings = createChatTimingTracker();
  const logDecision = (fields: Parameters<typeof logChatPathDecision>[0]): void => {
    logChatPathDecision({
      ...fields,
      timings: timings.snapshot()
    });
  };
  const attachTimedDebug = (
    response: ChatResponsePayload,
    debug: Parameters<typeof attachChatDebug>[1]
  ): ChatResponsePayload => attachChatDebug(response, {
    ...debug,
    ...timings.snapshot()
  });
  const appendWebSupplement = (
    targetFiling: FilingCacheRecord,
    targetQuestion: string,
    response: ChatResponsePayload,
    targetEnv: Env,
    targetConfig: RemoteConfig
  ): Promise<ChatResponsePayload> =>
    timings.timeAsync("webSupplementMs", () =>
      maybeAppendWebSupplement(targetFiling, targetQuestion, response, targetEnv, targetConfig)
    );
  const attachCurrentFilingSourceUrlsTimed = (response: ChatResponsePayload): ChatResponsePayload =>
    timings.timeSync("groundingMs", () => attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl));
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
    const responseWithUrls = attachCurrentFilingSourceUrlsTimed(ensureFilingGroundedResponse(historical));
    logDecision({
      filing,
      questionIntent,
      responsePath,
      geminiCalled: false,
      geminiSucceeded: false,
      fallbackReason: null,
      schemaValid: true,
      sourceIdsValid: true,
      sourceCount: responseWithUrls.sources.length,
      contentMode
    });
    return attachTimedDebug(
      {
        ...responseWithUrls,
        responsePath
      },
      {
        questionIntent,
        responsePath,
        fallbackReason: null,
        sourceIdsValid: true,
        contentMode,
        geminiCalled: false,
        geminiSucceeded: false,
        schemaValid: true
      }
    );
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
    const response = await appendWebSupplement(
      filing,
      question,
      ensureFilingGroundedResponse(deterministic.response),
      env,
      resolvedConfig
    );
    const responseWithUrls = attachCurrentFilingSourceUrlsTimed(response);
    logDecision({
      filing,
      questionIntent,
      responsePath: "deterministic",
      geminiCalled: false,
      geminiSucceeded: false,
      fallbackReason: null,
      schemaValid: true,
      sourceIdsValid: true,
      sourceCount: responseWithUrls.sources.length,
      contentMode
    });
    return attachTimedDebug(
      {
        ...responseWithUrls,
        responsePath: "deterministic"
      },
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
  }

  let contextPack = timings.timeSync("contextBuildMs", () => buildChatContextPack(filing, questionIntent));
  logChatContextSelection(filing, contextPack);
  let modelResponse = await timings.timeAsync("geminiFirstCallMs", () =>
    generateChatAnswer(env, { filing, question, questionIntent, contextPack })
  );
  let sourceValidation = validateModelSources(modelResponse, contextPack);
  const retryReason = chooseRetryReason({
    filing,
    question,
    modelResponse,
    approvedSourceIds: sourceValidation.approvedSourceIds
  });
  if (shouldRetryModelAnswer(modelResponse, retryReason)) {
    const retryResult = await timings.timeAsync("geminiRetryMs", () => retryModelAnswer({
      filing,
      question,
      env,
      questionIntent,
      retryReason: retryReason!,
      previousModelResponse: modelResponse
    }));
    contextPack = retryResult.contextPack;
    modelResponse = retryResult.modelResponse;
    sourceValidation = validateModelSources(modelResponse, contextPack);
  }
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

    const response = await appendWebSupplement(
      filing,
      question,
      ensureFilingGroundedResponse(deterministic.response),
      env,
      resolvedConfig
    );
    const responseWithUrls = attachCurrentFilingSourceUrlsTimed(response);
    logDecision({
      filing,
      questionIntent,
      responsePath: "deterministic",
      geminiCalled: modelResponse.geminiCalled ?? true,
      geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
      fallbackReason: modelResponse.fallbackReason ?? "deterministic_repair",
      schemaValid: modelResponse.schemaValid ?? true,
      sourceIdsValid: modelSourceIdsValid,
      sourceCount: responseWithUrls.sources.length,
      contentMode,
      contextPack,
      retryAttempt: modelResponse.retryAttempt ?? 0,
      retryReason: modelResponse.retryReason ?? null,
      llmUsage: modelResponse.llmUsage
    });
    return attachTimedDebug(
      {
        ...responseWithUrls,
        responsePath: "deterministic"
      },
      {
        questionIntent,
        responsePath: "deterministic",
        fallbackReason: modelResponse.fallbackReason ?? "deterministic_repair",
        sourceIdsValid: modelSourceIdsValid,
        contentMode,
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        schemaValid: modelResponse.schemaValid ?? true,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        ...buildContextDebugFields(contextPack)
      }
    );
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

      const response = await appendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      const responseWithUrls = attachCurrentFilingSourceUrlsTimed(response);
      logDecision({
        filing,
        questionIntent,
        responsePath: "fallback",
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        fallbackReason: fallbackReasonForNoSources(modelResponse, contentMode),
        schemaValid: modelResponse.schemaValid ?? true,
        sourceIdsValid: false,
        sourceCount: responseWithUrls.sources.length,
        contentMode,
        contextPack,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        llmUsage: modelResponse.llmUsage
      });
      return attachTimedDebug(
        {
          ...responseWithUrls,
          responsePath: "fallback"
        },
        {
          questionIntent,
          responsePath: "fallback",
          fallbackReason: fallbackReasonForNoSources(modelResponse, contentMode),
          sourceIdsValid: false,
          contentMode,
          geminiCalled: modelResponse.geminiCalled ?? true,
          geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
          schemaValid: modelResponse.schemaValid ?? true,
          retryAttempt: modelResponse.retryAttempt ?? 0,
          retryReason: modelResponse.retryReason ?? null,
          ...buildContextDebugFields(contextPack)
        }
      );
    }

    logWarnEvent("chat_unsupported_due_to_source_gap", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: "model_context_unavailable"
    });
    const responsePath = modelResponse.usedRemoteModel === true ? "gemini" : "fallback";
    logChatLlmUsage(modelResponse, filing, responsePath);
    logDecision({
      filing,
      questionIntent,
      responsePath,
      geminiCalled: modelResponse.geminiCalled ?? true,
      geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
      fallbackReason: fallbackReasonForNoSources(modelResponse, contentMode),
      schemaValid: modelResponse.schemaValid ?? true,
      sourceIdsValid: false,
      sourceCount: 0,
      contentMode,
      contextPack,
      retryAttempt: modelResponse.retryAttempt ?? 0,
      retryReason: modelResponse.retryReason ?? null,
      llmUsage: modelResponse.llmUsage
    });
    return attachTimedDebug(
      {
        answer: modelResponse.answer,
        sources: [],
        responsePath
      },
      {
        questionIntent,
        responsePath,
        fallbackReason: fallbackReasonForNoSources(modelResponse, contentMode),
        sourceIdsValid: false,
        contentMode,
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        schemaValid: modelResponse.schemaValid ?? true,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        ...buildContextDebugFields(contextPack)
      }
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

      const response = await appendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      const responseWithUrls = attachCurrentFilingSourceUrlsTimed(response);
      logDecision({
        filing,
        questionIntent,
        responsePath: "fallback",
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        fallbackReason: fallbackReasonForMissingValidSourceIds(modelResponse, contentMode),
        schemaValid: modelResponse.schemaValid ?? true,
        sourceIdsValid: false,
        sourceCount: responseWithUrls.sources.length,
        contentMode,
        contextPack,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        llmUsage: modelResponse.llmUsage
      });
      return attachTimedDebug(
        {
          ...responseWithUrls,
          responsePath: "fallback"
        },
        {
          questionIntent,
          responsePath: "fallback",
          fallbackReason: fallbackReasonForMissingValidSourceIds(modelResponse, contentMode),
          sourceIdsValid: false,
          contentMode,
          geminiCalled: modelResponse.geminiCalled ?? true,
          geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
          schemaValid: modelResponse.schemaValid ?? true,
          retryAttempt: modelResponse.retryAttempt ?? 0,
          retryReason: modelResponse.retryReason ?? null,
          ...buildContextDebugFields(contextPack)
        }
      );
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

      const response = await appendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      const responseWithUrls = attachCurrentFilingSourceUrlsTimed(response);
      logDecision({
        filing,
        questionIntent,
        responsePath: "fallback",
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
        fallbackReason: "weak_grounding",
        schemaValid: modelResponse.schemaValid ?? true,
        sourceIdsValid: modelSourceIdsValid,
        sourceCount: responseWithUrls.sources.length,
        contentMode,
        contextPack,
        retryAttempt: modelResponse.retryAttempt ?? 0,
        retryReason: modelResponse.retryReason ?? null,
        llmUsage: modelResponse.llmUsage
      });
      return attachTimedDebug(
        {
          ...responseWithUrls,
          responsePath: "fallback"
        },
        {
          questionIntent,
          responsePath: "fallback",
          fallbackReason: "weak_grounding",
          sourceIdsValid: modelSourceIdsValid,
          contentMode,
          geminiCalled: modelResponse.geminiCalled ?? true,
          geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
          schemaValid: modelResponse.schemaValid ?? true,
          retryAttempt: modelResponse.retryAttempt ?? 0,
          retryReason: modelResponse.retryReason ?? null,
          ...buildContextDebugFields(contextPack)
        }
      );
    }
  }

  const responsePath = modelResponse.usedRemoteModel === true ? "gemini" : "fallback";

  logEvent("chat_path_selected", {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    path: responsePath,
    sourceCount: approvedSourceIds.length
  });
  logChatLlmUsage(modelResponse, filing, responsePath);

  const response = await appendWebSupplement(
    filing,
    question,
    ensureFilingGroundedResponse({
      answer: modelResponse.answer,
      sources: mapSourceIdsToSecFilingSources(approvedSourceIds, sourceById)
    }),
    env,
    resolvedConfig
  );
  const responseWithUrls = attachCurrentFilingSourceUrlsTimed(response);
  logDecision({
    filing,
    questionIntent,
    responsePath,
    geminiCalled: modelResponse.geminiCalled ?? true,
    geminiSucceeded: modelResponse.geminiSucceeded ?? modelResponse.usedRemoteModel === true,
    fallbackReason: modelResponse.fallbackReason ?? null,
    schemaValid: modelResponse.schemaValid ?? true,
    sourceIdsValid: modelSourceIdsValid,
    sourceCount: responseWithUrls.sources.length,
    contentMode,
    contextPack,
    retryAttempt: modelResponse.retryAttempt ?? 0,
    retryReason: modelResponse.retryReason ?? null,
    llmUsage: modelResponse.llmUsage
  });
  return attachTimedDebug(
    {
      ...responseWithUrls,
      responsePath
    },
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
      ...buildContextDebugFields(contextPack)
    }
  );
}

type ChatTimingMetric = Extract<
  keyof ChatResponseDebug,
  | "historicalLookupMs"
  | "deterministicBuildMs"
  | "contextBuildMs"
  | "geminiFirstCallMs"
  | "geminiRetryMs"
  | "fallbackBuildMs"
  | "webSupplementMs"
  | "groundingMs"
>;

type ChatTimingSnapshot = Pick<
  ChatResponseDebug,
  | "totalPipelineMs"
  | "historicalLookupMs"
  | "deterministicBuildMs"
  | "contextBuildMs"
  | "geminiFirstCallMs"
  | "geminiRetryMs"
  | "fallbackBuildMs"
  | "webSupplementMs"
  | "groundingMs"
>;

function createChatTimingTracker(): {
  add: (metric: ChatTimingMetric, ms: number) => void;
  timeSync: <T>(metric: ChatTimingMetric, work: () => T) => T;
  timeAsync: <T>(metric: ChatTimingMetric, work: () => Promise<T>) => Promise<T>;
  snapshot: () => Partial<ChatTimingSnapshot>;
} {
  const startedAt = Date.now();
  const values: Partial<Record<ChatTimingMetric, number>> = {};
  const add = (metric: ChatTimingMetric, ms: number): void => {
    values[metric] = Math.max(0, Math.round((values[metric] ?? 0) + ms));
  };

  return {
    add,
    timeSync(metric, work) {
      const stageStartedAt = Date.now();
      try {
        return work();
      } finally {
        add(metric, Date.now() - stageStartedAt);
      }
    },
    async timeAsync(metric, work) {
      const stageStartedAt = Date.now();
      try {
        return await work();
      } finally {
        add(metric, Date.now() - stageStartedAt);
      }
    },
    snapshot() {
      return {
        totalPipelineMs: Math.max(0, Date.now() - startedAt),
        ...values
      };
    }
  };
}
