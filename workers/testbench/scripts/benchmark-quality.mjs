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
    sourceIdsValidFalse: decoratedRows.filter((row) => row.sourceIdsValid === false).length,
    rawResponsePathBreakdown: countBy(decoratedRows, (row) => row.responsePath ?? "unknown"),
    rawFallbackTotal: decoratedRows.filter((row) => row.responsePath === "fallback").length,
    rawFallbackKindBreakdown: countBy(decoratedRows, (row) => row.fallbackKind ?? "none"),
    rawFallbackReasonBreakdown: countBy(
      decoratedRows.filter((row) => row.fallbackReason),
      (row) => row.fallbackReason
    ),
    rawGeminiApiErrorBreakdown: countBy(
      decoratedRows.filter((row) => row.geminiApiErrorKind),
      (row) => row.geminiApiErrorKind
    ),
    fallbackKindNoneOnFallbackRows: decoratedRows.filter(
      (row) => row.responsePath === "fallback" && (row.fallbackKind == null || row.fallbackKind === "none")
    ).length,
    rawEnglishSurfaced: decoratedRows.filter((row) => row.finalAnswerRawExcerptLike === true || hasLabel(row, "raw_english_excerpt")).length,
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

function isHardIntent(intent) {
  return ["revenue_driver", "driver_durability_followup", "margin_durability_followup"].includes(intent);
}

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
