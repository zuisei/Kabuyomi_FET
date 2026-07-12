import { createHash } from "node:crypto";

export const DEFAULT_RATE_LIMIT_CONTROLS = Object.freeze({
  concurrency: 1,
  minDelayMsBetweenRequests: 1500,
  maxRetriesOnRateLimit: 2,
  initialRateLimitBackoffMs: 5000,
  maxRateLimitBackoffMs: 30000,
  respectRetryAfterHeader: true,
  jitterMs: 500,
  stopRunOnRateLimitThreshold: null,
  markInfraContaminatedOnRateLimitThreshold: null
});

const INFRA_ERROR_KINDS = new Set(["rate_limit", "auth_error", "provider_server_error", "network_error", "unknown"]);
const ENGINEERING_ERROR_KINDS = new Set(["bad_request", "payload_too_large", "context_too_large"]);

export function benchmarkControlsFromEnv(env = process.env) {
  const controls = {
    concurrency: parsePositiveInt(env.BENCHMARK_CONCURRENCY, DEFAULT_RATE_LIMIT_CONTROLS.concurrency),
    minDelayMsBetweenRequests: parseNonNegativeInt(
      env.BENCHMARK_MIN_DELAY_MS,
      DEFAULT_RATE_LIMIT_CONTROLS.minDelayMsBetweenRequests
    ),
    maxRetriesOnRateLimit: parseNonNegativeInt(
      env.BENCHMARK_RATE_LIMIT_MAX_RETRIES,
      DEFAULT_RATE_LIMIT_CONTROLS.maxRetriesOnRateLimit
    ),
    initialRateLimitBackoffMs: parseNonNegativeInt(
      env.BENCHMARK_RATE_LIMIT_INITIAL_BACKOFF_MS,
      DEFAULT_RATE_LIMIT_CONTROLS.initialRateLimitBackoffMs
    ),
    maxRateLimitBackoffMs: parseNonNegativeInt(
      env.BENCHMARK_RATE_LIMIT_MAX_BACKOFF_MS,
      DEFAULT_RATE_LIMIT_CONTROLS.maxRateLimitBackoffMs
    ),
    respectRetryAfterHeader: parseBoolean(
      env.BENCHMARK_RATE_LIMIT_RESPECT_RETRY_AFTER,
      DEFAULT_RATE_LIMIT_CONTROLS.respectRetryAfterHeader
    ),
    jitterMs: parseNonNegativeInt(env.BENCHMARK_RATE_LIMIT_JITTER_MS, DEFAULT_RATE_LIMIT_CONTROLS.jitterMs),
    stopRunOnRateLimitThreshold: parseNullableNonNegativeInt(
      env.BENCHMARK_RATE_LIMIT_STOP_THRESHOLD,
      DEFAULT_RATE_LIMIT_CONTROLS.stopRunOnRateLimitThreshold
    ),
    markInfraContaminatedOnRateLimitThreshold: parseNullableNonNegativeInt(
      env.BENCHMARK_INFRA_CONTAMINATED_RATE_LIMIT_THRESHOLD,
      DEFAULT_RATE_LIMIT_CONTROLS.markInfraContaminatedOnRateLimitThreshold
    )
  };

  // Follow-up rows depend on prior answers, so this runner remains sequential.
  return { ...controls, concurrency: Math.max(1, controls.concurrency) };
}

export function classifyBenchmarkInfra(row) {
  const kind = normalizeGeminiApiErrorKind(row?.geminiApiErrorKind);
  if (!kind) {
    return {
      infraError: false,
      infraErrorKind: null,
      qualityEvaluable: true,
      excludedFromQualityMetricsReason: null,
      engineeringError: false
    };
  }

  if (ENGINEERING_ERROR_KINDS.has(kind)) {
    return {
      infraError: true,
      infraErrorKind: "unknown",
      qualityEvaluable: false,
      excludedFromQualityMetricsReason: kind,
      engineeringError: true
    };
  }

  if (kind === "timeout") {
    return {
      infraError: false,
      infraErrorKind: null,
      qualityEvaluable: true,
      excludedFromQualityMetricsReason: null,
      engineeringError: false
    };
  }

  return {
    infraError: true,
    infraErrorKind: INFRA_ERROR_KINDS.has(kind) ? kind : "unknown",
    qualityEvaluable: false,
    excludedFromQualityMetricsReason: INFRA_ERROR_KINDS.has(kind) ? kind : "unknown",
    engineeringError: false
  };
}

export function decorateBenchmarkRow(row) {
  const infra = classifyBenchmarkInfra(row);
  return {
    ...row,
    infraError: infra.infraError,
    infraErrorKind: infra.infraErrorKind,
    qualityEvaluable: infra.qualityEvaluable,
    excludedFromQualityMetricsReason: infra.excludedFromQualityMetricsReason,
    benchmarkFinalInfraErrorKind: row.benchmarkFinalInfraErrorKind ?? infra.infraErrorKind
  };
}

export function isRateLimitRow(row) {
  return normalizeGeminiApiErrorKind(row?.geminiApiErrorKind ?? row?.debug?.geminiApiErrorKind) === "rate_limit";
}

export function calculateRateLimitBackoffMs({ retryCount, controls, retryAfterMs = null, random = Math.random }) {
  const retryAfter = controls.respectRetryAfterHeader && Number.isFinite(retryAfterMs) ? retryAfterMs : null;
  const exponential = controls.initialRateLimitBackoffMs * 2 ** Math.max(0, retryCount - 1);
  const base = retryAfter ?? exponential;
  const capped = Math.min(base, controls.maxRateLimitBackoffMs);
  const jitter = controls.jitterMs > 0 ? Math.floor(random() * (controls.jitterMs + 1)) : 0;
  return capped + jitter;
}

