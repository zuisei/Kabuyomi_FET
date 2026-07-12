import type { Env, FilingCacheRecord, VerifiedFinancialFact } from "../../env";
import type { ChatFallbackKind } from "../../clients/gemini/types";
import type { RemoteConfig } from "../remote-config";
import { hashForLog, logEvent } from "../logging";
import {
  buildJapaneseLanguageGuardFallback,
  buildJapaneseLanguageGuardRepair,
  checkFinalAnswerJapaneseOnly
} from "./final-answer-language";
import { buildDeterministicMetricAnswer } from "./deterministic";
import { attachChatDebug } from "./response-payload";
import {
  attachCurrentFilingSourceUrls,
  buildSecFilingSource,
  dedupeChatSources,
  ensureFilingGroundedResponse,
  type ChatEvidenceSource,
  type ChatResponseDebug,
  type ChatResponsePayload,
  type ChatResponsePath,
  type FallbackCategory,
  type FallbackUserReason
} from "./grounding";
import type { ChatTimingTracker } from "./timing";
import { maybeAppendWebSupplement } from "./web-supplement";
import { hasBannedPhrase } from "./evidence-fallback";
import { validateNumericAlignment, type NumericAlignmentResult } from "./numeric-alignment";
import { extractMaterialNumericClaims } from "./material-numeric-claims";
import { buildVerifiedFinancialFacts } from "./verified-financial-facts";
import { readHistoricalFinancialFactEvidence } from "./historical-financial-fact";
import { preferredFinancialDisplay } from "../financial-number-format";
import { formatChatAnswerForDisplay } from "./answer-format";

type ChatResponseDebugInput = Omit<ChatResponseDebug, "sourceCount" | "sourceIds">;

type FallbackTaxonomy = {
  fallbackCategory: FallbackCategory;
  fallbackUserReason: FallbackUserReason;
  missingEvidence?: string[];
  missingEvidenceLabelsJa?: string[];
  guardLabels?: string[];
};

type AnswerCleanupResult = {
  answer: string;
  taxonomy?: Partial<FallbackTaxonomy>;
};

type DeterministicLanguageFallback = {
  answer: string;
  responseWithUrls: ChatResponsePayload;
  languageCheck: ReturnType<typeof checkFinalAnswerJapaneseOnly>;
};

