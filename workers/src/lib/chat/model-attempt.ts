import type { Env, FilingCacheRecord } from "../../env";
import { generateModelChatAnswer } from "../../clients/llm/provider";
import type { GeminiChatAnswer } from "../../clients/gemini/types";
import { buildChatContextPack, type ChatContextPack } from "./context-pack";
import { logChatContextSelection } from "./decision-log";
import { buildEvidenceFallbackAnswer, hasBannedPhrase } from "./evidence-fallback";
import { extractEvidenceSlots, type EvidenceSlots } from "./evidence-slots";
import {
  analyzeHardIntentSourceCoverage,
  applyHardIntentRetrievalPlan,
  buildHardIntentRetrievalPlan,
  resolveHardIntentRetrievalMode,
  type HardIntentRetrievalMode,
  type HardIntentSourceCoverage,
  type HardIntentRetrievalPlan
} from "./hard-intent-retrieval";
import type { QuestionIntent } from "./intent";
import { retryModelAnswer } from "./model-retry";
import { chooseRetryReason, retryBlockedReasonForQuestion, shouldRetryModelAnswer } from "./route-policy";
import {
  evaluateSourceGate,
  normalizeSector,
  resolveHardFinancialIntent,
  type SourceGateResult
} from "./source-gate";
import { validateModelSources, type ChatSourceValidationResult } from "./source-validation";
import type { ChatTimingTracker } from "./timing";

