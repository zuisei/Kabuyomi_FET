import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  benchmarkControlsFromEnv,
  buildBenchmarkSummary,
  calculateRateLimitBackoffMs,
  decorateBenchmarkRow,
  isRateLimitRow
} from "./benchmark-quality.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workersDir = resolve(__dirname, "../..");
const rootDir = resolve(__dirname, "..");
const runsDir = join(rootDir, "runs");

const baseURL = requiredEnv("KABUYOMI_TESTBENCH_BASE_URL");
const runId = process.env.KABUYOMI_TESTBENCH_RUN_ID?.trim() || buildRunId();
const deviceKey = process.env.KABUYOMI_TESTBENCH_DEVICE_KEY?.trim() || `testbench-${runId}`;
const detachedAccess = process.env.KABUYOMI_TESTBENCH_DETACHED_ACCESS?.trim();
const appVersion = process.env.KABUYOMI_TESTBENCH_APP_VERSION?.trim() || gitRevision();
const limit = parsePositiveInt(process.env.KABUYOMI_TESTBENCH_LIMIT);
const benchmarkControls = benchmarkControlsFromEnv(process.env);
const benchmarkDeviceKeyMode = resolveBenchmarkDeviceKeyMode(process.env.BENCHMARK_DEVICE_KEY_MODE);

const questionsPath = resolvePath(process.env.KABUYOMI_TESTBENCH_QUESTIONS, join(rootDir, "questions/core-12.jsonl"));
const companySetPath = resolvePath(process.env.KABUYOMI_TESTBENCH_COMPANY_SET, join(rootDir, "company-sets/minimal-5.json"));

const questions = await readJsonl(questionsPath);
const tickers = await resolveTickers();
const rows = buildRows(tickers, questions).slice(0, limit ?? Number.POSITIVE_INFINITY);
const results = [];
const filingKeyByTicker = new Map();
const runStartedAt = new Date().toISOString();
const outputPath = join(runsDir, `${runId}.jsonl`);
const summaryPath = join(runsDir, `${runId}-summary.json`);
let previousRequestCompletedAt = 0;
let finalRateLimitRows = 0;

