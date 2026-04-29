import type { Env, FilingCacheRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import type { ChatFallbackReason, GeminiChatAnswer } from "../../clients/gemini/types";
import { AppError } from "../errors";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
import { DEFAULT_REMOTE_CONFIG, type RemoteConfig } from "../remote-config";
import { buildChatContextPack, type ChatContextPack, resolveContentMode } from "./context-pack";
import { buildContextDebugFields } from "./diagnostics";
import { logChatContextSelection, logChatLlmUsage, logChatPathDecision } from "./decision-log";
import { buildDeterministicMetricAnswer, shouldRecoverFromWeakModelSources } from "./deterministic";
import {
  attachCurrentFilingSourceUrls,
  type ChatResponseDebug,
  CONTEXT_UNAVAILABLE_ANSWER,
  ensureFilingGroundedResponse,
  type ChatResponsePayload
} from "./grounding";
import { maybeBuildHistoricalChatResponseWithHydration } from "./historical";
import { classifyQuestionIntent, type QuestionIntent } from "./intent";
import {
  chooseRetryReason,
  combineLlmUsage,
  fallbackReasonForMissingValidSourceIds,
  fallbackReasonForNoSources,
  retryContextMode,
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
  const questionIntent = classifyQuestionIntent(question);
  const contentMode = resolveContentMode(filing);
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
    logChatPathDecision({
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
    return attachChatDebug(
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

  const deterministic = buildDeterministicMetricAnswer(filing, question);
  const letModelTryFirst = shouldLetModelTryBeforeDeterministic(env, deterministic);
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
    logChatPathDecision({
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
    return attachChatDebug(
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

  let contextPack = buildChatContextPack(filing, questionIntent);
  logChatContextSelection(filing, contextPack);
  let modelResponse = await generateChatAnswer(env, { filing, question, questionIntent, contextPack });
  let sourceValidation = validateModelSources(modelResponse, contextPack);
  const retryReason = chooseRetryReason({
    filing,
    question,
    modelResponse,
    approvedSourceIds: sourceValidation.approvedSourceIds
  });
  if (shouldRetryModelAnswer(modelResponse, retryReason)) {
    const retryResult = await retryModelAnswer({
      filing,
      question,
      env,
      questionIntent,
      retryReason: retryReason!,
      previousModelResponse: modelResponse
    });
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

    const response = await maybeAppendWebSupplement(
      filing,
      question,
      ensureFilingGroundedResponse(deterministic.response),
      env,
      resolvedConfig
    );
    const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
    logChatPathDecision({
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
    return attachChatDebug(
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
    const recovered = await buildFallbackResponse(filing, question, env, fallbackValidSourceIds, contextPack);
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

      const response = await maybeAppendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
      logChatPathDecision({
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
      return attachChatDebug(
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
    logChatPathDecision({
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
    return attachChatDebug(
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
    const recovered = await buildFallbackResponse(filing, question, env, fallbackValidSourceIds, contextPack);
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

      const response = await maybeAppendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
      logChatPathDecision({
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
      return attachChatDebug(
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

    logChatPathDecision({
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
    const recovered = await buildFallbackResponse(filing, question, env, fallbackValidSourceIds, contextPack);
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

      const response = await maybeAppendWebSupplement(
        filing,
        question,
        ensureFilingGroundedResponse(recovered),
        env,
        resolvedConfig
      );
      const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
      logChatPathDecision({
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
      return attachChatDebug(
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

  const response = await maybeAppendWebSupplement(
    filing,
    question,
    ensureFilingGroundedResponse({
      answer: modelResponse.answer,
      sources: mapSourceIdsToSecFilingSources(approvedSourceIds, sourceById)
    }),
    env,
    resolvedConfig
  );
  const responseWithUrls = attachCurrentFilingSourceUrls(response, filing.primaryDocumentUrl);
  logChatPathDecision({
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
  return attachChatDebug(
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

async function retryModelAnswer({
  filing,
  question,
  env,
  questionIntent,
  retryReason,
  previousModelResponse
}: {
  filing: FilingCacheRecord;
  question: string;
  env: Env;
  questionIntent: QuestionIntent;
  retryReason: ChatFallbackReason;
  previousModelResponse: GeminiChatAnswer;
}): Promise<{ contextPack: ChatContextPack; modelResponse: GeminiChatAnswer }> {
  const contextPack = buildChatContextPack(filing, questionIntent, {
    mode: retryContextMode(retryReason),
    retryReason
  });
  logChatContextSelection(filing, contextPack, {
    retryAttempt: 1,
    retryReason
  });
  logEvent("chat_model_retry", {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    questionIntent,
    retryAttempt: 1,
    retryReason,
    contextTokenBudget: contextPack.contextTokenBudget,
    selectedSourceCount: contextPack.selectedSourceCount,
    selectedSourceCharCount: contextPack.selectionDiagnostics.selectedSourceCharCount,
    estimatedContextTokens: contextPack.selectionDiagnostics.estimatedContextTokens,
    sourceSelectionStrategy: contextPack.sourceSelectionStrategy,
    selectedSourceIds: contextPack.sourceChunks.map((source) => source.sourceId),
    selectedSourceLabels: contextPack.sourceChunks.map((source) => source.sourceLabel)
  });
  const modelResponse = await generateChatAnswer(env, {
    filing,
    question,
    questionIntent,
    contextPack,
    retryInstruction: {
      attempt: 1,
      reason: retryReason
    }
  });

  return {
    contextPack,
    modelResponse: {
      ...modelResponse,
      llmUsage: combineLlmUsage(previousModelResponse.llmUsage, modelResponse.llmUsage),
      retryAttempt: modelResponse.retryAttempt ?? 1,
      retryReason: modelResponse.retryReason ?? retryReason
    }
  };
}

async function buildFallbackResponse(
  filing: FilingCacheRecord,
  question: string,
  env: Env,
  validSourceIds: Set<string>,
  contextPack?: ChatContextPack
): Promise<ChatResponsePayload | null> {
  const fallback = await generateChatAnswer(
    { ...env, GEMINI_API_KEY: undefined } as Env,
    { filing, question, questionIntent: contextPack?.questionIntent, contextPack }
  );
  const approvedSourceIds = fallback.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

  if (approvedSourceIds.length === 0) {
    if (fallback.answer === CONTEXT_UNAVAILABLE_ANSWER) {
      return {
        answer: fallback.answer,
        sources: []
      };
    }

    return null;
  }

  const sourceById = buildSourceLookup(filing, contextPack);
  return {
    answer: fallback.answer,
    sources: mapSourceIdsToSecFilingSources(approvedSourceIds, sourceById)
  };
}

function attachChatDebug(response: ChatResponsePayload, debug: Omit<ChatResponseDebug, "sourceCount" | "sourceIds">): ChatResponsePayload {
  return {
    ...response,
    debug: {
      ...debug,
      sourceCount: response.sources.length,
      sourceIds: response.sources.map((source) => source.sourceId)
    }
  };
}