export async function buildValidatedModelAnswer({
  filing,
  question,
  env,
  questionIntent,
  timings
}: {
  filing: FilingCacheRecord;
  question: string;
  env: Env;
  questionIntent: QuestionIntent;
  timings: ChatTimingTracker;
}): Promise<{
  contextPack: ChatContextPack;
  modelResponse: GeminiChatAnswer;
  sourceValidation: ChatSourceValidationResult;
}> {
  let contextPack = timings.timeSync("contextBuildMs", () => buildChatContextPack(filing, questionIntent));
  logChatContextSelection(filing, contextPack);
  const initialGate = evaluateSourceGate({
    ticker: filing.ticker,
    companyName: filing.companyName,
    questionIntent,
    question,
    selectedSources: contextPack.sourceChunks,
    metrics: contextPack.metrics.length > 0 ? contextPack.metrics : filing.metrics
  });
  let sourceGateResult = initialGate;
  let retrievalRetryUsed = false;
  let retrievalRetryOutcome: NonNullable<GeminiChatAnswer["qualityControl"]>["retrievalRetryOutcome"] = "not_used";
  const hardRetrievalMode = resolveHardIntentRetrievalMode(env.HARD_INTENT_TARGETED_RETRIEVAL_MODE);
  const initialCoverage = initialGate.sourceGateApplied
    ? analyzeHardIntentSourceCoverage({
        filing,
        sector: normalizeSector(null, filing.ticker, filing.companyName),
        questionIntent,
        sourceGateMissingSourceTypes: initialGate.missingSourceTypes,
        selectedSourceLabels: contextPack.sourceChunks.map((source) => source.sourceLabel),
        selectedSourceIds: contextPack.sourceChunks.map((source) => source.sourceId)
      })
    : null;
  let hardRetrievalDiagnostics = createHardRetrievalDiagnostics(contextPack, initialGate, null, undefined, {
    mode: hardRetrievalMode,
    coverage: initialCoverage
  });

  if (
    hardRetrievalMode !== "off" &&
    initialGate.sourceGateApplied &&
    !initialGate.sourceSufficient &&
    initialGate.retrievalRetryRecommended
  ) {
    const sector = normalizeSector(null, filing.ticker, filing.companyName);
    const initialSlots = extractEvidenceSlots({
      filing,
      sources: contextPack.sourceChunks,
      sourceGateResult: initialGate
    });
    const hardPlan = buildHardIntentRetrievalPlan({
      ticker: filing.ticker,
      companyName: filing.companyName,
      sector,
      questionIntent,
      question,
      sourceGateResult: initialGate,
      sourceGateMissingSourceTypes: initialGate.missingSourceTypes,
      selectedSourceLabels: contextPack.sourceChunks.map((source) => source.sourceLabel),
      selectedSourceIds: contextPack.sourceChunks.map((source) => source.sourceId),
      selectedSources: contextPack.sourceChunks,
      filingKey: filing.filingKey,
      filingType: filing.formType
    });
    if (hardRetrievalMode === "diagnostic") {
      hardRetrievalDiagnostics = createHardRetrievalDiagnostics(contextPack, initialGate, hardPlan, undefined, {
        mode: hardRetrievalMode,
        coverage: initialCoverage
      });
    } else if (hardPlan.shouldRetryRetrieval) {
      retrievalRetryUsed = true;
      const beforeLabels = contextPack.sourceChunks.map((source) => source.sourceLabel);
      const retrievalResult = timings.timeSync("contextBuildMs", () =>
        applyHardIntentRetrievalPlan(filing, contextPack, hardPlan, initialGate.hardIntent!)
      );
      const expandedContextPack = retrievalResult.contextPack;
      const expandedGate = evaluateSourceGate({
        ticker: filing.ticker,
        companyName: filing.companyName,
        questionIntent,
        question,
        selectedSources: expandedContextPack.sourceChunks,
        metrics: expandedContextPack.metrics.length > 0 ? expandedContextPack.metrics : filing.metrics
      });
      const expandedSlots = extractEvidenceSlots({
        filing,
        sources: expandedContextPack.sourceChunks,
        sourceGateResult: expandedGate
      });
      retrievalRetryOutcome = expandedGate.sourceSufficient ||
        expandedGate.missingSourceTypes.length < initialGate.missingSourceTypes.length ||
        expandedGate.identifiedDrivers.length > initialGate.identifiedDrivers.length ||
        expandedSlots.companyExplainedDrivers.length > initialSlots.companyExplainedDrivers.length ||
        expandedSlots.marginDrivers.length > initialSlots.marginDrivers.length
        ? "improved"
        : "no_improvement";
      contextPack = expandedContextPack;
      sourceGateResult = expandedGate;
      hardRetrievalDiagnostics = createHardRetrievalDiagnostics(
        contextPack,
        initialGate,
        hardPlan,
        {
          addedSources: retrievalResult.addedSources,
          outcome: retrievalRetryOutcome,
          afterGate: expandedGate,
          beforeSlots: initialSlots,
          afterSlots: expandedSlots,
          beforeLabels
        },
        {
          mode: hardRetrievalMode,
          coverage: initialCoverage
        }
      );
      logChatContextSelection(filing, contextPack);
    } else {
      hardRetrievalDiagnostics = createHardRetrievalDiagnostics(contextPack, initialGate, hardPlan, undefined, {
        mode: hardRetrievalMode,
        coverage: initialCoverage
      });
    }
  }

  if (sourceGateResult.sourceGateApplied && !sourceGateResult.sourceSufficient) {
    const evidenceSlots = extractEvidenceSlots({
      filing,
      sources: contextPack.sourceChunks,
      sourceGateResult
    });
    const evidenceFallback = buildEvidenceFallbackAnswer({
      sourceGateResult,
      evidenceSlots,
      selectedSources: contextPack.sourceChunks,
      fallbackReason: "low_quality_answer"
    });
    const modelResponse = attachQualityControl(
      evidenceFallback.answer,
      sourceGateResult,
      evidenceSlots,
      {
        retrievalRetryUsed,
        retrievalRetryOutcome,
        evidenceFallbackUsed: true,
        fallbackKind: "evidence_slot",
        genericFallbackPhraseDetected: evidenceFallback.genericFallbackPhraseDetected,
        hardRetrievalDiagnostics
      }
    );
    return {
      contextPack,
      modelResponse: attachRetryDiagnostics(modelResponse, null, false, null, false),
      sourceValidation: validateModelSources(modelResponse, contextPack, filing)
    };
  }

  if (sourceGateResult.sourceGateApplied) {
    const evidenceSlots = extractEvidenceSlots({
      filing,
      sources: contextPack.sourceChunks,
      sourceGateResult
    });
    if (shouldUseEvidenceFallbackForEmptyDriverSlots(sourceGateResult, evidenceSlots)) {
      const adjustedGate: SourceGateResult = {
        ...sourceGateResult,
        sourceSufficient: false,
        failureLabels: [
          ...new Set([
            ...sourceGateResult.failureLabels,
            ...evidenceSlots.failureLabels,
            "source_gate_false_positive",
            "source_sufficient_but_driver_slots_empty",
            "driver_evidence_rejected",
            sourceGateResult.hardIntent === "margin_durability_followup"
              ? "margin_driver_slots_empty"
              : "driver_slots_empty"
          ])
        ],
        reason: "Source gate initially passed, but extracted driver evidence slots were empty."
      };
      const adjustedSlots = extractEvidenceSlots({
        filing,
        sources: contextPack.sourceChunks,
        sourceGateResult: adjustedGate
      });
      const evidenceFallback = buildEvidenceFallbackAnswer({
        sourceGateResult: adjustedGate,
        evidenceSlots: adjustedSlots,
        selectedSources: contextPack.sourceChunks,
        fallbackReason: "low_quality_answer"
      });
      const modelResponse = attachQualityControl(
        evidenceFallback.answer,
        adjustedGate,
        adjustedSlots,
        {
          retrievalRetryUsed,
          retrievalRetryOutcome,
          evidenceFallbackUsed: true,
          fallbackKind: "evidence_slot",
          genericFallbackPhraseDetected: evidenceFallback.genericFallbackPhraseDetected,
          hardRetrievalDiagnostics
        }
      );
      return {
        contextPack,
        modelResponse: attachRetryDiagnostics(modelResponse, null, false, null, false),
        sourceValidation: validateModelSources(modelResponse, contextPack, filing)
      };
    }
  }

  let modelResponse = await timings.timeAsync("geminiFirstCallMs", () =>
    generateModelChatAnswer(env, { filing, question, questionIntent, contextPack })
  );
  let sourceValidation = validateModelSources(modelResponse, contextPack, filing);
  if (
    sourceGateResult.sourceGateApplied &&
    shouldReplaceHardIntentFallback(modelResponse, sourceGateResult)
  ) {
    const evidenceSlots = extractEvidenceSlots({
      filing,
      sources: contextPack.sourceChunks,
      sourceGateResult
    });
    const evidenceFallback = buildEvidenceFallbackAnswer({
      sourceGateResult,
      evidenceSlots,
      selectedSources: contextPack.sourceChunks,
      fallbackReason: modelResponse.fallbackReason
    });
    modelResponse = attachQualityControl(
      {
        ...evidenceFallback.answer,
        geminiCalled: modelResponse.geminiCalled ?? true,
        geminiSucceeded: modelResponse.geminiSucceeded ?? false,
        fallbackReason: modelResponse.fallbackReason,
        llmUsage: modelResponse.llmUsage,
        geminiApiError: modelResponse.geminiApiError
      },
      sourceGateResult,
      evidenceSlots,
      {
        retrievalRetryUsed,
        retrievalRetryOutcome,
        evidenceFallbackUsed: true,
        fallbackKind: modelResponse.fallbackReason === "gemini_timeout"
          ? "hard_model_timeout_evidence"
          : modelResponse.fallbackReason === "gemini_api_error"
            ? "api_error"
            : "evidence_slot",
        genericFallbackPhraseDetected: evidenceFallback.genericFallbackPhraseDetected,
        hardRetrievalDiagnostics
      }
    );
    sourceValidation = validateModelSources(modelResponse, contextPack, filing);
  } else if (sourceGateResult.sourceGateApplied) {
    const evidenceSlots = extractEvidenceSlots({
      filing,
      sources: contextPack.sourceChunks,
      sourceGateResult
    });
    modelResponse = attachQualityControl(modelResponse, sourceGateResult, evidenceSlots, {
      retrievalRetryUsed,
      retrievalRetryOutcome,
      evidenceFallbackUsed: false,
      fallbackKind: modelResponse.usedRemoteModel === true
        ? "none"
        : sourceGateResult.hardIntent
          ? "evidence_slot"
          : "legacy_template",
      genericFallbackPhraseDetected: false,
      hardRetrievalDiagnostics
    });
  }
  const retryReason = chooseRetryReason({
    filing,
    question,
    modelResponse,
    approvedSourceIds: sourceValidation.approvedSourceIds
  });
  const retryBlockedReason = retryBlockedReasonForQuestion(retryReason, questionIntent, question);
  const hardIntent = resolveHardFinancialIntent(questionIntent, question);
  const retryAllowed = hardIntent
    ? false
    : shouldRetryModelAnswer(modelResponse, retryReason, { questionIntent, question });
  let retryAttempted = false;
  let retryOutcome: NonNullable<GeminiChatAnswer["retryDiagnostics"]>["retryOutcome"] = retryReason
    ? retryAllowed
      ? null
      : "blocked"
    : null;
  let retryWasted = false;

  if (retryAllowed) {
    retryAttempted = true;
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
    sourceValidation = validateModelSources(modelResponse, contextPack, filing);
    retryOutcome = classifyRetryOutcome(modelResponse, sourceValidation);
    retryWasted = retryOutcome !== "accepted";
  }

  return {
    contextPack,
    modelResponse: attachRetryDiagnostics(modelResponse, retryReason, retryAllowed, retryBlockedReason, retryAttempted, retryOutcome, retryWasted),
    sourceValidation
  };
}