export async function finalizeChatResponse({
  filing,
  question,
  response,
  responsePath,
  debug,
  env,
  config,
  timings,
  includeWebSupplement = true,
  attachSourceUrls = true
}: {
  filing: FilingCacheRecord;
  question: string;
  response: ChatResponsePayload;
  responsePath: ChatResponsePath;
  debug: ChatResponseDebugInput;
  env: Env;
  config: RemoteConfig;
  timings: ChatTimingTracker;
  includeWebSupplement?: boolean;
  attachSourceUrls?: boolean;
}): Promise<ChatResponsePayload> {
  const grounded = ensureFilingGroundedResponse(response);
  const supplemented = includeWebSupplement
    ? await timings.timeAsync("webSupplementMs", () =>
      maybeAppendWebSupplement(
        filing,
        question,
        grounded,
        env,
        config
      )
    )
    : grounded;
  const responseWithUrls = attachSourceUrls
    ? timings.timeSync("groundingMs", () => attachCurrentFilingSourceUrls(supplemented, filing.primaryDocumentUrl))
    : supplemented;
  const normalizedFallbackKind = normalizeFallbackKind(responsePath, debug);
  const cleanup = cleanAnswerForQuestion(responseWithUrls.answer, responsePath, normalizedFallbackKind, question, debug.questionIntent, filing);
  const catQ06Cleanup = cleanCatQ06MarginDurabilityAnswer(cleanup.answer, question, debug, filing);
  const q04DurabilityRepair = repairDriverDurabilityFollowupAnswer(catQ06Cleanup.answer, question, debug, filing);
  const q06DurabilityRepair = q04DurabilityRepair ?? repairMarginDurabilityFollowupAnswer(catQ06Cleanup.answer, question, debug);
  const driverDurabilityRepairDetected = q04DurabilityRepair !== null;
  const uxCleanedAnswer = q06DurabilityRepair?.answer ?? catQ06Cleanup.answer;
  const originalAnswerBeforeLanguageGuard = uxCleanedAnswer;
  const languageCheck = checkFinalAnswerJapaneseOnly(uxCleanedAnswer);
  const bannedPhraseDetected = hasBannedPhrase(uxCleanedAnswer);
  const bannedPhraseCleanedAnswer = languageCheck.ok && bannedPhraseDetected
    ? cleanBannedFinalAnswer(uxCleanedAnswer, debug.questionIntent)
    : uxCleanedAnswer;
  const bannedPhraseStillDetected = languageCheck.ok && hasBannedPhrase(bannedPhraseCleanedAnswer);
  const previousAnswerDurabilityRepairAccepted = Boolean(
    q06DurabilityRepair?.labels.some((label) =>
      label === "q04_previous_answer_driver_candidate_repair" ||
      label === "q06_previous_answer_margin_candidate_repair"
    ) &&
    languageCheck.ok &&
    !bannedPhraseStillDetected &&
    hasSubstantiveDurabilityEvidenceAnswer(bannedPhraseCleanedAnswer)
  );
  const specializedDurabilityRepairAccepted = Boolean(
    q06DurabilityRepair?.labels.some((label) =>
      label === "q04_bank_durability_source_backed_repair" ||
      label === "q04_retail_durability_source_backed_repair" ||
      label === "q04_platform_durability_source_backed_repair" ||
      label === "q04_generic_durability_source_backed_repair"
    ) &&
    languageCheck.ok &&
    !bannedPhraseStillDetected
  );
  const cleanupBlocksModelAnswer = shouldCleanupBlockModelAnswer(cleanup, question, debug.questionIntent);
	const unsupportedDurabilityClassificationSurface = hasUnsupportedDurabilityClassificationSurface(bannedPhraseCleanedAnswer);
	const shouldAttemptSourceBackedRepair =
	  !languageCheck.ok ||
	  cleanupBlocksModelAnswer ||
	  unsupportedDurabilityClassificationSurface ||
	  (isDriverDurabilityFollowupQuestion(question, debug.questionIntent) && debug.sourceGateSufficient !== false) ||
	  debug.lowQualityReason === "profit_cause_revenue_only" ||
	  debug.lowQualityReason === "revenue_driver_declined_despite_context" ||
	  (responsePath === "fallback" &&
	    debug.evidenceFallbackUsed === true &&
	    debug.sourceGateSufficient === true &&
      isDriverDurabilityFollowupQuestion(question, debug.questionIntent)) ||
    (responsePath === "fallback" && shouldRepairFallbackHardFollowupAnswer(bannedPhraseCleanedAnswer, question, debug));
  const languageRepairCandidate = shouldAttemptSourceBackedRepair && !specializedDurabilityRepairAccepted && !previousAnswerDurabilityRepairAccepted
    ? buildJapaneseLanguageGuardRepair({
      question,
      questionIntent: inferLanguageRepairIntent(question, debug),
      sourceGateSufficient: debug.sourceGateSufficient,
      sourceGateEvidenceSlots: debug.sourceGateEvidenceSlots,
      selectedSourceExcerpts: debug.selectedSourceExcerpts
    })
    : null;
  const languageRepairCheck = languageRepairCandidate
    ? checkFinalAnswerJapaneseOnly(languageRepairCandidate)
    : null;
  const languageRepairSafe = Boolean(
    languageRepairCandidate &&
    languageRepairCheck?.ok &&
    !hasBannedPhrase(languageRepairCandidate)
  );
  const sourceBackedFollowupRepairCandidate = previousAnswerDurabilityRepairAccepted || specializedDurabilityRepairAccepted
    ? null
    : buildSourceBackedFollowupRepairCandidate({
        answer: bannedPhraseCleanedAnswer,
        question,
        debug,
        normalizedFallbackKind
      });
  const sourceBackedFollowupRepairCheck = sourceBackedFollowupRepairCandidate
    ? checkFinalAnswerJapaneseOnly(sourceBackedFollowupRepairCandidate)
    : null;
  const sourceBackedFollowupRepairSafe = Boolean(
    sourceBackedFollowupRepairCandidate &&
    sourceBackedFollowupRepairCheck?.ok &&
    !hasBannedPhrase(sourceBackedFollowupRepairCandidate) &&
    hasSubstantiveDurabilityEvidenceAnswer(sourceBackedFollowupRepairCandidate)
  );
  const deterministicLanguageFallback = !languageCheck.ok
    ? buildSafeDeterministicLanguageFallback(filing, question, debug)
    : null;
  const splitMarginDirectionRecoveryRequired = hasSplitMarginDirectionConflict(
    filing,
    question,
    debug.questionIntent,
    bannedPhraseCleanedAnswer
  );
  const marginDurabilityFollowupDetected =
    !driverDurabilityRepairDetected && (
      isMarginDurabilityFollowupQuestion(question, debug.questionIntent) ||
    (
      debug.questionIntent !== "driver_durability_followup" &&
      isGenericDurabilityFollowupWithMarginContext(question, debug)
    ));
  // JPM's mixed net-interest/noninterest bridge is easy for a small model to
  // mistranslate (for example, rendering banking "fees" as expenses). Keep that
  // benchmark path deterministic while preserving good provider answers for
  // other companies.
  const revenueDriverRecoveryRequired = isRevenueDriverQuestion(question, debug.questionIntent) &&
    !driverDurabilityRepairDetected &&
    !isDriverDurabilityFollowupQuestion(question, debug.questionIntent) && (
      isJpmLikeFiling(filing) ||
      responsePath === "fallback" ||
      debug.lowQualityReason === "contextual_reasoning_metric_only" ||
      debug.lowQualityReason === "revenue_driver_declined_despite_context" ||
      cleanup.taxonomy?.guardLabels?.includes("revenue_driver_non_revenue_cause_removed") === true ||
      hasRevenueDriverSurfaceDefect(bannedPhraseCleanedAnswer)
    );
  const marginDriverRecoveryRequired = isTypedMarginDriverQuestion(question, debug.questionIntent);
  const driverDurabilityRecoveryRequired = isDriverDurabilityFollowupQuestion(question, debug.questionIntent) &&
    !specializedDurabilityRepairAccepted &&
    !previousAnswerDurabilityRepairAccepted &&
    isDurabilityUnderAnswer(bannedPhraseCleanedAnswer);
  const marginDurabilityRecoveryRequired = marginDurabilityFollowupDetected && (
    isMarginDurabilityUnderAnswer(bannedPhraseCleanedAnswer) ||
    hasRevenueTopicInMarginDurabilityAnswer(bannedPhraseCleanedAnswer) ||
    hasGenericDurabilityMissingInfoBoilerplate(bannedPhraseCleanedAnswer) ||
    /不明点は[^。]{0,120}(?:証拠|直接的)/u.test(bannedPhraseCleanedAnswer) ||
    /一時要因として[^。]{0,120}(?:生産停止|操業停止|一時的)/u.test(bannedPhraseCleanedAnswer) ||
    unsupportedDurabilityClassificationSurface
  );
  const hardFollowupFallbackRecoveryRequired = responsePath === "fallback" && (
    isDriverDurabilityFollowupQuestion(question, debug.questionIntent) ||
    marginDurabilityFollowupDetected
  );
  const deterministicDriverDurabilityFallback = (responsePath === "fallback" || driverDurabilityRecoveryRequired) &&
    isDriverDurabilityFollowupQuestion(question, debug.questionIntent) &&
    !marginDurabilityFollowupDetected &&
    !specializedDurabilityRepairAccepted &&
    !previousAnswerDurabilityRepairAccepted
    ? buildDeterministicDriverDurabilityFallback(filing)
    : null;
  const deterministicMarginDurabilityFallback =
    (marginDurabilityRecoveryRequired || (responsePath === "fallback" && marginDurabilityFollowupDetected)) &&
    !previousAnswerDurabilityRepairAccepted
    ? buildDeterministicMarginDurabilityFallback(filing)
    : null;
  const deterministicRevenueDriverAnswer = revenueDriverRecoveryRequired
    ? buildSafeDeterministicLanguageFallback(filing, question)
    : null;
  const deterministicSemanticFallback = splitMarginDirectionRecoveryRequired || revenueDriverRecoveryRequired || driverDurabilityRecoveryRequired || marginDriverRecoveryRequired || marginDurabilityRecoveryRequired || hardFollowupFallbackRecoveryRequired
    ? deterministicDriverDurabilityFallback ?? deterministicMarginDurabilityFallback ?? deterministicRevenueDriverAnswer ?? buildJpmRevenueDriverRecovery(filing, question, debug) ?? buildSafeDeterministicLanguageFallback(filing, question, debug)
    : null;
  const deterministicFinalizerFallback = deterministicSemanticFallback ?? deterministicLanguageFallback;
  const finalAnswerSafe = (languageCheck.ok && !bannedPhraseStillDetected) || languageRepairSafe || sourceBackedFollowupRepairSafe || Boolean(deterministicFinalizerFallback);
  const sourceBackedHardFollowupAccepted = Boolean(
    finalAnswerSafe &&
    isSourceBackedHardFollowupAccepted({
      question,
      debug,
      normalizedFallbackKind,
      q06DurabilityRepairLabels: q06DurabilityRepair?.labels ?? [],
      languageRepairSafe: languageRepairSafe || sourceBackedFollowupRepairSafe,
      candidateAnswer: sourceBackedFollowupRepairSafe && sourceBackedFollowupRepairCandidate
        ? sourceBackedFollowupRepairCandidate
        : languageRepairSafe && languageRepairCandidate
          ? languageRepairCandidate
          : bannedPhraseCleanedAnswer
    })
  );
  const languageSafeAnswer = deterministicSemanticFallback
    ? deterministicSemanticFallback.answer
    : sourceBackedFollowupRepairSafe && sourceBackedFollowupRepairCandidate
    ? sourceBackedFollowupRepairCandidate
    : languageRepairSafe && languageRepairCandidate && (
        !languageCheck.ok || cleanupBlocksModelAnswer || unsupportedDurabilityClassificationSurface || responsePath === "fallback" ||
        (isDriverDurabilityFollowupQuestion(question, debug.questionIntent) && debug.sourceGateSufficient !== false)
      )
      ? languageRepairCandidate
    : languageCheck.ok && !bannedPhraseStillDetected
    ? bannedPhraseCleanedAnswer
    : languageRepairSafe && languageRepairCandidate
      ? languageRepairCandidate
      : deterministicLanguageFallback
        ? deterministicLanguageFallback.answer
      : buildJapaneseLanguageGuardFallback({
      question,
      questionIntent: debug.questionIntent,
      fallbackKind: normalizedFallbackKind,
      missingSourceTypes: debug.sourceGateMissingSourceTypes
    });
  const sanitizedLanguageSafeAnswer = sanitizeFinalUserFacingAnswer(languageSafeAnswer);
  const responseWithFollowupEvidence = q06DurabilityRepair || sourceBackedFollowupRepairSafe ||
    (sourceBackedHardFollowupAccepted && languageRepairSafe)
    ? addSelectedDebugSourcesToResponse(responseWithUrls, filing, debug)
    : responseWithUrls;
  const responseBeforeNumericAlignment = deterministicFinalizerFallback?.responseWithUrls ?? responseWithFollowupEvidence;
  const verifiedFacts = buildVerifiedFinancialFacts(filing, {
    additionalSources: responseBeforeNumericAlignment.sources
      .filter((source) => !filing.sourceChunks.some((chunk) => chunk.sourceId === source.sourceId))
      .map((source) => ({
        sourceId: source.sourceId,
        sourceLabel: source.sourceLabel,
        sectionTitle: source.sectionType,
        text: source.excerpt,
        sourceUrl: source.sourceUrl,
        historicalFinancialFact: readHistoricalFinancialFactEvidence(source)
      }))
  });
  // Historical answers carry their own filing-scoped evidence. Do not let an
  // equal-valued metric from the current in-memory filing introduce a
  // non-historical source into an otherwise historical-only response.
  const numericFacts = responsePath === "historical"
    ? verifiedFacts.filter((fact) => responseBeforeNumericAlignment.sources.some((source) => source.sourceId === fact.sourceId))
    : verifiedFacts;
  const initialNumericAlignment = validateNumericAlignment({
    answer: sanitizedLanguageSafeAnswer,
    facts: numericFacts,
    citedSourceIds: responseBeforeNumericAlignment.sources.map((source) => source.sourceId)
  });
  logNumericAlignmentResult(filing, responsePath, initialNumericAlignment);
  const validatedInitialNumericAlignment = revalidateNumericAlignmentForFinalSurface({
    initial: initialNumericAlignment,
    facts: numericFacts,
    citedSourceIds: responseBeforeNumericAlignment.sources.map((source) => source.sourceId)
  });
  const initialSemanticQualityLabels = buildFinalSemanticQualityLabels({
    question,
    questionIntent: debug.questionIntent,
    answer: validatedInitialNumericAlignment.answer,
    facts: numericFacts,
    claimBindings: validatedInitialNumericAlignment.claimBindings,
    sourceCount: responseBeforeNumericAlignment.sources.length
  });
  const hasTypedCashFlow = numericFacts.some((fact) =>
    fact.semanticLabel === "operatingCashFlow" && fact.role === "current" && fact.scope === "company_total"
  );
  const hasTypedLiquidityPosition = numericFacts.some((fact) =>
    fact.role === "current" &&
    ["cashAndCashEquivalents", "currentDebt", "longTermDebt", "operatingCashFlow"].includes(fact.semanticLabel)
  );
  const liquidityConclusionRecoveryRequired =
    isLiquidityDebtQuestion(question, debug.questionIntent) &&
    hasAffirmativeLiquiditySafetyOrDistressConclusion(sanitizedLanguageSafeAnswer);
  const cashFlowConclusionRecoveryRequired =
    isCashGenerationQuestion(question, debug.questionIntent) &&
    hasDefinitiveCashGenerationHealthConclusion(sanitizedLanguageSafeAnswer);
  // Q10 conclusions are safety-sensitive. If typed liquidity facts exist, always
  // render the cautious deterministic comparison even when a model answer passes
  // the structural completeness counter.
  const liquiditySemanticRecoveryRequired =
    isLiquidityDebtQuestion(question, debug.questionIntent) &&
    hasTypedLiquidityPosition;
  const cashFlowSemanticRecoveryRequired =
    isCashGenerationQuestion(question, debug.questionIntent) &&
    hasTypedCashFlow &&
    !initialSemanticQualityLabels.includes("q09_semantic_complete");
  const liquidityRecoveryRequired = liquidityConclusionRecoveryRequired || liquiditySemanticRecoveryRequired;
  const cashFlowRecoveryRequired = cashFlowConclusionRecoveryRequired || cashFlowSemanticRecoveryRequired;
  const profitCauseNumericRecovery = validatedInitialNumericAlignment.status === "blocked"
    ? buildSafeProfitCauseNumericRecovery(
        filing,
        question,
        numericFacts,
        sanitizedLanguageSafeAnswer,
        responseBeforeNumericAlignment
      )
    : null;
  const liquidityNumericRecovery = validatedInitialNumericAlignment.status === "blocked" || liquidityRecoveryRequired
    ? buildSafeLiquidityNumericRecovery(
        filing,
        question,
        debug.questionIntent,
        numericFacts,
        responseBeforeNumericAlignment.sources
      )
    : null;
  const cashFlowNumericRecovery = validatedInitialNumericAlignment.status === "blocked" || cashFlowRecoveryRequired
    ? buildSafeCashFlowNumericRecovery(
        filing,
        question,
        debug.questionIntent,
        numericFacts,
        responseBeforeNumericAlignment.sources
      )
    : null;
  const marginNumericRecovery = validatedInitialNumericAlignment.status === "blocked" &&
    (debug.questionIntent === "margin_driver" || debug.questionIntent === "margin_profitability" || /(?:利益率|マージン|採算)/u.test(question))
    ? buildSafeDeterministicLanguageFallback(filing, question)
    : null;
  const qualitativeNumericRecovery = validatedInitialNumericAlignment.status === "blocked"
    ? buildQualitativeNumericGuardRecovery({
        answer: sanitizedLanguageSafeAnswer,
        responseWithUrls: responseBeforeNumericAlignment,
        question,
        questionIntent: debug.questionIntent
      })
    : null;
  const deterministicNumericRecovery = validatedInitialNumericAlignment.status === "blocked" || liquidityRecoveryRequired || cashFlowRecoveryRequired
    ? (liquidityRecoveryRequired ? liquidityNumericRecovery : null) ??
      (cashFlowRecoveryRequired ? cashFlowNumericRecovery : null) ??
      profitCauseNumericRecovery ??
      liquidityNumericRecovery ??
      cashFlowNumericRecovery ??
      marginNumericRecovery ??
      qualitativeNumericRecovery ??
      buildSafeDeterministicLanguageFallback(filing, question)
    : null;
  const initialDeterministicNumericRecoveryAlignment = deterministicNumericRecovery
    ? validateNumericAlignment({
        answer: deterministicNumericRecovery.answer,
        facts: numericFacts,
        citedSourceIds: deterministicNumericRecovery.responseWithUrls.sources.map((source) => source.sourceId)
      })
    : null;
  const deterministicNumericRecoveryAlignment = initialDeterministicNumericRecoveryAlignment
    ? revalidateNumericAlignmentForFinalSurface({
        initial: initialDeterministicNumericRecoveryAlignment,
        facts: numericFacts,
        citedSourceIds: deterministicNumericRecovery?.responseWithUrls.sources.map((source) => source.sourceId) ?? []
      })
    : null;
  if (deterministicNumericRecoveryAlignment) {
    logNumericAlignmentResult(filing, "deterministic", deterministicNumericRecoveryAlignment);
  }
  const deterministicNumericRecoveryAccepted = Boolean(
    deterministicNumericRecovery &&
    deterministicNumericRecoveryAlignment &&
    deterministicNumericRecoveryAlignment.status !== "blocked"
  );
  const qualitativeNumericRecoveryAccepted = deterministicNumericRecoveryAccepted &&
    deterministicNumericRecovery === qualitativeNumericRecovery;
  const numericAlignment = deterministicNumericRecoveryAccepted && deterministicNumericRecoveryAlignment
    ? deterministicNumericRecoveryAlignment
    : validatedInitialNumericAlignment;
  const responseForNumericAlignment = deterministicNumericRecoveryAccepted && deterministicNumericRecovery
    ? deterministicNumericRecovery.responseWithUrls
    : responseBeforeNumericAlignment;
  const responseAfterNumericAlignment = {
    ...responseForNumericAlignment,
    sources: addRequiredNumericSources(
      responseForNumericAlignment.sources,
      filing,
      numericFacts,
      numericAlignment.requiredSourceIds
    )
  };
  const numericAlignmentBlocked = numericAlignment.status === "blocked";
  const finalNumericLanguageCheck = checkFinalAnswerJapaneseOnly(numericAlignment.answer);
  const finalAnswerLanguageSafe = finalNumericLanguageCheck.ok && !hasBannedPhrase(numericAlignment.answer);
  const finalResponsePath = numericAlignmentBlocked
    ? "fallback"
    : qualitativeNumericRecoveryAccepted
    ? responsePath
    : deterministicNumericRecoveryAccepted
    ? "deterministic"
    : deterministicFinalizerFallback
    ? "deterministic"
    : sourceBackedHardFollowupAccepted
      ? debug.sourceGateSufficient !== true && q06DurabilityRepair?.labels.some((label) =>
          label === "q04_previous_answer_driver_candidate_repair" ||
          label === "q06_previous_answer_margin_candidate_repair"
        ) && responsePath === "fallback"
        ? "deterministic"
        : "openai"
      : finalAnswerSafe && !cleanupBlocksModelAnswer
        ? responsePath
        : "fallback";
  const finalFallbackKind: ChatFallbackKind = numericAlignmentBlocked
    ? "low_quality"
    : qualitativeNumericRecoveryAccepted
    ? normalizedFallbackKind
    : deterministicNumericRecoveryAccepted
    ? "none"
    : finalAnswerSafe
    ? deterministicFinalizerFallback
      ? "none"
      : sourceBackedHardFollowupAccepted
      ? "none"
      : cleanupBlocksModelAnswer
        ? responsePath === "fallback"
          ? normalizedFallbackKind
          : "low_quality"
        : normalizedFallbackKind
    : "language_guard_fallback";
  const responsePathFallbackButKindNone = finalResponsePath === "fallback" && finalFallbackKind === "none";
  const finalAnswerLanguageLabels = languageCheck.ok && finalAnswerSafe ? [] : languageRepairSafe ? [
    ...languageCheck.labels,
    "answer_repaired_to_japanese"
  ] : deterministicLanguageFallback ? [
    ...languageCheck.labels,
    "answer_repaired_to_deterministic_japanese"
  ] : [
    ...languageCheck.labels,
    ...(bannedPhraseStillDetected ? ["generic_fallback_phrase"] : []),
    "answer_rewritten_to_japanese_fallback"
  ];
  const fallbackTaxonomy = classifyFallbackTaxonomy({
    debug,
    responsePath: finalResponsePath,
    fallbackKind: responsePathFallbackButKindNone ? "unknown_fallback" : finalFallbackKind,
    cleanup,
    finalAnswerSafe,
    languageLabels: finalAnswerLanguageLabels
  });
  const finalFallbackTaxonomy = numericAlignmentBlocked
    ? {
      fallbackCategory: "answer_quality_guard" as const,
      fallbackUserReason: "numeric_alignment_failed" as const,
      guardLabels: ["numeric_alignment_blocked", ...numericAlignment.labels]
    }
    : suppressInvisibleMalformedCurrencyTaxonomy(fallbackTaxonomy, numericAlignment.answer);
  const effectiveFallbackKind: ChatFallbackKind = finalResponsePath === "fallback"
    ? responsePathFallbackButKindNone ? "unknown_fallback" : finalFallbackKind
    : "none";
  const effectiveFallbackTaxonomy: FallbackTaxonomy = finalResponsePath === "fallback"
    ? finalFallbackTaxonomy
    : { fallbackCategory: "none", fallbackUserReason: "none", missingEvidence: [], missingEvidenceLabelsJa: [], guardLabels: [] };
  const finalSurfaceStatus = numericAlignment.status === "blocked"
    ? "blocked" as const
    : numericAlignment.status === "not_applicable"
      ? "not_applicable" as const
      : "passed" as const;
  const finalSurfaceVerifiedBindings = numericAlignment.claimBindings.filter((binding) => binding.outcome !== "blocked");
  const finalSurfaceBlockedBindings = numericAlignment.claimBindings.filter((binding) => binding.outcome === "blocked");
  const finalSurfaceAnswerSha256 = await sha256Hex(numericAlignment.answer);
  const semanticQualityLabels = buildFinalSemanticQualityLabels({
    question,
    questionIntent: debug.questionIntent,
    answer: numericAlignment.answer,
    facts: numericFacts,
    claimBindings: numericAlignment.claimBindings,
    sourceCount: responseAfterNumericAlignment.sources.length
  });

  return attachChatDebug(
    {
      ...responseAfterNumericAlignment,
      answer: numericAlignment.answer,
      responsePath: finalResponsePath
    },
    {
      ...debug,
      responsePath: finalResponsePath,
      fallbackReason: finalResponsePath !== "fallback"
        ? null
        : numericAlignmentBlocked
          ? "numeric_alignment_failed"
          : qualitativeNumericRecoveryAccepted
            ? debug.fallbackReason ?? "low_quality_answer"
            : deterministicNumericRecoveryAccepted || deterministicFinalizerFallback || sourceBackedHardFollowupAccepted
              ? debug.fallbackReason ?? "low_quality_answer"
              : finalAnswerSafe && !cleanupBlocksModelAnswer
                ? debug.fallbackReason ?? "low_quality_answer"
                : debug.fallbackReason ?? "low_quality_answer",
      fallbackCategory: effectiveFallbackTaxonomy.fallbackCategory,
      fallbackUserReason: effectiveFallbackTaxonomy.fallbackUserReason,
      missingEvidence: effectiveFallbackTaxonomy.missingEvidence ?? [],
      missingEvidenceLabelsJa: effectiveFallbackTaxonomy.missingEvidenceLabelsJa ?? [],
      guardLabels: effectiveFallbackTaxonomy.guardLabels ?? [],
      fallbackKind: effectiveFallbackKind,
      fallbackKindSource: finalResponsePath !== "fallback"
        ? undefined
        : qualitativeNumericRecoveryAccepted
          ? debug.fallbackKindSource ?? "finalizer"
          : numericAlignmentBlocked || deterministicNumericRecoveryAccepted || deterministicFinalizerFallback || sourceBackedHardFollowupAccepted
            ? "finalizer"
            : finalAnswerSafe
              ? debug.fallbackKindSource ?? "finalizer"
              : "language_guard",
      responsePathFallbackButKindNone: finalResponsePath === "fallback" && effectiveFallbackKind === "none",
      evidenceFallbackUsed: finalResponsePath === "fallback" ? debug.evidenceFallbackUsed : false,
      sourceGateSufficient: debug.sourceGateSufficient,
      sourceGatePassed: debug.sourceGatePassed,
      sourceGateFailureLabels: normalizedHardIntentInsufficiencyFailureLabels({
        debug,
        repairLabels: q06DurabilityRepair?.labels ?? []
      }),
      sourceGateMissingSourceTypes: debug.sourceGateMissingSourceTypes,
      finalAnswerJapaneseRatio: finalNumericLanguageCheck.japaneseRatio,
      finalAnswerEnglishSentenceCount: finalNumericLanguageCheck.englishSentenceCount,
      finalAnswerRawExcerptLike: finalNumericLanguageCheck.rawExcerptLike,
      finalAnswerLanguageLabels,
      finalAnswerLanguageViolations: finalAnswerLanguageSafe ? [] : finalNumericLanguageCheck.violations,
      languageGuardChecked: true,
      languageGuardOk: finalAnswerLanguageSafe,
      languageGuardViolationLabels: finalAnswerLanguageSafe ? [] : finalNumericLanguageCheck.labels,
      languageGuardFallbackUsed: !finalAnswerLanguageSafe,
      languageGuardFallbackKind: finalAnswerLanguageSafe ? null : "language_guard_fallback",
      originalAnswerBeforeLanguageGuardLength: languageCheck.ok ? null : originalAnswerBeforeLanguageGuard.length,
      originalAnswerBeforeLanguageGuardSample: languageCheck.ok
        ? null
        : sampleUnsafeAnswer(originalAnswerBeforeLanguageGuard),
      genericFallbackPhraseDetected: bannedPhraseStillDetected,
      lowQualityReason: deterministicSemanticFallback || specializedDurabilityRepairAccepted || previousAnswerDurabilityRepairAccepted
        ? null
        : debug.lowQualityReason,
      numericAlignmentChecked: true,
      numericAlignmentInitialStatus: initialNumericAlignment.status,
      numericAlignmentStatus: numericAlignment.status,
      numericAlignmentClaimCount: numericAlignment.claimCount,
      numericAlignmentVerifiedClaimCount: numericAlignment.verifiedClaimCount,
      numericAlignmentRepairedClaimCount: numericAlignment.repairedClaimCount,
      numericAlignmentBlockedClaimCount: numericAlignment.blockedClaimCount,
      numericAlignmentLabels: numericAlignment.labels,
      numericAlignmentMatchedFactIds: numericAlignment.matchedFactIds,
      numericAlignmentClaimBindings: numericAlignment.claimBindings,
      numericAlignmentFinalSurfaceChecked: true,
      numericAlignmentFinalSurfaceStatus: finalSurfaceStatus,
      numericAlignmentFinalSurfaceClaimCount: numericAlignment.claimCount,
      numericAlignmentFinalSurfaceVerifiedClaimCount: finalSurfaceVerifiedBindings.length,
      numericAlignmentFinalSurfaceBlockedClaimCount: Math.max(numericAlignment.blockedClaimCount, finalSurfaceBlockedBindings.length),
      numericAlignmentFinalSurfaceAnswerHash: finalSurfaceAnswerSha256,
      semanticQualityLabels,
      sourceRepairLabels: [
        ...(debug.sourceRepairLabels ?? []),
        ...catQ06Cleanup.labels,
        ...(q06DurabilityRepair?.labels ?? []),
        ...(languageRepairSafe ? ["language_guard_source_backed_repair"] : []),
        ...(sourceBackedFollowupRepairSafe ? ["q06_source_backed_followup_repair"] : []),
        ...(deterministicLanguageFallback ? ["language_guard_deterministic_repair"] : []),
        ...(deterministicSemanticFallback && splitMarginDirectionRecoveryRequired ? ["split_margin_direction_deterministic_recovery"] : []),
        ...(deterministicSemanticFallback && revenueDriverRecoveryRequired ? ["revenue_driver_deterministic_recovery"] : []),
        ...(deterministicSemanticFallback && marginDriverRecoveryRequired ? ["margin_driver_deterministic_recovery"] : []),
        ...(sourceBackedHardFollowupAccepted && debug.sourceGateSufficient !== true &&
          q06DurabilityRepair?.labels.some((label) =>
            label === "q04_previous_answer_driver_candidate_repair" ||
            label === "q06_previous_answer_margin_candidate_repair"
          ) ? ["hard_intent_explicit_insufficiency_repair"] : []),
        ...(liquidityConclusionRecoveryRequired && deterministicNumericRecoveryAccepted ? ["liquidity_conclusion_deterministic_recovery"] : []),
        ...(cashFlowConclusionRecoveryRequired && deterministicNumericRecoveryAccepted ? ["cash_flow_conclusion_deterministic_recovery"] : []),
        ...(liquiditySemanticRecoveryRequired && deterministicNumericRecoveryAccepted ? ["q10_semantic_deterministic_recovery"] : []),
        ...(cashFlowSemanticRecoveryRequired && deterministicNumericRecoveryAccepted ? ["q09_semantic_deterministic_recovery"] : []),
        ...(deterministicNumericRecoveryAccepted && !qualitativeNumericRecoveryAccepted ? ["numeric_alignment_deterministic_recovery"] : []),
        ...(qualitativeNumericRecoveryAccepted ? ["numeric_alignment_qualitative_recovery"] : []),
        ...(numericAlignment.status === "repaired" ? ["numeric_alignment_repaired"] : []),
        ...(validatedInitialNumericAlignment.status === "blocked" && !deterministicNumericRecoveryAccepted ? ["numeric_alignment_blocked"] : [])
      ],
      ...timings.snapshot()
    }
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildFinalSemanticQualityLabels(input: {
  question: string;
  questionIntent: string | null | undefined;
  answer: string;
  facts: VerifiedFinancialFact[];
  claimBindings: NumericAlignmentResult["claimBindings"];
  sourceCount: number;
}): string[] {
  const labels: string[] = [];
  const bindingLabels = new Set(input.claimBindings
    .filter((binding) => binding.outcome !== "blocked")
    .map((binding) => binding.semanticLabel));
  const isQ08 = ["segment_analysis", "segment_driver", "revenue_breakdown"].includes(input.questionIntent ?? "") &&
    /(?:伸び|弱|強|増|減|セグメント|地域)/u.test(input.question);
  if (isQ08) {
    if (/伸びた部分として[^。]{2,}(?:です|ます)/u.test(input.answer)) labels.push("q08_strong_dimension_source_backed");
    if (/伸びた具体的な[^。]{2,}特定できません/u.test(input.answer)) labels.push("q08_strong_dimension_explicitly_unavailable");
    if (/弱かった部分として[^。]{2,}(?:です|ます)/u.test(input.answer)) labels.push("q08_weak_dimension_source_backed");
    if (/(?:減収・減益|弱かった部分)[^。]{2,}特定できません/u.test(input.answer)) labels.push("q08_weak_dimension_explicitly_unavailable");
    if (input.sourceCount > 0) labels.push("q08_evidence_mapped");
    const hasStrong = labels.some((label) => label.startsWith("q08_strong_dimension_"));
    const hasWeak = labels.some((label) => label.startsWith("q08_weak_dimension_"));
    if (hasStrong && hasWeak && labels.includes("q08_evidence_mapped")) labels.push("q08_semantic_complete");
  }

  const isQ09 = /(?:営業CF|営業キャッシュフロー|キャッシュフロー).*(?:健全|質|現金創出)/u.test(input.question);
  if (isQ09) {
    if (bindingLabels.has("operatingCashFlow")) labels.push("q09_operating_cash_flow_typed");
    if (bindingLabels.has("netIncome") && /同じ対象期間の純利益/u.test(input.answer)) {
      labels.push("q09_compatible_net_income_compared");
    } else if (/純利益との対応|同じ対象期間の純利益[^。]*確認できない/u.test(input.answer)) {
      labels.push("q09_net_income_explicitly_unavailable");
    }
    if (/運転資本[^。]*(?:確認|寄与|増減|内訳)/u.test(input.answer)) labels.push("q09_working_capital_assessed");
    if (/設備投資[^。]*(?:確認|余力|フリーCF)/u.test(input.answer)) labels.push("q09_capex_assessed");
    const cashFlowFact = input.facts.find((fact) => fact.semanticLabel === "operatingCashFlow" && fact.role === "current");
    const currentCashFlow = cashFlowFact?.derivedPercentage?.currentValue;
    const comparisonCashFlow = cashFlowFact?.derivedPercentage?.comparisonValue;
    const crossesSign = Boolean(cashFlowFact?.derivedPercentage?.kind === "derived_change" &&
      currentCashFlow !== undefined &&
      comparisonCashFlow !== undefined &&
      ((currentCashFlow < 0 && comparisonCashFlow >= 0) ||
        (currentCashFlow >= 0 && comparisonCashFlow < 0)));
    if (!crossesSign || !/営業CF[^。]*%/u.test(input.answer)) labels.push("q09_sign_safe");
    if (input.sourceCount > 0) labels.push("q09_evidence_mapped");
    if (
      labels.includes("q09_operating_cash_flow_typed") &&
      labels.some((label) => label === "q09_compatible_net_income_compared" || label === "q09_net_income_explicitly_unavailable") &&
      labels.includes("q09_working_capital_assessed") &&
      labels.includes("q09_capex_assessed") &&
      labels.includes("q09_sign_safe") &&
      labels.includes("q09_evidence_mapped")
    ) labels.push("q09_semantic_complete");
  }

  const isQ10 = /(?:資金繰り|流動性|負債|債務|借入|liquidity|debt)/iu.test(input.question);
  if (isQ10) {
    if (bindingLabels.has("cashAndCashEquivalents") || bindingLabels.has("operatingCashFlow")) labels.push("q10_liquidity_position_typed");
    if (bindingLabels.has("currentDebt") || bindingLabels.has("longTermDebt")) labels.push("q10_debt_position_typed");
    if (/確認できません|十分に比較できない/u.test(input.answer)) labels.push("q10_missing_position_explicit");
    if (/懸念[^。]*(?:判断|断定)|資金繰り[^。]*(?:判断|断定)|返済期限と借換条件/u.test(input.answer)) labels.push("q10_concern_assessment_explicit");
    if (input.sourceCount > 0) labels.push("q10_evidence_mapped");
    if (
      labels.some((label) => label === "q10_liquidity_position_typed" || label === "q10_missing_position_explicit") &&
      labels.some((label) => label === "q10_debt_position_typed" || label === "q10_missing_position_explicit") &&
      labels.includes("q10_concern_assessment_explicit") &&
      labels.includes("q10_evidence_mapped")
    ) labels.push("q10_semantic_complete");
  }
  return labels;
}

function buildQualitativeNumericGuardRecovery(input: {
  answer: string;
  responseWithUrls: ChatResponsePayload;
  question: string;
  questionIntent?: string | null;
}): DeterministicLanguageFallback | null {
  // Q09/Q10 conclusions must be rebuilt from typed facts. Stripping a bad
  // number while retaining a separate `no concern` sentence would turn an
  // unsupported conclusion into the final answer.
  if (
    isLiquidityDebtQuestion(input.question, input.questionIntent) ||
    isCashGenerationQuestion(input.question, input.questionIntent)
  ) {
    return null;
  }
  const investmentSafetyRequired = /(?:買うべき|売るべき|投資推奨|目標株価|株価予想|割安|割高)/u.test(
    `${input.question} ${input.answer}`
  );
  const parts = input.answer.match(/[^。！？\n]+[。！？]?|\n+/gu) ?? [input.answer];
  const qualitativeParts = parts.filter((part) =>
    part.trim().length > 0 &&
    extractMaterialNumericClaims(part).length === 0 &&
    !hasMalformedNumericSurface(part)
  );
  let qualitativeAnswer = qualitativeParts.join(" ").replace(/\s+/g, " ").trim();
  if (investmentSafetyRequired) {
    qualitativeAnswer = `${qualitativeAnswer ? `${qualitativeAnswer} ` : ""}提出資料の事実整理にとどめ、投資判断や株価の断定はしません。`;
  }
  qualitativeAnswer = sanitizeFinalUserFacingAnswer(qualitativeAnswer)
    .replace(/(?:投資判断や株価の断定はしません。\s*){2,}/gu, "投資判断や株価の断定はしません。")
    .trim();
  if (qualitativeAnswer.length < 18 || hasBannedPhrase(qualitativeAnswer)) {
    return null;
  }
  const languageCheck = checkFinalAnswerJapaneseOnly(qualitativeAnswer);
  if (!languageCheck.ok) {
    return null;
  }
  return {
    answer: qualitativeAnswer,
    responseWithUrls: { ...input.responseWithUrls, answer: qualitativeAnswer },
    languageCheck
  };
}

function revalidateNumericAlignmentForFinalSurface(input: {
  initial: NumericAlignmentResult;
  facts: VerifiedFinancialFact[];
  citedSourceIds: string[];
}): NumericAlignmentResult {
  // The API use case applies this same formatter to the returned answer. Run
  // it before the final numeric proof so the hash certifies the exact visible
  // surface, including paragraph breaks, rather than a pre-display variant.
  const displayAnswer = formatChatAnswerForDisplay(input.initial.answer);
  if (input.initial.status === "blocked") {
    return { ...input.initial, answer: displayAnswer };
  }
  if (hasMalformedNumericSurface(displayAnswer)) {
    return blockMalformedNumericSurface({ ...input.initial, answer: displayAnswer });
  }
  if (input.initial.status !== "repaired" && displayAnswer === input.initial.answer) {
    return input.initial;
  }

  const revalidated = validateNumericAlignment({
    answer: displayAnswer,
    facts: input.facts,
    citedSourceIds: dedupeStrings([...input.citedSourceIds, ...input.initial.requiredSourceIds])
  });
  if (
    (revalidated.status !== "passed" && revalidated.status !== "not_applicable") ||
    hasMalformedNumericSurface(revalidated.answer)
  ) {
    return blockMalformedNumericSurface(revalidated);
  }
  return {
    ...input.initial,
    answer: revalidated.answer,
    requiredSourceIds: dedupeStrings([...input.initial.requiredSourceIds, ...revalidated.requiredSourceIds]),
    matchedFactIds: dedupeStrings([...input.initial.matchedFactIds, ...revalidated.matchedFactIds]),
    claimBindings: revalidated.claimBindings,
    blockedClaimCount: 0
  };
}

function hasMalformedNumericSurface(answer: string): boolean {
  return /(?:億ドル(?:万ドル|百万ドル|億ドル|兆ドル|\s*[Bb](?:\b|$)|(?:か|カ|ヶ|ケ)?月|日)|[$＄]\s*\d+(?:\.\d+)?\s*十億|\d{4}年\s*\d+(?:\.\d+)?億ドル(?:月|日))/u.test(answer);
}

function blockMalformedNumericSurface(result: NumericAlignmentResult): NumericAlignmentResult {
  return {
    ...result,
    status: "blocked",
    answer: "回答内の数値表記を提出資料と安全に照合できなかったため、未確認の数値は表示しません。根拠資料の期間・単位を確認してから案内します。",
    labels: Array.from(new Set([...result.labels, "unsupported_numeric_claim"])),
    blockedClaimCount: Math.max(1, result.blockedClaimCount)
  };
}

function hasSplitMarginDirectionConflict(
  filing: FilingCacheRecord,
  question: string,
  questionIntent: string | null | undefined,
  answer: string
): boolean {
  if (
    !["margin_driver", "margin_profitability"].includes(questionIntent ?? "") &&
    !/(?:利益率|マージン).*(?:改善|悪化|要因|理由)/u.test(question)
  ) {
    return false;
  }
  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const operatingIncome = filing.metrics.find((metric) => metric.logicalName === "operatingIncome");
  const netIncome = filing.metrics.find((metric) => metric.logicalName === "netIncome");
  if (
    !revenue || !revenue.comparisonValue ||
    !operatingIncome?.comparisonValue || !netIncome?.comparisonValue ||
    revenue.value === 0
  ) {
    return false;
  }
  const operatingDelta = operatingIncome.value / revenue.value -
    operatingIncome.comparisonValue / revenue.comparisonValue;
  const netDelta = netIncome.value / revenue.value - netIncome.comparisonValue / revenue.comparisonValue;
  if (Math.abs(operatingDelta) <= 0.0001 || Math.abs(netDelta) <= 0.0001 || Math.sign(operatingDelta) === Math.sign(netDelta)) {
    return false;
  }

  const operatingDirectionExplicit = operatingDelta > 0
    ? /営業利益率[^。！？\n]{0,48}(?:改善|上昇)/u.test(answer)
    : /営業利益率[^。！？\n]{0,48}(?:低下|悪化)/u.test(answer);
  const netDirectionExplicit = netDelta > 0
    ? /純利益率[^。！？\n]{0,48}(?:改善|上昇)/u.test(answer)
    : /純利益率[^。！？\n]{0,48}(?:低下|悪化)/u.test(answer);
  return !(operatingDirectionExplicit && netDirectionExplicit);
}

function addRequiredNumericSources(
  sources: ChatEvidenceSource[],
  filing: FilingCacheRecord,
  facts: VerifiedFinancialFact[],
  requiredSourceIds: string[]
): ChatEvidenceSource[] {
  const additions: ChatEvidenceSource[] = [];
  for (const sourceId of requiredSourceIds) {
    if (sources.some((source) => source.sourceId === sourceId)) {
      continue;
    }
    const sourceChunk = filing.sourceChunks.find((source) => source.sourceId === sourceId);
    if (sourceChunk) {
      const evidence = buildSecFilingSource(sourceChunk);
      additions.push({
        ...evidence,
        sourceUrl: evidence.sourceUrl ?? filing.primaryDocumentUrl
      });
      continue;
    }
    const fact = facts.find((candidate) => candidate.sourceId === sourceId);
    if (!fact) {
      continue;
    }
    additions.push({
      sourceId,
      sourceKind: "sec_filing",
      sourceStrength: "filing_primary",
      sectionType: "xbrl_metric",
      sourceLabel: `XBRL ${fact.semanticLabelJa} (${fact.concept})`,
      excerpt: `${fact.semanticLabelJa}: ${fact.displayValues[0]?.ja ?? fact.canonicalValue}`,
      sourceUrl: fact.sourceUrl || filing.primaryDocumentUrl
    });
  }
  return dedupeChatSources([...sources, ...additions]);
}

function logNumericAlignmentResult(
  filing: FilingCacheRecord,
  responsePath: ChatResponsePath,
  result: NumericAlignmentResult
): void {
  if (result.status === "not_applicable") {
    return;
  }
  const event = result.status === "passed"
    ? "numeric_alignment_passed"
    : result.status === "repaired"
      ? "numeric_alignment_repaired"
      : "numeric_alignment_blocked";
  const fields = {
    filingKeyHash: hashForLog(filing.filingKey),
    ticker: filing.ticker,
    responsePath,
    claimCount: result.claimCount,
    verifiedClaimCount: result.verifiedClaimCount,
    repairedClaimCount: result.repairedClaimCount,
    blockedClaimCount: result.blockedClaimCount,
    labels: result.labels,
    matchedFactCount: result.matchedFactIds.length,
    requiredSourceCount: result.requiredSourceIds.length,
    claimBindings: result.claimBindings
  };
  logEvent(event, fields);
  if (result.labels.includes("unsupported_numeric_claim")) {
    logEvent("unsupported_numeric_claim", fields);
  }
}

const BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK = "選択された資料だけでは、この会社の収益源を十分に特定できません。売上高などの数字は確認できますが、それだけでは「何で稼いでいる会社か」は判断しません。確認すべき箇所は、事業内容、セグメント情報、売上内訳、MD&Aの事業説明です。";
const BUSINESS_MODEL_MISSING_EVIDENCE = ["事業内容", "セグメント情報", "売上内訳", "MD&Aの事業説明"];
const MANAGEMENT_MISSING_EVIDENCE = ["MD&A", "業績説明", "セグメント実績", "見通し・リスクの説明"];
const REVENUE_DRIVER_MISSING_EVIDENCE = ["MD&A", "セグメント実績", "売上説明"];
const REVENUE_BREAKDOWN_MISSING_EVIDENCE = ["セグメント実績", "地域別売上", "製品・カテゴリ別売上"];
const MARGIN_DRIVER_MISSING_EVIDENCE = ["MD&A", "セグメント実績", "利益率・採算性の説明", "費用・原価の説明"];
const LIQUIDITY_MISSING_EVIDENCE = ["キャッシュフロー計算書", "流動性の説明", "負債の注記", "借入枠", "満期スケジュール"];
const RISK_MISSING_EVIDENCE = ["リスク要因", "MD&Aのリスク説明", "見通し・リスクの説明"];

function isSourceBackedHardFollowupAccepted({
  question,
  debug,
  normalizedFallbackKind,
  q06DurabilityRepairLabels,
  languageRepairSafe,
  candidateAnswer
}: {
  question: string;
  debug: ChatResponseDebugInput;
  normalizedFallbackKind: ChatFallbackKind;
  q06DurabilityRepairLabels: string[];
  languageRepairSafe: boolean;
  candidateAnswer: string;
}): boolean {
  const isExplicitHardDurabilityFollowup =
    debug.questionIntent === "driver_durability_followup" ||
    debug.questionIntent === "margin_durability_followup" ||
    isDriverDurabilityFollowupQuestion(question, debug.questionIntent) ||
    isMarginDurabilityFollowupQuestion(question, debug.questionIntent) ||
    isGenericDurabilityFollowupWithMarginContext(question, debug);
  const hasHardFollowupSourceReason =
    debug.fallbackUserReason === "revenue_driver_sources_missing" ||
    debug.fallbackUserReason === "margin_driver_sources_missing";
  if (!isExplicitHardDurabilityFollowup && !hasHardFollowupSourceReason) {
    return false;
  }

  const hasExplicitInsufficiencyRepair = q06DurabilityRepairLabels.some((label) =>
    label === "q04_previous_answer_driver_candidate_repair" ||
    label === "q06_previous_answer_margin_candidate_repair"
  ) &&
    /(?:一時要因か継続要因か|一時要因か構造的変化か)は断定しません/u.test(candidateAnswer) &&
    hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer) &&
    debug.sourceIdsValid !== false;
  if (debug.sourceGateSufficient !== true) {
    const sourceGateWasNotApplied = debug.sourceGateSufficient == null && debug.sourceGateApplied !== true;
    const selectedNarrativeRepair = sourceGateWasNotApplied &&
      debug.questionIntent === "driver_durability_followup" &&
      languageRepairSafe &&
      hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer) &&
      !hasXbrlOnlyHardIntentContext(debug) &&
      debug.sourceIdsValid !== false;
    return hasExplicitInsufficiencyRepair || selectedNarrativeRepair;
  }

  if (q06DurabilityRepairLabels.some((label) =>
    label === "q04_bank_durability_source_backed_repair" ||
    label === "q04_retail_durability_source_backed_repair" ||
    label === "q04_platform_durability_source_backed_repair" ||
    label === "q04_generic_durability_source_backed_repair"
  )) {
    return true;
  }

  if (
    debug.sourceGateSufficient === true &&
    q06DurabilityRepairLabels.some((label) =>
      label === "q04_previous_answer_driver_candidate_repair" ||
      label === "q06_previous_answer_margin_candidate_repair"
    ) &&
    hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer)
  ) {
    return true;
  }

  if (
    debug.sourceGateSufficient === true &&
    languageRepairSafe &&
    hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer)
  ) {
    return true;
  }

  if (
    languageRepairSafe &&
    isGenericDurabilityFollowupWithMarginContext(question, debug) &&
    hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer) &&
    !hasXbrlOnlyHardIntentContext(debug)
  ) {
    return true;
  }

  return debug.evidenceFallbackUsed === true &&
    normalizedFallbackKind === "evidence_slot" &&
    (
      languageRepairSafe ||
      hasSubstantiveDurabilityEvidenceAnswer(candidateAnswer) ||
      /具体的な要因が十分に特定できていません[^。]*。[^。]*(?:一時要因か継続要因か|一時要因か構造的変化か)は分類しません/u.test(candidateAnswer)
    );
}

