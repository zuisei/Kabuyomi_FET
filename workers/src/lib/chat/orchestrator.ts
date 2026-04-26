import type { Env, FilingCacheRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import type { ChatFallbackReason, GeminiChatAnswer, GeminiInvocationUsage } from "../../clients/gemini/types";
import { AppError } from "../errors";
import { logLlmUsage } from "../llm-usage";
import { logErrorEvent, logEvent, logWarnEvent } from "../logging";
import { DEFAULT_REMOTE_CONFIG, type RemoteConfig } from "../remote-config";
import { buildChatContextPack, type ChatContextPack, resolveContentMode } from "./context-pack";
import { buildDeterministicMetricAnswer, shouldRecoverFromWeakModelSources } from "./deterministic";
import {
  attachCurrentFilingSourceUrls,
  buildSecFilingSource,
  type ChatResponsePath,
  CONTEXT_UNAVAILABLE_ANSWER,
  ensureFilingGroundedResponse,
  type ChatResponsePayload
} from "./grounding";
import { maybeBuildHistoricalChatResponseWithHydration } from "./historical";
import { classifyQuestionIntent, type QuestionIntent } from "./intent";
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
    return {
      ...responseWithUrls,
      responsePath: "deterministic"
    };
  }

  let contextPack = buildChatContextPack(filing, questionIntent);
  logChatContextSelection(filing, contextPack);
  let modelResponse = await generateChatAnswer(env, { filing, question, questionIntent, contextPack });
  let sourceValidation = validateModelSources(modelResponse, contextPack);
  const retryReason = chooseRetryReason(filing, question, modelResponse, sourceValidation.approvedSourceIds);
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
  const fallbackValidSourceIds = new Set([
    ...filing.sourceChunks.map((chunk) => chunk.sourceId),
    ...contextPack.sourceChunks.map((chunk) => chunk.sourceId)
  ]);
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
    return {
      answer: modelResponse.answer,
      sources: [],
      responsePath
    };
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
      return {
        ...responseWithUrls,
        responsePath: "fallback"
      };
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
  logChatLlmUsage(modelResponse, filing, responsePath);

  const response = await maybeAppendWebSupplement(
    filing,
    question,
    ensureFilingGroundedResponse({
      answer: modelResponse.answer,
      sources: approvedSourceIds.map((sourceId) => {
        const source = sourceById.get(sourceId)!;
        return buildSecFilingSource(source);
      })
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
  return {
    ...responseWithUrls,
    responsePath
  };
}

function validateModelSources(
  modelResponse: GeminiChatAnswer,
  contextPack: ChatContextPack
): { approvedSourceIds: string[]; modelSourceIdsValid: boolean } {
  const validSourceIds = new Set(contextPack.sourceChunks.map((chunk) => chunk.sourceId));
  const approvedSourceIds = modelResponse.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));
  return {
    approvedSourceIds,
    modelSourceIdsValid: modelResponse.sourceIds.length > 0 && approvedSourceIds.length === modelResponse.sourceIds.length
  };
}

function chooseRetryReason(
  filing: FilingCacheRecord,
  question: string,
  modelResponse: GeminiChatAnswer,
  approvedSourceIds: string[]
): ChatFallbackReason | null {
  if (modelResponse.fallbackReason) {
    return modelResponse.fallbackReason;
  }

  if (modelResponse.sourceIds.length > 0 && approvedSourceIds.length !== modelResponse.sourceIds.length) {
    return "invalid_source_id";
  }

  if (approvedSourceIds.length === 0) {
    return modelResponse.answer === CONTEXT_UNAVAILABLE_ANSWER ? "no_sources" : "invalid_source_id";
  }

  if (shouldRecoverFromWeakModelSources(filing, question, approvedSourceIds)) {
    return "weak_grounding";
  }

  return null;
}