for (const row of rows) {
  await waitForBenchmarkPacing(previousRequestCompletedAt, benchmarkControls);
  const startedAt = Date.now();
  const rowStartedAt = new Date(startedAt).toISOString();
  const filingKey = await resolveFilingKey(row.ticker);
  const conversationContext = buildConversationContext(row, results);
  const operationId = `${runId}:${row.caseId}`;
  const rowDeviceKey = buildBenchmarkRowDeviceKey(row);
  const attemptResult = await postChatWithBenchmarkRetries({
    filingKey,
    question: row.question,
    conversationContext,
    operationId,
    deviceKey: rowDeviceKey,
    controls: benchmarkControls
  });
  const payload = attemptResult.payload;
  const latencyMs = Date.now() - startedAt;
  previousRequestCompletedAt = Date.now();

  const result = decorateBenchmarkRow({
    benchmarkVersion: "kabuyomi-testbench-v1",
    runId,
    runStartedAt,
    rowStartedAt,
    baseURL,
    appVersion,
    benchmarkDeviceKeyMode,
    ticker: row.ticker,
    filingKey,
    caseId: row.caseId,
    templateId: row.templateId,
    question: row.question,
    intent: row.intent,
    followupOf: row.followupOf ?? null,
    conversationContext,
    expectedSourceSections: row.expectedSourceSections,
    goldChecklist: row.goldChecklist,
    mustAvoid: row.mustAvoid,
    answer: payload.answer ?? "",
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    responsePath: payload.responsePath ?? payload.debug?.responsePath ?? null,
    fallbackReason: payload.fallbackReason ?? payload.debug?.fallbackReason ?? null,
    fallbackCategory: payload.debug?.fallbackCategory ?? null,
    fallbackUserReason: payload.debug?.fallbackUserReason ?? null,
    missingEvidence: payload.debug?.missingEvidence ?? [],
    missingEvidenceLabelsJa: payload.debug?.missingEvidenceLabelsJa ?? [],
    guardLabels: payload.debug?.guardLabels ?? [],
    modelName: payload.modelName ?? payload.debug?.modelName ?? null,
    modelProvider: payload.debug?.modelProvider ?? null,
    promptTokenCount: payload.promptTokenCount ?? null,
    latencyMs,
    sourceCount: Array.isArray(payload.sources) ? payload.sources.length : 0,
    selectedSourceCount: payload.debug?.selectedSourceCount ?? null,
    selectedSourceCharCount: payload.debug?.selectedSourceCharCount ?? null,
    estimatedContextTokens: payload.debug?.estimatedContextTokens ?? null,
    selectedSourceIds: payload.debug?.selectedSourceIds ?? sourceIds(payload.sources),
    selectedSourceLabels: payload.debug?.selectedSourceLabels ?? sourceLabels(payload.sources),
    sourceIdsValid: payload.debug?.sourceIdsValid ?? null,
    answerQualityFlags: payload.debug?.answerQualityFlags ?? [],
    retryAttempted: payload.debug?.retryAttempted ?? false,
    retryAllowed: payload.debug?.retryAllowed ?? false,
    retryBlockedReason: payload.debug?.retryBlockedReason ?? null,
    retryOutcome: payload.debug?.retryOutcome ?? null,
    retryWasted: payload.debug?.retryWasted ?? false,
    firstCallFailureKind: payload.debug?.firstCallFailureKind ?? null,
    sourceGateApplied: payload.debug?.sourceGateApplied ?? false,
    sourceGateSufficient: payload.debug?.sourceGateSufficient ?? null,
    sourceGateMissingSourceTypes: payload.debug?.sourceGateMissingSourceTypes ?? [],
    sourceGateFailureLabels: payload.debug?.sourceGateFailureLabels ?? [],
    sourceGateRetrievalRetryRecommended: payload.debug?.sourceGateRetrievalRetryRecommended ?? false,
    retrievalRetryUsed: payload.debug?.retrievalRetryUsed ?? false,
    retrievalRetryOutcome: payload.debug?.retrievalRetryOutcome ?? "not_used",
    evidenceFallbackUsed: payload.debug?.evidenceFallbackUsed ?? false,
    fallbackKind: payload.debug?.fallbackKind ?? "none",
    fallbackKindSource: payload.debug?.fallbackKindSource ?? null,
    responsePathFallbackButKindNone: payload.debug?.responsePathFallbackButKindNone ?? false,
    driverSlotsCount: payload.debug?.driverSlotsCount ?? 0,
    marginDriverSlotsCount: payload.debug?.marginDriverSlotsCount ?? 0,
    followupTargetFound: payload.debug?.followupTargetFound ?? null,
    genericFallbackPhraseDetected: payload.debug?.genericFallbackPhraseDetected ?? false,
    hardRetrievalPlanUsed: payload.debug?.hardRetrievalPlanUsed ?? false,
    hardRetrievalQueries: payload.debug?.hardRetrievalQueries ?? [],
    hardRetrievalQueryPurposes: payload.debug?.hardRetrievalQueryPurposes ?? [],
    hardRetrievalMissingSourceTypes: payload.debug?.hardRetrievalMissingSourceTypes ?? [],
    hardRetrievalAddedSourceCount: payload.debug?.hardRetrievalAddedSourceCount ?? 0,
    hardRetrievalAddedSourceLabels: payload.debug?.hardRetrievalAddedSourceLabels ?? [],
    hardRetrievalAddedSourceIds: payload.debug?.hardRetrievalAddedSourceIds ?? [],
    hardRetrievalOutcome: payload.debug?.hardRetrievalOutcome ?? "not_used",
    sourceGateSufficientBeforeHardRetrieval: payload.debug?.sourceGateSufficientBeforeHardRetrieval ?? null,
    sourceGateSufficientAfterHardRetrieval: payload.debug?.sourceGateSufficientAfterHardRetrieval ?? null,
    driverSlotsCountBeforeHardRetrieval: payload.debug?.driverSlotsCountBeforeHardRetrieval ?? null,
    driverSlotsCountAfterHardRetrieval: payload.debug?.driverSlotsCountAfterHardRetrieval ?? null,
    marginDriverSlotsCountBeforeHardRetrieval: payload.debug?.marginDriverSlotsCountBeforeHardRetrieval ?? null,
    marginDriverSlotsCountAfterHardRetrieval: payload.debug?.marginDriverSlotsCountAfterHardRetrieval ?? null,
    selectedSourceLabelsBeforeHardRetrieval: payload.debug?.selectedSourceLabelsBeforeHardRetrieval ?? [],
    selectedSourceLabelsAfterHardRetrieval: payload.debug?.selectedSourceLabelsAfterHardRetrieval ?? [],
    hardRetrievalMode: payload.debug?.hardRetrievalMode ?? "diagnostic",
    hardSourceCoverageScore: payload.debug?.hardSourceCoverageScore ?? null,
    hardSourceCoverageMissing: payload.debug?.hardSourceCoverageMissing ?? [],
    hardSourceCoverageSectorKpiHits: payload.debug?.hardSourceCoverageSectorKpiHits ?? [],
    hardSourceCoverageHasMdaRevenueDiscussion: payload.debug?.hardSourceCoverageHasMdaRevenueDiscussion ?? null,
    hardSourceCoverageHasSegmentResults: payload.debug?.hardSourceCoverageHasSegmentResults ?? null,
    hardSourceCoverageHasSectorKpiWindow: payload.debug?.hardSourceCoverageHasSectorKpiWindow ?? null,
    geminiApiErrorKind: payload.debug?.geminiApiErrorKind ?? null,
    geminiApiErrorStatus: payload.debug?.geminiApiErrorStatus ?? null,
    geminiApiErrorCode: payload.debug?.geminiApiErrorCode ?? null,
    geminiApiErrorMessageSample: payload.debug?.geminiApiErrorMessageSample ?? null,
    geminiApiErrorRetryable: payload.debug?.geminiApiErrorRetryable ?? null,
    geminiRequestPromptCharCount: payload.debug?.geminiRequestPromptCharCount ?? null,
    geminiRequestEstimatedTokens: payload.debug?.geminiRequestEstimatedTokens ?? null,
    geminiRequestSourceCount: payload.debug?.geminiRequestSourceCount ?? null,
    geminiRequestContextCharCount: payload.debug?.geminiRequestContextCharCount ?? null,
    geminiModelName: payload.debug?.geminiModelName ?? null,
    geminiErrorOccurredBeforeResponse: payload.debug?.geminiErrorOccurredBeforeResponse ?? null,
    modelApiErrorKind: payload.debug?.modelApiErrorKind ?? null,
    modelApiErrorStatus: payload.debug?.modelApiErrorStatus ?? null,
    modelApiErrorCode: payload.debug?.modelApiErrorCode ?? null,
    modelApiErrorMessageSample: payload.debug?.modelApiErrorMessageSample ?? null,
    modelApiErrorRetryable: payload.debug?.modelApiErrorRetryable ?? null,
    modelRequestPromptCharCount: payload.debug?.modelRequestPromptCharCount ?? null,
    modelRequestEstimatedTokens: payload.debug?.modelRequestEstimatedTokens ?? null,
    modelRequestSourceCount: payload.debug?.modelRequestSourceCount ?? null,
    modelRequestContextCharCount: payload.debug?.modelRequestContextCharCount ?? null,
    modelErrorOccurredBeforeResponse: payload.debug?.modelErrorOccurredBeforeResponse ?? null,
    benchmarkHttpErrorStatus: payload.debug?.benchmarkHttpErrorStatus ?? null,
    benchmarkHttpErrorCode: payload.debug?.benchmarkHttpErrorCode ?? null,
    finalAnswerJapaneseRatio: payload.debug?.finalAnswerJapaneseRatio ?? null,
    finalAnswerEnglishSentenceCount: payload.debug?.finalAnswerEnglishSentenceCount ?? null,
    finalAnswerRawExcerptLike: payload.debug?.finalAnswerRawExcerptLike ?? false,
    finalAnswerLanguageLabels: payload.debug?.finalAnswerLanguageLabels ?? [],
    finalAnswerLanguageViolations: payload.debug?.finalAnswerLanguageViolations ?? [],
    languageGuardChecked: payload.debug?.languageGuardChecked ?? false,
    languageGuardOk: payload.debug?.languageGuardOk ?? null,
    languageGuardViolationLabels: payload.debug?.languageGuardViolationLabels ?? [],
    languageGuardFallbackUsed: payload.debug?.languageGuardFallbackUsed ?? false,
    languageGuardFallbackKind: payload.debug?.languageGuardFallbackKind ?? null,
    originalAnswerBeforeLanguageGuardLength: payload.debug?.originalAnswerBeforeLanguageGuardLength ?? null,
    originalAnswerBeforeLanguageGuardSample: payload.debug?.originalAnswerBeforeLanguageGuardSample ?? null,
    sourceRepairLabels: payload.debug?.sourceRepairLabels ?? [],
    bannedFallbackPhraseHits: bannedFallbackPhraseHits(payload.answer ?? ""),
    benchmarkControls: sanitizeBenchmarkControls(benchmarkControls),
    benchmarkAttemptCount: attemptResult.attemptCount,
    benchmarkRateLimitRetryCount: attemptResult.rateLimitRetryCount,
    benchmarkRateLimitBackoffMsTotal: attemptResult.rateLimitBackoffMsTotal,
    benchmarkFinalInfraErrorKind: null,
    rateLimitRetrySucceeded: attemptResult.rateLimitRetrySucceeded,
    rateLimitRetryObserved: attemptResult.rateLimitRetryObserved,
    timings: extractTimings(payload.debug),
    usage: payload.usage ?? null,
    creditsCharged: payload.creditsCharged ?? null,
    creditsRemaining: payload.creditsRemaining ?? payload.usage?.credits?.totalRemaining ?? null,
    answerRating: null,
    failureLabelsObserved: [],
    notes: ""
  });

  results.push(result);
  if (result.infraErrorKind === "rate_limit") {
    finalRateLimitRows += 1;
  }
  console.log(
    `[testbench] ${row.caseId} ${result.responsePath ?? "unknown"} sources=${result.sourceCount} selected=${result.selectedSourceCount ?? "n/a"} fallback=${result.fallbackReason ?? "none"} infra=${result.infraErrorKind ?? "none"} attempts=${result.benchmarkAttemptCount} latency=${latencyMs}ms`
  );
  if (
    benchmarkControls.stopRunOnRateLimitThreshold != null &&
    finalRateLimitRows > benchmarkControls.stopRunOnRateLimitThreshold
  ) {
    console.warn(
      `[testbench] stopping early: final rate_limit rows ${finalRateLimitRows} exceeded BENCHMARK_RATE_LIMIT_STOP_THRESHOLD=${benchmarkControls.stopRunOnRateLimitThreshold}`
    );
    break;
  }
}