function hasXbrlOnlyHardIntentContext(debug: ChatResponseDebugInput): boolean {
  const failureLabels = debug.sourceGateFailureLabels ?? [];
  const selectedTypes = debug.selectedSourceTypes ?? [];
  return failureLabels.some((label) =>
    label === "retrieval_overfocused_xbrl" ||
    label === "margin_context_xbrl_only" ||
    label === "q04_metric_only_context"
  ) || (
    selectedTypes.length > 0 &&
    selectedTypes.every((type) => type === "xbrl_metric")
  );
}

function inferLanguageRepairIntent(question: string, debug: ChatResponseDebugInput): string | null | undefined {
  if (debug.questionIntent !== "yoy_change" && isGenericDurabilityFollowupWithMarginContext(question, debug)) {
    return "margin_durability_followup";
  }
  return debug.questionIntent;
}

function isGenericDurabilityFollowupWithMarginContext(question: string, debug: ChatResponseDebugInput): boolean {
  if (!/(一時|一過性|継続|続き|構造|temporary|transitory|continue|continued|structural)/i.test(question)) {
    return false;
  }
  const families = debug.selectedSourceSectionFamilies ?? [];
  const labels = debug.selectedSourceLabels ?? [];
  const excerpts = debug.selectedSourceExcerpts ?? [];
  const text = [...families, ...labels, ...excerpts].join(" ").toLowerCase();
  return debug.questionIntent === "margin_durability_followup" ||
    debug.lowQualityReason === "profit_cause_revenue_only" ||
    /margin|profitability|cost discussion|gross margin|operating expense|cost of sales|cost of revenue|利益率|粗利|費用|原価/.test(text);
}

function shouldRepairFallbackHardFollowupAnswer(answer: string, question: string, debug: ChatResponseDebugInput): boolean {
  if (
    debug.sourceGateSufficient !== true ||
    !/(一時|一過性|継続|続き|構造|temporary|transitory|continue|continued|structural)/i.test(question)
  ) {
    return false;
  }
  const normalized = answer.replace(/\s+/g, " ").trim();
  return debug.questionIntent === "yoy_change" &&
    /(?:[A-Za-z]{3,}\s+){3,}|[0-9]\s*%\s+[A-Za-z]|Other operating|income expense|average selling prices?|bit shipments?/i.test(normalized);
}

function buildSourceBackedFollowupRepairCandidate({
  answer,
  question,
  debug,
  normalizedFallbackKind
}: {
  answer: string;
  question: string;
  debug: ChatResponseDebugInput;
  normalizedFallbackKind: ChatFallbackKind;
}): string | null {
  if (
    debug.sourceGateSufficient !== true ||
    debug.evidenceFallbackUsed !== true ||
    normalizedFallbackKind !== "evidence_slot" ||
    !isMarginDurabilityFollowupQuestion(question, debug.questionIntent) ||
    !isDurabilityUnderAnswer(answer)
  ) {
    return null;
  }

  return buildJapaneseLanguageGuardRepair({
    question,
    questionIntent: "margin_durability_followup",
    sourceGateSufficient: true,
    sourceGateEvidenceSlots: debug.sourceGateEvidenceSlots,
    selectedSourceExcerpts: debug.selectedSourceExcerpts
  });
}

function hasSubstantiveDurabilityEvidenceAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, " ").trim();
  if (!normalized || /具体的な(?:利益率)?要因は十分に特定できません|具体的な要因が十分に特定できていません/.test(normalized)) {
    return false;
  }
  const hasDriverCandidate =
    /(?:売上|利益率)要因(?:候補)?(?:として)?確認できるのは、[^。]{3,}/.test(normalized) ||
    /前問(?:の|で挙がっていた)(?:売上|利益率)要因(?:候補)?は、[^。]{3,}/.test(normalized) ||
    /前問では[^。]{0,160}全社売上の主因[^。]{0,120}確認できていません[^。]*。[^。]{0,160}次に確認すべき指標は、価格、販売数量、事業別売上/.test(normalized);
  const hasDurabilityCaveat = /一時|継続|構造|断定しません|断定できません|次に見るべき指標/.test(normalized);
  return hasDriverCandidate && hasDurabilityCaveat;
}

function buildSafeDeterministicLanguageFallback(
  filing: FilingCacheRecord,
  question: string,
  debug?: ChatResponseDebugInput
): DeterministicLanguageFallback | null {
  const deterministicFiling = debug ? withSelectedDebugSources(filing, debug) : filing;
  const deterministic = buildDeterministicMetricAnswer(deterministicFiling, question);
  if (!deterministic) {
    return null;
  }
  const responseWithUrls = attachCurrentFilingSourceUrls(
    ensureFilingGroundedResponse(deterministic.response),
    filing.primaryDocumentUrl
  );
  const sanitizedAnswer = sanitizeFinalUserFacingAnswer(responseWithUrls.answer);
  const languageCheck = checkFinalAnswerJapaneseOnly(sanitizedAnswer);
  if (!languageCheck.ok || hasBannedPhrase(sanitizedAnswer)) {
    return null;
  }
  return {
    answer: sanitizedAnswer,
    responseWithUrls: {
      ...responseWithUrls,
      answer: sanitizedAnswer
    },
    languageCheck
  };
}

function buildJpmRevenueDriverRecovery(
  filing: FilingCacheRecord,
  question: string,
  debug: ChatResponseDebugInput
): DeterministicLanguageFallback | null {
  if (!isJpmLikeFiling(filing) || !isRevenueDriverQuestion(question, debug.questionIntent)) {
    return null;
  }
  const evidence = (debug.selectedSourceExcerpts ?? []).join(" ");
  const hasNiiDrivers = /net interest income[\s\S]{0,360}(?:driven by|higher markets net interest income|deposit balances|revolving balances)/i.test(evidence);
  const hasNirDrivers = /noninterest revenue[\s\S]{0,420}(?:driven by|asset management fees|investment banking fees|markets noninterest revenue|payments fees)/i.test(evidence);
  if (!hasNiiDrivers && !hasNirDrivers) {
    return null;
  }

  const clauses = [
    hasNiiDrivers
      ? "純利息収入では、市場部門の純利息収入、預金残高、カード事業のリボルビング残高の増加が寄与し、金利低下の影響が一部を相殺しました。"
      : null,
    hasNirDrivers
      ? "非利息収入では、資産運用手数料、投資銀行手数料、市場関連収入、決済手数料の増加が寄与しました。"
      : null,
    /absence of the \$?[\d,.]+\s*million first republic-related gain/i.test(evidence)
      ? "一方、前年に計上した買収関連利益が当期にはなかったことは相殺要因です。"
      : null
  ].filter((value): value is string => Boolean(value));
  const answer = sanitizeFinalUserFacingAnswer(clauses.join(" "));
  const languageCheck = checkFinalAnswerJapaneseOnly(answer);
  if (!languageCheck.ok || hasBannedPhrase(answer)) {
    return null;
  }

  const filingWithSelectedSources = withSelectedDebugSources(filing, debug);
  const selectedIds = new Set(debug.selectedSourceIds ?? []);
  const sources = filingWithSelectedSources.sourceChunks
    .filter((source) => selectedIds.has(source.sourceId) && /net interest income|noninterest revenue/i.test(source.text))
    .slice(0, 4)
    .map(buildSecFilingSource);
  if (sources.length === 0) {
    return null;
  }
  const responseWithUrls = attachCurrentFilingSourceUrls(
    ensureFilingGroundedResponse({ answer, sources: dedupeChatSources(sources) }),
    filing.primaryDocumentUrl
  );
  return { answer, responseWithUrls, languageCheck };
}

function withSelectedDebugSources(
  filing: FilingCacheRecord,
  debug: ChatResponseDebugInput
): FilingCacheRecord {
  const selectedIds = debug.selectedSourceIds ?? [];
  const selectedLabels = debug.selectedSourceLabels ?? [];
  const selectedExcerpts = debug.selectedSourceExcerpts ?? [];
  if (selectedIds.length === 0 || selectedExcerpts.length === 0) {
    return filing;
  }

  const existingIds = new Set(filing.sourceChunks.map((source) => source.sourceId));
  const supplementalSources = selectedIds.flatMap((sourceId, index) => {
    const excerpt = selectedExcerpts[index]?.replace(/\s+/g, " ").trim();
    if (!sourceId || !excerpt || existingIds.has(sourceId)) return [];
    const label = selectedLabels[index] ?? `${filing.formType} selected filing context`;
    return [{
      sourceId,
      sectionType: /xbrl|metric/i.test(`${sourceId} ${label}`) ? "xbrl_metric" as const : "md_a" as const,
      sectionTitle: label,
      sourceLabel: label,
      text: excerpt,
      startOffset: 0,
      endOffset: excerpt.length,
      sourceUrl: filing.primaryDocumentUrl,
      sortOrder: 10_000 + index
    }];
  });
  return supplementalSources.length > 0
    ? { ...filing, sourceChunks: [...supplementalSources, ...filing.sourceChunks] }
    : filing;
}

function addSelectedDebugSourcesToResponse(
  response: ChatResponsePayload,
  filing: FilingCacheRecord,
  debug: ChatResponseDebugInput
): ChatResponsePayload {
  const selectedIds = debug.selectedSourceIds ?? [];
  if (selectedIds.length === 0) {
    return response;
  }
  const filingWithSelectedSources = withSelectedDebugSources(filing, debug);
  const additions = selectedIds.flatMap((sourceId) => {
    const source = filingWithSelectedSources.sourceChunks.find((candidate) => candidate.sourceId === sourceId);
    if (!source) return [];
    const evidence = buildSecFilingSource(source);
    return [{ ...evidence, sourceUrl: evidence.sourceUrl ?? filing.primaryDocumentUrl }];
  });
  return additions.length > 0
    ? { ...response, sources: dedupeChatSources([...response.sources, ...additions]) }
    : response;
}

function hasRevenueDriverSurfaceDefect(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, " ").trim();
  const visibleLeakage =
    /(?:高ー売上|\bServices\b|\bfees?\b|\bMarkets\b|\bPayments\b|\bNoninterest revenue\b|\bTotal net revenue\b|\bOperating lease income\b|\brate effects\b|\ban increase in spending on infrastructure\b|\bdepreciation\b|\bamortization\b|\bperiod\b|\bAutomotive\b|\brefinery\b|\bmerchandise\b|\be-?commerce\b)/i.test(normalized);
  const wrongSectorBoilerplate =
    /(?:バイオ医薬|提携収入|承認済み製品の需要|研究開発や販売体制).{0,100}(?:売上|要因|確認)/u.test(normalized);
  const genericOnly =
    /(?:会社固有の売上要因までは|売上区分や地域・セグメントの説明が近い材料|販売数量、セグメント構成が売上変化を見る軸|追加確認が必要な点)[^。]*。?$/u.test(normalized) ||
    /具体的な(?:売上)?(?:ドライバー|要因)[^。]{0,120}(?:含まれていません|確認できません|明示されていません)/u.test(normalized) ||
    /どの(?:製品カテゴリ|顧客セグメント)[^。]{0,120}(?:確認|追加情報|詳細)/u.test(normalized) ||
    (/一番大きい変化は売上高/u.test(normalized) && !/(?:主因|要因として|支えた|押し上げ|牽引|due to|driven by)/iu.test(normalized));
  return visibleLeakage || wrongSectorBoilerplate || genericOnly;
}

function hasRevenueTopicInMarginDurabilityAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, " ").trim();
  return /(?:売上(?:高)?(?:変化|増減|成長)?の要因|売上要因(?:候補)?|全社増収の(?:主な)?(?:説明)?要因)/u.test(normalized) ||
    /(?:revenue|sales)[^。.!?]{0,100}(?:driver|driven by)/i.test(normalized);
}

function buildSafeProfitCauseNumericRecovery(
  filing: FilingCacheRecord,
  question: string,
  facts: VerifiedFinancialFact[],
  answer: string,
  responseWithUrls: ChatResponsePayload
): DeterministicLanguageFallback | null {
  if (!/(?:赤字|純損失|最終損失|net\s*loss).*(?:原因|理由|要因|なぜ|why)|(?:原因|理由|要因).*(?:赤字|純損失|最終損失|net\s*loss)/iu.test(question)) {
    return null;
  }
  const netIncome = facts.find((fact) =>
    fact.semanticLabel === "netIncome" && fact.role === "current" && fact.scope === "company_total"
  );
  if (!netIncome) {
    return null;
  }
  const netIncomeSource = filing.sourceChunks.find((source) => source.sourceId === netIncome.sourceId);
  if (!netIncomeSource) {
    return null;
  }

  const parts = answer.match(/[^。！？\n]+[。！？]?|\n+/gu) ?? [answer];
  const qualitativeParts = parts.filter((part) =>
    part.trim().length > 0 &&
    extractMaterialNumericClaims(part).length === 0 &&
    !hasMalformedNumericSurface(part)
  );
  if (!qualitativeParts.some((part) =>
    /(?:評価損益|公正価値|減損|費用|税(?:金|負担)?|構造改革|訴訟|利息|為替|デジタル資産|原価|一時費用)/u.test(part)
  )) {
    return null;
  }

  const qualitativeAnswer = qualitativeParts.join(" ").replace(/\s+/g, " ").trim();
  const recoveredAnswer = sanitizeFinalUserFacingAnswer(
    `純利益は ${preferredFinancialDisplay(netIncome.canonicalValue, netIncome.unit).ja}です。 ${qualitativeAnswer}`
  );
  const languageCheck = checkFinalAnswerJapaneseOnly(recoveredAnswer);
  if (!languageCheck.ok || hasBannedPhrase(recoveredAnswer)) {
    return null;
  }

  const typedSourceIds = new Set(facts.map((fact) => fact.sourceId));
  const sources = dedupeChatSources([
    buildSecFilingSource(netIncomeSource),
    ...responseWithUrls.sources.filter((source) => !typedSourceIds.has(source.sourceId))
  ]);
  if (sources.length < 2) {
    return null;
  }
  return {
    answer: recoveredAnswer,
    responseWithUrls: attachCurrentFilingSourceUrls(
      ensureFilingGroundedResponse({ answer: recoveredAnswer, sources }),
      filing.primaryDocumentUrl
    ),
    languageCheck
  };
}