function shouldUseEvidenceFallbackForEmptyDriverSlots(
  sourceGateResult: SourceGateResult,
  evidenceSlots: EvidenceSlots
): boolean {
  if (!sourceGateResult.sourceGateApplied || !sourceGateResult.sourceSufficient) {
    return false;
  }
  if (sourceGateResult.hardIntent === "revenue_driver") {
    return evidenceSlots.companyExplainedDrivers.length === 0;
  }
  if (sourceGateResult.hardIntent === "driver_durability_followup") {
    return sourceGateResult.followupTargetFound !== true || evidenceSlots.companyExplainedDrivers.length === 0;
  }
  if (sourceGateResult.hardIntent === "margin_durability_followup") {
    return sourceGateResult.followupTargetFound !== true || evidenceSlots.marginDrivers.length === 0;
  }
  return false;
}

function shouldReplaceHardIntentFallback(modelResponse: GeminiChatAnswer, sourceGateResult: SourceGateResult): boolean {
  return (
    modelResponse.fallbackReason === "gemini_timeout" ||
    modelResponse.fallbackReason === "gemini_api_error" ||
    isUnsafeHardIntentLocalFallback(modelResponse, sourceGateResult) ||
    (
      modelResponse.fallbackReason !== undefined &&
      modelResponse.usedRemoteModel !== true &&
      hasBannedPhrase(modelResponse.answer)
    )
  );
}