function bannedFallbackPhraseHits(answer) {
  const checks = [
    ["本文に説明があります", /本文に.*説明があります/],
    ["本文全体と数字を並べると見えてきます", /本文全体と数字を並べると見えてきます/],
    ["本文の要因説明と並べると判断しやすくなります", /本文の要因説明と並べると判断しやすくなります/],
    ["価格、数量、需要、コスト、mixを見るべきです", /価格、数量、需要、コスト、mixを見るべきです/],
    ["この資料の範囲では確認できません", /この資料の範囲では確認できません(?!.*(不足|source|説明|指標|KPI|MD&A))/],
    ["一時的とは断定しにくいです", /一時的とは断定しにくいです(?!.*(driver|要因|不足|未特定|不明))/]
  ];
  return checks.filter(([, pattern]) => pattern.test(answer)).map(([label]) => label);
}

await mkdir(runsDir, { recursive: true });
await writeFile(outputPath, `${results.map((row) => JSON.stringify(row)).join("\n")}\n`);
const summary = buildBenchmarkSummary(results, {
  markInfraContaminatedOnRateLimitThreshold: benchmarkControls.markInfraContaminatedOnRateLimitThreshold,
  benchmarkControls: sanitizeBenchmarkControls(benchmarkControls)
});
await writeFile(summaryPath, `${JSON.stringify({ ...summary, benchmarkControls: sanitizeBenchmarkControls(benchmarkControls) }, null, 2)}\n`);
console.log(`Wrote ${results.length} rows to ${outputPath}`);
console.log(`Wrote summary to ${summaryPath}`);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is required.`);
    console.error("Example:");
    console.error(
      "KABUYOMI_TESTBENCH_BASE_URL=https://kabuyomi-api-test.dznqjmctk7.workers.dev npm run testbench:run"
    );
    process.exit(1);
  }
  return value.replace(/\/+$/, "");
}

async function resolveTickers() {
  const inlineTickers = parseTickers(process.env.KABUYOMI_TESTBENCH_TICKERS);
  if (inlineTickers.length > 0) {
    return inlineTickers;
  }

  const companySet = JSON.parse(await readFile(companySetPath, "utf8"));
  if (!Array.isArray(companySet.tickers) || companySet.tickers.length === 0) {
    throw new Error(`${companySetPath} must contain a non-empty tickers array`);
  }
  return companySet.tickers.map((ticker) => String(ticker).trim().toUpperCase()).filter(Boolean);
}

function buildRows(tickers, questions) {
  return tickers.flatMap((ticker) =>
    questions.map((template) => ({
      ...template,
      ticker,
      caseId: `${ticker}-${template.templateId}`
    }))
  );
}

async function resolveFilingKey(ticker) {
  const cached = filingKeyByTicker.get(ticker);
  if (cached) {
    return cached;
  }

  const response = await fetch(`${baseURL}/v1/company/${encodeURIComponent(ticker)}`, {
    headers: requestHeaders()
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`/v1/company/${ticker} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  if (typeof payload.filingKey !== "string" || payload.filingKey.length === 0) {
    throw new Error(`/v1/company/${ticker} did not return filingKey`);
  }

  filingKeyByTicker.set(ticker, payload.filingKey);
  return payload.filingKey;
}