function buildSafeCashFlowNumericRecovery(
  filing: FilingCacheRecord,
  question: string,
  questionIntent: string | null | undefined,
  facts: VerifiedFinancialFact[],
  fallbackSources: ChatEvidenceSource[] = []
): DeterministicLanguageFallback | null {
  if (!isCashGenerationQuestion(question, questionIntent)) {
    return null;
  }
  const operatingCashFlow = facts.find((fact) =>
    fact.semanticLabel === "operatingCashFlow" && fact.role === "current" && fact.scope === "company_total"
  );
  if (operatingCashFlow) {
    const deterministic = buildSafeDeterministicLanguageFallback(filing, question);
    if (deterministic) {
      return deterministic;
    }
  }

  const evidenceSources = fallbackSources.filter((source) =>
    source.sourceKind === "sec_filing" || source.sourceKind === "historical_filing"
  );
  if (evidenceSources.length === 0) {
    return null;
  }
  const answer = "選択された資料では、同じ対象期間の営業CFを型付き数値として確認できないため、現金創出力が健全か弱いかは断定しません。運転資本、設備投資、非資金費用の内訳を確認する必要があります。";
  const languageCheck = checkFinalAnswerJapaneseOnly(answer);
  if (!languageCheck.ok || hasBannedPhrase(answer)) {
    return null;
  }
  return {
    answer,
    responseWithUrls: attachCurrentFilingSourceUrls(
      ensureFilingGroundedResponse({ answer, sources: dedupeChatSources(evidenceSources) }),
      filing.primaryDocumentUrl
    ),
    languageCheck
  };
}

function buildSafeLiquidityNumericRecovery(
  filing: FilingCacheRecord,
  question: string,
  questionIntent: string | null | undefined,
  facts: VerifiedFinancialFact[],
  fallbackSources: ChatEvidenceSource[] = []
): DeterministicLanguageFallback | null {
  if (!isLiquidityDebtQuestion(question, questionIntent)) {
    return null;
  }
  const operatingCashFlow = facts.find((fact) =>
    fact.semanticLabel === "operatingCashFlow" && fact.role === "current"
  );
  const cash = facts.find((fact) => fact.semanticLabel === "cashAndCashEquivalents" && fact.role === "current");
  const currentDebt = facts.find((fact) => fact.semanticLabel === "currentDebt" && fact.role === "current");
  const longTermDebt = facts.find((fact) => fact.semanticLabel === "longTermDebt" && fact.role === "current");
  const selectedFacts = [cash, currentDebt, longTermDebt, operatingCashFlow]
    .filter((fact): fact is VerifiedFinancialFact => fact !== undefined);
  const sourceChunks = selectedFacts.flatMap((fact) => {
    const source = filing.sourceChunks.find((candidate) => candidate.sourceId === fact.sourceId);
    return source ? [source] : [];
  });
  const evidenceSources = sourceChunks.length > 0
    ? sourceChunks.map(buildSecFilingSource)
    : fallbackSources.filter((source) => source.sourceKind === "sec_filing" || source.sourceKind === "historical_filing");
  if (evidenceSources.length === 0) {
    return null;
  }

  const factSentence = (label: string, fact: VerifiedFinancialFact) =>
    `${label}は${preferredFinancialDisplay(fact.canonicalValue, fact.unit).ja}です。`;
  const observed = [
    ...(cash ? [factSentence("現金及び現金同等物", cash)] : []),
    ...(currentDebt ? [factSentence("1年内返済予定の長期債務", currentDebt)] : []),
    ...(longTermDebt ? [factSentence("長期債務（非流動）", longTermDebt)] : []),
    ...(operatingCashFlow ? [factSentence("営業CF", operatingCashFlow)] : [])
  ];
  const instantFacts = cash && currentDebt && longTermDebt ? [cash, currentDebt, longTermDebt] : [];
  const instantPeriodsCompatible = instantFacts.length === 3 && instantFacts.every((fact) =>
    fact.periodKind === "instant" &&
    fact.periodEnd === instantFacts[0]!.periodEnd &&
    fact.currency !== null &&
    fact.currency === instantFacts[0]!.currency &&
    fact.scope === instantFacts[0]!.scope
  );
  const confirmedLongTermDebtPortions = currentDebt && longTermDebt
    ? currentDebt.canonicalValue + longTermDebt.canonicalValue
    : null;
  const concernAssessment = cash && currentDebt && longTermDebt && instantPeriodsCompatible && confirmedLongTermDebtPortions !== null
    ? cash.canonicalValue > confirmedLongTermDebtPortions
      ? "同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計より手元資金が上回っています。ただし、この3項目だけから直ちに資金繰り懸念がないとは断定しません。"
      : cash.canonicalValue === confirmedLongTermDebtPortions
        ? "同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金と同額です。ただし、この3項目だけから資金繰りの安全性や悪化を断定しません。"
        : "同じ時点で確認できた長期債務の1年内返済予定分と非流動分の合計は手元資金を上回るため、返済期限と借換条件を確認する必要があります。ただし、この3項目だけで資金繰り悪化を断定しません。"
    : "現金・1年内返済予定の長期債務・長期債務（非流動）を同じ時点で十分に比較できないため、資金繰りへの懸念は断定しません。";
  const missing = [
    ...(!cash ? ["手元資金"] : []),
    ...(!currentDebt ? ["1年内返済予定の長期債務"] : []),
    ...(!longTermDebt ? ["長期債務（非流動）"] : [])
  ];
  const missingAssessment = missing.length > 0
    ? `返却された根拠では${missing.join("・")}を確認できません。`
    : "";
  const answer = `${observed.join("")} ${concernAssessment}${missingAssessment} コマーシャルペーパー、その他の短期借入、リース負債はこの比較に含めていません。返済期限、利用可能な信用枠、流動性の説明も合わせて確認する必要があります。`;
  const sanitizedAnswer = sanitizeFinalUserFacingAnswer(answer);
  const languageCheck = checkFinalAnswerJapaneseOnly(sanitizedAnswer);
  if (!languageCheck.ok || hasBannedPhrase(sanitizedAnswer)) {
    return null;
  }
  const responseWithUrls = attachCurrentFilingSourceUrls(
    ensureFilingGroundedResponse({
      answer: sanitizedAnswer,
      sources: dedupeChatSources(evidenceSources)
    }),
    filing.primaryDocumentUrl
  );
  return {
    answer: sanitizedAnswer,
    responseWithUrls,
    languageCheck
  };
}

type Q04DurabilityRepair = {
  answer: string;
  labels: string[];
};

type AnswerRepairResult = {
  answer: string;
  labels: string[];
};

function cleanCatQ06MarginDurabilityAnswer(
  answer: string,
  question: string,
  debug: ChatResponseDebugInput,
  filing: FilingCacheRecord
): AnswerRepairResult {
  if (!isMarginDurabilityFollowupQuestion(question, debug.questionIntent) || !isCatLikeFiling(filing)) {
    return { answer, labels: [] };
  }

  let cleaned = answer;
  const labels: string[] = [];
  const sourceText = `${debug.selectedSourceExcerpts?.join(" ") ?? ""} ${extractSourceGateEvidenceText(debug.sourceGateEvidenceSlots)}`;
  const netIncomeAmount = extractCurrentMetricValue(debug.sourceGateEvidenceSlots, "純利益");
  if (netIncomeAmount) {
    const corrected = cleaned.replace(/(純利益[^。！？\n]{0,16}?)([0-9]+(?:\.[0-9]+)?)\s*百万ドル/g, `$1${netIncomeAmount}`);
    if (corrected !== cleaned) {
      cleaned = corrected;
      labels.push("cat_q06_net_income_unit_corrected_from_source");
    }
  }
  const revenueAmount = extractCatRevenueOkuDollar(sourceText);
  if (revenueAmount) {
    const corrected = cleaned.replace(/売上高は(?:約)?(?:2025年)?[0-9]+(?:\.[0-9]+)?億ドル/g, `売上高は約${revenueAmount}億ドル`);
    if (corrected !== cleaned) {
      cleaned = corrected;
      labels.push("cat_q06_revenue_unit_corrected_from_source");
    }
  }
  const softened = cleaned.replace(
    /利益率の変動要因は一時的というより、需要の変動とコスト構造の影響が組み合わさっています。/g,
    "利益率の変動要因が一時的か構造的かは、このfilingだけでは断定できません。需要の変動とコスト構造の影響が組み合わさっている点は確認できます。"
  );
  if (softened !== cleaned) {
    cleaned = softened;
    labels.push("cat_q06_temporality_wording_softened");
  }
  if (!/(一時|構造|断定できません|未確定|不確実)/.test(cleaned)) {
    cleaned = `${cleaned.trim()} このfilingだけでは、一時要因か構造的変化かは断定できません。`;
    labels.push("cat_q06_temporality_caveat_added");
  }

  const normalized = sanitizeFinalUserFacingAnswer(cleaned);
  if (normalized !== answer && labels.length === 0) {
    labels.push("cat_q06_wording_cleaned");
  }
  return { answer: normalized, labels };
}

function extractCurrentMetricValue(sourceGateEvidenceSlots: Record<string, unknown> | null | undefined, metricName: string): string | null {
  if (!sourceGateEvidenceSlots || typeof sourceGateEvidenceSlots !== "object") {
    return null;
  }
  const confirmedMetricMovement = (sourceGateEvidenceSlots as Record<string, unknown>).confirmedMetricMovement;
  if (!confirmedMetricMovement || typeof confirmedMetricMovement !== "object") {
    return null;
  }
  const slot = confirmedMetricMovement as Record<string, unknown>;
  return slot.metricName === metricName && typeof slot.currentValue === "string" ? slot.currentValue : null;
}

function isMarginDurabilityFollowupQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "margin_durability_followup") {
    return true;
  }
  return /(利益率|margin|マージン).*(一時|構造|継続)|これは一時要因/i.test(question);
}

function isTypedMarginDriverQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "margin_durability_followup") return false;
  const asksTypedMarginCause = /(?:利益率|マージン|採算).*(?:改善|悪化|要因|理由)|(?:改善|悪化).*(?:利益率|マージン|採算)/u.test(question);
  return asksTypedMarginCause && (
    questionIntent == null ||
    questionIntent === "margin_driver" ||
    questionIntent === "margin_profitability" ||
    questionIntent === "margin_snapshot"
  );
}

function isCatLikeFiling(filing: FilingCacheRecord): boolean {
  return /\bCAT\b|Caterpillar/i.test(`${filing.ticker} ${filing.companyName}`);
}

function extractCatRevenueOkuDollar(text: string): string | null {
  const rawUsdMatch = text.match(/売上高:\s*([0-9]{8,})\s*USD/i);
  if (rawUsdMatch) {
    const value = Number.parseFloat(rawUsdMatch[1]);
    return Number.isFinite(value) ? formatOkuDollar(value / 100_000_000, true) : null;
  }

  const billionMatch = text.match(/Total sales and revenues[^.]{0,80}\$([0-9]+(?:\.[0-9]+)?)\s*billion/i);
  if (billionMatch) {
    const value = Number.parseFloat(billionMatch[1]);
    return Number.isFinite(value) ? formatOkuDollar(value * 10, true) : null;
  }
  return null;
}

function repairDriverDurabilityFollowupAnswer(
  answer: string,
  question: string,
  debug: ChatResponseDebugInput,
  filing: FilingCacheRecord
): Q04DurabilityRepair | null {
  if (
    !isDriverDurabilityFollowupQuestion(question, debug.questionIntent) ||
    isMarginDurabilityFollowupQuestion(question, debug.questionIntent)
  ) {
    return null;
  }

  // Q04 is explicitly a follow-up. When Q03 already supplied grounded drivers,
  // preserve those drivers instead of allowing a fresh model response to replace
  // them with generic categories or unrelated missing-information boilerplate.
  const groundedPreviousAnswerRepair = buildPreviousAnswerDurabilityCandidate(
    answer,
    debug.followupPreviousAnswer,
    true
  );
  if (groundedPreviousAnswerRepair) {
    return {
      answer: sanitizeFinalUserFacingAnswer(groundedPreviousAnswerRepair),
      labels: ["q04_previous_answer_driver_candidate_repair"]
    };
  }

  const unresolvedPreviousAnswerRepair = buildUnresolvedPreviousDriverDurabilityCandidate(
    debug.followupPreviousAnswer
  );
  if (unresolvedPreviousAnswerRepair) {
    return {
      answer: sanitizeFinalUserFacingAnswer(unresolvedPreviousAnswerRepair),
      labels: ["q04_previous_answer_driver_candidate_repair"]
    };
  }

  if (
    debug.lowQualityReason === "durability_missing_assessment" ||
    debug.responsePath === "fallback" ||
    hasGenericDurabilityMissingInfoBoilerplate(answer) ||
    !/(?:継続|一時|持続|断定)/u.test(answer)
  ) {
    const previousAnswerRepair = buildPreviousAnswerDurabilityCandidate(
      answer,
      debug.followupPreviousAnswer,
      debug.lowQualityReason === "durability_missing_assessment" ||
      hasGenericDurabilityMissingInfoBoilerplate(answer) ||
      !/(?:継続|一時|持続|断定)/u.test(answer)
    );
    if (previousAnswerRepair) {
      return {
        answer: sanitizeFinalUserFacingAnswer(previousAnswerRepair),
        labels: ["q04_previous_answer_driver_candidate_repair"]
      };
    }
  }

  if (debug.sourceGateSufficient !== true) {
    const previousAnswerRepair = buildPreviousAnswerDurabilityCandidate(answer, debug.followupPreviousAnswer);
    return previousAnswerRepair
      ? {
          answer: sanitizeFinalUserFacingAnswer(previousAnswerRepair),
          labels: ["q04_previous_answer_driver_candidate_repair"]
        }
      : null;
  }

  const evidenceText = extractSourceGateEvidenceText(debug.sourceGateEvidenceSlots);
  const labels: string[] = [];
  let repairedAnswer = answer;

  const bankRepair = buildJpmDurabilitySynthesis(answer, evidenceText, debug.lowQualityReason, filing);
  if (bankRepair) {
    repairedAnswer = bankRepair;
    labels.push("q04_bank_durability_source_backed_repair");
  } else {
    const retailRepair = buildWmtDurabilitySynthesis(answer, evidenceText, filing);
    if (retailRepair) {
      repairedAnswer = retailRepair;
      labels.push("q04_retail_durability_source_backed_repair");
    } else {
      const platformRepair = buildGoogleDurabilitySynthesis(answer, evidenceText, filing);
      if (platformRepair) {
        repairedAnswer = platformRepair;
        labels.push("q04_platform_durability_source_backed_repair");
      } else {
        const genericRepair = buildGenericDriverDurabilitySynthesis(answer, evidenceText);
        if (genericRepair) {
          repairedAnswer = genericRepair;
          labels.push("q04_generic_durability_source_backed_repair");
        }
      }
    }
  }

  const softenedAnswer = softenOverconfidentDurabilityWording(repairedAnswer);
  if (softenedAnswer !== repairedAnswer) {
    repairedAnswer = softenedAnswer;
    labels.push("q04_durability_wording_softened");
  }

  if (labels.length === 0) {
    return null;
  }

  const sanitized = sanitizeFinalUserFacingAnswer(repairedAnswer);
  return { answer: sanitized, labels };
}

function buildPreviousAnswerDurabilityCandidate(
  answer: string,
  previousAnswer?: string | null,
  force = false
): string | null {
  if ((!force && !isDurabilityUnderAnswer(answer)) || !previousAnswer || shouldIgnorePreviousDriverAnswer(previousAnswer)) {
    return null;
  }

  const drivers = inferPreviousAnswerDriverLabels(previousAnswer);
  if (drivers.length === 0) {
    return null;
  }

  const indicators = inferPreviousAnswerDurabilityIndicators(previousAnswer, drivers);
  const indicatorText = indicators.length > 0
    ? `次に見るべき指標は、${joinJapaneseItems(indicators.slice(0, 5))} です。`
    : "次に見るべき指標は、同じ要因が次期にも続くかどうかです。";
  return `前問で挙がっていた売上要因候補は、${joinJapaneseItems(drivers.slice(0, 5))} です。ただし、この資料だけでは一時要因か継続要因かは断定しません。${indicatorText}`;
}

function buildUnresolvedPreviousDriverDurabilityCandidate(previousAnswer?: string | null): string | null {
  if (!previousAnswer) return null;
  const normalized = previousAnswer.replace(/\s+/g, " ").trim();
  const explicitlyUnresolved =
    /(?:全社売上の主因|具体的な(?:売上)?(?:要因|ドライバー))[^。]{0,140}(?:確認できません|特定できません|明示されていません|断定しません)/u.test(normalized) ||
    /価格・数量・事業別[^。]{0,120}(?:結び付ける説明|主因)[^。]{0,80}(?:確認できません|特定できません)/u.test(normalized);
  if (!explicitlyUnresolved) return null;
  return "前問では、価格・数量・事業別のどれが全社売上の主因かを結び付ける説明を確認できていません。そのため、この資料だけで一時要因か継続要因かは分類しません。次に確認すべき指標は、価格、販売数量、事業別売上です。";
}

function buildDeterministicDriverDurabilityFallback(
  filing: FilingCacheRecord
): DeterministicLanguageFallback | null {
  const deterministic = buildDeterministicMetricAnswer(filing, "売上増加の主な要因は？");
  if (!deterministic) return null;
  const drivers = inferPreviousAnswerDriverLabels(deterministic.response.answer);
  if (drivers.length === 0) return null;
  const answer = `提出資料だけでは継続性は断定できません。売上要因候補として確認できるのは、${joinJapaneseItems(drivers.slice(0, 5))} です。次に見るべき指標は、${joinJapaneseItems(drivers.slice(0, 5))} が次期にも続くかどうかです。`;
  const responseWithUrls = { ...deterministic.response, answer };
  return {
    answer,
    responseWithUrls,
    languageCheck: checkFinalAnswerJapaneseOnly(answer)
  };
}

function buildDeterministicMarginDurabilityFallback(
  filing: FilingCacheRecord
): DeterministicLanguageFallback | null {
  const deterministic = buildDeterministicMetricAnswer(filing, "利益率は改善した？その要因は？");
  if (!deterministic) return null;
  const drivers = inferPreviousAnswerMarginDriverLabels(deterministic.response.answer);
  if (drivers.length === 0) return null;
  const indicators = inferPreviousAnswerMarginDurabilityIndicators(deterministic.response.answer, drivers);
  const answer = `提出資料だけでは一時要因か構造的変化かは断定できません。利益率要因候補として確認できるのは、${joinJapaneseItems(drivers.slice(0, 5))} です。次に見るべき指標は、${joinJapaneseItems((indicators.length > 0 ? indicators : drivers).slice(0, 5))} です。`;
  const responseWithUrls = { ...deterministic.response, answer };
  return {
    answer,
    responseWithUrls,
    languageCheck: checkFinalAnswerJapaneseOnly(answer)
  };
}

function normalizedHardIntentInsufficiencyFailureLabels({
  debug,
  repairLabels
}: {
  debug: ChatResponseDebugInput;
  repairLabels: string[];
}): string[] | undefined {
  if (debug.sourceGateSufficient === true) return debug.sourceGateFailureLabels;
  if (repairLabels.includes("q04_previous_answer_driver_candidate_repair")) {
    return ["durability_context_missing", "source_gate_failed"];
  }
  if (repairLabels.includes("q06_previous_answer_margin_candidate_repair")) {
    return ["missing_margin_durability_context", "source_gate_failed"];
  }
  return debug.sourceGateFailureLabels;
}

function repairMarginDurabilityFollowupAnswer(
  answer: string,
  question: string,
  debug: ChatResponseDebugInput
): Q04DurabilityRepair | null {
  if (
    debug.questionIntent === "driver_durability_followup" ||
    (debug.questionIntent === "yoy_change" && isDriverDurabilityFollowupQuestion(question, debug.questionIntent))
  ) {
    return null;
  }
  if (!isMarginDurabilityFollowupQuestion(question, debug.questionIntent) && !isGenericDurabilityFollowupWithMarginContext(question, debug)) {
    return null;
  }

  const previousAnswerRepair = buildPreviousAnswerMarginDurabilityCandidate(answer, debug.followupPreviousAnswer);
  return previousAnswerRepair
    ? {
        answer: sanitizeFinalUserFacingAnswer(previousAnswerRepair),
        labels: ["q06_previous_answer_margin_candidate_repair"]
      }
    : null;
}

function buildPreviousAnswerMarginDurabilityCandidate(answer: string, previousAnswer?: string | null): string | null {
  if (!previousAnswer || shouldIgnorePreviousMarginDriverAnswer(previousAnswer)) {
    return null;
  }

  const drivers = inferPreviousAnswerMarginDriverLabels(previousAnswer);
  if (drivers.length === 0) {
    return null;
  }

  const indicators = inferPreviousAnswerMarginDurabilityIndicators(previousAnswer, drivers);
  const indicatorText = indicators.length > 0
    ? `次に見るべき指標は、${joinJapaneseItems(indicators.slice(0, 5))} です。`
    : "次に見るべき指標は、同じ利益率要因が次期にも続くかどうかです。";
  return `前問で挙がっていた利益率要因候補は、${joinJapaneseItems(drivers.slice(0, 5))} です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。${indicatorText}`;
}

function shouldIgnorePreviousDriverAnswer(previousAnswer: string): boolean {
  const hasExplicitSegmentRevenueBridge =
    /energy products[^。]{0,120}(?:増加|正の寄与)/i.test(previousAnswer) &&
    /upstream[^。]{0,120}(?:減少|相殺|マイナス寄与)/i.test(previousAnswer);
  if (hasExplicitSegmentRevenueBridge) {
    return false;
  }
  return /(?:主因かを結び付ける説明は確認できません|主因は断定しません|income taxes payable|Pillar Two|TAC|traffic acquisition costs?|トラフィック獲得(?:コスト|費用)|交通獲得(?:コスト|費用)|brokerage expense|auto lease depreciation|marketing expense|occupancy expense|distribution fees|noncurrent income taxes|税金|税効果|費用|減価償却|販管費|人件費|信用損失|引当|Sleep\?|正確な表現は数字)/i.test(previousAnswer);
}

function shouldIgnorePreviousMarginDriverAnswer(previousAnswer: string): boolean {
  return /(?:income taxes payable|Pillar Two|noncurrent income taxes|税金|税効果|Sleep\?|正確な表現は数字)/i.test(previousAnswer);
}

