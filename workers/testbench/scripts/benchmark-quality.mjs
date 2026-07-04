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
    numericDisplaySuspicious: decoratedRows.filter((row) => hasSuspiciousNumericDisplay(row)).length,
    unsupportedDurabilityClassification: decoratedRows.filter((row) => hasUnsupportedDurabilityClassification(row)).length,
    unsupportedRiskOrLiquidityConclusion: decoratedRows.filter((row) => hasUnsupportedRiskOrLiquidityConclusion(row)).length,
    qualitySourceEvidenceWeak: qualityRowsList.filter((row) => hasWeakSourceEvidence(row)).length,
    fallbackTaxonomyIntentMismatch: qualityRowsList.filter((row) => hasFallbackTaxonomyIntentMismatch(row)).length,
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
  numericDisplaySuspicious: 0,
  unsupportedDurabilityClassification: 0,
  unsupportedRiskOrLiquidityConclusion: 0,
  qualitySourceEvidenceWeak: 0,
  fallbackTaxonomyIntentMismatch: 0,
  fallbackKindNoneOnFallbackRows: 0,
  maxQualityFallbackRate: 0.15,
  maxQualityQ03Q04Q06Fallback: 0,
  maxQualityHardIntentFallback: 0,
  maxQualityLatencyP95Ms: 12_000
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
  addCountCheck("numericDisplaySuspicious", thresholds.numericDisplaySuspicious);
  addCountCheck("unsupportedDurabilityClassification", thresholds.unsupportedDurabilityClassification);
  addCountCheck("unsupportedRiskOrLiquidityConclusion", thresholds.unsupportedRiskOrLiquidityConclusion);
  addCountCheck("qualitySourceEvidenceWeak", thresholds.qualitySourceEvidenceWeak);
  addCountCheck("fallbackTaxonomyIntentMismatch", thresholds.fallbackTaxonomyIntentMismatch);
  addCountCheck("fallbackKindNoneOnFallbackRows", thresholds.fallbackKindNoneOnFallbackRows);
  addCountCheck("qualityQ03Q04Q06Fallback", thresholds.maxQualityQ03Q04Q06Fallback);
  addCountCheck("qualityHardIntentFallback", thresholds.maxQualityHardIntentFallback);

  if ((summary.qualityFallbackRate ?? 0) > thresholds.maxQualityFallbackRate) {
    failures.push(`qualityFallbackRate=${formatRatio(summary.qualityFallbackRate)} > ${formatRatio(thresholds.maxQualityFallbackRate)}`);
  }
  if ((summary.qualityLatency?.p95 ?? 0) > thresholds.maxQualityLatencyP95Ms) {
    failures.push(`qualityLatency.p95=${summary.qualityLatency.p95} > ${thresholds.maxQualityLatencyP95Ms}`);
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
  if (typeof thresholds.minRows === "number" && (summary.rows ?? 0) < thresholds.minRows) {
    failures.push(`rows=${summary.rows ?? 0} < ${thresholds.minRows}`);
  }

  return {
    ok: failures.length === 0,
    failures,
    thresholds
  };
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
    numericDisplaySuspicious: decoratedRows.filter((row) => hasSuspiciousNumericDisplay(row)),
    unsupportedDurabilityClassification: decoratedRows.filter((row) => hasUnsupportedDurabilityClassification(row)),
    unsupportedRiskOrLiquidityConclusion: decoratedRows.filter((row) => hasUnsupportedRiskOrLiquidityConclusion(row)),
    qualitySourceEvidenceWeak: qualityRowsList.filter((row) => hasWeakSourceEvidence(row)),
    fallbackTaxonomyIntentMismatch: qualityRowsList.filter((row) => hasFallbackTaxonomyIntentMismatch(row)),
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

function hasLabel(row, label) {
  return [
    ...(row.failureLabelsObserved ?? []),
    ...(row.answerQualityFlags ?? []),
    ...(row.sourceGateFailureLabels ?? []),
    ...(row.finalAnswerLanguageLabels ?? []),
    ...(row.languageGuardViolationLabels ?? [])
  ].includes(label);
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
  const ticker = String(row.ticker ?? "").toUpperCase();
  if (BANK_TICKERS.has(ticker)) {
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