function isUnsafeHardIntentLocalFallback(modelResponse: GeminiChatAnswer, sourceGateResult: SourceGateResult): boolean {
  if (sourceGateResult.hardIntent !== "revenue_driver" || modelResponse.usedRemoteModel === true) {
    return false;
  }
  const answer = modelResponse.answer;
  const missing = sourceGateResult.missingSourceTypes.join(" ").toLowerCase();
  const allowsBankTerms = /(net interest|noninterest|provision|deposit|credit quality|investment banking|trading|wealth management|bank)/i.test(missing);
  const allowsRetailTerms = /(comparable|traffic|ticket|ecommerce|membership|retail|store)/i.test(missing);
  const hasBankChecklist = /(銀行では|net interest income|noninterest income|provision|deposits?|credit quality|預金・貸出)/i.test(answer);
  const hasRetailChecklist = /(小売では|既存店|traffic|ticket|eCommerce|membership\/advertising)/i.test(answer);
  return (hasBankChecklist && !allowsBankTerms) || (hasRetailChecklist && !allowsRetailTerms);
}

function attachRetryDiagnostics(
  modelResponse: GeminiChatAnswer,
  retryReason: GeminiChatAnswer["fallbackReason"] | null,
  retryAllowed: boolean,
  retryBlockedReason: string | null,
  retryAttempted: boolean,
  retryOutcome: NonNullable<GeminiChatAnswer["retryDiagnostics"]>["retryOutcome"] = retryReason
    ? retryAllowed
      ? null
      : "blocked"
    : null,
  retryWasted = false
): GeminiChatAnswer {
  return {
    ...modelResponse,
    retryDiagnostics: {
      retryAttempted,
      retryAllowed,
      retryReason,
      retryBlockedReason,
      retryOutcome,
      retryWasted,
      firstCallFailureKind: retryReason
    }
  };
}