export function buildBenchmarkSummary(rows, options = {}) {
  const decoratedRows = rows.map((row) => (typeof row.qualityEvaluable === "boolean" ? row : decorateBenchmarkRow(row)));
  const rateLimitRows = decoratedRows.filter((row) => row.infraErrorKind === "rate_limit").length;
  const authErrorRows = decoratedRows.filter((row) => row.infraErrorKind === "auth_error").length;
  const providerErrorRows = decoratedRows.filter((row) => row.infraErrorKind === "provider_server_error").length;
  const networkErrorRows = decoratedRows.filter((row) => row.infraErrorKind === "network_error").length;
  const engineeringErrorRows = decoratedRows.filter((row) =>
    ENGINEERING_ERROR_KINDS.has(normalizeGeminiApiErrorKind(row.geminiApiErrorKind) ?? "")
  ).length;
  const qualityRowsList = decoratedRows.filter((row) => row.qualityEvaluable !== false);
  const qualityRowsExcluded = decoratedRows.length - qualityRowsList.length;
  const judgeRows = qualityRowsList.filter((row) => row.claimSourceJudge && typeof row.claimSourceJudge === "object");
  const calibratedAlternative = normalizeCalibratedAlternative(options.calibratedAlternative, decoratedRows.length);
  const unresolvedNumericRows = qualityRowsList.filter((row) => hasUnresolvedNumericIssue(row));
  const materialNumericErrors = unresolvedNumericRows.length;
  const unsupportedInvestmentAdvice = qualityRowsList.filter((row) => hasUnsupportedInvestmentAdvice(row)).length;
  const fullJudgeCoverage = qualityRowsList.length > 0 && judgeRows.length === qualityRowsList.length;
  const judgeCoverageMissing = fullJudgeCoverage
    ? 0
    : Math.max(1, qualityRowsList.length - judgeRows.length);
  const evaluationCoverageSatisfied = fullJudgeCoverage || calibratedAlternative?.type === "complete_human_review_v2";
  const evaluationCoverageMode = fullJudgeCoverage
    ? "model_judge_full"
    : calibratedAlternative?.type === "complete_human_review_v2"
      ? "complete_human_review_v2"
      : judgeRows.length > 0
        ? "model_judge_partial"
        : "missing";
  const rateLimitThreshold = resolveRateLimitContaminationThreshold(decoratedRows.length, options);
  const providerErrorThreshold = options.providerErrorThreshold ?? Math.max(3, Math.floor(decoratedRows.length * 0.05));
  const infraContaminationReasons = [];

  if (rateLimitRows > rateLimitThreshold) {
    infraContaminationReasons.push(`rate_limit_rows>${rateLimitThreshold}`);
  }
  if (authErrorRows > 0) {
    infraContaminationReasons.push("auth_error_rows>0");
  }
  if (engineeringErrorRows > 0) {
    infraContaminationReasons.push("engineering_error_rows>0");
  }
  if (providerErrorRows > providerErrorThreshold) {
    infraContaminationReasons.push(`provider_error_rows>${providerErrorThreshold}`);
  }

  return {
    rows: decoratedRows.length,
    tickers: Array.from(new Set(decoratedRows.map((row) => row.ticker).filter(Boolean))),
    templates: Array.from(new Set(decoratedRows.map((row) => row.templateId).filter(Boolean))).sort(),
    sourceIdsValidFalse: decoratedRows.filter((row) => row.sourceIdsValid === false).length,
    materialNumericErrors,
    signErrors: unresolvedNumericRows.filter((row) => hasLabel(row, "sign_error")).length,
    periodMismatches: unresolvedNumericRows.filter((row) => hasLabel(row, "period_mismatch")).length,
    unitCurrencyMismatches: unresolvedNumericRows.filter((row) => hasAnyLabel(row, ["unit_mismatch", "currency_mismatch"])).length,
    numericAlignmentRepairedRows: qualityRowsList.filter((row) => row.numericAlignmentStatus === "repaired").length,
    numericAlignmentRepairedWithoutFinalProof: qualityRowsList.filter(
      (row) => row.numericAlignmentStatus === "repaired" && !hasFinalSurfaceNumericProof(row)
    ).length,
    numericAlignmentBlockedRows: qualityRowsList.filter((row) => row.numericAlignmentStatus === "blocked").length,
    unsupportedInvestmentAdvice,
    criticalFailures: decoratedRows.filter((row) => row.sourceIdsValid === false).length + materialNumericErrors + unsupportedInvestmentAdvice,
    judgeVersionBreakdown: countBy(judgeRows, (row) => row.claimSourceJudge.version ?? "missing"),
    judgeModelBreakdown: countBy(judgeRows, (row) => row.claimSourceJudge.model ?? "missing"),
    judgeRows: judgeRows.length,
    judgeCoverageMissing,
    judgeCoverageRate: ratio(judgeRows.length, qualityRowsList.length),
    calibratedAlternative,
    evaluationCoverageMode,
    evaluationCoverageSatisfied,
    judgeScores: {
      overallAverage: average(judgeRows.map((row) => row.claimSourceJudge.overall)),
      scoreBelow3Rate: ratio(judgeRows.filter((row) => Number(row.claimSourceJudge.overall) < 3).length, judgeRows.length),
      factualAccuracy: average(judgeRows.map((row) => row.claimSourceJudge.factualAccuracy)),
      filingGrounding: average(judgeRows.map((row) => row.claimSourceJudge.filingGrounding)),
      sourceRelevance: average(judgeRows.map((row) => row.claimSourceJudge.sourceRelevance)),
      followUpHandling: average(judgeRows.map((row) => row.claimSourceJudge.followUpHandling)),
      fallbackAcceptability: average(judgeRows.map((row) => row.claimSourceJudge.fallbackAcceptability))
    },
    rawResponsePathBreakdown: countBy(decoratedRows, (row) => row.responsePath ?? "unknown"),
    rawFallbackTotal: decoratedRows.filter((row) => row.responsePath === "fallback").length,
    rawFallbackKindBreakdown: countBy(decoratedRows, (row) => row.fallbackKind ?? "none"),
    rawFallbackReasonBreakdown: countBy(
      decoratedRows.filter((row) => row.fallbackReason),
      (row) => row.fallbackReason
    ),
    fallbackCategoryBreakdown: countBy(
      decoratedRows.filter((row) => row.fallbackCategory),
      (row) => row.fallbackCategory
    ),
    fallbackUserReasonBreakdown: countBy(
      decoratedRows.filter((row) => row.fallbackUserReason),
      (row) => row.fallbackUserReason
    ),
    rawGeminiApiErrorBreakdown: countBy(
      decoratedRows.filter((row) => row.geminiApiErrorKind),
      (row) => row.geminiApiErrorKind
    ),
    fallbackKindNoneOnFallbackRows: decoratedRows.filter(
      (row) => row.responsePath === "fallback" && (row.fallbackKind == null || row.fallbackKind === "none")
    ).length,
    rawEnglishInAnswer: decoratedRows.filter((row) => hasUserVisibleRawEnglish(row)).length,
    rawEnglishInDiagnostics: decoratedRows.filter((row) =>
      !hasUserVisibleRawEnglish(row) && (row.finalAnswerRawExcerptLike === true || hasLabel(row, "raw_english_excerpt"))
    ).length,
    rawEnglishSurfaced: decoratedRows.filter((row) => hasUserVisibleRawEnglish(row)).length,
    hybridEnglishJapaneseSurfaced: decoratedRows.filter((row) => hasVisibleHybridEnglishJapanese(row)).length,
    genericBusinessModelAnswers: decoratedRows.filter((row) => hasGenericBusinessModelAnswer(row)).length,
    genericRevenueBreakdownAnswers: decoratedRows.filter((row) => hasGenericRevenueBreakdownAnswer(row)).length,
    misleadingRevenueDriverCauses: decoratedRows.filter((row) => hasMisleadingRevenueDriverCause(row)).length,
    nonFinancialCashFlowBankLanguage: decoratedRows.filter((row) => hasNonFinancialCashFlowBankLanguage(row)).length,
    metricOnlyImportantIntentAnswers: decoratedRows.filter((row) => hasMetricOnlyImportantIntentAnswer(row)).length,
    durabilityFollowupLostPriorDriver: decoratedRows.filter((row) => hasDurabilityFollowupLostPriorDriver(row)).length,
    lowQualityReasonBreakdown: countBy(
      qualityRowsList.flatMap((row) => normalizedLowQualityReasons(row)),
      (reason) => reason
    ),
    malformedLowQualityLabels: qualityRowsList.reduce(
      (count, row) => count + observedRawLabels(row).filter((label) => /^low_quality\s*:\s*$/iu.test(label)).length,
      0
    ),
    q07Rows: qualityRowsList.filter((row) => isQ07Row(row)).length,
    q07HistoricalLookupMissing: qualityRowsList.filter((row) => hasQ07HistoricalLookupMissing(row)).length,
    q07DistinctFilingSourcesMissing: qualityRowsList.filter((row) => hasQ07DistinctFilingSourcesMissing(row)).length,
    q07YoYMasquerade: qualityRowsList.filter((row) => hasQ07YoYMasquerade(row)).length,
    q07SourcePeriodMismatch: qualityRowsList.filter((row) => hasQ07SourcePeriodMismatch(row)).length,
    q07TypedClaimMappingMissing: qualityRowsList.filter((row) => hasQ07TypedClaimMappingMissing(row)).length,
    q03Q04Q06FinalEvidenceMissing: qualityRowsList.filter((row) => hasQ03Q04Q06FinalEvidenceMissing(row)).length,
    q05Rows: qualityRowsList.filter((row) => isQ05Row(row)).length,
    q05TypedMarginDirectionMissing: qualityRowsList.filter((row) => hasQ05TypedMarginDirectionMissing(row)).length,
    q05CitedFactorMissing: qualityRowsList.filter((row) => hasQ05CitedFactorMissing(row)).length,
    q08Rows: qualityRowsList.filter((row) => isQ08Row(row)).length,
    q08CompletenessMissing: qualityRowsList.filter((row) => hasQ08CompletenessMissing(row)).length,
    q08EvidenceMappingMissing: qualityRowsList.filter((row) => hasQ08EvidenceMappingMissing(row)).length,
    q09Rows: qualityRowsList.filter((row) => isQ09Row(row)).length,
    q09CompletenessMissing: qualityRowsList.filter((row) => hasQ09CompletenessMissing(row)).length,
    q09EvidenceMappingMissing: qualityRowsList.filter((row) => hasQ09EvidenceMappingMissing(row)).length,
    q10Rows: qualityRowsList.filter((row) => isQ10Row(row)).length,
    q10CompletenessMissing: qualityRowsList.filter((row) => hasQ10CompletenessMissing(row)).length,
    q10EvidenceMappingMissing: qualityRowsList.filter((row) => hasQ10EvidenceMappingMissing(row)).length,
    numericDisplaySuspicious: decoratedRows.filter((row) => hasSuspiciousNumericDisplay(row)).length,
    unsupportedDurabilityClassification: decoratedRows.filter((row) => hasUnsupportedDurabilityClassification(row)).length,
    unsupportedRiskOrLiquidityConclusion: decoratedRows.filter((row) => hasUnsupportedRiskOrLiquidityConclusion(row)).length,
    qualitySourceEvidenceWeak: qualityRowsList.filter((row) => hasWeakSourceEvidence(row)).length,
    fallbackTaxonomyIntentMismatch: qualityRowsList.filter((row) => hasFallbackTaxonomyIntentMismatch(row)).length,
    fallbackTaxonomyTupleMismatch: qualityRowsList.filter((row) => hasFallbackTaxonomyTupleMismatch(row)).length,
    bannedFallbackPhraseHits: decoratedRows.reduce(
      (sum, row) => sum + (Array.isArray(row.bannedFallbackPhraseHits) ? row.bannedFallbackPhraseHits.length : 0),
      0
    ),
    bankTermsInNonBankSectors: decoratedRows.filter((row) => hasLabel(row, "bank_terms_in_non_bank")).length,
    wrongSectorTerms: decoratedRows.filter((row) => hasLabel(row, "wrong_sector_terms")).length,
    infraContaminated: infraContaminationReasons.length > 0,
    infraContaminationReasons,
    rateLimitRows,
    rateLimitRate: ratio(rateLimitRows, decoratedRows.length),
    authErrorRows,
    providerErrorRows,
    networkErrorRows,
    engineeringErrorRows,
    qualityRows: qualityRowsList.length,
    qualityRowsExcluded,
    qualityFallbackTotal: qualityRowsList.filter((row) => row.responsePath === "fallback").length,
    qualityFallbackRate: ratio(qualityRowsList.filter((row) => row.responsePath === "fallback").length, qualityRowsList.length),
    qualityHardIntentFallback: qualityRowsList.filter(
      (row) => isHardIntent(row.intent) && row.responsePath === "fallback"
    ).length,
    qualityQ03Q04Q06Fallback: qualityRowsList.filter(
      (row) => ["Q03", "Q04", "Q06"].includes(row.templateId) && row.responsePath === "fallback"
    ).length,
    qualityMetricWithoutDriver: qualityRowsList.filter((row) => hasLabel(row, "metric_without_driver")).length,
    qualityTemporalityNotAssessed: qualityRowsList.filter((row) => hasLabel(row, "temporality_not_assessed")).length,
    qualityEvasiveAnswer: qualityRowsList.filter((row) => hasLabel(row, "evasive_answer")).length,
    retryAttempted: decoratedRows.filter((row) => row.retryAttempted === true).length,
    retryWasted: decoratedRows.filter((row) => row.retryWasted === true).length,
    rateLimitRetrySucceeded: decoratedRows.filter((row) => row.rateLimitRetrySucceeded === true).length,
    benchmarkRateLimitRetryCount: sumBy(decoratedRows, (row) => row.benchmarkRateLimitRetryCount ?? 0),
    latency: {
      p50: percentile(decoratedRows.map((row) => row.latencyMs), 0.5),
      p95: percentile(decoratedRows.map((row) => row.latencyMs), 0.95),
      p99: percentile(decoratedRows.map((row) => row.latencyMs), 0.99)
    },
    qualityLatency: {
      p50: percentile(qualityRowsList.map((row) => row.latencyMs), 0.5),
      p95: percentile(qualityRowsList.map((row) => row.latencyMs), 0.95),
      p99: percentile(qualityRowsList.map((row) => row.latencyMs), 0.99)
    }
  };
}