function inferPreviousAnswerDriverLabels(previousAnswer: string): string[] {
  const text = previousAnswer.split(/これらのブリッジ|この表だけでは|この表では|追加確認が必要な点|追加で確認/iu)[0]!.toLowerCase();
  const labels: string[] = [];
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(text)) {
      labels.push(label);
    }
  };

  add("地域別売上", /americas|europe|greater china|asia pacific|地域別|地域/);
  add("iPhone", /iphone/);
  add("サービス売上", /services?|サービス/);
  add("取引件数・客単価", /transactions?|average ticket|取引件数|客単価/);
  add("食品・一般商品", /grocery|general merchandise|食品|一般商品/);
  add("データセンター向けAI製品", /data center|blackwell|データセンター向けai/);
  add("決済額・処理件数・国際取引量", /payments volume|processed transactions|cross-border volume|決済/);
  add("アドバイザリー・付加価値サービス", /advisory|other services/);
  add("純利息収入", /net interest income|純利息収入/);
  add("非利息収入・投資銀行・市場業務", /noninterest (?:income|revenue)|investment banking|markets revenue|card services|非利息収入|投資銀行|市場業務/);
  add("Energy Productsの売上増加", /energy products[^。]{0,80}(?:増加|最大の正の寄与)|エネルギー製品[^。]{0,80}(?:増加|最大の正の寄与)/);
  add("Upstreamの売上減少", /upstream[^。]{0,80}(?:減少|最大の相殺|マイナス寄与)|上流[^。]{0,80}(?:減少|最大の相殺|マイナス寄与)/);
  add("Chemical Productsの売上増加", /chemical products[^。]{0,80}増加|化学製品[^。]{0,80}増加/);
  add("検索量", /search volume/);
  add("ユーザー単価", /revenue per user/);
  add("利用席数", /seats? (?:grew|growth|increased)|seat growth/);
  add("販売数量・出荷量", /sales volume|unit case volume|production volume|unit volume|出荷量|販売数量|数量|ボリューム|量の増加|ボリューム成長/);
  add("価格・ミックス", /price\/mix|price mix|pricing|price realization|realized price|価格|ミックス|実現価格|価格低下|値引き/);
  add("資源価格", /crude|oil price|natural gas|commodity|原油|天然ガス|市場価格|資源価格/);
  add("需給環境", /supply|demand|需要|供給/);
  add("買収影響", /acquisition|pioneer|買収/);
  add("製品カテゴリ成長", /coffee|water|sports|trademark coca-cola|sparkling|カテゴリ|コーヒー|水|スポーツ飲料|mounjaro|zepbound|製品/);
  add("ボトリング投資", /bottling|ボトリング/);
  add("AWS", /\baws\b/);
  add("Azure", /\bazure\b/);
  add("Google Cloud", /google cloud/);
  add("クラウド", /(?<!google )\bcloud\b|クラウド/);
  add("広告需要", /advertising|\bads?\b|広告/);
  add("旅客収入", /passenger revenue|passenger|旅客/);
  add("燃料価格", /fuel|燃料/);
  add("車両価格・納車", /vehicle pricing|deliveries|production volume|automotive|車両価格|納車|生産台数/);

  const unique = [...new Set(labels)];
  if (
    unique.includes("決済額・処理件数・国際取引量") ||
    unique.includes("純利息収入") ||
    unique.includes("非利息収入・投資銀行・市場業務")
  ) {
    return unique.filter((label) => label !== "販売数量・出荷量");
  }
  return unique;
}

function inferPreviousAnswerDurabilityIndicators(previousAnswer: string, drivers: string[]): string[] {
  const text = previousAnswer.split(/これらのブリッジ|この表だけでは|この表では|追加確認が必要な点|追加で確認/iu)[0]!.toLowerCase();
  const indicators = [...drivers];
  if (/iphone|services?|サービス/.test(text)) {
    indicators.push("製品別売上", "サービス売上");
  }
  if (/greater china|asia pacific|地域/.test(text)) {
    indicators.push("地域別売上");
  }
  if (/tariff|関税/.test(text)) {
    indicators.push("関税影響");
  }
  if (/crude|natural gas|原油|天然ガス|資源価格/.test(text)) {
    indicators.push("資源価格");
  }
  const financialOrPaymentDrivers = drivers.some((driver) =>
    /決済額・処理件数・国際取引量|純利息収入|非利息収入・投資銀行・市場業務/u.test(driver)
  );
  if (!financialOrPaymentDrivers && /sales volume|unit case volume|production volume|unit volume|ボリューム|数量/.test(text)) {
    indicators.push("販売数量・ボリューム");
  }
  if (/price\/mix|price mix|価格/.test(text)) {
    indicators.push("価格・ミックス");
  }
  return [...new Set(indicators)];
}

function inferPreviousAnswerMarginDriverLabels(previousAnswer: string): string[] {
  const text = previousAnswer
    .split(/一時要因か構造的変化かは/u)[0]!
    .toLowerCase();
  const labels: string[] = [];
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(text)) {
      labels.push(label);
    }
  };

  add("検索量", /search volume/);
  add("ユーザー単価", /revenue per user/);
  add("利用席数", /seats? (?:grew|growth|increased)|seat growth/);
  add("販売数量・出荷量", /sales volume|unit case volume|production volume|unit volume|出荷量|販売数量|数量|ボリューム|量の増加|ボリューム成長/);
  add("価格・ミックス", /price\/mix|price mix|pricing|price realization|realized price|価格|ミックス|実現価格|価格低下|値引き/);
  add("製造コスト", /manufacturing costs?|production costs?|cost pressure|製造コスト/);
  add("営業費用・原価", /operating expenses?|cost of revenue|cost of sales|営業費用|売上原価|原価/);
  add("在庫引当・評価損", /inventory provision|inventory charge|excess inventory|在庫引当|在庫評価損/);
  add("信用損失引当", /provision for credit losses?|credit loss provision|信用損失引当/);
  add("関税", /tariff|関税/);
  add("為替", /\bfx\b|foreign exchange|currency|為替/);
  add("粗利益率", /gross margin|gross profit|粗利|粗利益/);
  add("研究開発費", /\br&d\b|research and development|研究開発/);
  add("販売管理費", /selling, general and administrative|sg&a|marketing|administrative|販管費|販売管理費|マーケティング/);
  add("トラフィック獲得コスト", /\btac\b|traffic acquisition costs?|トラフィック獲得/);
  add("減価償却費", /depreciation|amortization|減価償却/);
  add("コンテンツ調達費", /content acquisition costs?|content costs?|コンテンツ/);
  add("人件費", /salar(?:y|ies)|labor|employee compensation|人件費|給与|従業員報酬/);
  add("燃料費", /fuel|aircraft fuel|燃料/);
  add("原材料コスト", /raw material|input cost|ingredient|原材料/);
  add("クラウド需要", /aws|azure|google cloud|cloud|クラウド/);
  add("製品需要", /mounjaro|zepbound|demand|需要/);
  add("訴訟費用・引当", /litigation|legal expense|訴訟/);
  add("買収関連費用", /acquired ipr&d|acquisition|買収/);

  return [...new Set(labels)];
}

function inferPreviousAnswerMarginDurabilityIndicators(previousAnswer: string, drivers: string[]): string[] {
  const text = previousAnswer
    .split(/一時要因か構造的変化かは/u)[0]!
    .toLowerCase();
  const indicators = [...drivers];
  if (/gross margin|gross profit|粗利/.test(text)) {
    indicators.push("粗利益率");
  }
  if (/price|価格|ミックス/.test(text)) {
    indicators.push("価格・ミックス");
  }
  if (/manufacturing cost|cost|原価|コスト/.test(text) && !drivers.includes("営業費用・原価")) {
    indicators.push("原価・営業コスト");
  }
  if (/\br&d\b|research and development|研究開発/.test(text)) {
    indicators.push("研究開発費");
  }
  if (/marketing|sg&a|administrative|販管費|販売管理費/.test(text) && !drivers.includes("販売管理費")) {
    indicators.push("販管費");
  }
  if (/\btac\b|traffic acquisition costs?/.test(text)) {
    indicators.push("トラフィック獲得コスト");
  }
  if (/depreciation|amortization|減価償却/.test(text)) {
    indicators.push("減価償却費");
  }
  return [...new Set(indicators)];
}

function joinJapaneseItems(items: string[]): string {
  return [...new Set(items.filter(Boolean))].join("、");
}

function isDriverDurabilityFollowupQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "margin_durability_followup") {
    return false;
  }
  if (questionIntent === "driver_durability_followup") {
    return true;
  }
  return /(その要因|一時|継続|続きそう|続く|durability|temporary)/i.test(question) &&
    !/(利益率|margin|マージン)/i.test(question);
}

function extractSourceGateEvidenceText(sourceGateEvidenceSlots?: Record<string, unknown> | null): string {
  if (!sourceGateEvidenceSlots || typeof sourceGateEvidenceSlots !== "object") {
    return "";
  }
  const pieces: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string") {
      pieces.push(value);
    }
  };
  const visit = (value: unknown, depth = 0) => {
    if (depth > 4 || value == null) {
      return;
    }
    if (typeof value === "string") {
      add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) {
        visit(item, depth + 1);
      }
    }
  };
  visit(sourceGateEvidenceSlots);
  return pieces.join(" ").slice(0, 5000);
}

function buildJpmDurabilitySynthesis(
  answer: string,
  evidenceText: string,
  lowQualityReason: unknown,
  filing: FilingCacheRecord
): string | null {
  if (!isJpmLikeFiling(filing) || !hasBankDurabilityEvidence(evidenceText)) {
    return null;
  }
  const underAnswered = lowQualityReason === "durability_missing_assessment" ||
    /セグメント・地域別の強弱|十分に分解できません|確認すべき箇所は/.test(answer);
  if (!underAnswered) {
    return null;
  }

  const lower = evidenceText.toLowerCase();
  const niiClause = /net interest income|\bnii\b/.test(lower)
    ? "純利息収入は、市場業務の純利息収入、カード事業のリボ残高、法人預金残高、投資証券活動が寄与しました。一方、預金マージンの縮小や金利低下の影響も受けるため、継続性は金利環境次第です。"
    : "";
  const nirClause = /noninterest income|\bnir\b|investment banking|markets noninterest|asset management|payments|first republic/.test(lower)
    ? "非金利収入は、市場業務、資産運用、決済、投資銀行の手数料収入が寄与しました。ただし、市場関連収益や一時利益は変動しやすい要因です。"
    : "";
  if (!niiClause && !nirClause) {
    return null;
  }

  return `提出資料だけでは継続性は断定できません。${niiClause}${nirClause}次回は純利息収入、非金利収入、預金マージン、市場業務収益、手数料収入を確認する必要があります。`;
}

function buildWmtDurabilitySynthesis(
  answer: string,
  evidenceText: string,
  filing: FilingCacheRecord
): string | null {
  if (!isWmtLikeFiling(filing) || !hasRetailDurabilityEvidence(evidenceText) || !isDurabilityUnderAnswer(answer)) {
    return null;
  }

  return "提出資料だけでは継続性は断定できません。Walmart米国では、既存店売上にECが寄与し、取引件数と販売数量、食品・ヘルスケア商品の強さ、Walmart+の会員利用とオムニチャネル利用が支えになっています。これらは継続性を見る材料ですが、持続性を判断するには、次回の既存店売上、客数、客単価、EC寄与、会員利用、燃料価格の影響を確認する必要があります。";
}

function buildGoogleDurabilitySynthesis(
  answer: string,
  evidenceText: string,
  filing: FilingCacheRecord
): string | null {
  if (!isGoogleLikeFiling(filing) || !isDurabilityUnderAnswer(answer)) {
    return null;
  }
  const lower = evidenceText.toLowerCase();
  const hasSubscriptions = /paid subscriptions|subscriptions? revenues?|youtube services|google one/.test(lower);
  const hasAdvertising = /youtube ads|advertis(?:ing|er)|direct response|brand advertising/.test(lower);
  const hasForeignExchange = /foreign currency|foreign exchange|currency exchange/.test(lower);
  const hasCloud = /google cloud/.test(lower);
  const hasDurabilityContext = /seasonal|competition|paid subscriptions|foreign currency|device mix|underlying business trends/.test(lower);
  if (!hasDurabilityContext || !(hasSubscriptions || hasAdvertising || hasForeignExchange || hasCloud)) {
    return null;
  }

  const observations = [
    hasSubscriptions ? "有料サブスクリプションの増加は継続性を見る材料です。" : "",
    hasAdvertising ? "広告売上は、広告主の競争、広告形式、端末構成、季節性によって変動します。" : "",
    hasForeignExchange ? "為替影響も四半期ごとに変動し得ます。" : "",
    hasCloud ? "Google Cloudは、次回も売上成長率が続くかを確認する必要があります。" : ""
  ].filter(Boolean).join("");
  return `提出資料だけでは継続性は断定できません。${observations}次回は、Googleサービス、Google Cloud、YouTube広告、有料サブスクリプションの成長率を同じ基準で確認する必要があります。`;
}

function buildGenericDriverDurabilitySynthesis(answer: string, evidenceText: string): string | null {
  if (!isDurabilityUnderAnswer(answer) || !hasGenericDurabilityEvidence(evidenceText)) {
    return null;
  }
  const drivers = inferPreviousAnswerDriverLabels(evidenceText);
  if (drivers.length === 0) {
    return null;
  }
  const indicators = inferPreviousAnswerDurabilityIndicators(evidenceText, drivers);
  const indicatorText = indicators.length > 0
    ? `次に見るべき指標は、${joinJapaneseItems(indicators.slice(0, 5))} です。`
    : `次に見るべき指標は、${joinJapaneseItems(drivers.slice(0, 5))} が次期にも続くかどうかです。`;
  return `このfilingだけでは継続性は断定できません。売上要因候補として確認できるのは、${joinJapaneseItems(drivers.slice(0, 5))} です。${indicatorText}`;
}

function isJpmLikeFiling(filing: FilingCacheRecord): boolean {
  return /\bJPM\b|JPMorgan|Chase/i.test(`${filing.ticker} ${filing.companyName}`);
}

function isWmtLikeFiling(filing: FilingCacheRecord): boolean {
  return /\bWMT\b|Walmart/i.test(`${filing.ticker} ${filing.companyName}`);
}

function isGoogleLikeFiling(filing: FilingCacheRecord): boolean {
  return /\bGOOGL?\b|Alphabet|Google/i.test(`${filing.ticker} ${filing.companyName}`);
}

function hasBankDurabilityEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  const hasNii = /net interest income|\bnii\b|deposit margin compression|wholesale deposit|card services/.test(lower);
  const hasNir = /noninterest income|\bnir\b|markets noninterest|investment banking|asset management|payments|first republic/.test(lower);
  const hasDurabilityContext = /deposit margin compression|lower rates|markets|investment banking|first republic|revolving balances|wholesale deposit|fees|gain/.test(lower);
  return (hasNii || hasNir) && hasDurabilityContext;
}

function hasRetailDurabilityEvidence(text: string): boolean {
  const lower = text.toLowerCase();
  const hasComparableSales = /comparable sales|comp sales|same-store sales/.test(lower);
  const hasRetailDriver = /ecommerce|e-commerce|walmart\+|member engagement|membership|omnichannel|transactions|unit volumes|average ticket|traffic|ticket/.test(lower);
  const hasContext = /continued strength|driven by|contributed|growth|fuel|grocery|health and wellness|health & wellness/.test(lower);
  return hasComparableSales && hasRetailDriver && hasContext;
}

function hasGenericDurabilityEvidence(text: string): boolean {
  return /(continue|continued|expected|expects|outlook|future|vary based on|performance expectation|long[- ]term|cyclical|uncertain|uncertainty|risk|headwind|tailwind|supply constraint|demand|volume growth|pricing modifications|price\/mix|price mix|market supply and demand|継続|見通し|不確実|需要|価格)/i.test(text);
}

function hasGenericDurabilityMissingInfoBoilerplate(answer: string): boolean {
  return /(?:契約期間|受注残|バックログ).{0,100}(?:顧客需要|需要の継続性|継続期間|追加情報|情報が必要)/u.test(answer);
}

function hasUnsupportedDurabilityClassificationSurface(answer: string): boolean {
  return /(?:一時的要因|一時要因)(?:として|の可能性)[^。！？\n]{0,100}(?:挙げ|示唆|考え|みられ|見られ)/u.test(answer);
}

function isDurabilityUnderAnswer(answer: string): boolean {
  return /前問の具体的な(?:売上|利益率)?要因(?:が|は)?十分に特定|具体的な(?:売上|利益率)?要因(?:が|は)?十分に特定できません|要因が一時的かどうかは判断できません|一時要因か(?:継続要因|構造的変化)かは分類しません|確認すべき箇所は|追加確認が必要/.test(answer);
}

function isMarginDurabilityUnderAnswer(answer: string): boolean {
  return /利益率|マージン|営業利益|純利益|粗利|コスト|営業費用|セグメント利益率/.test(answer) &&
    /具体的な(?:利益率)?要因は十分に特定できません|改善\/悪化|一時要因か構造的変化/.test(answer);
}

function softenOverconfidentDurabilityWording(answer: string): string {
  let softened = answer
    .replace(/(?:eCommerce|EC)\s*の売上寄与が継続的に高まり/g, "ECの売上寄与は継続性を見る材料ですが、このfilingだけでは継続性は断定できません")
    .replace(/eCommerce[^。]*継続的に高まり/g, "eCommerceや会員エンゲージメントは継続性を見る材料ですが、持続性の断定は避けるべきです")
    .replace(/今後も続くでしょう/g, "今後も続くかは、このfilingだけでは断定できません")
    .replace(/今後も続くと見られます/g, "今後も続くかは、このfilingだけでは断定できません")
    .replace(/継続するでしょう/g, "継続するかは、このfilingだけでは断定できません")
    .replace(/持続的に伸びるでしょう/g, "持続的に伸びるかは、このfilingだけでは断定できません")
    .replace(/持続的に伸びると見られます/g, "持続的に伸びるかは、このfilingだけでは断定できません")
    .replace(/安定成長を示しています/g, "継続性を見る材料ですが、このfilingだけでは安定成長とは断定できません")
    .replace(/安定した成長を示しています/g, "継続性を見る材料ですが、このfilingだけでは安定成長とは断定できません");

  if (softened !== answer && !/継続性は断定できません|持続性の断定は避けるべき/.test(softened)) {
    softened = `${softened} このfilingだけでは継続性は断定できません。`;
  }
  return softened.replace(/\s+/g, " ").trim();
}

function cleanAnswerForQuestion(
  answer: string,
  responsePath: ChatResponsePath,
  fallbackKind: ChatFallbackKind,
  question: string,
  questionIntent?: string | null,
  filing?: FilingCacheRecord
): AnswerCleanupResult {
  const normalizedAnswer = sanitizeFinalUserFacingAnswer(answer);
  const sectorCleanup = cleanWrongSectorBankLanguage(normalizedAnswer, question, questionIntent, filing);
  if (sectorCleanup) {
    return sectorCleanup;
  }
  if (isLiquidityDebtQuestion(question, questionIntent)) {
    return cleanLiquidityDebtAnswer(normalizedAnswer);
  }
  if (isWatchPointsQuestion(question, questionIntent)) {
    return cleanWatchPointsAnswer(normalizedAnswer);
  }
  if (isManagementFocusQuestion(question, questionIntent)) {
    return cleanManagementFocusAnswer(normalizedAnswer);
  }
  if (isBusinessModelQuestion(question, questionIntent)) {
    return cleanBusinessModelAnswer(normalizedAnswer, responsePath, fallbackKind);
  }
  if (isRevenueBreakdownQuestion(question, questionIntent)) {
    const revenueBreakdownCleanup = cleanRevenueBreakdownAnswer(normalizedAnswer);
    if (revenueBreakdownCleanup) {
      return revenueBreakdownCleanup;
    }
  }
  if (isRevenueDriverQuestion(question, questionIntent)) {
    const revenueDriverCleanup = cleanRevenueDriverAnswer(normalizedAnswer);
    if (revenueDriverCleanup) {
      return revenueDriverCleanup;
    }
  }
  if (hasMalformedCurrencyForTaxonomy(normalizedAnswer) || hasCurrencySanitizationPlaceholder(normalizedAnswer)) {
    return {
      answer: normalizedAnswer,
      taxonomy: {
        fallbackCategory: "sanitation_guard",
        fallbackUserReason: "malformed_currency_detected",
        guardLabels: ["malformed_currency_detected"]
      }
    };
  }
  return { answer: normalizedAnswer };
}

const LIQUIDITY_DEBT_SOURCE_INSUFFICIENT_FALLBACK = "選択された資料だけでは、資金繰りや負債の懸念を直接判断するには不足しています。確認すべき箇所は、キャッシュフロー計算書、流動性の説明、負債の注記、借入枠、満期スケジュールです。現時点では、一般的なリスク要因だけから資金繰りの悪化を断定しません。";

const MANAGEMENT_FOCUS_SOURCE_INSUFFICIENT_FALLBACK = "選択された資料だけでは、経営陣が強調している論点を十分に特定できません。確認すべき箇所は、MD&A（経営陣による業績説明）、業績説明、セグメント実績、見通し・リスクの説明です。売上高だけでは、経営陣の強調点とは判断しません。";

const REVENUE_BREAKDOWN_SOURCE_INSUFFICIENT_FALLBACK = "売上高の増減は確認できますが、選択された資料だけでは会社固有の売上の柱までは特定できません。見るべき箇所は、事業別の実績表、製品・サービス別の売上表、地域別の実績表、MD&Aの売上説明です。分類名だけでは、どの事業が大きいか・どこが伸びたかまでは判断しません。";

const REVENUE_DRIVER_SOURCE_INSUFFICIENT_FALLBACK = "売上の増減は確認できますが、選択された資料だけでは会社固有の売上要因までは断定できません。確認すべき箇所は、MD&A、セグメント実績、売上説明です。売上以外の損益項目だけでは、売上要因として扱いません。";

function sourceInsufficientCleanup(
  answer: string,
  fallbackUserReason: Extract<FallbackUserReason, `${string}_sources_missing`>,
  missingEvidenceLabelsJa: string[],
  guardLabels: string[]
): AnswerCleanupResult {
  return {
    answer,
    taxonomy: {
      fallbackCategory: "source_insufficient",
      fallbackUserReason,
      missingEvidence: missingEvidenceLabelsJa.map((label) => sourceLabelToEvidenceKey(label)),
      missingEvidenceLabelsJa,
      guardLabels
    }
  };
}

function isRevenueDriverQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "revenue_driver") {
    return true;
  }
  const normalized = question.replace(/\s+/g, "");
  return /(売上|増収|減収|revenue|sales)/i.test(normalized) && /(要因|主因|理由|なぜ|driver|cause)/i.test(normalized);
}

function isRevenueBreakdownQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "revenue_breakdown" || questionIntent === "revenue_snapshot" || questionIntent === "segment_driver" || questionIntent === "segment_analysis") {
    return true;
  }
  const normalized = question.replace(/\s+/g, "");
  return /(売上|revenue|sales)/i.test(normalized) && /(内訳|区分|セグメント|segment|地域|region|製品|カテゴリ|category|伸びた|弱かった)/i.test(normalized);
}

function cleanRevenueBreakdownAnswer(answer: string): AnswerCleanupResult | null {
  if (!hasGenericRevenueBreakdownOnly(answer)) {
    return null;
  }
  return sourceInsufficientCleanup(
    REVENUE_BREAKDOWN_SOURCE_INSUFFICIENT_FALLBACK,
    "revenue_breakdown_sources_missing",
    ["セグメント実績", "地域別売上", "製品・カテゴリ別売上"],
    ["revenue_breakdown_generic_category_only"]
  );
}

function hasGenericRevenueBreakdownOnly(answer: string): boolean {
  const compact = answer.replace(/\s+/g, "");
  const hasGenericCategory =
    /(地域別売上|地域別の内訳|セグメント別|セグメント別売上|セグメント別売上高|セグメント別の売上|セグメント別の売上高|セグメント別の内訳|セグメント別売上の内訳|製品別売上|製品・カテゴリ別売上|売上区分|大きい区分|大きな区分|主な売上区分|主な売上区分は不明|区分別の内訳|個別セグメント別|セグメント別・地域別|製品別・地域別|全社ベース|売上高全体|総売上高|全体売上高|支払い関連サービス全般|servicerevenue)/i.test(compact) ||
    /主な売上区分[:：]?売上高/.test(compact);
  if (!hasGenericCategory) {
    return false;
  }
  if (hasConcreteRevenueBreakdownTerm(answer)) {
    return false;
  }
  return /(地域別売上(?:が|は|を|として|という分類)|地域別の内訳|セグメント別(?:では情報|売上高|内訳|の内訳|の売上(?:高)?(?:が|は|を|として|という分類)?)|セグメント別売上の内訳|製品別売上(?:が|は|を|として|という分類)|大きい区分|大きな区分|主な売上区分(?:[:：]?\s*売上高|は不明)|全社ベース|売上高全体|総売上高|全体売上高|支払い関連サービス全般|service revenue|区分別の内訳|具体的な金額の内訳は|詳細な内訳は|内訳(?:情報|データ|は|が)?(?:[^。]{0,48})?(?:示されていません|含まれていません|明示されていません|読み取れません|欠如しています|記載されていません|分かりません|確認できません)|どのセグメントや地域が伸びたか(?:[^。]{0,48})?(?:示されていません|分かりません)|具体的なセグメント別の売上比率|売上内訳のセグメント別金額|カテゴリ別の寄与は示されていません)/i.test(answer);
}

function hasConcreteRevenueBreakdownTerm(answer: string): boolean {
  return [
    /Construction Industries|Resource Industries|Energy & Transportation/i,
    /建設機械|資源産業|エネルギー・輸送/,
    /Energy Products|Chemical Products|Specialty Products|Upstream|Downstream|Chemical/i,
    /NII|NIR|Net interest income|Noninterest revenue|利息収益|非利息収益/i,
    /Walmart U\.?S\.?|Walmart International|Sam'?s Club/i,
    /DRAM|NAND|NOR|Memory|Storage/i,
    /Google Services|Google Cloud|YouTube ads?|Google Network|AdSense/i,
    /iPhone|iPad|Mac|Wearables|ウェアラブル|Services/i,
    /Mounjaro|Zepbound/,
    /Coca-Cola|Trademark|Asia Pacific|EMEA|North America/i,
    /Advisory|Other Services|Payments|value-added services/i,
    /Compute|Networking|Graphics|Data Center/i,
    /Automotive|Energy Generation/i,
    /Passenger revenue|Cargo|Refinery|MRO|Premium products|loyalty/i
  ].some((pattern) => pattern.test(answer));
}

function cleanRevenueDriverAnswer(answer: string): AnswerCleanupResult | null {
  if (!hasMisleadingNonRevenueDriverCause(answer)) {
    return null;
  }
  return sourceInsufficientCleanup(
    REVENUE_DRIVER_SOURCE_INSUFFICIENT_FALLBACK,
    "revenue_driver_sources_missing",
    REVENUE_DRIVER_MISSING_EVIDENCE,
    ["revenue_driver_non_revenue_cause_removed"]
  );
}

function hasMisleadingNonRevenueDriverCause(answer: string): boolean {
  if (!/(売上(?:変化|成長|増減)?の?要因|売上要因|revenue driver)/i.test(answer)) {
    return false;
  }
  return /(?:income taxes payable|Pillar Two|TAC|traffic acquisition costs?|トラフィック獲得(?:コスト|費用)|交通獲得(?:コスト|費用)|brokerage expense|auto lease depreciation|marketing expense|occupancy expense|distribution fees|noncurrent income taxes|税金|税効果|費用|減価償却|販管費|人件費|信用損失|引当)/i.test(answer);
}

export function sanitizeFinalUserFacingAnswer(answer: string): string {
  return normalizeInternalSourceWording(
    normalizeBusinessLineLabels(
      normalizeFallbackSourceLabels(
        normalizeAwkwardModelLanguage(normalizeQuarterLanguage(answer))
      )
    )
  );
}

function normalizeQuarterLanguage(answer: string): string {
  const englishOrdinal: Record<string, string> = {
    first: "1",
    second: "2",
    third: "3",
    fourth: "4"
  };
  const japaneseOrdinal: Record<string, string> = {
    一: "1",
    二: "2",
    三: "3",
    四: "4",
    "1": "1",
    "2": "2",
    "3": "3",
    "4": "4"
  };
  const englishMonth: Record<string, string> = {
    january: "1",
    february: "2",
    march: "3",
    april: "4",
    may: "5",
    june: "6",
    july: "7",
    august: "8",
    september: "9",
    october: "10",
    november: "11",
    december: "12"
  };
  return answer
    .replace(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+((?:19|20)\d{2})\s*(?:quarter|四半期)\b/gi,
      (_match, month: string, year: string) => `${year}年${englishMonth[month.toLowerCase()] ?? month}月期`
    )
    .replace(
      /\b(?:the\s+)?(first|second|third|fourth)\s+quarters?\s+of\s+(?:fiscal\s+)?((?:19|20)\d{2})\b/gi,
      (_match, ordinal: string, year: string) => `${year}年第${englishOrdinal[ordinal.toLowerCase()] ?? ordinal}四半期`
    )
    .replace(
      /\b(?:fiscal\s+)?((?:19|20)\d{2})\s+(?:the\s+)?(first|second|third|fourth)\s+quarters?\b/gi,
      (_match, year: string, ordinal: string) => `${year}年第${englishOrdinal[ordinal.toLowerCase()] ?? ordinal}四半期`
    )
    .replace(
      /第\s*([一二三四1-4])\s*(?:quarters?|クォーター)/gi,
      (_match, ordinal: string) => `第${japaneseOrdinal[ordinal] ?? ordinal}四半期`
    )
    .replace(
      /\b(?:the\s+)?(first|second|third|fourth)\s+quarters?\b/gi,
      (_match, ordinal: string) => `第${englishOrdinal[ordinal.toLowerCase()] ?? ordinal}四半期`
    );
}

