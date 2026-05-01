import type { Env, FilingCacheRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import type { GeminiChatAnswer } from "../../clients/gemini/types";
import { buildChatContextPack, type ChatContextPack } from "./context-pack";
import { logChatContextSelection } from "./decision-log";
import { buildEvidenceFallbackAnswer, hasBannedPhrase } from "./evidence-fallback";
import { extractEvidenceSlots, type EvidenceSlots } from "./evidence-slots";
import type { QuestionIntent } from "./intent";
import { retryModelAnswer } from "./model-retry";
import { chooseRetryReason, retryBlockedReasonForQuestion, shouldRetryModelAnswer } from "./route-policy";
import {
  evaluateSourceGate,
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

  if (initialGate.sourceGateApplied && !initialGate.sourceSufficient && initialGate.retrievalRetryRecommended) {
    retrievalRetryUsed = true;
    const expandedContextPack = timings.timeSync("contextBuildMs", () =>
      buildChatContextPack(filing, questionIntent, { mode: "expanded", retryReason: "source_gate_failed" })
    );
    const expandedGate = evaluateSourceGate({
      ticker: filing.ticker,
      companyName: filing.companyName,
      questionIntent,
      question,
      selectedSources: expandedContextPack.sourceChunks,
      metrics: expandedContextPack.metrics.length > 0 ? expandedContextPack.metrics : filing.metrics
    });
    retrievalRetryOutcome = expandedGate.sourceSufficient ||
      expandedGate.missingSourceTypes.length < initialGate.missingSourceTypes.length ||
      expandedGate.identifiedDrivers.length > initialGate.identifiedDrivers.length
      ? "improved"
      : "no_improvement";
    contextPack = expandedContextPack;
    sourceGateResult = expandedGate;
    logChatContextSelection(filing, contextPack);
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
        genericFallbackPhraseDetected: evidenceFallback.genericFallbackPhraseDetected
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
          genericFallbackPhraseDetected: evidenceFallback.genericFallbackPhraseDetected
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
    generateChatAnswer(env, { filing, question, questionIntent, contextPack })
  );
  let sourceValidation = validateModelSources(modelResponse, contextPack, filing);
  if (
    sourceGateResult.sourceGateApplied &&
    shouldReplaceHardIntentFallback(modelResponse)
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
        llmUsage: modelResponse.llmUsage
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
        genericFallbackPhraseDetected: evidenceFallback.genericFallbackPhraseDetected
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
      fallbackKind: modelResponse.usedRemoteModel === true ? "none" : "legacy_template",
      genericFallbackPhraseDetected: false
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

function shouldReplaceHardIntentFallback(modelResponse: GeminiChatAnswer): boolean {
  return (
    modelResponse.fallbackReason === "gemini_timeout" ||
    modelResponse.fallbackReason === "gemini_api_error" ||
    (
      modelResponse.fallbackReason !== undefined &&
      modelResponse.usedRemoteModel !== true &&
      hasBannedPhrase(modelResponse.answer)
    )
  );
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
): GeminiChatAnswer {
  return {
    ...modelResponse,
    qualityControl: {
      sourceGateApplied: sourceGateResult.sourceGateApplied,
      sourceGateSufficient: sourceGateResult.sourceGateApplied ? sourceGateResult.sourceSufficient : null,
      sourceGateMissingSourceTypes: sourceGateResult.missingSourceTypes,
      sourceGateFailureLabels: [...new Set([...sourceGateResult.failureLabels, ...evidenceSlots.failureLabels])],
      sourceGateRetrievalRetryRecommended: sourceGateResult.retrievalRetryRecommended,
      retrievalRetryUsed: options.retrievalRetryUsed,
      retrievalRetryOutcome: options.retrievalRetryOutcome,
      evidenceFallbackUsed: options.evidenceFallbackUsed,
      fallbackKind: options.fallbackKind,
      driverSlotsCount: evidenceSlots.companyExplainedDrivers.length,
      marginDriverSlotsCount: evidenceSlots.marginDrivers.length,
      followupTargetFound: sourceGateResult.followupTargetFound,
      genericFallbackPhraseDetected: options.genericFallbackPhraseDetected
    }
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