export const DEFAULT_QUALITY_GATE_THRESHOLDS = Object.freeze({
  criticalFailures: 0,
  materialNumericErrors: 0,
  signErrors: 0,
  periodMismatches: 0,
  unitCurrencyMismatches: 0,
  numericAlignmentRepairedWithoutFinalProof: 0,
  unsupportedInvestmentAdvice: 0,
  sourceIdsValidFalse: 0,
  infraContaminated: false,
  authErrorRows: 0,
  engineeringErrorRows: 0,
  rawEnglishSurfaced: 0,
  hybridEnglishJapaneseSurfaced: 0,
  genericBusinessModelAnswers: 0,
  genericRevenueBreakdownAnswers: 0,
  misleadingRevenueDriverCauses: 0,
  nonFinancialCashFlowBankLanguage: 0,
  metricOnlyImportantIntentAnswers: 0,
  durabilityFollowupLostPriorDriver: 0,
  malformedLowQualityLabels: 0,
  q07HistoricalLookupMissing: 0,
  q07DistinctFilingSourcesMissing: 0,
  q07YoYMasquerade: 0,
  q07SourcePeriodMismatch: 0,
  q07TypedClaimMappingMissing: 0,
  q03Q04Q06FinalEvidenceMissing: 0,
  q05TypedMarginDirectionMissing: 0,
  q05CitedFactorMissing: 0,
  q08CompletenessMissing: 0,
  q08EvidenceMappingMissing: 0,
  q09CompletenessMissing: 0,
  q09EvidenceMappingMissing: 0,
  q10CompletenessMissing: 0,
  q10EvidenceMappingMissing: 0,
  numericDisplaySuspicious: 0,
  unsupportedDurabilityClassification: 0,
  unsupportedRiskOrLiquidityConclusion: 0,
  qualitySourceEvidenceWeak: 0,
  fallbackTaxonomyIntentMismatch: 0,
  fallbackTaxonomyTupleMismatch: 0,
  fallbackKindNoneOnFallbackRows: 0,
  requireEvaluationCoverage: true,
  maxQualityFallbackRate: 0.15,
  maxQualityQ03Q04Q06Fallback: 0,
  maxQualityHardIntentFallback: 0,
  maxQualityLatencyP95Ms: 12_000,
  minOverallJudgeAverage: 4.1,
  maxJudgeScoreBelow3Rate: 0.08,
  minFactualAccuracy: 4.3,
  minFilingGrounding: 4.3,
  minSourceRelevance: 4.2,
  minFollowUpHandling: 4.0,
  minFallbackAcceptability: 3.8
});

export function qualityGateThresholdsFromEnv(env = process.env) {
  return {
    ...DEFAULT_QUALITY_GATE_THRESHOLDS,
    maxQualityFallbackRate: parseNonNegativeNumber(
      env.KABUYOMI_QUALITY_GATE_MAX_FALLBACK_RATE,
      DEFAULT_QUALITY_GATE_THRESHOLDS.maxQualityFallbackRate
    ),
    maxQualityQ03Q04Q06Fallback: parseNonNegativeInt(
      env.KABUYOMI_QUALITY_GATE_MAX_Q03_Q04_Q06_FALLBACK,
      DEFAULT_QUALITY_GATE_THRESHOLDS.maxQualityQ03Q04Q06Fallback
    ),
    maxQualityHardIntentFallback: parseNonNegativeInt(
      env.KABUYOMI_QUALITY_GATE_MAX_HARD_INTENT_FALLBACK,
      DEFAULT_QUALITY_GATE_THRESHOLDS.maxQualityHardIntentFallback
    ),
    maxQualityLatencyP95Ms: parseNonNegativeInt(
      env.KABUYOMI_QUALITY_GATE_MAX_P95_MS,
      DEFAULT_QUALITY_GATE_THRESHOLDS.maxQualityLatencyP95Ms
    ),
    requiredTemplates: parseStringList(env.KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES),
    minCompanyTickers: parseNullableNonNegativeInt(env.KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS, null),
    minRows: parseNullableNonNegativeInt(env.KABUYOMI_QUALITY_GATE_MIN_ROWS, null)
  };
}

export function evaluateQualityGate(summary, thresholds = DEFAULT_QUALITY_GATE_THRESHOLDS) {
  const failures = [];
  const addCountCheck = (field, maxValue) => {
    const actual = summary[field] ?? 0;
    if (actual > maxValue) {
      failures.push(`${field}=${actual} > ${maxValue}`);
    }
  };

  if (thresholds.infraContaminated === false && summary.infraContaminated) {
    failures.push(`infraContaminated=true (${(summary.infraContaminationReasons ?? []).join(", ") || "unknown"})`);
  }

  addCountCheck("sourceIdsValidFalse", thresholds.sourceIdsValidFalse);
  addCountCheck("criticalFailures", thresholds.criticalFailures);
  addCountCheck("materialNumericErrors", thresholds.materialNumericErrors);
  addCountCheck("signErrors", thresholds.signErrors);
  addCountCheck("periodMismatches", thresholds.periodMismatches);
  addCountCheck("unitCurrencyMismatches", thresholds.unitCurrencyMismatches);
  addCountCheck("numericAlignmentRepairedWithoutFinalProof", thresholds.numericAlignmentRepairedWithoutFinalProof);
  addCountCheck("unsupportedInvestmentAdvice", thresholds.unsupportedInvestmentAdvice);
  addCountCheck("authErrorRows", thresholds.authErrorRows);
  addCountCheck("engineeringErrorRows", thresholds.engineeringErrorRows);
  addCountCheck("rawEnglishSurfaced", thresholds.rawEnglishSurfaced);
  addCountCheck("hybridEnglishJapaneseSurfaced", thresholds.hybridEnglishJapaneseSurfaced);
  addCountCheck("genericBusinessModelAnswers", thresholds.genericBusinessModelAnswers);
  addCountCheck("genericRevenueBreakdownAnswers", thresholds.genericRevenueBreakdownAnswers);
  addCountCheck("misleadingRevenueDriverCauses", thresholds.misleadingRevenueDriverCauses);
  addCountCheck("nonFinancialCashFlowBankLanguage", thresholds.nonFinancialCashFlowBankLanguage);
  addCountCheck("metricOnlyImportantIntentAnswers", thresholds.metricOnlyImportantIntentAnswers);
  addCountCheck("durabilityFollowupLostPriorDriver", thresholds.durabilityFollowupLostPriorDriver);
  addCountCheck("malformedLowQualityLabels", thresholds.malformedLowQualityLabels);
  addCountCheck("q07HistoricalLookupMissing", thresholds.q07HistoricalLookupMissing);
  addCountCheck("q07DistinctFilingSourcesMissing", thresholds.q07DistinctFilingSourcesMissing);
  addCountCheck("q07YoYMasquerade", thresholds.q07YoYMasquerade);
  addCountCheck("q07SourcePeriodMismatch", thresholds.q07SourcePeriodMismatch);
  addCountCheck("q07TypedClaimMappingMissing", thresholds.q07TypedClaimMappingMissing);
  addCountCheck("q03Q04Q06FinalEvidenceMissing", thresholds.q03Q04Q06FinalEvidenceMissing);
  addCountCheck("q05TypedMarginDirectionMissing", thresholds.q05TypedMarginDirectionMissing);
  addCountCheck("q05CitedFactorMissing", thresholds.q05CitedFactorMissing);
  addCountCheck("q08CompletenessMissing", thresholds.q08CompletenessMissing);
  addCountCheck("q08EvidenceMappingMissing", thresholds.q08EvidenceMappingMissing);
  addCountCheck("q09CompletenessMissing", thresholds.q09CompletenessMissing);
  addCountCheck("q09EvidenceMappingMissing", thresholds.q09EvidenceMappingMissing);
  addCountCheck("q10CompletenessMissing", thresholds.q10CompletenessMissing);
  addCountCheck("q10EvidenceMappingMissing", thresholds.q10EvidenceMappingMissing);
  addCountCheck("numericDisplaySuspicious", thresholds.numericDisplaySuspicious);
  addCountCheck("unsupportedDurabilityClassification", thresholds.unsupportedDurabilityClassification);
  addCountCheck("unsupportedRiskOrLiquidityConclusion", thresholds.unsupportedRiskOrLiquidityConclusion);
  addCountCheck("qualitySourceEvidenceWeak", thresholds.qualitySourceEvidenceWeak);
  addCountCheck("fallbackTaxonomyIntentMismatch", thresholds.fallbackTaxonomyIntentMismatch);
  addCountCheck("fallbackTaxonomyTupleMismatch", thresholds.fallbackTaxonomyTupleMismatch);
  addCountCheck("fallbackKindNoneOnFallbackRows", thresholds.fallbackKindNoneOnFallbackRows);
  addCountCheck("qualityQ03Q04Q06Fallback", thresholds.maxQualityQ03Q04Q06Fallback);
  addCountCheck("qualityHardIntentFallback", thresholds.maxQualityHardIntentFallback);

  if ((summary.qualityFallbackRate ?? 0) > thresholds.maxQualityFallbackRate) {
    failures.push(`qualityFallbackRate=${formatRatio(summary.qualityFallbackRate)} > ${formatRatio(thresholds.maxQualityFallbackRate)}`);
  }
  if ((summary.qualityLatency?.p95 ?? 0) > thresholds.maxQualityLatencyP95Ms) {
    failures.push(`qualityLatency.p95=${summary.qualityLatency.p95} > ${thresholds.maxQualityLatencyP95Ms}`);
  }
  const judge = summary.judgeScores ?? {};
  const judgedCount = Object.values(summary.judgeVersionBreakdown ?? {}).reduce((sum, count) => sum + count, 0);
  if (thresholds.requireEvaluationCoverage !== false && summary.evaluationCoverageSatisfied !== true) {
    failures.push(
      `evaluationCoverageMissing=${summary.judgeCoverageMissing ?? summary.qualityRows ?? 0} ` +
      `(judged=${judgedCount}, calibratedAlternative=${summary.calibratedAlternative?.type ?? "none"})`
    );
  }
  if (judgedCount > 0) {
    if ((judge.overallAverage ?? 0) < thresholds.minOverallJudgeAverage) failures.push(`judge.overallAverage=${judge.overallAverage} < ${thresholds.minOverallJudgeAverage}`);
    if ((judge.scoreBelow3Rate ?? 0) > thresholds.maxJudgeScoreBelow3Rate) failures.push(`judge.scoreBelow3Rate=${formatRatio(judge.scoreBelow3Rate)} > ${formatRatio(thresholds.maxJudgeScoreBelow3Rate)}`);
    for (const [field, minimum] of [
      ["factualAccuracy", thresholds.minFactualAccuracy],
      ["filingGrounding", thresholds.minFilingGrounding],
      ["sourceRelevance", thresholds.minSourceRelevance],
      ["followUpHandling", thresholds.minFollowUpHandling],
      ["fallbackAcceptability", thresholds.minFallbackAcceptability]
    ]) {
      if ((judge[field] ?? 0) < minimum) failures.push(`judge.${field}=${judge[field] ?? 0} < ${minimum}`);
    }
  }
  const requiredTemplates = Array.isArray(thresholds.requiredTemplates) ? thresholds.requiredTemplates : [];
  if (requiredTemplates.length > 0) {
    const observedTemplates = new Set(summary.templates ?? []);
    const missingTemplates = requiredTemplates.filter((template) => !observedTemplates.has(template));
    if (missingTemplates.length > 0) {
      failures.push(`requiredTemplatesMissing=${missingTemplates.join(",")}`);
    }
  }
  if (typeof thresholds.minCompanyTickers === "number" && (summary.tickers?.length ?? 0) < thresholds.minCompanyTickers) {
    failures.push(`companyTickers=${summary.tickers?.length ?? 0} < ${thresholds.minCompanyTickers}`);
  }
  if (typeof thresholds.exactCompanyTickers === "number" && (summary.tickers?.length ?? 0) !== thresholds.exactCompanyTickers) {
    failures.push(`companyTickers=${summary.tickers?.length ?? 0} != ${thresholds.exactCompanyTickers}`);
  }
  if (typeof thresholds.minRows === "number" && (summary.rows ?? 0) < thresholds.minRows) {
    failures.push(`rows=${summary.rows ?? 0} < ${thresholds.minRows}`);
  }
  if (typeof thresholds.exactRows === "number" && (summary.rows ?? 0) !== thresholds.exactRows) {
    failures.push(`rows=${summary.rows ?? 0} != ${thresholds.exactRows}`);
  }
  if (Array.isArray(thresholds.exactTemplates) && !sameStringSet(summary.templates ?? [], thresholds.exactTemplates)) {
    failures.push("templateSetMismatch=standard_release_profile");
  }
  if (Array.isArray(thresholds.exactTickers) && !sameStringSet(summary.tickers ?? [], thresholds.exactTickers)) {
    failures.push("tickerSetMismatch=standard_release_profile");
  }

  return {
    ok: failures.length === 0,
    failures,
    thresholds
  };
}

