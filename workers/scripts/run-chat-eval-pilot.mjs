import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetPath = join(__dirname, "../eval/chat-quality-v1.jsonl");
const runsDir = join(__dirname, "../eval/runs");

const baseURL = process.env.KABUYOMI_EVAL_BASE_URL?.trim();
const runId = process.env.KABUYOMI_EVAL_RUN_ID?.trim() || buildRunId();
const deviceKey = process.env.KABUYOMI_EVAL_DEVICE_KEY?.trim() || `eval-pilot-${runId}`;
const maxQuestions = Number.parseInt(process.env.KABUYOMI_EVAL_LIMIT ?? "5", 10);
const evalMode = process.env.KABUYOMI_EVAL_MODE?.trim() || "pilot";
const appVersion = process.env.KABUYOMI_EVAL_APP_VERSION?.trim() || gitRevision();
const questionIds = parseQuestionIds(process.env.KABUYOMI_EVAL_QUESTION_IDS);

if (!baseURL) {
  console.error(
    "KABUYOMI_EVAL_BASE_URL is required, for example: KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api.example.workers.dev npm run eval:chat:pilot"
  );
  process.exit(1);
}

const dataset = await loadDataset();
const rows = selectRows(dataset);
const outputPath = join(runsDir, `${runId}.jsonl`);
const results = [];
const filingKeyByTicker = new Map();
const runStartedAt = new Date().toISOString();

for (const row of rows) {
  const startedAt = Date.now();
  const rowStartedAt = new Date(startedAt).toISOString();
  const filingKey = await resolveFilingKey(row.ticker);
  const response = await fetch(`${baseURL}/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-device-key": deviceKey
    },
    body: JSON.stringify({
      filingKey,
      question: row.question,
      operationId: `${runId}:${row.questionId}`
    })
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`/v1/chat failed for ${row.questionId} with ${response.status}: ${JSON.stringify(payload)}`);
  }

  const result = {
    evalSetVersion: row.evalSetVersion,
    runId,
    evalMode,
    runStartedAt,
    rowStartedAt,
    baseURL,
    deviceKey,
    appVersion,
    ticker: row.ticker,
    filingKey,
    questionId: row.questionId,
    question: row.question,
    intent: row.intent,
    expectedFocus: row.expectedFocus,
    answer: payload.answer,
    sources: payload.sources ?? [],
    responsePath: payload.responsePath ?? null,
    modelName: payload.modelName ?? null,
    fallbackReason: payload.fallbackReason ?? null,
    promptTokenCount: payload.promptTokenCount ?? null,
    sourceCount: Array.isArray(payload.sources) ? payload.sources.length : 0,
    latencyMs: Date.now() - startedAt,
    creditsCharged: payload.creditsCharged ?? null,
    creditsRemaining: payload.creditsRemaining ?? payload.usage?.credits?.totalRemaining ?? null,
    creditBillingEnabled: payload.usage?.creditBillingEnabled ?? null,
    usageCredits: payload.usage?.credits ?? null,
    answerRating: null,
    failureLabelsObserved: [],
    notes: ""
  };
  results.push(result);
  console.log(
    `[eval] ${row.questionId} ${row.ticker} ${result.responsePath ?? "unknown"} sources=${result.sourceCount} credits=${result.creditsCharged ?? "n/a"}`
  );
}

await mkdir(runsDir, { recursive: true });
await writeFile(outputPath, `${results.map((row) => JSON.stringify(row)).join("\n")}\n`);
console.log(`Wrote ${results.length} pilot rows to ${outputPath}`);

async function loadDataset() {
  const raw = await readFile(datasetPath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function firstQuestionPerTicker(rows) {
  const selected = [];
  const seenTickers = new Set();
  for (const row of rows) {
    if (seenTickers.has(row.ticker)) {
      continue;
    }
    seenTickers.add(row.ticker);
    selected.push(row);
  }
  return selected;
}

function selectRows(rows) {
  if (questionIds.length > 0) {
    const requested = new Set(questionIds);
    const selected = rows.filter((row) => requested.has(row.questionId));
    const found = new Set(selected.map((row) => row.questionId));
    const missing = questionIds.filter((questionId) => !found.has(questionId));
    if (missing.length > 0) {
      throw new Error(`Unknown KABUYOMI_EVAL_QUESTION_IDS: ${missing.join(", ")}`);
    }
    return selected.slice(0, maxQuestions);
  }

  if (evalMode === "full") {
    return rows.slice(0, maxQuestions);
  }

  if (evalMode !== "pilot") {
    throw new Error(`Unknown KABUYOMI_EVAL_MODE: ${evalMode}`);
  }

  return firstQuestionPerTicker(rows).slice(0, maxQuestions);
}

async function resolveFilingKey(ticker) {
  const cached = filingKeyByTicker.get(ticker);
  if (cached) {
    return cached;
  }

  const response = await fetch(`${baseURL}/v1/company/${encodeURIComponent(ticker)}`, {
    headers: {
      "x-device-key": deviceKey
    }
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`/v1/company/${ticker} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  if (typeof payload.filingKey !== "string" || payload.filingKey.length === 0) {
    throw new Error(`/v1/company/${ticker} did not return a filingKey`);
  }

  filingKeyByTicker.set(ticker, payload.filingKey);
  return payload.filingKey;
}

function buildRunId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseQuestionIds(rawValue) {
  return (rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function gitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: join(__dirname, "../.."),
      encoding: "utf8"
    }).trim();
  } catch {
    return null;
  }
}