function shouldRetryModelAnswer(
  modelResponse: GeminiChatAnswer,
  retryReason: ChatFallbackReason | null
): boolean {
  if (!retryReason || (modelResponse.retryAttempt ?? 0) >= 1) {
    return false;
  }

  if (modelResponse.geminiCalled === false) {
    return false;
  }

  return retryReason !== "gemini_timeout" && retryReason !== "gemini_api_error" && retryReason !== "metrics_only_insufficient";
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
    sourceSelectionStrategy: contextPack.sourceSelectionStrategy
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

function logChatContextSelection(
  filing: FilingCacheRecord,
  contextPack: ChatContextPack,
  retry?: { retryAttempt: number; retryReason: ChatFallbackReason }
): void {
  const diagnostics = contextPack.selectionDiagnostics;
  logEvent("chat_context_selection", {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    questionIntent: contextPack.questionIntent,
    candidateSourceCount: diagnostics.candidateSourceCount,
    selectedSourceCount: diagnostics.selectedSourceCount,
    selectedSourceCharCount: diagnostics.selectedSourceCharCount,
    avgSelectedSourceChars: diagnostics.avgSelectedSourceChars,
    contextTokenBudget: diagnostics.contextTokenBudget,
    estimatedContextTokens: diagnostics.estimatedContextTokens,
    sourceSelectionStrategy: diagnostics.sourceSelectionStrategy,
    rejectedShortCount: diagnostics.rejectedShortCount,
    rejectedTableFragmentCount: diagnostics.rejectedTableFragmentCount,
    rejectedLowTextQualityCount: diagnostics.rejectedLowTextQualityCount,
    sectionHitCountBusiness: diagnostics.sectionHitCountBusiness,
    sectionHitCountRisk: diagnostics.sectionHitCountRisk,
    sectionHitCountMda: diagnostics.sectionHitCountMda,
    retryAttempt: retry?.retryAttempt ?? 0,
    retryReason: retry?.retryReason ?? null
  });
}

function combineLlmUsage(
  first: GeminiInvocationUsage[] | undefined,
  second: GeminiInvocationUsage[] | undefined
): GeminiInvocationUsage[] | undefined {
  const combined = [...(first ?? []), ...(second ?? [])];
  return combined.length > 0 ? combined : undefined;
}

function retryContextMode(retryReason: ChatFallbackReason): "standard" | "expanded" | "compact" {
  switch (retryReason) {
    case "no_sources":
    case "weak_grounding":
    case "low_quality_answer":
    case "invalid_source_id":
      return "expanded";
    case "schema_invalid":
    case "json_parse_failed":
    case "deterministic_repair":
      return "standard";
    case "gemini_timeout":
    case "gemini_api_error":
    case "metrics_only_insufficient":
      return "compact";
  }
}

function buildSourceLookup(
  filing: FilingCacheRecord,
  contextPack: ChatContextPack | undefined
): Map<string, FilingCacheRecord["sourceChunks"][number]> {
  const sourceById = new Map<string, FilingCacheRecord["sourceChunks"][number]>();
  for (const source of filing.sourceChunks) {
    sourceById.set(source.sourceId, source);
  }
  for (const source of contextPack?.sourceChunks ?? []) {
    sourceById.set(source.sourceId, source);
  }
  return sourceById;
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
    sources: approvedSourceIds.map((sourceId) => {
      const source = sourceById.get(sourceId)!;
      return buildSecFilingSource(source);
    })
  };
}

function logChatLlmUsage(
  modelResponse: GeminiChatAnswer,
  filing: FilingCacheRecord,
  responsePath: ChatResponsePath
): void {
  logLlmUsage(modelResponse.llmUsage, {
    aiTask: "chat",
    route: "/v1/chat",
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    responsePath
  });
}

function logChatPathDecision({
  filing,
  questionIntent,
  responsePath,
  geminiCalled,
  geminiSucceeded,
  fallbackReason,
  schemaValid,
  sourceIdsValid,
  sourceCount,
  contentMode,
  contextPack,
  retryAttempt,
  retryReason,
  llmUsage
}: {
  filing: FilingCacheRecord;
  questionIntent: QuestionIntent;
  responsePath: ChatResponsePath;
  geminiCalled: boolean;
  geminiSucceeded: boolean;
  fallbackReason: ChatFallbackReason | null;
  schemaValid: boolean;
  sourceIdsValid: boolean;
  sourceCount: number;
  contentMode: "full" | "metrics_only";
  contextPack?: ChatContextPack;
  retryAttempt?: number;
  retryReason?: ChatFallbackReason | null;
  llmUsage?: GeminiInvocationUsage[];
}): void {
  const usage = summarizeLlmUsage(llmUsage);
  logEvent("chat_path_decision", {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    questionIntent,
    responsePath,
    geminiCalled,
    geminiSucceeded,
    fallbackReason,
    schemaValid,
    sourceIdsValid,
    sourceCount,
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: usage.candidatesTokenCount,
    totalTokenCount: usage.totalTokenCount,
    latencyMs: usage.latencyMs,
    contentMode,
    retryAttempt: retryAttempt ?? 0,
    retryReason: retryReason ?? null,
    finalFallbackReason: fallbackReason,
    contextTokenBudget: contextPack?.contextTokenBudget ?? null,
    selectedSourceCount: contextPack?.selectedSourceCount ?? null,
    sourceSelectionStrategy: contextPack?.sourceSelectionStrategy ?? null
  });
}

function summarizeLlmUsage(llmUsage: GeminiInvocationUsage[] | undefined): {
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  latencyMs: number | null;
} {
  if (!llmUsage || llmUsage.length === 0) {
    return {
      promptTokenCount: null,
      candidatesTokenCount: null,
      totalTokenCount: null,
      latencyMs: null
    };
  }

  return {
    promptTokenCount: sumNullableCounts(llmUsage.map((usage) => usage.promptTokenCount)),
    candidatesTokenCount: sumNullableCounts(llmUsage.map((usage) => usage.candidatesTokenCount)),
    totalTokenCount: sumNullableCounts(llmUsage.map((usage) => usage.totalTokenCount)),
    latencyMs: llmUsage.reduce((sum, usage) => sum + usage.latencyMs, 0)
  };
}

function sumNullableCounts(values: Array<number | null>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function fallbackReasonForNoSources(
  modelResponse: GeminiChatAnswer,
  contentMode: "full" | "metrics_only"
): ChatFallbackReason {
  if (modelResponse.fallbackReason) {
    return modelResponse.fallbackReason;
  }

  return contentMode === "metrics_only" ? "metrics_only_insufficient" : "no_sources";
}

function fallbackReasonForMissingValidSourceIds(
  modelResponse: GeminiChatAnswer,
  contentMode: "full" | "metrics_only"
): ChatFallbackReason {
  if (modelResponse.sourceIds.length > 0) {
    return "invalid_source_id";
  }

  return fallbackReasonForNoSources(modelResponse, contentMode);
}
