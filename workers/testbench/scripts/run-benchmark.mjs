import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const questionsPath = resolvePath(process.env.KABUYOMI_TESTBENCH_QUESTIONS, join(rootDir, "questions/core-12.jsonl"));
const companySetPath = resolvePath(process.env.KABUYOMI_TESTBENCH_COMPANY_SET, join(rootDir, "company-sets/minimal-5.json"));

const questions = await readJsonl(questionsPath);
const tickers = await resolveTickers();
const rows = buildRows(tickers, questions).slice(0, limit ?? Number.POSITIVE_INFINITY);
const results = [];
const filingKeyByTicker = new Map();
const runStartedAt = new Date().toISOString();
const outputPath = join(runsDir, `${runId}.jsonl`);

for (const row of rows) {
  const startedAt = Date.now();
  const rowStartedAt = new Date(startedAt).toISOString();
  const filingKey = await resolveFilingKey(row.ticker);
  const conversationContext = buildConversationContext(row, results);
  const operationId = `${runId}:${row.caseId}`;
  const payload = await postChat({ filingKey, question: row.question, conversationContext, operationId });
  const latencyMs = Date.now() - startedAt;

  const result = {
    benchmarkVersion: "kabuyomi-testbench-v1",
    runId,
    runStartedAt,
    rowStartedAt,
    baseURL,
    appVersion,
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
    modelName: payload.modelName ?? payload.debug?.modelName ?? null,
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
    timings: extractTimings(payload.debug),
    usage: payload.usage ?? null,
    creditsCharged: payload.creditsCharged ?? null,
    creditsRemaining: payload.creditsRemaining ?? payload.usage?.credits?.totalRemaining ?? null,
    answerRating: null,
    failureLabelsObserved: [],
    notes: ""
  };

  results.push(result);
  console.log(
    `[testbench] ${row.caseId} ${result.responsePath ?? "unknown"} sources=${result.sourceCount} selected=${result.selectedSourceCount ?? "n/a"} fallback=${result.fallbackReason ?? "none"} latency=${latencyMs}ms`
  );
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
console.log(`Wrote ${results.length} rows to ${outputPath}`);

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

async function postChat({ filingKey, question, conversationContext, operationId }) {
  const response = await fetch(`${baseURL}/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...requestHeaders()
    },
    body: JSON.stringify({
      filingKey,
      question,
      ...(conversationContext.length > 0 ? { conversationContext } : {}),
      operationId
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`/v1/chat failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
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

function requestHeaders() {
  return {
    "x-device-key": deviceKey,
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