function attachQualityControl(
  modelResponse: GeminiChatAnswer,
  sourceGateResult: SourceGateResult,
  evidenceSlots: EvidenceSlots,
  options: Pick<
    NonNullable<GeminiChatAnswer["qualityControl"]>,
    "retrievalRetryUsed" | "retrievalRetryOutcome" | "evidenceFallbackUsed" | "fallbackKind" | "genericFallbackPhraseDetected"
  >
    & { hardRetrievalDiagnostics?: HardRetrievalDiagnostics }
): GeminiChatAnswer {
  const hardRetrievalDiagnostics = options.hardRetrievalDiagnostics ?? createHardRetrievalDiagnosticsFromGate(sourceGateResult);
  return {
    ...modelResponse,
    qualityControl: {
      sourceGateApplied: sourceGateResult.sourceGateApplied,
      sourceGateSufficient: sourceGateResult.sourceGateApplied ? sourceGateResult.sourceSufficient : null,
      sourceGateMissingSourceTypes: sourceGateResult.missingSourceTypes,
      sourceGateFailureLabels: [...new Set([...sourceGateResult.failureLabels, ...evidenceSlots.failureLabels])],
      sourceGateEvidenceSlots: summarizeEvidenceSlots(evidenceSlots),
      sourceGateRetrievalRetryRecommended: sourceGateResult.retrievalRetryRecommended,
      retrievalRetryUsed: options.retrievalRetryUsed,
      retrievalRetryOutcome: options.retrievalRetryOutcome,
      evidenceFallbackUsed: options.evidenceFallbackUsed,
      fallbackKind: options.fallbackKind,
      driverSlotsCount: evidenceSlots.companyExplainedDrivers.length,
      marginDriverSlotsCount: evidenceSlots.marginDrivers.length,
      followupTargetFound: sourceGateResult.followupTargetFound,
      genericFallbackPhraseDetected: options.genericFallbackPhraseDetected,
      ...hardRetrievalDiagnostics
    }
  };
}

function summarizeEvidenceSlots(evidenceSlots: EvidenceSlots): Record<string, unknown> {
  return {
    confirmedMetricMovement: evidenceSlots.confirmedMetricMovement ?? null,
    companyExplainedDrivers: evidenceSlots.companyExplainedDrivers.map((driver) => ({
      category: driver.category,
      driver: driver.driver.slice(0, 220),
      sourceIds: driver.sourceIds,
      confidence: driver.confidence
    })),
    segmentOrBusinessSignals: evidenceSlots.segmentOrBusinessSignals.map((signal) => ({
      fact: signal.fact.slice(0, 220),
      sourceIds: signal.sourceIds,
      confidence: signal.confidence
    })),
    marginDriverCount: evidenceSlots.marginDrivers.length,
    unknowns: evidenceSlots.unknowns,
    sourceLimitations: evidenceSlots.sourceLimitations,
    failureLabels: evidenceSlots.failureLabels
  };
}

type HardRetrievalDiagnostics = Pick<
  NonNullable<GeminiChatAnswer["qualityControl"]>,
  | "hardRetrievalPlanUsed"
  | "hardRetrievalQueries"
  | "hardRetrievalQueryPurposes"
  | "hardRetrievalMissingSourceTypes"
  | "hardRetrievalAddedSourceCount"
  | "hardRetrievalAddedSourceLabels"
  | "hardRetrievalAddedSourceIds"
  | "hardRetrievalOutcome"
  | "sourceGateSufficientBeforeHardRetrieval"
  | "sourceGateSufficientAfterHardRetrieval"
  | "driverSlotsCountBeforeHardRetrieval"
  | "driverSlotsCountAfterHardRetrieval"
  | "marginDriverSlotsCountBeforeHardRetrieval"
  | "marginDriverSlotsCountAfterHardRetrieval"
  | "selectedSourceLabelsBeforeHardRetrieval"
  | "selectedSourceLabelsAfterHardRetrieval"
  | "hardRetrievalMode"
  | "hardSourceCoverageScore"
  | "hardSourceCoverageMissing"
  | "hardSourceCoverageSectorKpiHits"
  | "hardSourceCoverageHasMdaRevenueDiscussion"
  | "hardSourceCoverageHasSegmentResults"
  | "hardSourceCoverageHasSectorKpiWindow"
>;