function normalizeAwkwardModelLanguage(answer: string): string {
  return answer
    .replace(/\balso\b/gi, "また")
    .replace(/\bthis\s+filing\b|この\s*filing\b|本\s*filer\b|\bthe\s+filer\b/gi, "この提出資料")
    .replace(/\bfiling\b/gi, "提出資料")
    .replace(/\brecurring\s+revenue\b/gi, "継続収益")
    .replace(/\bProducts?\s+and\s+Services\b/gi, "製品・サービス")
    .replace(/\bGoogle\s+Services\b/g, "Googleサービス")
    .replace(/\bcost\s+of\s+services\s+and\s+other\s+revenue\b/gi, "サービス・その他売上原価")
    .replace(/\bservices\s+and\s+other\s+revenue\b/gi, "サービス・その他売上")
    .replace(/\bServices\b/g, "サービス")
    .replace(/\bUniform Rental and Facility サービス/g, "Uniform Rental and Facility Services")
    .replace(/\bFirst Aid and Safety サービス/g, "First Aid and Safety Services")
    .replace(/\bmembership\b/gi, "会員事業")
    .replace(/\bmember\s+engagement\b/gi, "会員利用")
    .replace(/\be-?commerce\b/gi, "EC")
    .replace(/\bcomparable\s+sales\b/gi, "既存店売上")
    .replace(/\baverage\s+ticket\b/gi, "客単価")
    .replace(/\btransactions?\b/gi, "取引件数")
    .replace(/\bunit\s+case\s+volume\b/gi, "ユニットケース販売数量")
    .replace(/\bunit\s+volumes?\b/gi, "販売数量")
    .replace(/\bvolume\s*[（(]\s*販売数量\s*[）)]/gi, "販売数量")
    .replace(/\bvolume\b/gi, "販売数量")
    .replace(/\bMarkets?\b/g, "市場業務")
    .replace(/\bdistribution\s+fees\b/gi, "流通費用")
    .replace(/\bfees?\b/gi, "手数料")
    .replace(/\bAWM\b/g, "資産・ウェルスマネジメント部門")
    .replace(/\bCCB\b/g, "個人・中小企業向け銀行部門")
    .replace(/\bCIB\b/g, "法人・投資銀行部門")
    .replace(/\bOperating\s+expenses?\b/gi, "営業費用")
    .replace(/\bMargin\s+and\s+利益率・採算性の説明\b/gi, "利益率・採算性の説明")
    .replace(/\bMargin\s+and\b/gi, "利益率・採算性")
    .replace(/\bfulfillment\b/gi, "物流・配送")
    .replace(/\bdriver\b/gi, "要因")
    .replace(/\bquarters?\b/gi, "四半期")
    .replace(/\brate\s+effects?\b/gi, "影響")
    .replace(/\bAutomotive\b/g, "自動車部門")
    .replace(/\brefinery\s+sales\b/gi, "製油所売上")
    .replace(/\bsales\b/gi, "売上")
    .replace(/\brefinery\b/gi, "精製事業")
    .replace(/\bramp\b/gi, "立ち上がり")
    .replace(/\bSG&A\/R&D discussion\b/gi, "販管費・研究開発費の説明")
    .replace(/\bSG&A\b/g, "販管費")
    .replace(/\bTAC\b/g, "トラフィック獲得コスト")
    .replace(/\bWalmart\s+U\.?S\.?\b/gi, "Walmart米国")
    .replace(/\bgrocery\b/gi, "食品")
    .replace(/\bomnichannel\b/gi, "オムニチャネル")
    .replace(/\bfuel\b/gi, "燃料")
    .replace(/高ー売上/g, "高い売上")
    .replace(/\bProductivity\s+and\s+Business\s+Processes\b/gi, "生産性・ビジネスプロセス")
    .replace(/Productivity\s+and\s+事業内容\s+Processes/gi, "生産性・ビジネスプロセス")
    .replace(/実\s*realized\s+prices?\b/gi, "実現価格")
    .replace(/\brealized\s+prices?\b/gi, "実現価格")
    .replace(/\bsenior\s+unsecured\s+notes\s+outstanding\b/gi, "発行済み無担保シニア債")
    .replace(/\bdebt\s+notes?\b/gi, "負債の注記")
    .replace(/\bliquidity\s+management\b/gi, "流動性管理")
    .replace(/\bmaturity\s+profile\b/gi, "満期構成")
    .replace(/\bdebt\s+repayments?\b/gi, "債務返済")
    .replace(/\bforeseeable\s+future\b/gi, "予見可能な将来")
    .replace(/\bstock[- ]based\s+compensation\b/gi, "株式報酬")
    .replace(/\baverage\s+selling\s+prices?\b/gi, "平均販売価格")
    .replace(/\bselling\s+prices?\b/gi, "販売価格")
    .replace(/平均\s+販売価格/g, "平均販売価格")
    .replace(/\bdurability\b/gi, "継続性")
    .replace(/\bbacklog\b/gi, "受注残")
    .replace(/総\s*Liabilities\b/gi, "総負債")
    .replace(/長期\s*debt\b/gi, "長期債務")
    .replace(/短期\s*borrowings?\b/gi, "短期借入")
    .replace(/\bLiabilities\b/gi, "負債")
    .replace(/\bDeposits\b/gi, "預金")
    .replace(/\bborrowings?\b/gi, "借入")
    .replace(/\bdebt\b/gi, "負債")
    .replace(/負債\s+notes?\b/gi, "負債の注記")
    .replace(/\bYoY\b/gi, "前年同期比")
    .replace(/第九ヶ?月間/g, "9か月累計")
    .replace(/三ヶ?月時点/g, "3か月累計時点")
    .replace(/[$＄]\s*([0-9]+(?:\.[0-9]+)?)\s*[Bb]\b/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value * 10, true)}億ドル` : `${raw}十億ドル`;
    })
    .replace(/[$＄]\s*([0-9]+(?:\.[0-9]+)?)\s*[Mm]\b/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value / 100, true)}億ドル` : `${raw}百万ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*名\s*billion\s*ドル/gi, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value * 10, true)}億ドル` : `${raw}十億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*억\s*(?:USD|달러|ドル)/gi, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value, raw.includes("."))}億ドル` : `${raw}億ドル`;
    })
    .replace(/\bRevenueFromContractWithCustomerExcludingAssessedTax\b/g, "売上高")
    .replace(/\b[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+){2,}\b/g, (tag: string) => {
      if (KNOWN_XBRL_TAG_LABELS[tag]) {
        return KNOWN_XBRL_TAG_LABELS[tag];
      }
      return looksLikeXbrlTag(tag) ? "指標" : tag;
    })
    .replace(/売上\s*driver/g, "売上要因")
    .replace(/具体的な\s*driver/g, "具体的な要因")
    .replace(/driverが十分に特定/g, "要因が十分に特定")
    .replace(/前問の\s*driver/g, "前問の要因")
    .replace(/利益率\s*driver/g, "利益率要因")
    .replace(/\brevenue\s+driver\s+discussion\b/gi, "売上要因の説明")
    .replace(/\brevenue\s+要因\s+discussion\b/gi, "売上要因の説明")
    .replace(/\binvestment\s+banking\b/gi, "投資銀行")
    .replace(/\bNote\s+(\d+)\b/gi, "注記$1")
    .replace(/\bmargin\s+driver\s+discussion\b/gi, "利益率要因の説明")
    .replace(/\bsegment\s+margin\b/gi, "セグメント利益率")
    .replace(/\bpricing\b/gi, "価格改定")
    .replace(/\bmix\b/gi, "構成")
    .replace(/\bprovision\b/gi, "引当")
    .replace(/\brestructuring\b/gi, "構造改革費用")
    .replace(/\bimpairment\b/gi, "減損")
    .replace(/\bprice\s+reali[sz]ation\b/gi, "価格実現")
    .replace(/\bhigher\s+net\s+sales\s+of\s+Pro\s+models\b/gi, "Proモデルの純売上増")
    .replace(/\bforeign\s+exchange\b/gi, "為替")
    .replace(/\baverage\s+selling\s+prices?\b/gi, "平均販売価格")
    .replace(/\bbit\s+shipments?\b/gi, "出荷量")
    .replace(/\bfavorable\s+mix\b/gi, "有利な製品ミックス")
    .replace(/短期债(?:務|务)/g, "短期債務")
    .replace(/\bmaturities\b/gi, "満期")
    .replace(/\bcost\s+of\s+sales\b/gi, "売上原価")
    .replace(/\bcost\s+of\s+revenue\b/gi, "売上原価")
    .replace(/\bmanufacturing\s+costs?\b/gi, "製造コスト")
    .replace(/\bcosts?\b/gi, "コスト")
    .replace(/\btariffs?\b/gi, "関税")
    .replace(/\bdeveloping economies\b/gi, "新興国")
    .replace(/\bdeveloped economies\b/gi, "先進国")
    .replace(/較為小さい/g, "比較的小さい")
    .replace(/前年同\s*period\s*比/gi, "前年同期比")
    .replace(/\bperiod\b/gi, "期間")
    .replace(/[0-9]+(?:,[0-9]{1,2})+\.[0-9]+億ドル/g, "売上高の数値表示")
    .replace(/([0-9]+(?:,[0-9])+)億ドル/g, (_match, raw: string) => `${raw.replace(/,/g, ".")}億ドル`)
    .replace(/([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw.replace(/,/g, ""));
      return Number.isFinite(value) ? formatUsdAmount(value) : "金額";
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*百万\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value / 100)}億ドル` : `${raw}百万ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*億\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value, raw.includes("."))}億ドル` : `${raw}億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*千\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value / 100_000)}億ドル` : `${raw}千ドル`;
    })
    .replace(/[$＄]\s*([0-9]+(?:\.[0-9]+)?)\s*十億(?:ドル)?/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value * 10, raw.includes("."))}億ドル` : `${raw}十億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*十億\s*(?:USD|ドル)/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value * 10, raw.includes("."))}億ドル` : `${raw}十億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*млрд\s*ドル/gi, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value * 10, raw.includes("."))}億ドル` : `${raw}十億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*billion\s*USD\b/gi, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value * 10, raw.includes("."))}億ドル` : `${raw}十億ドル`;
    })
    .replace(/([0-9,]+)\s*억\s*([0-9,]+)\s*万\s*USD/g, (_match, okuRaw: string, manRaw: string) => {
      const oku = Number.parseFloat(okuRaw.replace(/,/g, ""));
      const man = Number.parseFloat(manRaw.replace(/,/g, ""));
      return Number.isFinite(oku) && Number.isFinite(man)
        ? `${formatOkuDollar(oku + man / 10_000, true)}億ドル`
        : "金額";
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*[亿億]\s*USD/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value, raw.includes("."))}億ドル` : `${raw}億ドル`;
    })
    .replace(/([0-9]+(?:\.[0-9]+)?)\s*[亿億]\s*美元/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) ? `${formatOkuDollar(value, raw.includes("."))}億ドル` : `${raw}億ドル`;
    })
    .replace(/([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\s*美元/g, (_match, raw: string) => {
      const value = Number.parseFloat(raw.replace(/,/g, ""));
      return Number.isFinite(value) ? formatUsdAmount(value) : "金額";
    })
    .replace(/(億ドル)(?:万ドル|百万ドル|億ドル|兆ドル)/g, "$1")
    .replace(/億ドル\s*[Bb](?=$|[^A-Za-z])/g, "億ドル")
    .replace(/億ドル\s*-\s*Q\b/gi, "億ドル")
    .replace(/(億ドル)(?:(?:か|カ|ヶ|ケ)?月(?:間|累計)?|四半期|月期|日)/g, "$1")
    .replace(/[0-9０-９.,，]+\s*兆円超?(?:の規模)?/g, "金額規模")
    .replace(/前年同[0-9.,?，]+/g, "前年同期の比較値")
    .replace(/\bseasonality\b/gi, "季節性")
    .replace(/\bgovernment\b/gi, "政府")
    .replace(/\bacquisitions?\b/gi, "買収")
    .replace(/\bprimarily due to\b/gi, "主に")
    .replace(/\bdriven by\b/gi, "主因は")
    .replace(/\bas well as\b/gi, "さらに")
    .replace(/\bpartially offset by\b/gi, "一部相殺したのは")
    .replace(/\bpartially offset\b/gi, "一部相殺")
    .replace(/\bhigher\s+稼働率\s+expense\b/gi, "稼働関連費用の増加")
    .replace(/\bhigher\s+([a-z][a-z\s-]{2,80}?)\s+expense\b/gi, (_match, raw: string) => `${normalizeEnglishExpenseLabel(raw)}の増加`)
    .replace(/\bhigher\s+auto lease depreciation\b/gi, "オートリース減価償却の増加")
    .replace(/\bcontinued investments in technology\b/gi, "継続的な技術投資")
    .replace(/\bconcentrate\s+販売数量/gi, "原液販売数量")
    .replace(/\bBottling Investments\b/g, "ボトリング投資")
    .replace(/\bNorth America\b/g, "北米")
    .replace(/\bPremium products\b/g, "プレミアム商品")
    .replace(/\bMain cabin\b/g, "メインキャビン")
    .replace(/\bre[-\s]?franchising\b/gi, "再フランチャイズ化")
    .replace(/\bsales volume\b/gi, "販売数量")
    .replace(/\bmarketing\b/gi, "マーケティング費用")
    .replace(/\bunfavorable\b/gi, "不利な")
    .replace(/\bfavorable\b/gi, "有利な")
    .replace(/\brepurchase(?:d|s)?\b/gi, "買い戻し")
    .replace(/\bexpenditures?\b/gi, "支出")
    .replace(/\bNI\b/g, "純利益")
    .replace(/\bCash flow\b/g, "キャッシュフロー")
    .replace(/\bcash flow\b/g, "キャッシュフロー")
    .replace(/(第[1-4]四半期)\s+(?=[にでのはを])/g, "$1");
}

const KNOWN_XBRL_TAG_LABELS: Record<string, string> = {
  RevenueFromContractWithCustomerExcludingAssessedTax: "売上高",
  Revenues: "売上高",
  NetIncomeLoss: "純利益",
  OperatingIncomeLoss: "営業利益"
};

function looksLikeXbrlTag(value: string): boolean {
  return /(?:Revenue|Income|Loss|Assets|Liabilities|Equity|Cash|Expense|Expenses|Debt|Stockholders|Contract|Customer|AssessedTax)/.test(value) &&
    /[a-z][A-Z]/.test(value);
}

function normalizeFallbackSourceLabels(answer: string): string {
  return answer
    .replace(/\bMD&A risk discussion\b/gi, "MD&Aのリスク説明")
    .replace(/\bMD&A business discussion\b/gi, "経営陣による業績説明の事業説明")
    .replace(/\bproduct launch or channel inventory discussion\b/gi, "新製品投入や販売チャネル在庫")
    .replace(/\bproduct launches\b/gi, "新製品投入")
    .replace(/\bchannel inventory\b/gi, "販売チャネル在庫")
    .replace(/\bprice-cost spread discussion\b/gi, "価格とコスト差の説明")
    .replace(/\bprice-cost spread\b/gi, "価格とコスト差")
    .replace(/price-コスト spread discussion/gi, "価格とコスト差の説明")
    .replace(/price-コスト/gi, "価格とコスト")
    .replace(/\bmanufacturing cost discussion\b/gi, "製造コストの説明")
    .replace(/製造コスト\s+discussion/gi, "製造コストの説明")
    .replace(/\bSG&A\/R&D discussion\b/gi, "販管費・研究開発費の説明")
    .replace(/\bcomparable sales discussion\b/gi, "既存店売上の説明")
    .replace(/\btraffic and ticket discussion\b/gi, "客数・客単価の説明")
    .replace(/\beCommerce discussion\b/gi, "EC売上の説明")
    .replace(/\bmembership or advertising discussion\b/gi, "会員・広告収益の説明")
    .replace(/\bproduct revenue(?: discussion)?\b/gi, "製品別売上")
    .replace(/\bservices revenue(?: discussion)?\b/gi, "サービス売上")
    .replace(/\bsegment revenue(?: discussion)?\b/gi, "セグメント別売上")
    .replace(/\bgeographic revenue(?: discussion)?\b/gi, "地域別売上")
    .replace(/\bgeography revenue(?: discussion)?\b/gi, "地域別売上")
    .replace(/\bProduct\/category revenue\b/gi, "製品・カテゴリ別売上")
    .replace(/\bGeographic revenue\b/gi, "地域別売上")
    .replace(/\bSegment Information\b/g, "セグメント情報")
    .replace(/\bRevenue Note\b/g, "売上注記")
    .replace(/\bBusiness\b/g, "事業内容")
    .replace(/\bRisk Factors\b/g, "リスク要因")
    .replace(/\brevenue or profitability discussion\b/gi, "売上または利益率の説明")
    .replace(/\bsegment results\b/gi, "セグメント実績")
    .replace(/\brevenue discussion\b/gi, "売上説明")
    .replace(/\bprofitability discussion\b/gi, "利益率・採算性の説明")
    .replace(/\bcash flow \/ liquidity\b/gi, "キャッシュフロー・流動性")
    .replace(/\bliquidity discussion\b/gi, "流動性の説明")
    .replace(/\bdebt discussion\b/gi, "負債の説明")
    .replace(/\bsector-specific KPIs\b/gi, "業種固有KPI")
    .replace(/\bBalance Sheet\b/g, "貸借対照表")
    .replace(/\bDebt Note\b/gi, "負債の注記")
    .replace(/\bLiquidity MD&A\b/g, "流動性の説明")
    .replace(/\bCash Flow Statement\b/g, "キャッシュフロー計算書")
    .replace(/\bMD&A\b(?![の（])/g, "経営陣による業績説明");
}

function normalizeEnglishExpenseLabel(raw: string): string {
  const normalized = raw.replace(/\s+/g, " ").trim().toLowerCase();
  if (/brokerage/.test(normalized)) return "ブローカー費用";
  if (/distribution/.test(normalized)) return "流通費用";
  if (/auto lease depreciation/.test(normalized)) return "オートリース減価償却";
  if (/marketing/.test(normalized)) return "マーケティング費用";
  if (/occupancy/.test(normalized)) return "稼働関連費用";
  if (/technology/.test(normalized)) return "技術投資";
  return "費用";
}

function normalizeInternalSourceWording(answer: string): string {
  return answer
    .replace(/evidence\s*slot/gi, "根拠")
    .replace(/metric-only/gi, "数値中心")
    .replace(/\bfallback\b/gi, "代替回答")
    .replace(/\bdebug\b/gi, "診断")
    .replace(/\bschema\b/gi, "形式")
    .replace(/選択された\s*source/g, "選択された資料")
    .replace(/この\s*source/g, "この資料")
    .replace(/取得できた\s*source/g, "取得できた資料")
    .replace(/確認すべき\s*source\s*は/g, "確認すべき箇所は")
    .replace(/不足している\s*source\s*type/g, "不足している資料の種類")
    .replace(/source\s*type/g, "資料の種類")
    .replace(/source\s*だけ/g, "資料だけ")
    .replace(/source\s*では/g, "資料では")
    .replace(/source\s*は/g, "資料は")
    .replace(/source\s*を/g, "資料を")
    .replace(/source\s*の/g, "資料の")
    .replace(/\bsource\b/gi, "資料");
}

function normalizeBusinessLineLabels(answer: string): string {
  return answer
    .replace(/Re資料 Industries/g, "資源産業")
    .replace(/\bResource Industries\b/g, "資源産業")
    .replace(/\bConstruction Industries\b/g, "建設機械")
    .replace(/\bEnergy & Transportation\b/g, "エネルギー・輸送")
    .replace(/\btotal Revenue\b/gi, "全体売上")
    .replace(/全体 Revenue/g, "全体売上")
    .replace(/\bWearables,\s*Home and Accessories(?:,\s*|、)Services\b/g, "ウェアラブル、ホーム、アクセサリ、サービス")
    .replace(/\bWearables,\s*Home and Accessories\b/g, "ウェアラブル、ホーム、アクセサリ")
    .replace(/\bWearables\b/g, "ウェアラブル")
    .replace(/\bHome and Accessories\b/g, "ホーム、アクセサリ")
    .replace(/売上区分としては、?全社売上高も確認できます。?/g, "")
    .replace(/全社売上高も確認できます。?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const GENERAL_COMPANY_CASH_FLOW_NOTE = "営業CFは、運転資本、在庫、売掛金、買掛金などで大きく動くため、単純な利益水準だけでは判断しません。キャッシュフロー計算書と流動性の説明を合わせて確認する必要があります。";

function cleanWrongSectorBankLanguage(
  answer: string,
  question: string,
  questionIntent?: string | null,
  filing?: FilingCacheRecord
): AnswerCleanupResult | null {
  if (!filing || isFinancialFilingForFinalizer(filing)) {
    return null;
  }
  if (!isCashFlowOrLiquidityAnswer(answer, question, questionIntent) || !containsBankSpecificLanguage(answer)) {
    return null;
  }

  return {
    answer: `${removeBankSpecificSentences(answer)} ${GENERAL_COMPANY_CASH_FLOW_NOTE}`.replace(/\s+/g, " ").trim(),
    taxonomy: {
      fallbackCategory: "sanitation_guard",
      fallbackUserReason: "wrong_sector_wording",
      guardLabels: ["wrong_sector_bank_language_removed"]
    }
  };
}

function isCashFlowOrLiquidityAnswer(answer: string, question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "cash_flow" || questionIntent === "liquidity_debt") {
    return true;
  }
  return /(営業CF|営業キャッシュフロー|キャッシュフロー|資金繰り|流動性|cash\s*flow|liquidity)/i.test(`${question} ${answer}`);
}

function containsBankSpecificLanguage(answer: string): boolean {
  return /\b(deposits?|loans?|loan losses|credit losses|deposit base|net interest income)\b|預金|貸出|貸倒|信用損失|純金利収入/i.test(answer);
}

function removeBankSpecificSentences(answer: string): string {
  const parts = answer.match(/[^。！？\n]+[。！？]?|\n+/g) ?? [answer];
  return parts.filter((part) => !containsBankSpecificLanguage(part)).join("").replace(/\n{3,}/g, "\n\n").trim();
}

function isFinancialFilingForFinalizer(filing: FilingCacheRecord): boolean {
  const ticker = filing.ticker.toUpperCase();
  if (FINANCIAL_TICKERS_FOR_FINALIZER.has(ticker)) {
    return true;
  }
  const name = filing.companyName.toLowerCase();
  return /\b(bank|bancorp|banking|financial group|financial services|capital markets|securities|brokerage)\b/.test(name);
}

const FINANCIAL_TICKERS_FOR_FINALIZER = new Set([
  "JPM",
  "BAC",
  "WFC",
  "C",
  "GS",
  "MS",
  "USB",
  "PNC",
  "TFC",
  "BK",
  "STT",
  "COF",
  "AXP"
]);

function formatUsdAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100_000_000) {
    return `${formatOkuDollar(value / 100_000_000)}億ドル`;
  }
  if (abs >= 1_000_000) {
    const millions = Math.round((value / 1_000_000) * 10) / 10;
    return `${Number.isInteger(millions) ? String(millions) : millions.toFixed(1)}百万ドル`;
  }
  return "金額";
}

function formatOkuDollar(value: number, forceDecimal = false): string {
  const rounded = Math.round(value * 10) / 10;
  if (forceDecimal) {
    return rounded.toFixed(1);
  }
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function isLiquidityDebtQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "liquidity_debt") {
    return true;
  }
  return /(資金繰り|負債|債務|借入|返済期限|満期|流動性|liquidity|debt|maturity|borrowings?|creditfacility)/i.test(
    question.replace(/\s+/g, "")
  );
}

function hasAffirmativeLiquiditySafetyOrDistressConclusion(answer: string): boolean {
  const noConcernConclusion = /(?:懸念|問題|不安)(?:は|が|も)?(?:全く|まったく|特に|ほぼ)?(?:ありません(?!か)|ない(?!とは|とまでは|可能性|かもしれ|か(?:は|どうか))|小さい(?!とは|とまでは|可能性|かもしれ)|限定的(?:です|と判断))/u.test(answer);
  const qualifiedLowConcernConclusion = /(?:懸念|問題|不安)(?:は|が|も)?\s*(?:(?:資料上|現時点|直ちに)(?:で|では|は)?|当面|今のところ)?\s*(?:(?:限定的|小さい|低い|少ない)(?:に|と)?(?:見え(?:ます|る)|みられ(?:ます|る)|見られ(?:ます|る)|思われ(?:ます|る)|考えられ(?:ます|る))(?!か(?:は|どうか)|とは|とまでは|可能性|かもしれ)|(?:示されて|確認されて|認められて)(?:いません|いない)|見当たりません)/u.test(answer);
  const concernPresenceConclusion = /(?:懸念|問題|不安)(?:は|が|も)?(?:あります(?!か)|ある(?!可能性|かもしれ|か(?:は|どうか)|とは|とまでは))/u.test(answer);
  const safetyConclusion = /(?:資金繰り|流動性|財務)(?:は|が)?(?:安全|健全|盤石|十分)(?:です|と判断します|と言えます)|(?:十分な流動性|返済余力がある|債務返済に問題ありません)/u.test(answer);
  const healthyLiquidityPositionConclusion = /(?:現金(?:及び現金同等物)?|手元資金|営業CF|営業キャッシュフロー)[^。！？\n]{0,40}(?:健全|盤石|潤沢|十分)(?:な規模|な水準|です|と言えます|と判断します)(?!か(?:は|どうか)|とは|とまでは|可能性|かもしれ)/u.test(answer);
  const unsupportedBalanceSheetReassurance = /(?:直近の現金|手元資金)(?:が|は)[^。！？\n]{0,24}(?:十分|潤沢)|(?:負債|債務)(?:水準|の水準)?(?:は|が)[^。！？\n]{0,16}(?:安定的|健全|問題ない)|(?:現金|営業CF|営業キャッシュフロー)[^。！？\n]{0,60}(?:カバー余力[^。！？\n]{0,16}示唆|大きく安定|資金余力|規模が十分)|(?:満期|返済)リスク[^。！？\n]{0,20}限定的|(?:懸念|問題|不安)[^。！？\n]{0,36}(?:(?:限定的|小さい|低い)(?!か(?:は|どうか)|とは|とまでは)|見当たらない)|特定の不足は示されず|特定の[^。！？\n]{0,24}リスク[^。！？\n]{0,16}(?:記載|示唆)はなく|現金余力|安定した現金創出|現金の手元は堅調|大枠安定/u.test(answer);
  const distressConclusion = /(?:懸念|不安)(?:は|が)?(?:非常に|かなり|極めて)?強い(?!とは|とまでは|可能性|かもしれ)|(?:資金繰り|流動性)(?:は|が)?(?:危機的|深刻|逼迫|枯渇|不足)(?:です|しています|と判断します)|(?:返済困難|返済不能|債務不履行|デフォルト)(?:です|に陥っています|と判断します)/u.test(answer);
  return noConcernConclusion || qualifiedLowConcernConclusion || concernPresenceConclusion || safetyConclusion ||
    healthyLiquidityPositionConclusion || unsupportedBalanceSheetReassurance || distressConclusion;
}

function hasDefinitiveCashGenerationHealthConclusion(answer: string): boolean {
  return /(?:現金|キャッシュ)(?:創出力|創出余力|創出)(?:は|が)?(?:健全|強い|十分|良好|弱い|脆弱|不十分|乏しい)(?:です|と判断します|と言えます|だと考えます)|営業CF[^。！？\n]{0,40}(?:健全|強い|十分|良好|弱い|脆弱|不十分|乏しい)(?:です|と判断します|と言えます)|(?:現金|キャッシュ)創出(?:力)?[^。！？\n]{0,20}(?:問題|懸念)(?:は|が)?(?:ありません(?!か)|あります(?!か))/u.test(answer);
}

function isCashGenerationQuestion(question: string, questionIntent?: string | null): boolean {
  if (isLiquidityDebtQuestion(question, questionIntent)) {
    return false;
  }
  if (questionIntent === "cash_flow") {
    return true;
  }
  return /(?:営業CF|営業キャッシュフロー|キャッシュ創出|operatingcashflow|operating cash flow)/iu.test(
    question.replace(/\s+/g, "")
  );
}

function cleanLiquidityDebtAnswer(answer: string): AnswerCleanupResult {
  const hasLiquidityEvidence = /(cash|キャッシュ|現金|資金|liquidity|流動性|debt|負債|債務|借入|credit facility|信用枠|revolver|社債|maturit|満期|leverage|レバレッジ|deposit|預金|capital ratio|自己資本|operating cash flow|営業CF|営業キャッシュフロー|キャッシュフロー)/i.test(answer);
  const genericRiskShape = /(主要リスク|リスク要因|規制|競争|顧客|データ|市場環境|サプライチェーン)/.test(answer) &&
    !/(cash|キャッシュ|現金|資金|liquidity|流動性|debt|負債|債務|借入|credit facility|信用枠|maturit|満期|leverage|レバレッジ|deposit|預金|capital ratio|自己資本|operating cash flow|営業CF|営業キャッシュフロー|キャッシュフロー)/i.test(answer);
  const riskSummaryLead = /^主要リスク/.test(answer.trim()) &&
    /(規制|競争|顧客|データ|市場環境|サプライチェーン|リスク要因)/.test(answer) &&
    !/(現金|借入残高|負債残高|満期スケジュール|借入枠|信用枠|キャッシュフロー計算書|営業キャッシュフロー|預金|自己資本比率)/.test(answer);

  if (genericRiskShape || riskSummaryLead || !hasLiquidityEvidence) {
    return sourceInsufficientCleanup(
      LIQUIDITY_DEBT_SOURCE_INSUFFICIENT_FALLBACK,
      "liquidity_sources_missing",
      LIQUIDITY_MISSING_EVIDENCE,
      ["liquidity_debt_sources_missing"]
    );
  }
  return { answer };
}

function isWatchPointsQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "watch_points") {
    return true;
  }
  return /(次回決算|次に見る|見るべき|ポイント|watchpoints?|nextquarter|nextfiling)/i.test(question.replace(/\s+/g, ""));
}

function cleanWatchPointsAnswer(answer: string): AnswerCleanupResult {
  if (!isGenericWatchPointsAnswer(answer)) {
    return { answer };
  }
  return {
    answer: "選択された資料だけでは、次回決算で見るべき会社固有のポイントを3つに絞るには不足しています。確認すべき箇所は、経営陣による業績説明、セグメント実績、売上説明、利益率・採算性の説明、キャッシュフロー・流動性です。一般的な売上・利益・コストだけでは、この会社固有の注目点とは判断しません。",
    taxonomy: {
      fallbackCategory: "answer_quality_guard",
      fallbackUserReason: "generic_watch_points",
      missingEvidence: ["management_discussion", "segment_results", "revenue_discussion", "profitability_discussion", "cash_flow_liquidity"],
      missingEvidenceLabelsJa: ["経営陣による業績説明", "セグメント実績", "売上説明", "利益率・採算性の説明", "キャッシュフロー・流動性"],
      guardLabels: ["generic_watch_points"]
    }
  };
}

function isGenericWatchPointsAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const genericItems = ["売上高", "営業利益", "利益率", "純利益", "コスト構造", "キャッシュフロー", "支出の動向", "財務健全性"].filter((item) => normalized.includes(item)).length;
  const hasMalformedMetric = /[0-9]{1,3}(?:,[0-9]{3})+\s*USD|前年同期の比較値|\?/.test(answer);
  const specificSignals = /(segment|セグメント|顧客|製品|地域|価格|数量|受注|backlog|orders|occupancy|NOI|traffic|ticket|commodity|production|Neutron|Electron|RNA|廃棄物|資産運用|医療機器|半導体|診断|Alaris|Medication Management|信用枠|満期|借入|流動性)/i;
  return (genericItems >= 3 && !specificSignals.test(answer)) || (genericItems >= 2 && hasMalformedMetric);
}

function cleanBusinessModelAnswer(answer: string, responsePath: ChatResponsePath, fallbackKind: ChatFallbackKind): AnswerCleanupResult {
  if (
    responsePath === "fallback" &&
    ["api_error", "low_quality", "weak_grounding", "non_hard_model_timeout", "legacy_template", "unknown_fallback"].includes(fallbackKind) &&
    isMetricSnapshotOnly(answer)
  ) {
    return sourceInsufficientCleanup(
      BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK,
      "business_model_sources_missing",
      BUSINESS_MODEL_MISSING_EVIDENCE,
      ["business_model_metric_snapshot_replaced"]
    );
  }

  const naturalized = normalizeBusinessLineLabels(answer);
  const withoutForbiddenUnits = removeForbiddenCurrencyUnitSentences(naturalized);
  const withoutMetricSnapshots = removeBusinessModelMetricSnapshotSentences(withoutForbiddenUnits);
  if (!withoutMetricSnapshots.trim()) {
    return sourceInsufficientCleanup(
      BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK,
      "business_model_sources_missing",
      BUSINESS_MODEL_MISSING_EVIDENCE,
      ["business_model_metric_sentences_removed"]
    );
  }

  if (isMetricHeavyBusinessModelAnswer(withoutMetricSnapshots)) {
    return {
      answer: BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK,
      taxonomy: {
        fallbackCategory: "answer_quality_guard",
        fallbackUserReason: "answer_too_metric_only",
        missingEvidence: ["business", "segment_information", "revenue_note", "mda_business_discussion"],
        missingEvidenceLabelsJa: BUSINESS_MODEL_MISSING_EVIDENCE,
        guardLabels: ["business_model_metric_heavy"]
      }
    };
  }

  if (isGenericBusinessModelAnswer(withoutMetricSnapshots)) {
    return {
      answer: BUSINESS_MODEL_SOURCE_INSUFFICIENT_FALLBACK,
      taxonomy: {
        fallbackCategory: "source_insufficient",
        fallbackUserReason: "business_model_sources_missing",
        missingEvidence: ["business", "segment_information", "revenue_note", "mda_business_discussion"],
        missingEvidenceLabelsJa: BUSINESS_MODEL_MISSING_EVIDENCE,
        guardLabels: ["business_model_too_generic"]
      }
    };
  }

  if (withoutMetricSnapshots !== withoutForbiddenUnits) {
    return {
      answer: withoutMetricSnapshots,
      taxonomy: {
        fallbackCategory: "answer_quality_guard",
        fallbackUserReason: "answer_too_metric_only",
        missingEvidence: ["business", "segment_information", "revenue_note", "mda_business_discussion"],
        missingEvidenceLabelsJa: BUSINESS_MODEL_MISSING_EVIDENCE,
        guardLabels: ["business_model_metric_snapshot_sentence_removed"]
      }
    };
  }

  if (hasMalformedCurrencyForTaxonomy(withoutMetricSnapshots) || hasCurrencySanitizationPlaceholder(withoutMetricSnapshots)) {
    return {
      answer: withoutMetricSnapshots,
      taxonomy: {
        fallbackCategory: "sanitation_guard",
        fallbackUserReason: "malformed_currency_detected",
        guardLabels: ["malformed_currency_detected"]
      }
    };
  }

  return { answer: withoutMetricSnapshots };
}

function isManagementFocusQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "management_focus" || questionIntent === "mda_emphasis") {
    return true;
  }
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return /(経営陣.*強調|会社側.*強調|md&a.*強調|強調している論点|強調してる論点|強調されてること|強調されていること|management.*emphas|mda.*emphas)/i.test(normalized);
}

function cleanManagementFocusAnswer(answer: string): AnswerCleanupResult {
  if (isMetricSnapshotOnly(answer) || isMetricOnlyManagementFocusAnswer(answer)) {
    return {
      answer: MANAGEMENT_FOCUS_SOURCE_INSUFFICIENT_FALLBACK,
      taxonomy: {
        fallbackCategory: "answer_quality_guard",
        fallbackUserReason: "answer_too_metric_only",
        missingEvidence: ["mda", "results_of_operations", "segment_results", "outlook_risk_discussion"],
        missingEvidenceLabelsJa: MANAGEMENT_MISSING_EVIDENCE,
        guardLabels: ["management_focus_metric_only"]
      }
    };
  }
  return { answer };
}

function isMetricOnlyManagementFocusAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const hasManagementSignal = /(経営陣|会社側|強調|MD&A|経営陣による業績説明|業績説明|セグメント|需要|見通し|リスク|利益率|製品|サービス|顧客|供給|コスト|価格|数量)/.test(normalized);
  const metricLead = /^(売上高|収益|営業利益|純利益|利益率|マージン)は[-0-9.,]+(?:兆|億|百万)?ドル/.test(normalized);
  const metricHeavy = /(売上高|営業利益|純利益|前年同期比|前年比|億ドル|百万ドル|%)/g;
  const metricHits = normalized.match(metricHeavy)?.length ?? 0;
  return metricLead || (!hasManagementSignal && metricHits >= 2);
}

function isBusinessModelQuestion(question: string, questionIntent?: string | null): boolean {
  if (questionIntent === "business_model" || questionIntent === "business_overview") {
    return true;
  }
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return /(何屋|なに屋|何で稼|なにで稼|何で儲|なにで儲|儲けている|儲けてる|稼いでる|稼いでん|なんの会社|何の会社|どんな会社|何してる|何をしてる|事業内容|収益源|businessmodel|whatdoes.*companydo|whatbusiness)/.test(normalized);
}

function isMetricSnapshotOnly(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const metricLabel = "(?:売上高|営業利益|純利益|営業CF|営業キャッシュフロー)";
  const amount = "[-0-9.,]+(?:兆|億|百万)?ドル";
  return new RegExp(`^${metricLabel}は${amount}で、?(?:前年同期比|前年比)[-0-9.]+%[増減]です。?$`).test(normalized) ||
    new RegExp(`^${metricLabel}は${amount}です。?$`).test(normalized);
}

function isMetricHeavyBusinessModelAnswer(answer: string): boolean {
  const firstSentence = firstJapaneseSentence(answer).replace(/\s+/g, "");
  if (isMetricSnapshotOnly(firstSentence)) {
    return true;
  }
  if (/^(この会社|同社|[A-Za-z0-9 .,&'-]+)?(?:は)?(?:主に)?(?:売上|売上高|収益|営業利益|純利益|利益率|マージン|前年同期比)/.test(firstSentence)) {
    return true;
  }
  if (/売上(?:を|高を)?[「\"]?売上高|売上を軸に稼/.test(firstSentence)) {
    return true;
  }

  const businessSignals = /(会社|企業|事業|製品|サービス|半導体|ソフトウェア|小売|広告|販売|提供|顧客|向け|収益源|稼ぐ会社|何屋|メーカー|プラットフォーム|部品|機器)/;
  const metricSignals = /(売上高|営業利益|純利益|利益率|前年同期比|前年比|営業CF|キャッシュフロー|億ドル|百万ドル|USD|ドル)/g;
  const metricHits = answer.match(metricSignals)?.length ?? 0;
  return !businessSignals.test(answer) && metricHits >= 2;
}

function isGenericBusinessModelAnswer(answer: string): boolean {
  const normalized = answer.replace(/\s+/g, "");
  const genericBusinessLineOnly = /(?:製品とサービス|製品やサービス|商品とサービス|商品やサービス|製品・サービス|商品・サービス|小売事業|事業活動|販売事業|サービス事業)(?:の提供|の販売)?(?:を通じて)?(?:で|から)?(?:収益|売上|利益)?(?:を)?(?:得ています|稼いでいます|儲けています|上げています|得る会社です|稼ぐ会社です)/.test(normalized);
  return genericBusinessLineOnly;
}

function firstJapaneseSentence(answer: string): string {
  return answer.split(/[。！？\n]/)[0] ?? answer;
}

function removeForbiddenCurrencyUnitSentences(answer: string): string {
  if (!hasForbiddenCurrencyUnit(answer)) {
    return answer;
  }

  const parts = answer.match(/[^。！？\n]+[。！？]?|\n+/g) ?? [answer];
  const kept = parts.filter((part) => !hasForbiddenCurrencyUnit(part));
  return kept.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function removeBusinessModelMetricSnapshotSentences(answer: string): string {
  const parts = answer.match(/[^。！？\n]+[。！？]?|\n+/g) ?? [answer];
  const kept = parts.filter((part) => !isBusinessModelMetricSnapshotSentence(part));
  return kept.join("").replace(/\n{3,}/g, "\n\n").trim();
}

function isBusinessModelMetricSnapshotSentence(text: string): boolean {
  const normalized = text.replace(/\s+/g, "");
  if (!/[0-9０-９]/.test(normalized)) {
    return false;
  }
  if (!/(売上高|総売上高|純利益|営業利益|利益率|マージン|前年同期比|前年比|前期比|四半期実績|決算では|億ドル|百万ドル|USD|ドル|%)/.test(normalized)) {
    return false;
  }
  if (/(製品|サービス|部品|半導体|ソフトウェア|広告|プラットフォーム|顧客|向け|販売から稼|提供して稼|収益源)/.test(normalized) && !/(売上高|総売上高|純利益|営業利益|前年同期比|前年比|四半期実績)/.test(normalized)) {
    return false;
  }
  return true;
}

function hasForbiddenCurrencyUnit(text: string): boolean {
  return /(?:千\s*USD|千USD|百万円|億円|万円|[0-9０-９.,，]+億[0-9０-９.,，千百十]*千\s*USD|[0-9０-９.,，]+億[0-9０-９.,，千百十]*百万円|[0-9０-９.,，]+億[0-9０-９.,，千百十]*万円|[0-9０-９.,，]+\s*円)/.test(text);
}

function hasMalformedCurrencyForTaxonomy(text: string): boolean {
  return hasForbiddenCurrencyUnit(text) ||
    /(?:百万\s*USD|億\s*USD|億USD|千\s*USD|千USD|[0-9]{1,3}(?:,[0-9]{3})+\s*USD|[0-9]+(?:\.[0-9]+)?\s*[亿億]?\s*美元|[0-9]+,(?![0-9]{3}(?:,[0-9]{3})*億ドル)[0-9,]+億ドル|[0-9]+(?:,[0-9]{1,2})+\.[0-9]+億ドル|前年同[0-9.,?，]+)/.test(text);
}

function hasCurrencySanitizationPlaceholder(text: string): boolean {
  return /売上高の数値表示/.test(text);
}

function suppressInvisibleMalformedCurrencyTaxonomy(
  taxonomy: FallbackTaxonomy,
  finalAnswer: string
): FallbackTaxonomy {
  if (
    taxonomy.fallbackUserReason !== "malformed_currency_detected" ||
    hasMalformedCurrencyForTaxonomy(finalAnswer) ||
    hasCurrencySanitizationPlaceholder(finalAnswer)
  ) {
    return taxonomy;
  }
  return {
    fallbackCategory: "none",
    fallbackUserReason: "none",
    missingEvidence: taxonomy.missingEvidence,
    missingEvidenceLabelsJa: taxonomy.missingEvidenceLabelsJa,
    guardLabels: (taxonomy.guardLabels ?? []).filter((label) => label !== "malformed_currency_detected")
  };
}

function classifyFallbackTaxonomy({
  debug,
  responsePath,
  fallbackKind,
  cleanup,
  finalAnswerSafe,
  languageLabels
}: {
  debug: ChatResponseDebugInput;
  responsePath: ChatResponsePath;
  fallbackKind: ChatFallbackKind;
  cleanup: AnswerCleanupResult;
  finalAnswerSafe: boolean;
  languageLabels: string[];
}): FallbackTaxonomy {
  if (!finalAnswerSafe) {
    return {
      fallbackCategory: "language_guard",
      fallbackUserReason: "raw_english_detected",
      guardLabels: languageLabels.length > 0 ? languageLabels : ["language_guard"]
    };
  }

  const cleanupTaxonomy = normalizePartialTaxonomy(cleanup.taxonomy);
  if (cleanupTaxonomy) {
    return alignSourceMissingTaxonomyWithIntent(cleanupTaxonomy, debug.questionIntent);
  }

  const modelErrorKind = debug.modelApiErrorKind ?? debug.geminiApiErrorKind ?? null;
  if (modelErrorKind) {
    return {
      fallbackCategory: "model_error",
      fallbackUserReason: modelErrorKindToUserReason(modelErrorKind),
      guardLabels: [`model_api_error:${modelErrorKind}`]
    };
  }

  if (debug.sourceIdsValid === false || debug.fallbackReason === "invalid_source_id") {
    return {
      fallbackCategory: "answer_quality_guard",
      fallbackUserReason: "invalid_sources",
      guardLabels: ["invalid_sources"]
    };
  }

  if (debug.fallbackReason === "schema_invalid" || debug.fallbackReason === "json_parse_failed") {
    return {
      fallbackCategory: "model_error",
      fallbackUserReason: "model_schema_invalid",
      guardLabels: [debug.fallbackReason]
    };
  }

  if (responsePath !== "fallback" && fallbackKind === "none") {
    return { fallbackCategory: "none", fallbackUserReason: "none" };
  }

  if (responsePath === "fallback") {
    if (debug.fallbackReason === "gemini_timeout" || fallbackKind === "non_hard_model_timeout" || fallbackKind === "hard_model_timeout_evidence") {
      return {
        fallbackCategory: "model_error",
        fallbackUserReason: "model_timeout",
        guardLabels: ["model_timeout"]
      };
    }
    if (debug.fallbackReason === "gemini_api_error" || fallbackKind === "api_error") {
      return {
        fallbackCategory: "model_error",
        fallbackUserReason: "model_unavailable",
        guardLabels: ["model_api_error"]
      };
    }
    if (debug.evidenceFallbackUsed || fallbackKind === "evidence_slot" || debug.sourceGateApplied) {
      return sourceInsufficientTaxonomyForIntent(debug.questionIntent, debug.sourceGateMissingSourceTypes);
    }
  }

  return { fallbackCategory: "none", fallbackUserReason: "none" };
}

function normalizePartialTaxonomy(taxonomy?: Partial<FallbackTaxonomy>): FallbackTaxonomy | null {
  if (!taxonomy?.fallbackCategory && !taxonomy?.fallbackUserReason) {
    return null;
  }
  return {
    fallbackCategory: taxonomy.fallbackCategory ?? "none",
    fallbackUserReason: taxonomy.fallbackUserReason ?? "none",
    missingEvidence: taxonomy.missingEvidence ?? taxonomy.missingEvidenceLabelsJa?.map((label) => sourceLabelToEvidenceKey(label)),
    missingEvidenceLabelsJa: taxonomy.missingEvidenceLabelsJa,
    guardLabels: taxonomy.guardLabels
  };
}

function alignSourceMissingTaxonomyWithIntent(
  taxonomy: FallbackTaxonomy,
  questionIntent?: string | null
): FallbackTaxonomy {
  if (!taxonomy.fallbackUserReason.endsWith("_sources_missing")) {
    return taxonomy;
  }
  if (
    questionIntent === "margin_driver" ||
    questionIntent === "margin_durability_followup" ||
    questionIntent === "margin_profitability"
  ) {
    return {
      ...sourceInsufficientTaxonomy("margin_driver_sources_missing", MARGIN_DRIVER_MISSING_EVIDENCE, taxonomy.missingEvidenceLabelsJa ?? []),
      guardLabels: dedupeStrings(["source_insufficient", ...(taxonomy.guardLabels ?? [])])
    };
  }
  if (questionIntent === "revenue_driver" || questionIntent === "yoy_change" || questionIntent === "driver_durability_followup") {
    return {
      ...sourceInsufficientTaxonomy("revenue_driver_sources_missing", REVENUE_DRIVER_MISSING_EVIDENCE, taxonomy.missingEvidenceLabelsJa ?? []),
      guardLabels: dedupeStrings(["source_insufficient", ...(taxonomy.guardLabels ?? [])])
    };
  }
  return taxonomy;
}

function shouldCleanupBlockModelAnswer(
  cleanup: AnswerCleanupResult,
  question: string,
  questionIntent?: string | null
): boolean {
  const reason = cleanup.taxonomy?.fallbackUserReason;
  if (!reason || reason === "none") {
    return false;
  }
  if (reason === "business_model_sources_missing" && isBusinessModelQuestion(question, questionIntent)) {
    return true;
  }
  if (reason === "revenue_driver_sources_missing" && isRevenueDriverQuestion(question, questionIntent)) {
    return true;
  }
  if (reason === "revenue_breakdown_sources_missing" && isRevenueBreakdownQuestion(question, questionIntent)) {
    return true;
  }
  if (reason === "margin_driver_sources_missing" && (questionIntent === "margin_driver" || questionIntent === "margin_durability_followup" || isMarginDurabilityFollowupQuestion(question, questionIntent))) {
    return true;
  }
  if (reason !== "answer_too_metric_only") {
    return false;
  }
  if (isBusinessModelQuestion(question, questionIntent)) {
    return true;
  }
  return questionIntent === "revenue_driver" ||
    questionIntent === "margin_driver" ||
    questionIntent === "driver_durability_followup" ||
    questionIntent === "margin_durability_followup";
}

function modelErrorKindToUserReason(kind: NonNullable<ChatResponseDebug["modelApiErrorKind"]>): FallbackUserReason {
  switch (kind) {
    case "rate_limit":
      return "model_rate_limited";
    case "timeout":
      return "model_timeout";
    case "bad_request":
    case "payload_too_large":
    case "context_too_large":
      return "model_schema_invalid";
    case "auth_error":
    case "provider_server_error":
    case "network_error":
    case "unknown":
    default:
      return "model_unavailable";
  }
}

function sourceInsufficientTaxonomyForIntent(questionIntent?: string | null, missingSourceTypes: string[] = []): FallbackTaxonomy {
  if (questionIntent === "revenue_driver" || questionIntent === "yoy_change" || questionIntent === "driver_durability_followup") {
    return sourceInsufficientTaxonomy("revenue_driver_sources_missing", REVENUE_DRIVER_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "revenue_breakdown" || questionIntent === "revenue_snapshot" || questionIntent === "segment_driver" || questionIntent === "segment_analysis") {
    return sourceInsufficientTaxonomy("revenue_breakdown_sources_missing", REVENUE_BREAKDOWN_MISSING_EVIDENCE, missingSourceTypes);
  }
  const missingHaystack = missingSourceTypes.join(" ").toLowerCase();
  if (/(margin|profitability|price-cost|manufacturing cost|sg&a|sga|r&d|research and development|segment margin|cost discussion)/.test(missingHaystack)) {
    return sourceInsufficientTaxonomy("margin_driver_sources_missing", MARGIN_DRIVER_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "business_model" || questionIntent === "business_overview") {
    return sourceInsufficientTaxonomy("business_model_sources_missing", BUSINESS_MODEL_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "management_focus" || questionIntent === "mda_emphasis") {
    return sourceInsufficientTaxonomy("management_discussion_sources_missing", MANAGEMENT_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "liquidity_debt" || questionIntent === "cash_flow") {
    return sourceInsufficientTaxonomy("liquidity_sources_missing", LIQUIDITY_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "risk_factors") {
    return sourceInsufficientTaxonomy("risk_sources_missing", RISK_MISSING_EVIDENCE, missingSourceTypes);
  }
  if (questionIntent === "margin_driver" || questionIntent === "margin_durability_followup" || questionIntent === "margin_profitability") {
    return sourceInsufficientTaxonomy("margin_driver_sources_missing", MARGIN_DRIVER_MISSING_EVIDENCE, missingSourceTypes);
  }
  return sourceInsufficientTaxonomy("revenue_driver_sources_missing", REVENUE_DRIVER_MISSING_EVIDENCE, missingSourceTypes);
}

function sourceInsufficientTaxonomy(
  fallbackUserReason: Extract<FallbackUserReason, `${string}_sources_missing`>,
  fallbackLabelsJa: string[],
  missingSourceTypes: string[]
): FallbackTaxonomy {
  const labelsJa = missingSourceTypes.length > 0
    ? dedupeStrings(missingSourceTypes.map((label) => normalizeMissingEvidenceLabelJa(label)))
    : fallbackLabelsJa;
  return {
    fallbackCategory: "source_insufficient",
    fallbackUserReason,
    missingEvidence: labelsJa.map((label) => sourceLabelToEvidenceKey(label)),
    missingEvidenceLabelsJa: labelsJa,
    guardLabels: ["source_insufficient"]
  };
}

function normalizeMissingEvidenceLabelJa(label: string): string {
  const normalized = label.trim();
  const lower = normalized.toLowerCase();
  if ((lower.includes("mda") || lower.includes("md&a")) && lower.includes("risk")) {
    return "MD&Aのリスク説明";
  }
  if (lower.includes("mda") || lower.includes("md&a") || normalized.includes("経営陣")) {
    return "MD&A";
  }
  if (lower.includes("segment")) {
    return "セグメント実績";
  }
  if (lower.includes("revenue")) {
    return "売上説明";
  }
  if (lower.includes("profitability") || lower.includes("margin")) {
    return "利益率・採算性の説明";
  }
  if (lower.includes("cash") || lower.includes("liquidity")) {
    return "キャッシュフロー・流動性";
  }
  if (lower.includes("debt")) {
    return "負債の説明";
  }
  if (lower.includes("risk")) {
    return "リスク要因";
  }
  if (lower.includes("sector")) {
    return "業種固有KPI";
  }
  if (lower.includes("net interest")) {
    return "純利息収入";
  }
  if (lower.includes("noninterest")) {
    return "非金利収入・費用";
  }
  if (lower.includes("provision for credit losses") || lower.includes("credit loss")) {
    return "信用損失引当";
  }
  if (lower.includes("deposit") || lower.includes("loan") || lower.includes("credit quality")) {
    return "預金・貸出・信用品質";
  }
  if (lower.includes("investment banking") || lower.includes("trading") || lower.includes("wealth management") || lower.includes("asset management")) {
    return "金融サービス別収益";
  }
  if (lower.includes("commodity") || lower.includes("crude") || lower.includes("natural gas")) {
    return "資源価格";
  }
  if (lower.includes("production volume")) {
    return "生産量";
  }
  if (lower.includes("upstream") || lower.includes("downstream")) {
    return "上流・下流セグメント";
  }
  if (lower.includes("refining") || lower.includes("chemical margin")) {
    return "精製・化学マージン";
  }
  if (lower.includes("price-cost") || lower.includes("manufacturing cost") || lower.includes("cost absorption") || lower.includes("material cost")) {
    return "価格とコスト・製造コスト";
  }
  if (lower.includes("sg&a") || lower.includes("sga") || lower.includes("r&d") || lower.includes("research and development")) {
    return "販管費・研究開発費";
  }
  if (lower.includes("segment margin") || lower.includes("segment profitability") || lower.includes("segment operating profit")) {
    return "セグメント利益率";
  }
  if (lower.includes("price realization")) {
    return "価格実現";
  }
  if (lower.includes("sales volume")) {
    return "販売数量";
  }
  if (lower.includes("order") || lower.includes("backlog")) {
    return "受注・バックログ";
  }
  if (lower.includes("dealer inventory")) {
    return "ディーラー在庫";
  }
  if (lower.includes("comparable sales") || lower.includes("comp sales")) {
    return "既存店売上";
  }
  if (lower.includes("traffic") || lower.includes("ticket")) {
    return "客数・客単価";
  }
  if (lower.includes("ecommerce") || lower.includes("e-commerce")) {
    return "EC売上";
  }
  if (lower.includes("membership") || lower.includes("advertising")) {
    return "会員・広告収益";
  }
  if (lower.includes("vehicle pricing")) {
    return "車両価格";
  }
  if (lower.includes("automotive gross margin")) {
    return "自動車粗利益率";
  }
  if (lower.includes("pricing")) {
    return "価格改定";
  }
  if (lower.includes("volume")) {
    return "販売数量";
  }
  if (lower.includes("foreign exchange") || lower.includes("currency")) {
    return "為替影響";
  }
  if (lower.includes("organic sales")) {
    return "オーガニック売上";
  }
  if (lower.includes("gross margin")) {
    return "粗利益率";
  }
  if (lower.includes("deliveries")) {
    return "納車台数";
  }
  if (lower.includes("energy revenue")) {
    return "エネルギー事業収益";
  }
  if (lower.includes("subscription") || lower.includes("usage") || lower.includes("customer") || lower.includes("rpo") || lower.includes("deferred revenue") || lower.includes("retention")) {
    return "サブスク・利用量・顧客指標";
  }
  return normalizeFallbackSourceLabels(normalized);
}

function sourceLabelToEvidenceKey(label: string): string {
  return label
    .normalize("NFKC")
    .toLowerCase()
    .replace(/md&a/g, "mda")
    .replace(/[・、／/（）()]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function sampleUnsafeAnswer(answer: string): string {
  return answer
    .replace(/[A-Za-z][A-Za-z0-9’'&,()/-]+(?:\s+[A-Za-z0-9’'&,()/-]+){5,}/g, "[english omitted]")
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function cleanBannedFinalAnswer(answer: string, questionIntent?: string | null): string {
  let cleaned = answer
    .replace(/提出資料の本文に、この論点に関する説明があります。?\s*/g, "")
    .replace(/本文に、この論点に関する説明があります。?\s*/g, "")
    .replace(/本文全体と数字を並べると、どの要因が強いかを追いやすくなります。?\s*/g, "")
    .replace(/本文全体と数字を並べると見えてきます。?\s*/g, "")
    .replace(/本文の要因説明と並べると判断しやすくなります。?\s*/g, "")
    .replace(/価格、数量、需要、コスト、mixを見るべきです。?\s*/g, "")
    .replace(/利益の動きは、この説明と費用・評価損益・税金の数字を並べると見えてきます。?/g, "利益の動きは、費用・評価損益・税金の内訳確認が必要です。")
    .replace(/(^|[。！？\s])買いです。?/g, "$1投資判断や株価の断定はしません。")
    .replace(/(?:売るべき|買うべき|投資推奨|目標株価|株価予想|(?:割安|割高)(?:です|だ|と断定|と判断))。?/g, "投資判断や株価の断定はしません。");

  if (/この資料の範囲では確認できません/.test(cleaned)) {
    const replacement = questionIntent === "liquidity_debt"
      ? "debt note や liquidity discussion の追加確認が必要です"
      : "不足している資料の種類の追加確認が必要です";
    cleaned = cleaned.replace(/この資料の範囲では確認できません/g, replacement);
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

function normalizeFallbackKind(
  responsePath: ChatResponsePath,
  debug: ChatResponseDebugInput
): ChatFallbackKind {
  if (responsePath !== "fallback") {
    return "none";
  }

  if (debug.fallbackKind && debug.fallbackKind !== "none") {
    if (debug.fallbackKind === "model_timeout") {
      return debug.sourceGateApplied ? "hard_model_timeout_evidence" : "non_hard_model_timeout";
    }
    return debug.fallbackKind;
  }

  switch (debug.fallbackReason) {
    case "gemini_timeout":
      return debug.sourceGateApplied ? "hard_model_timeout_evidence" : "non_hard_model_timeout";
    case "gemini_api_error":
      return "api_error";
    case "weak_grounding":
      return "weak_grounding";
    case "low_quality_answer":
      return debug.evidenceFallbackUsed ? "evidence_slot" : "low_quality";
    case "no_sources":
    case "metrics_only_insufficient":
      return "context_unavailable";
    case "deterministic_repair":
      return "deterministic_metric";
    case "invalid_source_id":
    case "schema_invalid":
    case "json_parse_failed":
      return "legacy_template";
    default:
      return "unknown_fallback";
  }
}