function sameStringSet(observedValues, expectedValues) {
  const observed = new Set(observedValues.map((value) => String(value)));
  const expected = new Set(expectedValues.map((value) => String(value)));
  return observed.size === expected.size && [...observed].every((value) => expected.has(value));
}

export function collectQualityIssueRows(rows) {
  const decoratedRows = rows.map((row) => (typeof row.qualityEvaluable === "boolean" ? row : decorateBenchmarkRow(row)));
  const qualityRowsList = decoratedRows.filter((row) => row.qualityEvaluable !== false);
  const issueRows = {
    rawEnglishSurfaced: decoratedRows.filter((row) => hasUserVisibleRawEnglish(row)),
    hybridEnglishJapaneseSurfaced: decoratedRows.filter((row) => hasVisibleHybridEnglishJapanese(row)),
    genericBusinessModelAnswers: decoratedRows.filter((row) => hasGenericBusinessModelAnswer(row)),
    genericRevenueBreakdownAnswers: decoratedRows.filter((row) => hasGenericRevenueBreakdownAnswer(row)),
    misleadingRevenueDriverCauses: decoratedRows.filter((row) => hasMisleadingRevenueDriverCause(row)),
    nonFinancialCashFlowBankLanguage: decoratedRows.filter((row) => hasNonFinancialCashFlowBankLanguage(row)),
    metricOnlyImportantIntentAnswers: decoratedRows.filter((row) => hasMetricOnlyImportantIntentAnswer(row)),
    durabilityFollowupLostPriorDriver: decoratedRows.filter((row) => hasDurabilityFollowupLostPriorDriver(row)),
    malformedLowQualityLabels: qualityRowsList.filter((row) =>
      observedRawLabels(row).some((label) => /^low_quality\s*:\s*$/iu.test(label))
    ),
    q07HistoricalLookupMissing: qualityRowsList.filter((row) => hasQ07HistoricalLookupMissing(row)),
    q07DistinctFilingSourcesMissing: qualityRowsList.filter((row) => hasQ07DistinctFilingSourcesMissing(row)),
    q07YoYMasquerade: qualityRowsList.filter((row) => hasQ07YoYMasquerade(row)),
    q07SourcePeriodMismatch: qualityRowsList.filter((row) => hasQ07SourcePeriodMismatch(row)),
    q07TypedClaimMappingMissing: qualityRowsList.filter((row) => hasQ07TypedClaimMappingMissing(row)),
    q03Q04Q06FinalEvidenceMissing: qualityRowsList.filter((row) => hasQ03Q04Q06FinalEvidenceMissing(row)),
    q05TypedMarginDirectionMissing: qualityRowsList.filter((row) => hasQ05TypedMarginDirectionMissing(row)),
    q05CitedFactorMissing: qualityRowsList.filter((row) => hasQ05CitedFactorMissing(row)),
    q08CompletenessMissing: qualityRowsList.filter((row) => hasQ08CompletenessMissing(row)),
    q08EvidenceMappingMissing: qualityRowsList.filter((row) => hasQ08EvidenceMappingMissing(row)),
    q09CompletenessMissing: qualityRowsList.filter((row) => hasQ09CompletenessMissing(row)),
    q09EvidenceMappingMissing: qualityRowsList.filter((row) => hasQ09EvidenceMappingMissing(row)),
    q10CompletenessMissing: qualityRowsList.filter((row) => hasQ10CompletenessMissing(row)),
    q10EvidenceMappingMissing: qualityRowsList.filter((row) => hasQ10EvidenceMappingMissing(row)),
    numericDisplaySuspicious: decoratedRows.filter((row) => hasSuspiciousNumericDisplay(row)),
    unsupportedDurabilityClassification: decoratedRows.filter((row) => hasUnsupportedDurabilityClassification(row)),
    unsupportedRiskOrLiquidityConclusion: decoratedRows.filter((row) => hasUnsupportedRiskOrLiquidityConclusion(row)),
    qualitySourceEvidenceWeak: qualityRowsList.filter((row) => hasWeakSourceEvidence(row)),
    fallbackTaxonomyIntentMismatch: qualityRowsList.filter((row) => hasFallbackTaxonomyIntentMismatch(row)),
    fallbackTaxonomyTupleMismatch: qualityRowsList.filter((row) => hasFallbackTaxonomyTupleMismatch(row)),
    numericAlignmentRepairedWithoutFinalProof: qualityRowsList.filter(
      (row) => row.numericAlignmentStatus === "repaired" && !hasFinalSurfaceNumericProof(row)
    ),
    fallbackKindNoneOnFallbackRows: decoratedRows.filter(
      (row) => row.responsePath === "fallback" && (row.fallbackKind == null || row.fallbackKind === "none")
    ),
    qualityQ03Q04Q06Fallback: qualityRowsList.filter(
      (row) => ["Q03", "Q04", "Q06"].includes(row.templateId) && row.responsePath === "fallback"
    ),
    qualityHardIntentFallback: qualityRowsList.filter(
      (row) => isHardIntent(row.intent) && row.responsePath === "fallback"
    )
  };

  return Object.fromEntries(
    Object.entries(issueRows).map(([key, values]) => [key, values.map(summarizeIssueRow)])
  );
}

function summarizeIssueRow(row) {
  return {
    caseId: row.caseId ?? `${row.ticker ?? "UNKNOWN"}-${row.templateId ?? "unknown"}`,
    ticker: row.ticker ?? null,
    templateId: row.templateId ?? null,
    intent: row.intent ?? null,
    responsePath: row.responsePath ?? null,
    fallbackKind: row.fallbackKind ?? null,
    fallbackUserReason: row.fallbackUserReason ?? null,
    answer: String(row.answer ?? "").replace(/\s+/g, " ").trim().slice(0, 220)
  };
}