function createHardRetrievalDiagnostics(
  contextPack: ChatContextPack,
  beforeGate: SourceGateResult,
  plan: HardIntentRetrievalPlan | null,
  result?: {
    addedSources: ChatContextPack["sourceChunks"];
    outcome: "improved" | "no_improvement" | "not_used";
    afterGate: SourceGateResult;
    beforeSlots: EvidenceSlots;
    afterSlots: EvidenceSlots;
    beforeLabels: string[];
  },
  options: {
    mode: HardIntentRetrievalMode;
    coverage: HardIntentSourceCoverage | null;
  } = { mode: "diagnostic", coverage: null }
): HardRetrievalDiagnostics {
  return {
    hardRetrievalPlanUsed: Boolean(plan?.shouldRetryRetrieval),
    hardRetrievalQueries: plan?.queries.map((query) => query.query) ?? [],
    hardRetrievalQueryPurposes: plan?.queries.map((query) => query.purpose) ?? [],
    hardRetrievalMissingSourceTypes: plan?.queries.flatMap((query) => query.missingSourceTypes) ?? beforeGate.missingSourceTypes,
    hardRetrievalAddedSourceCount: result?.addedSources.length ?? 0,
    hardRetrievalAddedSourceLabels: result?.addedSources.map((source) => source.sourceLabel) ?? [],
    hardRetrievalAddedSourceIds: result?.addedSources.map((source) => source.sourceId) ?? [],
    hardRetrievalOutcome: result?.outcome ?? "not_used",
    sourceGateSufficientBeforeHardRetrieval: beforeGate.sourceGateApplied ? beforeGate.sourceSufficient : null,
    sourceGateSufficientAfterHardRetrieval: result?.afterGate.sourceGateApplied ? result.afterGate.sourceSufficient : null,
    driverSlotsCountBeforeHardRetrieval: result?.beforeSlots.companyExplainedDrivers.length ?? null,
    driverSlotsCountAfterHardRetrieval: result?.afterSlots.companyExplainedDrivers.length ?? null,
    marginDriverSlotsCountBeforeHardRetrieval: result?.beforeSlots.marginDrivers.length ?? null,
    marginDriverSlotsCountAfterHardRetrieval: result?.afterSlots.marginDrivers.length ?? null,
    selectedSourceLabelsBeforeHardRetrieval: result?.beforeLabels ?? contextPack.sourceChunks.map((source) => source.sourceLabel),
    selectedSourceLabelsAfterHardRetrieval: result ? contextPack.sourceChunks.map((source) => source.sourceLabel) : [],
    hardRetrievalMode: options.mode,
    hardSourceCoverageScore: options.coverage?.coverageScore ?? null,
    hardSourceCoverageMissing: options.coverage?.missingCoverage ?? [],
    hardSourceCoverageSectorKpiHits: options.coverage?.sectorKpiHits ?? [],
    hardSourceCoverageHasMdaRevenueDiscussion: options.coverage?.hasMdaRevenueDiscussion ?? null,
    hardSourceCoverageHasSegmentResults: options.coverage?.hasSegmentResults ?? null,
    hardSourceCoverageHasSectorKpiWindow: options.coverage?.hasSectorKpiWindow ?? null
  };
}

function createHardRetrievalDiagnosticsFromGate(sourceGateResult: SourceGateResult): HardRetrievalDiagnostics {
  return {
    hardRetrievalPlanUsed: false,
    hardRetrievalQueries: [],
    hardRetrievalQueryPurposes: [],
    hardRetrievalMissingSourceTypes: sourceGateResult.missingSourceTypes,
    hardRetrievalAddedSourceCount: 0,
    hardRetrievalAddedSourceLabels: [],
    hardRetrievalAddedSourceIds: [],
    hardRetrievalOutcome: "not_used",
    sourceGateSufficientBeforeHardRetrieval: sourceGateResult.sourceGateApplied ? sourceGateResult.sourceSufficient : null,
    sourceGateSufficientAfterHardRetrieval: null,
    driverSlotsCountBeforeHardRetrieval: null,
    driverSlotsCountAfterHardRetrieval: null,
    marginDriverSlotsCountBeforeHardRetrieval: null,
    marginDriverSlotsCountAfterHardRetrieval: null,
    selectedSourceLabelsBeforeHardRetrieval: [],
    selectedSourceLabelsAfterHardRetrieval: [],
    hardRetrievalMode: "diagnostic",
    hardSourceCoverageScore: null,
    hardSourceCoverageMissing: [],
    hardSourceCoverageSectorKpiHits: [],
    hardSourceCoverageHasMdaRevenueDiscussion: null,
    hardSourceCoverageHasSegmentResults: null,
    hardSourceCoverageHasSectorKpiWindow: null
  };
}

function classifyRetryOutcome(
  modelResponse: GeminiChatAnswer,
  sourceValidation: ChatSourceValidationResult
): NonNullable<GeminiChatAnswer["retryDiagnostics"]>["retryOutcome"] {
  if (modelResponse.fallbackReason) {
    return "fallback";
  }

  if (modelResponse.sourceIds.length > 0 && !sourceValidation.modelSourceIdsValid) {
    return "invalid_source_ids";
  }

  if (sourceValidation.approvedSourceIds.length === 0) {
    return "no_valid_sources";
  }

  return "accepted";
}