async function postChatWithBenchmarkRetries({ filingKey, question, conversationContext, operationId, deviceKey, controls }) {
  let attemptCount = 0;
  let rateLimitRetryCount = 0;
  let rateLimitBackoffMsTotal = 0;
  let rateLimitRetryObserved = false;

  while (true) {
    attemptCount += 1;
    const attempt = await postChat({
      filingKey,
      question,
      conversationContext,
      deviceKey,
      operationId: attemptCount === 1 ? operationId : `${operationId}:attempt-${attemptCount}`
    });
    if (!isRateLimitRow(attempt.payload)) {
      return {
        payload: attempt.payload,
        attemptCount,
        rateLimitRetryCount,
        rateLimitBackoffMsTotal,
        rateLimitRetrySucceeded: rateLimitRetryObserved,
        rateLimitRetryObserved
      };
    }
    rateLimitRetryObserved = true;
    if (rateLimitRetryCount >= controls.maxRetriesOnRateLimit) {
      return {
        payload: attempt.payload,
        attemptCount,
        rateLimitRetryCount,
        rateLimitBackoffMsTotal,
        rateLimitRetrySucceeded: false,
        rateLimitRetryObserved
      };
    }
    rateLimitRetryCount += 1;
    const backoffMs = calculateRateLimitBackoffMs({
      retryCount: rateLimitRetryCount,
      controls,
      retryAfterMs: attempt.retryAfterMs
    });
    rateLimitBackoffMsTotal += backoffMs;
    console.warn(`[testbench] ${operationId} hit provider rate_limit; retry ${rateLimitRetryCount}/${controls.maxRetriesOnRateLimit} after ${backoffMs}ms`);
    await sleep(backoffMs);
  }
}