export function countBy(values, keyFn) {
  const counts = {};
  for (const value of values) {
    const key = String(keyFn(value) ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

export function percentile(values, ratioValue) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (numeric.length === 0) {
    return 0;
  }
  const index = Math.min(numeric.length - 1, Math.ceil(numeric.length * ratioValue) - 1);
  return numeric[index];
}

function average(values) {
  const numeric = values.map(Number).filter((value) => Number.isFinite(value));
  return numeric.length === 0 ? 0 : numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function normalizeCalibratedAlternative(alternative, totalRows) {
  if (!alternative || typeof alternative !== "object") {
    return null;
  }
  if (
    alternative.type !== "complete_human_review_v2"
    || alternative.verified !== true
    || !Number.isInteger(alternative.reviewedRows)
    || alternative.reviewedRows !== totalRows
    || !/^[a-f0-9]{64}$/iu.test(String(alternative.sourceRunSha256 ?? ""))
    || !/^[a-f0-9]{64}$/iu.test(String(alternative.reviewContentSha256 ?? ""))
  ) {
    return null;
  }
  return {
    type: "complete_human_review_v2",
    verified: true,
    reviewedRows: alternative.reviewedRows,
    sourceRunSha256: alternative.sourceRunSha256,
    reviewContentSha256: alternative.reviewContentSha256,
    reviewer: String(alternative.reviewer ?? "").trim() || null,
    signedAt: String(alternative.signedAt ?? "").trim() || null
  };
}

function resolveRateLimitContaminationThreshold(rowCount, options) {
  if (typeof options.rateLimitThreshold === "number" && Number.isFinite(options.rateLimitThreshold)) {
    return options.rateLimitThreshold;
  }
  if (
    typeof options.markInfraContaminatedOnRateLimitThreshold === "number" &&
    Number.isFinite(options.markInfraContaminatedOnRateLimitThreshold)
  ) {
    return options.markInfraContaminatedOnRateLimitThreshold;
  }
  return Math.max(3, Math.floor(rowCount * 0.05));
}

function normalizeGeminiApiErrorKind(kind) {
  if (typeof kind !== "string" || kind.trim().length === 0) {
    return null;
  }
  return kind.trim();
}

export function normalizeQualityLabel(label) {
  const normalized = String(label ?? "").trim();
  if (!normalized) {
    return null;
  }
  const lowQualityMatch = normalized.match(/^low_quality\s*:\s*(.+)$/iu);
  return (lowQualityMatch?.[1] ?? normalized).trim() || null;
}

function observedRawLabels(row) {
  return [
    ...(row.failureLabelsObserved ?? []),
    ...(row.answerQualityFlags ?? []),
    ...(row.sourceGateFailureLabels ?? []),
    ...(row.finalAnswerLanguageLabels ?? []),
    ...(row.languageGuardViolationLabels ?? []),
    ...(row.numericAlignmentLabels ?? []),
    ...(row.sourceRepairLabels ?? []),
    ...(row.semanticQualityLabels ?? []),
    ...(typeof row.lowQualityReason === "string" && row.lowQualityReason.trim() ? [row.lowQualityReason] : [])
  ].map((label) => String(label));
}

function observedNormalizedLabels(row) {
  return observedRawLabels(row).map(normalizeQualityLabel).filter(Boolean);
}

function normalizedLowQualityReasons(row) {
  const reasons = observedRawLabels(row)
    .map((label) => String(label).match(/^low_quality\s*:\s*(.+)$/iu)?.[1]?.trim())
    .filter(Boolean);
  if (typeof row.lowQualityReason === "string" && row.lowQualityReason.trim()) {
    reasons.push(normalizeQualityLabel(row.lowQualityReason));
  }
  return Array.from(new Set(reasons.filter(Boolean)));
}

function hasLabel(row, label) {
  const normalizedTarget = normalizeQualityLabel(label);
  return normalizedTarget != null && observedNormalizedLabels(row).includes(normalizedTarget);
}

function hasAnyLabel(row, labels) {
  return labels.some((label) => hasLabel(row, label));
}

function hasUnresolvedNumericIssue(row) {
  const hasNumericFailureLabel = hasAnyLabel(row, [
    "material_numeric_error",
    "unit_mismatch",
    "currency_mismatch",
    "sign_error",
    "period_mismatch",
    "unsupported_numeric_claim"
  ]);
  if (!hasNumericFailureLabel) return false;

  if (row.numericAlignmentStatus === "passed") {
    return false;
  }
  if (row.numericAlignmentStatus === "repaired") {
    return !hasFinalSurfaceNumericProof(row);
  }
  return true;
}

function hasFinalSurfaceNumericProof(row) {
  const claimCount = Number(row.numericAlignmentFinalSurfaceClaimCount);
  const verifiedCount = Number(row.numericAlignmentFinalSurfaceVerifiedClaimCount);
  const blockedCount = Number(row.numericAlignmentFinalSurfaceBlockedClaimCount);
  const status = row.numericAlignmentFinalSurfaceStatus;
  const expectedAnswerHash = createHash("sha256").update(String(row.answer ?? "")).digest("hex");
  return row.numericAlignmentFinalSurfaceChecked === true
    && (status === "passed" || status === "not_applicable")
    && Number.isFinite(claimCount)
    && claimCount > 0
    && verifiedCount === claimCount
    && blockedCount === 0
    && row.numericAlignmentFinalSurfaceAnswerHash === expectedAnswerHash;
}

function hasUnsupportedInvestmentAdvice(row) {
  if (hasAnyLabel(row, ["unsupported_investment_advice", "investment_advice_violation"])) return true;
  return /(?:今すぐ|絶対に|必ず)(?:買う|売る)|(?:買い|売り)(?:推奨|をおすすめ)|guaranteed (?:buy|sell)/iu.test(String(row.answer ?? ""));
}

function hasUserVisibleRawEnglish(row) {
  const answer = String(row.answer ?? "");
  const answerContainsLongEnglish = /[A-Za-z]{4,}(?:\s+[A-Za-z]{4,}){7,}/.test(answer);
  if (answerContainsLongEnglish) {
    return true;
  }
  if (hasLabel(row, "answer_rewritten_to_japanese_fallback") || hasLabel(row, "answer_repaired_to_japanese")) {
    return false;
  }
  return row.finalAnswerRawExcerptLike === true && row.languageGuardOk !== true;
}

function isHardIntent(intent) {
  return [
    "business_model",
    "business_overview",
    "revenue_driver",
    "margin_driver",
    "driver_durability_followup",
    "margin_durability_followup",
    "liquidity_debt",
    "risk_watchpoint",
    "watch_point"
  ].includes(intent);
}

function hasVisibleHybridEnglishJapanese(row) {
  const answer = String(row.answer ?? "");
  if (!answer) {
    return false;
  }
  return [
    /Profitability context/i,
    /Revenue driver discussion/i,
    /price-コスト/i,
    /Re資料/i,
    /higher\s+[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+(?:\s+[a-z]+)?/iu,
    /higher [a-z]/i,
    /partially offset/i,
    /unfavorable/i,
    /favorable/i,
    /comparable sales discussion/i,
    /un[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/iu,
    /geography revenue/i,
    /segment revenue\s*(?:が|は|を|で|に)/i
  ].some((pattern) => pattern.test(answer));
}

function hasGenericBusinessModelAnswer(row) {
  if (!isBusinessModelRow(row)) {
    return false;
  }
  if (hasLabel(row, "business_overview_metrics_only") || hasLabel(row, "business_overview_metric_lead")) {
    return true;
  }
  const answer = String(row.answer ?? "").replace(/\s+/g, "");
  if (!answer) {
    return false;
  }
  return [
    /製品(?:と|や|・)サービス(?:の提供)?(?:を通じて)?(?:収益|売上|利益)を(?:得ています|上げています|生み出しています)/,
    /商品(?:と|や|・)サービス(?:の提供)?(?:を通じて)?(?:収益|売上|利益)を(?:得ています|上げています|生み出しています)/,
    /金融サービス(?:で|を通じて)(?:収益|売上|利益)を(?:得ています|上げています|生み出しています)/,
    /小売事業(?:で|を通じて)(?:収益|売上|利益)を(?:得ています|上げています|生み出しています|儲けています)/,
    /建設機械など(?:で|を通じて)(?:収益|売上|利益)を(?:得ています|上げています|生み出しています|儲けています)/,
    /石油(?:・|と)?ガス(?:で|を通じて)(?:収益|売上|利益)を(?:得ています|上げています|生み出しています)/
  ].some((pattern) => pattern.test(answer));
}

function hasGenericRevenueBreakdownAnswer(row) {
  if (!(row.templateId === "Q02" || row.templateId === "Q08" || row.intent === "revenue_snapshot" || row.intent === "revenue_breakdown" || row.intent === "segment_driver")) {
    return false;
  }
  if (hasLabel(row, "revenue_breakdown_generic_category_only")) {
    return false;
  }
  const answer = String(row.answer ?? "").replace(/\s+/g, "");
  if (!answer) {
    return false;
  }
  const hasGenericCategory = /(geographyrevenue|geographicrevenue|segmentrevenue|productrevenue|地域別売上|セグメント別売上|製品別売上|売上区分|大きい区分|主な売上区分)/i.test(answer);
  if (!hasGenericCategory) {
    return false;
  }
  if (hasConcreteRevenueBreakdownTerm(answer)) {
    return false;
  }
  return /(geographyrevenue(?:が|は|を|として)|segmentrevenue(?:が|は|を|として)|地域別売上(?:が|は|を|として|という分類)|セグメント別売上(?:が|は|を|として|という分類)|製品別売上(?:が|は|を|として|という分類)|大きい区分|具体的な金額の内訳|詳細な内訳)/i.test(answer);
}

function hasConcreteRevenueBreakdownTerm(answer) {
  return [
    /ConstructionIndustries|ResourceIndustries|Energy&Transportation/i,
    /建設機械|資源産業|エネルギー・輸送/,
    /EnergyProducts|ChemicalProducts|SpecialtyProducts|Upstream|Downstream|Chemical/i,
    /NII|NIR|Netinterestincome|Noninterestrevenue|利息収益|非利息収益/i,
    /WalmartU\.?S\.?|WalmartInternational|Sam'?sClub/i,
    /DRAM|NAND|NOR|Memory|Storage/i,
    /GoogleServices|GoogleCloud|YouTubeads?|GoogleNetwork|AdSense/i,
    /iPhone|iPad|Mac|Wearables|Services/i,
    /Mounjaro|Zepbound|製品別売上/i,
    /Coca-Cola|Trademark|AsiaPacific|EMEA|NorthAmerica/i,
    /Advisory|OtherServices|Payments|service revenue|value-addedservices/i,
    /Compute|Networking|Graphics|DataCenter/i,
    /Automotive|EnergyGeneration/i,
    /Passengerrevenue|Cargo|Refinery|MRO|Premiumproducts|loyalty/i
  ].some((pattern) => pattern.test(answer));
}

function hasMisleadingRevenueDriverCause(row) {
  if (!(row.templateId === "Q03" || row.intent === "revenue_driver")) {
    return false;
  }
  if (hasLabel(row, "revenue_driver_non_revenue_cause_removed")) {
    return false;
  }
  const answer = String(row.answer ?? "");
  if (!/(売上(?:変化|成長|増減)?の?要因|売上要因|revenue driver)/i.test(answer)) {
    return false;
  }
  return /(?:income taxes payable|Pillar Two|TAC|traffic acquisition costs?|brokerage expense|auto lease depreciation|marketing expense|occupancy expense|distribution fees|noncurrent income taxes|税金|税効果|費用|減価償却|販管費|人件費|信用損失|引当)/i.test(answer);
}

function hasNonFinancialCashFlowBankLanguage(row) {
  if (!(row.templateId === "Q09" || row.intent === "cash_flow")) {
    return false;
  }
  const metadataBank = row.industryClassification?.isBank ?? row.filingMetadata?.isBank;
  const ticker = String(row.ticker ?? "").toUpperCase();
  if (metadataBank === true || (metadataBank == null && BANK_TICKERS.has(ticker))) {
    return false;
  }
  const answer = String(row.answer ?? "");
  return /(?:預金|貸出|貸付|融資|銀行|金融機関|trading assets|trading liabilities|deposit|loan book|net interest)/i.test(answer);
}

function hasMetricOnlyImportantIntentAnswer(row) {
  if (!isImportantIntent(row.intent)) {
    return false;
  }
  return [
    "answer_too_metric_only",
    "contextual_reasoning_metric_only",
    "business_overview_metrics_only",
    "business_overview_metric_lead",
    "metric_without_driver"
  ].some((label) => hasLabel(row, label));
}

function hasDurabilityFollowupLostPriorDriver(row) {
  if (!["Q04", "Q06"].includes(row.templateId) && !/durability_followup/.test(String(row.intent ?? ""))) {
    return false;
  }
  if (hasLabel(row, "missing_durability_evidence") || hasLabel(row, "unsupported_durability_classification")) {
    return true;
  }
  const answer = String(row.answer ?? "");
  return /前問の具体的な要因を十分に特定できていない|具体的な(?:売上|利益率)?要因は十分に特定できません/.test(answer);
}

function isQ07Row(row) {
  return row.templateId === "Q07" || row.intent === "prior_filing_delta";
}

function hasQ07HistoricalLookupMissing(row) {
  if (!isQ07Row(row)) {
    return false;
  }
  const historicalLookupMs = Number(row.timings?.historicalLookupMs ?? row.historicalLookupMs);
  return row.responsePath !== "historical"
    || !historicalFilingSources(row).length
    || !Number.isFinite(historicalLookupMs)
    || historicalLookupMs <= 0;
}

function hasQ07DistinctFilingSourcesMissing(row) {
  if (!isQ07Row(row)) {
    return false;
  }
  const identities = new Set(historicalFilingSources(row).map(historicalFilingIdentity).filter(Boolean));
  return identities.size < 2;
}

function hasQ07YoYMasquerade(row) {
  if (!isQ07Row(row)) {
    return false;
  }
  if (/(?:前年同期(?:比)?|前年比|\bYoY\b)/i.test(String(row.answer ?? ""))) {
    return true;
  }

  const quarterPeriods = Array.from(new Set(
    historicalFilingSources(row)
      .filter((source) => /\b10-Q\b/i.test(String(source.sourceLabel ?? "")))
      .map(historicalFilingPeriod)
      .filter(Boolean)
  )).map((period) => Date.parse(period)).filter(Number.isFinite).sort((left, right) => left - right);
  if (quarterPeriods.length < 2) {
    return false;
  }
  const spanDays = (quarterPeriods.at(-1) - quarterPeriods[0]) / (24 * 60 * 60 * 1000);
  return spanDays > 250;
}

function hasQ07SourcePeriodMismatch(row) {
  if (!isQ07Row(row)) {
    return false;
  }
  const periods = Array.from(new Set(historicalFilingSources(row).map(historicalFilingPeriod).filter(Boolean)));
  if (periods.length !== 2) {
    return true;
  }
  const answer = String(row.answer ?? "");
  return periods.some((period) => {
    const [year, month, day] = period.split("-").map(Number);
    const japanese = `${year}年${month}月${day}日`;
    return !answer.includes(period) && !answer.includes(japanese);
  });
}

function hasQ07TypedClaimMappingMissing(row) {
  if (!isQ07Row(row)) {
    return false;
  }
  const claimCount = Number(row.numericAlignmentClaimCount);
  const verifiedCount = Number(row.numericAlignmentVerifiedClaimCount);
  const blockedCount = Number(row.numericAlignmentBlockedClaimCount);
  const matchedFactIds = Array.isArray(row.numericAlignmentMatchedFactIds)
    ? row.numericAlignmentMatchedFactIds.filter(Boolean)
    : [];
  return row.numericAlignmentStatus !== "passed"
    || !Number.isFinite(claimCount)
    || claimCount <= 0
    || verifiedCount !== claimCount
    || blockedCount !== 0
    || matchedFactIds.length === 0;
}

function historicalFilingSources(row) {
  return (Array.isArray(row.sources) ? row.sources : []).filter(
    (source) => source && source.sourceKind === "historical_filing"
  );
}

function historicalFilingIdentity(source) {
  const sourceId = String(source?.sourceId ?? "");
  const filingKeyMatch = sourceId.match(/^([^:]+:[^:]+:[^:]+):/);
  if (filingKeyMatch?.[1]) {
    return `filing:${filingKeyMatch[1]}`;
  }
  if (typeof source?.sourceUrl === "string" && source.sourceUrl.trim()) {
    return `url:${source.sourceUrl.trim()}`;
  }
  const period = historicalFilingPeriod(source);
  return period ? `period:${period}` : null;
}

function historicalFilingPeriod(source) {
  return String(source?.sourceLabel ?? "").match(/\bperiod\s+(\d{4}-\d{2}-\d{2})\b/i)?.[1] ?? null;
}

function hasQ03Q04Q06FinalEvidenceMissing(row) {
  if (!["Q03", "Q04", "Q06"].includes(row.templateId)) {
    return false;
  }
  if (hasExplicitHardIntentInsufficiencyRepair(row)) {
    return !hasCompleteReturnedEvidenceMapping(row);
  }
  if (
    hasAnyLabel(row, [
      "contextual_reasoning_metric_only",
      "answer_too_metric_only",
      "metric_without_driver",
      "durability_missing_assessment",
      "missing_durability_evidence",
      "unsupported_durability_classification"
    ])
  ) {
    return true;
  }
  if (row.responsePath === "fallback" || !hasCompleteReturnedEvidenceMapping(row)) {
    return true;
  }
  const sourceText = returnedSourceText(row);
  if (row.templateId === "Q03") {
    return !/(?:md&a|management|segment|revenue|driver|price|volume|demand|経営陣|セグメント|売上|価格|数量|需要|要因)/iu.test(sourceText);
  }
  return row.sourceGateApplied === true && row.sourceGateSufficient !== true;
}

function isQ05Row(row) {
  return row.templateId === "Q05";
}

function isHonestQ05SourceInsufficientFallback(row) {
  return row.responsePath === "fallback"
    && row.fallbackCategory === "source_insufficient"
    && row.fallbackUserReason === "margin_driver_sources_missing"
    && row.fallbackKind !== "none"
    && row.fallbackKind != null
    && !hasFallbackTaxonomyTupleMismatch(row);
}

function isProofCompleteBankQ05MarginUnavailableRecovery(row) {
  if (
    !isQ05Row(row)
    || !isBankRow(row)
    || row.responsePath !== "deterministic"
    || !hasLabel(row, "margin_driver_deterministic_recovery")
    || row.sourceIdsValid !== true
    || hasAnyLabel(row, [
      "material_numeric_error",
      "unit_mismatch",
      "currency_mismatch",
      "sign_error",
      "period_mismatch",
      "unsupported_numeric_claim",
      "unsupported_margin_direction"
    ])
  ) {
    return false;
  }

  const answer = String(row.answer ?? "").replace(/\s+/gu, " ").trim();
  const hasExplicitMarginLimitation = /売上高に対する利益率を同じ定義で計算できない/u.test(answer)
    && /利益率の改善・悪化は断定しません/u.test(answer);
  const answerWithoutLimitation = answer.replace(/利益率の改善・悪化は断定しません/gu, "");
  const assertsUnsupportedMarginDirection = /(?:粗利率|売上総利益率|営業利益率|純利益率|マージン|margin)[^。]{0,50}(?:上昇|低下|改善|悪化|拡大|縮小|横ばい)/iu.test(
    answerWithoutLimitation
  );
  const hasAlternativeProfitComparison = /純利益[^。]{0,100}(?:比較期|前年同期|前期)[^。]{0,100}(?:当期|今回)[^。]{0,100}(?:増加|減少|横ばい)/u.test(answer);
  if (!hasExplicitMarginLimitation || assertsUnsupportedMarginDirection || !hasAlternativeProfitComparison) {
    return false;
  }

  const claimCount = Number(row.numericAlignmentClaimCount);
  const verifiedCount = Number(row.numericAlignmentVerifiedClaimCount);
  const blockedCount = Number(row.numericAlignmentBlockedClaimCount);
  const matchedFactIds = Array.isArray(row.numericAlignmentMatchedFactIds)
    ? row.numericAlignmentMatchedFactIds.filter(Boolean)
    : [];
  const alignmentAccepted = row.numericAlignmentStatus === "passed"
    || (row.numericAlignmentStatus === "repaired" && hasFinalSurfaceNumericProof(row));
  if (
    !alignmentAccepted
    || !Number.isFinite(claimCount)
    || claimCount < 2
    || verifiedCount !== claimCount
    || blockedCount !== 0
    || matchedFactIds.length < 2
    || !hasCompleteReturnedEvidenceMapping(row)
  ) {
    return false;
  }

  const sources = Array.isArray(row.sources) ? row.sources : [];
  const hasTypedProfitEvidence = sources.some((source) =>
    source?.sectionType === "xbrl_metric"
    && /(?:純利益|net\s*income|profit\s*loss)/iu.test(`${source?.sourceLabel ?? ""} ${source?.excerpt ?? ""}`)
  );
  const hasNarrativeFactorEvidence = sources.some((source) =>
    source?.sectionType === "md_a"
    && /(?:expense|compensation|legal|depreciation|費用|人件|報酬|訴訟|法務|減価償却)/iu.test(
      `${source?.sourceLabel ?? ""} ${source?.excerpt ?? ""}`
    )
  );
  return hasTypedProfitEvidence && hasNarrativeFactorEvidence;
}

function hasQ05TypedMarginDirectionMissing(row) {
  if (
    !isQ05Row(row)
    || isHonestQ05SourceInsufficientFallback(row)
    || isProofCompleteBankQ05MarginUnavailableRecovery(row)
  ) {
    return false;
  }
  const answer = String(row.answer ?? "");
  const claimCount = Number(row.numericAlignmentClaimCount);
  const verifiedCount = Number(row.numericAlignmentVerifiedClaimCount);
  const blockedCount = Number(row.numericAlignmentBlockedClaimCount);
  const matchedFactIds = Array.isArray(row.numericAlignmentMatchedFactIds)
    ? row.numericAlignmentMatchedFactIds.filter(Boolean)
    : [];
  const alignmentAccepted = row.numericAlignmentStatus === "passed"
    || (row.numericAlignmentStatus === "repaired" && hasFinalSurfaceNumericProof(row));
  const hasMargin = /(?:粗利率|売上総利益率|営業利益率|純利益率|マージン|margin)/iu.test(answer);
  const hasDirection = /(?:上昇|低下|改善|悪化|拡大|縮小|横ばい|変わら)/u.test(answer);
  const marginPercentageCount = answer.match(/[+-]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*%/gu)?.length ?? 0;
  return row.responsePath === "fallback"
    || !hasMargin
    || !hasDirection
    || marginPercentageCount < 2
    || !alignmentAccepted
    || !Number.isFinite(claimCount)
    || claimCount < 2
    || verifiedCount !== claimCount
    || blockedCount !== 0
    || matchedFactIds.length < 2;
}

function hasQ05CitedFactorMissing(row) {
  if (!isQ05Row(row) || isHonestQ05SourceInsufficientFallback(row)) {
    return false;
  }
  const answer = String(row.answer ?? "");
  const hasFactor = /(?:要因|背景|ため|押し上げ|押し下げ|価格|コスト|製品構成|構成比|ミックス|mix|費用|粗利|営業費|引当|数量|需要)/iu.test(answer);
  const sourceText = returnedSourceText(row);
  const hasCitedFactorEvidence = /(?:md&a|management|segment|price|cost|mix|margin|demand|volume|expense|経営陣|セグメント|価格|コスト|構成|ミックス|需要|数量|費用|利益率)/iu.test(sourceText);
  return !hasFactor || !hasCitedFactorEvidence || !hasCompleteReturnedEvidenceMapping(row);
}

function isQ08Row(row) {
  return row.templateId === "Q08" || row.intent === "segment_driver";
}

function hasQ08CompletenessMissing(row) {
  if (!isQ08Row(row)) {
    return false;
  }
  if (Array.isArray(row.semanticQualityLabels)) {
    const labels = new Set(row.semanticQualityLabels);
    const hasStrong = labels.has("q08_strong_dimension_source_backed")
      || labels.has("q08_strong_dimension_explicitly_unavailable");
    const hasWeak = labels.has("q08_weak_dimension_source_backed")
      || labels.has("q08_weak_dimension_explicitly_unavailable");
    return !labels.has("q08_semantic_complete") || !hasStrong || !hasWeak;
  }
  if (hasAnyLabel(row, ["q08_completeness_missing", "segment_strong_weak_missing", "revenue_breakdown_generic_category_only"])) {
    return true;
  }
  const answer = String(row.answer ?? "").replace(/\s+/gu, " ").trim();
  const namesRevenuePillar = /(?:売上|収益).*(?:柱|区分|構成|セグメント|製品|地域)|(?:柱|区分|構成|セグメント|製品|地域).*(?:売上|収益)/u.test(answer);
  const assessesStrength = /(?:強(?:い|み)|好調|成長|増加|拡大|伸(?:び|長)|押し上げ|最大|主力)/u.test(answer);
  const assessesWeakness = /(?:弱(?:い|み)|不調|減少|低下|縮小|鈍化|落ち込|逆風|特定できない|確認できない)/u.test(answer);
  return !namesRevenuePillar || !assessesStrength || !assessesWeakness || hasGenericRevenueBreakdownAnswer(row);
}

function hasQ08EvidenceMappingMissing(row) {
  if (!isQ08Row(row)) return false;
  if (Array.isArray(row.semanticQualityLabels) && !row.semanticQualityLabels.includes("q08_evidence_mapped")) {
    return true;
  }
  return !hasCompleteReturnedEvidenceMapping(row);
}

function isQ09Row(row) {
  return row.templateId === "Q09" || row.intent === "cash_flow" || row.intent === "cash_flow_quality";
}

function hasQ09CompletenessMissing(row) {
  if (!isQ09Row(row)) {
    return false;
  }
  if (Array.isArray(row.semanticQualityLabels)) {
    const labels = new Set(row.semanticQualityLabels);
    const hasNetIncomeDisposition = labels.has("q09_compatible_net_income_compared")
      || labels.has("q09_net_income_explicitly_unavailable");
    return !labels.has("q09_semantic_complete")
      || !labels.has("q09_operating_cash_flow_typed")
      || !hasNetIncomeDisposition
      || !labels.has("q09_working_capital_assessed")
      || !labels.has("q09_capex_assessed")
      || !labels.has("q09_sign_safe");
  }
  if (hasAnyLabel(row, ["q09_completeness_missing", "cash_flow_quality_incomplete", "cash_flow_quality_assessment_missing"])) {
    return true;
  }
  const answer = String(row.answer ?? "").replace(/\s+/gu, " ").trim();
  const hasCashFlow = /(?:営業活動による)?(?:キャッシュフロー|キャッシュ・フロー|営業CF|operating cash flow)/iu.test(answer);
  const hasQualityAssessment = /(?:良好|健全|弱い|悪化|改善|注意|懸念|裏付け|上回|下回|乖離|十分|不十分|質(?:は|が|を)|評価|判断)/u.test(answer);
  if (isBankRow(row)) {
    const hasBankContext = /(?:銀行|金融|預金|貸出|融資|運転資本|規制資本)/u.test(answer);
    return !hasCashFlow || !hasQualityAssessment || !hasBankContext;
  }
  const hasNetIncomeComparison = /(?:営業CF|営業活動によるキャッシュフロー).{0,80}(?:純利益|当期利益).{0,50}(?:上回|下回|比べ|対して|近い|乖離|一致|対応して|裏付け)|(?:純利益|当期利益).{0,80}(?:営業CF|営業活動によるキャッシュフロー).{0,50}(?:上回|下回|比べ|対して|近い|乖離|一致|対応して|裏付け)/u.test(answer);
  const genericBoilerplate = /健全性は、?純利益との対応、?運転資本、?設備投資後の余力を合わせて見る/u.test(answer);
  return !hasCashFlow
    || !hasNetIncomeComparison
    || !hasQualityAssessment
    || genericBoilerplate
    || hasQ09SignCrossingPercentClaim(row);
}

function hasQ09EvidenceMappingMissing(row) {
  if (!isQ09Row(row)) return false;
  if (Array.isArray(row.semanticQualityLabels) && !row.semanticQualityLabels.includes("q09_evidence_mapped")) {
    return true;
  }
  return !hasCompleteReturnedEvidenceMapping(row);
}

function hasQ09SignCrossingPercentClaim(row) {
  const answer = String(row.answer ?? "");
  if (!/%\s*(?:増|減|上昇|低下)/u.test(answer)) {
    return false;
  }
  return (Array.isArray(row.sources) ? row.sources : []).some((source) => {
    const excerpt = String(source?.excerpt ?? "");
    const match = excerpt.match(/営業CF\s*:\s*([+-]?[\d,.]+)\s+[A-Z]+\s*\/\s*比較値\s*:\s*([+-]?[\d,.]+)/iu);
    if (!match) return false;
    const current = Number(match[1].replace(/,/g, ""));
    const comparison = Number(match[2].replace(/,/g, ""));
    return Number.isFinite(current) && Number.isFinite(comparison) && current !== 0 && comparison !== 0 && Math.sign(current) !== Math.sign(comparison);
  });
}

function isQ10Row(row) {
  return row.templateId === "Q10" || row.intent === "liquidity_debt";
}

function hasQ10CompletenessMissing(row) {
  if (!isQ10Row(row)) {
    return false;
  }
  if (Array.isArray(row.semanticQualityLabels)) {
    const labels = new Set(row.semanticQualityLabels);
    return !labels.has("q10_semantic_complete")
      || !labels.has("q10_concern_assessment_explicit")
      || !(
        labels.has("q10_liquidity_position_typed")
        && labels.has("q10_debt_position_typed")
      ) && !labels.has("q10_missing_position_explicit");
  }
  if (hasAnyLabel(row, ["q10_completeness_missing", "liquidity_assessment_incomplete", "generic_liquidity_answer"])) {
    return true;
  }
  const answer = String(row.answer ?? "").replace(/\s+/gu, " ").trim();
  const hasLiquidity = /(?:流動性|手元(?:資金|現金)|現金(?:及び|および)?現金同等物|cash(?: and cash equivalents)?|資金繰り)/iu.test(answer);
  const hasDebt = /(?:負債|有利子負債|借入|社債|debt|borrowings?|maturit|返済)/iu.test(answer);
  const hasAssessment = /(?:懸念|問題|余力|圧力|リスク|対応可能|賄え|返済|十分|不足|注意|悪化|改善|断定)/u.test(answer);
  return !hasLiquidity || !hasDebt || !hasAssessment;
}

function hasQ10EvidenceMappingMissing(row) {
  if (!isQ10Row(row) || !hasCompleteReturnedEvidenceMapping(row)) {
    return isQ10Row(row);
  }
  if (Array.isArray(row.semanticQualityLabels) && !row.semanticQualityLabels.includes("q10_evidence_mapped")) {
    return true;
  }
  const sourceText = returnedSourceText(row);
  return !/(?:cash|liquidity|debt|borrow|credit facilit|maturit|現金|営業CF|営業キャッシュフロー|流動性|負債|借入|社債|貸借対照表)/iu.test(sourceText);
}

function hasCompleteReturnedEvidenceMapping(row) {
  const sources = Array.isArray(row.sources) ? row.sources : [];
  if (row.sourceIdsValid !== true || sources.length === 0) {
    return false;
  }
  if (sources.some((source) => !String(source?.sourceId ?? "").trim() || !String(source?.sourceLabel ?? "").trim())) {
    return false;
  }
  const claimCount = Number(row.numericAlignmentClaimCount);
  if (!Number.isFinite(claimCount) || claimCount <= 0) {
    return true;
  }
  const verifiedCount = Number(row.numericAlignmentVerifiedClaimCount);
  const blockedCount = Number(row.numericAlignmentBlockedClaimCount);
  const alignmentAccepted = row.numericAlignmentStatus === "passed"
    || (row.numericAlignmentStatus === "repaired" && hasFinalSurfaceNumericProof(row));
  return alignmentAccepted
    && verifiedCount === claimCount
    && blockedCount === 0
    && Array.isArray(row.numericAlignmentMatchedFactIds)
    && row.numericAlignmentMatchedFactIds.filter(Boolean).length > 0;
}

function returnedSourceText(row) {
  return (Array.isArray(row.sources) ? row.sources : [])
    .map((source) => `${source?.sourceLabel ?? ""} ${source?.sectionType ?? ""} ${source?.excerpt ?? ""}`)
    .join(" ");
}

function isBankRow(row) {
  const metadataBank = row.industryClassification?.isBank ?? row.filingMetadata?.isBank;
  if (metadataBank != null) {
    return metadataBank === true;
  }
  return BANK_TICKERS.has(String(row.ticker ?? "").toUpperCase());
}

function hasSuspiciousNumericDisplay(row) {
  const answer = String(row.answer ?? "");
  return (
    hasLabel(row, "numeric_display_mismatch") ||
    hasLabel(row, "malformed_currency") ||
    /(?:円|万円|億円|百万円|千\s*USD|千USD|USD\s*億|ドル円)/i.test(answer)
  );
}

function hasUnsupportedDurabilityClassification(row) {
  return hasLabel(row, "unsupported_durability_classification") || hasLabel(row, "durability_missing_assessment");
}

function hasUnsupportedRiskOrLiquidityConclusion(row) {
  if (!/risk|watch|liquidity|debt/i.test(String(row.intent ?? ""))) {
    return false;
  }
  return (
    hasLabel(row, "unsupported_risk_conclusion") ||
    hasLabel(row, "unsupported_liquidity_conclusion") ||
    hasLabel(row, "generic_risk_answer") ||
    hasLabel(row, "generic_liquidity_answer")
  );
}

function hasWeakSourceEvidence(row) {
  if (hasExplicitHardIntentInsufficiencyRepair(row)) {
    return false;
  }
  if (row.sourceIdsValid === false) {
    return true;
  }
  if (row.sourceGateApplied === true && row.sourceGateSufficient === false) {
    return true;
  }
  if (isImportantIntent(row.intent) && row.sourceCount === 0) {
    return true;
  }
  return (row.sourceGateFailureLabels ?? []).some((label) =>
    /(?:source_gate_failed|source_.*missing|missing_.*source|retrieval_overfocused_xbrl|xbrl_only|source_relevance_low|driver_slots_empty|margin_driver_slots_empty|followup_target_empty|missing_followup_target_driver|fallback_slot_incomplete)/i.test(String(label))
  );
}

function hasExplicitHardIntentInsufficiencyRepair(row) {
  const sources = Array.isArray(row.sources) ? row.sources : [];
  const answer = String(row.answer ?? "");
  const expectedRepairLabel = row.templateId === "Q04"
    ? "q04_previous_answer_driver_candidate_repair"
    : row.templateId === "Q06"
      ? "q06_previous_answer_margin_candidate_repair"
      : null;
  if (
    !expectedRepairLabel
    || !hasLabel(row, "hard_intent_explicit_insufficiency_repair")
    || !hasLabel(row, expectedRepairLabel)
    || row.sourceIdsValid !== true
    || row.sourceGateApplied !== true
    || row.sourceGateSufficient !== false
    || sources.length === 0
    || !/(?:一時要因か継続要因か|一時要因か構造的変化か)は断定しません/u.test(answer)
  ) {
    return false;
  }

  const failureLabels = new Set(
    (Array.isArray(row.sourceGateFailureLabels) ? row.sourceGateFailureLabels : []).map((label) => String(label))
  );
  const narrowMissingLabel = row.templateId === "Q04"
    ? ["durability_context_missing", "missing_durability_context"].some((label) => failureLabels.has(label))
    : failureLabels.has("missing_margin_durability_context") || failureLabels.has("durability_context_missing");
  const allowedFailureLabels = new Set([
    "source_gate_failed",
    "durability_context_missing",
    "missing_durability_context",
    "missing_margin_durability_context"
  ]);
  if (!narrowMissingLabel || [...failureLabels].some((label) => !allowedFailureLabels.has(label))) {
    return false;
  }

  return sources.some((source) => isRelevantHardIntentInsufficiencySource(source, row.templateId));
}

function isRelevantHardIntentInsufficiencySource(source, templateId) {
  const sourceId = String(source?.sourceId ?? "").trim();
  const sourceLabel = String(source?.sourceLabel ?? "").trim();
  const excerpt = String(source?.excerpt ?? "").replace(/\s+/gu, " ").trim();
  if (!sourceId || !sourceLabel || excerpt.length < 20) {
    return false;
  }
  const sourceText = `${sourceLabel} ${source?.sectionType ?? ""} ${excerpt}`;
  if (templateId === "Q04") {
    return /(?:revenue|net sales|sales|segment|product|service|pricing|price|volume|demand|units|売上|収益|セグメント|製品|サービス|価格|数量|需要)/iu.test(sourceText);
  }
  return /(?:margin|gross profit|operating income|profit|cost|expense|pricing|price|mix|volume|利益率|利益|コスト|費用|価格|構成|ミックス|数量)/iu.test(sourceText);
}

function hasFallbackTaxonomyIntentMismatch(row) {
  const reason = row.fallbackUserReason ?? "";
  if (!reason || reason === "none") {
    return false;
  }
  const intent = String(row.intent ?? "");
  if ((intent === "margin_driver" || intent === "margin_durability_followup") && reason !== "margin_driver_sources_missing") {
    return /_sources_missing$/.test(reason);
  }
  if ((intent === "revenue_driver" || intent === "driver_durability_followup") && reason === "margin_driver_sources_missing") {
    return true;
  }
  if ((intent === "liquidity_debt" || intent === "cash_flow") && reason !== "liquidity_sources_missing") {
    return /_sources_missing$/.test(reason);
  }
  if (/risk|watch/i.test(intent) && reason !== "risk_sources_missing") {
    return /_sources_missing$/.test(reason);
  }
  return false;
}

const FALLBACK_REASONS_BY_CATEGORY = Object.freeze({
  none: new Set(["none"]),
  model_error: new Set(["model_unavailable", "model_timeout", "model_rate_limited", "model_schema_invalid"]),
  source_insufficient: new Set([
    "business_model_sources_missing",
    "revenue_breakdown_sources_missing",
    "management_discussion_sources_missing",
    "revenue_driver_sources_missing",
    "margin_driver_sources_missing",
    "liquidity_sources_missing",
    "risk_sources_missing"
  ]),
  answer_quality_guard: new Set([
    "answer_too_metric_only",
    "generic_watch_points",
    "numeric_alignment_failed",
    "invalid_sources"
  ]),
  language_guard: new Set(["raw_english_detected"]),
  sanitation_guard: new Set(["wrong_sector_wording", "malformed_currency_detected"]),
  company_resolution_error: new Set(["company_not_resolved"])
});

function hasFallbackTaxonomyTupleMismatch(row) {
  const responsePath = String(row.responsePath ?? "");
  const fallbackReason = normalizeNone(row.fallbackReason);
  const fallbackCategory = normalizeNone(row.fallbackCategory);
  const fallbackUserReason = normalizeNone(row.fallbackUserReason);
  const fallbackKind = normalizeNone(row.fallbackKind);
  const fallbackKindSource = String(row.fallbackKindSource ?? "").trim();
  const categoryReasons = FALLBACK_REASONS_BY_CATEGORY[fallbackCategory];

  if (!categoryReasons || !categoryReasons.has(fallbackUserReason)) {
    return true;
  }
  if ((fallbackCategory === "none") !== (fallbackUserReason === "none")) {
    return true;
  }

  if (responsePath === "fallback") {
    if (
      fallbackReason === "none"
      || fallbackCategory === "none"
      || fallbackUserReason === "none"
      || fallbackKind === "none"
      || !fallbackKindSource
      || row.responsePathFallbackButKindNone === true
    ) {
      return true;
    }
    if (row.evidenceFallbackUsed === true && fallbackCategory !== "source_insufficient") {
      return true;
    }
    return false;
  }

  return fallbackReason !== "none"
    || fallbackCategory !== "none"
    || fallbackUserReason !== "none"
    || fallbackKind !== "none"
    || row.evidenceFallbackUsed === true
    || row.responsePathFallbackButKindNone === true;
}

function normalizeNone(value) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized !== "null" ? normalized : "none";
}

function isBusinessModelRow(row) {
  return row.templateId === "Q01" || row.intent === "business_model" || row.intent === "business_overview";
}

function isImportantIntent(intent) {
  return [
    "business_model",
    "business_overview",
    "revenue_driver",
    "margin_driver",
    "driver_durability_followup",
    "margin_durability_followup",
    "liquidity_debt",
    "risk_watchpoint",
    "watch_point"
  ].includes(intent);
}

const BANK_TICKERS = new Set(["JPM", "BAC", "WFC", "C", "GS", "MS", "USB", "PNC", "TFC", "BK", "STT"]);

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function sumBy(values, valueFn) {
  return values.reduce((sum, value) => {
    const next = valueFn(value);
    return sum + (typeof next === "number" && Number.isFinite(next) ? next : 0);
  }, 0);
}

function parsePositiveInt(rawValue, fallback) {
  const parsed = parseInteger(rawValue, fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${rawValue}`);
  }
  return parsed;
}

function parseNonNegativeInt(rawValue, fallback) {
  const parsed = parseInteger(rawValue, fallback);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, got ${rawValue}`);
  }
  return parsed;
}

function parseNullableNonNegativeInt(rawValue, fallback) {
  if (rawValue == null || String(rawValue).trim().length === 0) {
    return fallback;
  }
  return parseNonNegativeInt(rawValue, fallback);
}

function parseNonNegativeNumber(rawValue, fallback) {
  if (rawValue == null || String(rawValue).trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseFloat(String(rawValue));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative number, got ${rawValue}`);
  }
  return parsed;
}

function parseStringList(rawValue) {
  if (rawValue == null || String(rawValue).trim().length === 0) {
    return [];
  }
  return String(rawValue)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatRatio(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function parseInteger(rawValue, fallback) {
  if (rawValue == null || String(rawValue).trim().length === 0) {
    return fallback;
  }
  const parsed = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected an integer, got ${rawValue}`);
  }
  return parsed;
}

function parseBoolean(rawValue, fallback) {
  if (rawValue == null || String(rawValue).trim().length === 0) {
    return fallback;
  }
  return /^(1|true|yes|on)$/i.test(String(rawValue).trim());
}