async function postChat({ filingKey, question, conversationContext, deviceKey, operationId }) {
  const response = await fetch(`${baseURL}/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...requestHeaders(deviceKey)
    },
    body: JSON.stringify({
      filingKey,
      question,
      ...(conversationContext.length > 0 ? { conversationContext } : {}),
      operationId
    })
  });
  const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
  const payload = await safeJson(response);
  if (!response.ok) {
    return { payload: normalizeHttpErrorPayload(payload, response.status), retryAfterMs };
  }
  return { payload, retryAfterMs };
}

function buildConversationContext(row, previousResults) {
  if (!row.followupOf) {
    return [];
  }

  const priorCaseId = `${row.ticker}-${row.followupOf}`;
  const prior = [...previousResults].reverse().find((result) => result.caseId === priorCaseId);
  if (!prior?.answer) {
    return [];
  }

  return [
    { role: "user", content: prior.question },
    { role: "assistant", content: prior.answer }
  ];
}

function requestHeaders(overrideDeviceKey = deviceKey) {
  return {
    "x-device-key": overrideDeviceKey,
    ...(detachedAccess ? { "x-kabuyomi-detached-access": detachedAccess } : {})
  };
}

async function readJsonl(path) {
  const raw = await readFile(path, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function resolvePath(rawPath, fallback) {
  if (!rawPath?.trim()) {
    return fallback;
  }
  return isAbsolute(rawPath) ? rawPath : resolve(workersDir, rawPath);
}

function parseTickers(rawValue) {
  return (rawValue ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function parsePositiveInt(rawValue) {
  if (!rawValue?.trim()) {
    return null;
  }
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`KABUYOMI_TESTBENCH_LIMIT must be a positive integer, got ${rawValue}`);
  }
  return parsed;
}

function resolveBenchmarkDeviceKeyMode(rawValue) {
  const value = rawValue?.trim().toLowerCase();
  if (!value || value === "run") {
    return "run";
  }
  if (value === "row") {
    return "row";
  }
  throw new Error(`BENCHMARK_DEVICE_KEY_MODE must be "run" or "row", got ${rawValue}`);
}

function buildBenchmarkRowDeviceKey(row) {
  if (benchmarkDeviceKeyMode !== "row") {
    return deviceKey;
  }
  return `bench-${runId}-${row.caseId}`
    .toLowerCase()
    .replace(/[^a-z0-9._:-]/g, "-")
    .slice(0, 120);
}

function buildRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: join(workersDir, ".."),
      encoding: "utf8"
    }).trim();
  } catch {
    return null;
  }
}

function sourceIds(sources) {
  return Array.isArray(sources)
    ? sources.map((source) => source?.id ?? source?.sourceId).filter((value) => typeof value === "string")
    : [];
}

function sourceLabels(sources) {
  return Array.isArray(sources)
    ? sources.map((source) => source?.label ?? source?.sourceLabel).filter((value) => typeof value === "string")
    : [];
}

function extractTimings(debug) {
  if (!debug || typeof debug !== "object") {
    return {};
  }
  return {
    totalPipelineMs: debug.totalPipelineMs ?? null,
    historicalLookupMs: debug.historicalLookupMs ?? null,
    deterministicBuildMs: debug.deterministicBuildMs ?? null,
    contextBuildMs: debug.contextBuildMs ?? null,
    geminiFirstCallMs: debug.geminiFirstCallMs ?? null,
    geminiRetryMs: debug.geminiRetryMs ?? null,
    fallbackBuildMs: debug.fallbackBuildMs ?? null,
    webSupplementMs: debug.webSupplementMs ?? null,
    groundingMs: debug.groundingMs ?? null
  };
}

async function waitForBenchmarkPacing(previousCompletedAt, controls) {
  if (!previousCompletedAt || controls.minDelayMsBetweenRequests <= 0) {
    return;
  }
  const elapsed = Date.now() - previousCompletedAt;
  const remaining = controls.minDelayMsBetweenRequests - elapsed;
  if (remaining > 0) {
    await sleep(remaining);
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseRetryAfterMs(value) {
  if (!value) {
    return null;
  }
  const seconds = Number.parseFloat(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }
  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now());
  }
  return null;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function normalizeHttpErrorPayload(payload, status) {
  const errorCode = typeof payload?.error === "string" ? payload.error : `http_${status}`;
  const kind = classifyHttpErrorStatus(status, errorCode);
  const companyResolutionError = isCompanyResolutionError(errorCode, payload);
  return {
    answer: "",
    sources: [],
    responsePath: "fallback",
    fallbackReason: errorCode,
    debug: {
      responsePath: "fallback",
      fallbackReason: errorCode,
      fallbackKind: kind === "rate_limit" ? "api_error" : "unknown_fallback",
      fallbackCategory: companyResolutionError ? "company_resolution_error" : "model_error",
      fallbackUserReason: companyResolutionError ? "company_not_resolved" : kind === "rate_limit" ? "model_rate_limited" : "model_unavailable",
      missingEvidence: [],
      missingEvidenceLabelsJa: [],
      guardLabels: [`http_${status}`],
      geminiApiErrorKind: kind,
      geminiApiErrorStatus: status,
      geminiApiErrorCode: errorCode,
      geminiApiErrorMessageSample: truncateErrorMessage(JSON.stringify(payload ?? {})),
      geminiApiErrorRetryable: kind === "rate_limit" || kind === "provider_server_error" || kind === "network_error",
      geminiErrorOccurredBeforeResponse: true,
      sourceIdsValid: null,
      benchmarkHttpErrorStatus: status,
      benchmarkHttpErrorCode: errorCode
    }
  };
}

function isCompanyResolutionError(errorCode, payload) {
  const text = `${errorCode} ${JSON.stringify(payload ?? {})}`.toLowerCase();
  return /company|ticker_not_found|no_supported_filing|filing_not_found|company_not_resolved/.test(text);
}

function classifyHttpErrorStatus(status, errorCode) {
  if (status === 401 || status === 403) {
    return "auth_error";
  }
  if (status === 429) {
    return "rate_limit";
  }
  if (status >= 500) {
    return "provider_server_error";
  }
  if (status === 400) {
    return "bad_request";
  }
  if (status === 402 && errorCode === "insufficient_credits") {
    return "unknown";
  }
  return "unknown";
}

function truncateErrorMessage(value) {
  return String(value ?? "").slice(0, 160);
}

function sanitizeBenchmarkControls(controls) {
  return {
    concurrency: controls.concurrency,
    effectiveConcurrency: 1,
    minDelayMsBetweenRequests: controls.minDelayMsBetweenRequests,
    maxRetriesOnRateLimit: controls.maxRetriesOnRateLimit,
    initialRateLimitBackoffMs: controls.initialRateLimitBackoffMs,
    maxRateLimitBackoffMs: controls.maxRateLimitBackoffMs,
    respectRetryAfterHeader: controls.respectRetryAfterHeader,
    jitterMs: controls.jitterMs,
    stopRunOnRateLimitThreshold: controls.stopRunOnRateLimitThreshold,
    markInfraContaminatedOnRateLimitThreshold: controls.markInfraContaminatedOnRateLimitThreshold
  };
}
