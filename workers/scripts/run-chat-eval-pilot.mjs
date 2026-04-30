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
const detachedAccess = process.env.KABUYOMI_EVAL_DETACHED_ACCESS?.trim();
const evalLimitRaw = process.env.KABUYOMI_EVAL_LIMIT?.trim();
const evalMode = process.env.KABUYOMI_EVAL_MODE?.trim() || "pilot";
const appVersion = process.env.KABUYOMI_EVAL_APP_VERSION?.trim() || gitRevision();
const questionIds = parseQuestionIds(process.env.KABUYOMI_EVAL_QUESTION_IDS);
const requestedTickers = parseTickers(process.env.KABUYOMI_EVAL_TICKERS);

const dynamicQuestionTemplates = [
  {
    suffix: "01",
    question: "何の会社？",
    intent: "business_overview",
    expectedFocus: ["主要事業", "主な製品・サービス", "収益源"],
    failureLabels: ["good", "too_generic", "wrong_section", "unsupported_claim", "bad_japanese", "too_short"]
  },
  {
    suffix: "02",
    question: "売上成長の要因は？",
    intent: "yoy_change",
    expectedFocus: ["売上高の変化", "本文上の成長ドライバー", "数字と要因の対応"],
    failureLabels: [
      "good",
      "too_generic",
      "missing_numbers",
      "wrong_section",
      "unsupported_claim",
      "wrong_source",
      "bad_japanese",
      "too_short"
    ]
  },
  {
    suffix: "03",
    question: "その要因は一時的？",
    intent: "followup_durability",
    expectedFocus: ["前問の文脈維持", "一時要因か継続要因か", "断定できない場合の明示"],
    failureLabels: ["good", "off_topic", "stale_context", "unsupported_claim", "wrong_source", "bad_japanese", "too_short"]
  },
  {
    suffix: "04",
    question: "利益率が悪化した理由は？",
    intent: "margin_profitability",
    expectedFocus: ["利益率または営業利益率", "悪化要因", "売上要因との混同回避"],
    failureLabels: [
      "good",
      "too_generic",
      "missing_numbers",
      "wrong_section",
      "unsupported_claim",
      "numeric_error",
      "bad_japanese",
      "too_short"
    ]
  },
  {
    suffix: "05",
    question: "リスクは？",
    intent: "risk_factors",
    expectedFocus: ["主要リスク", "資料根拠", "一般論に寄せすぎない"],
    failureLabels: ["good", "too_generic", "wrong_section", "unsupported_claim", "over_refusal", "bad_japanese", "too_short"]
  },
  {
    suffix: "06",
    question: "前回決算との違いは？",
    intent: "historical_comparison",
    expectedFocus: ["前回または前年同期比較", "主要KPI", "数字"],
    failureLabels: [
      "good",
      "too_generic",
      "missing_numbers",
      "wrong_section",
      "unsupported_claim",
      "over_refusal",
      "bad_comparison",
      "bad_japanese",
      "too_short"
    ]
  },
  {
    suffix: "07",
    question: "売上の柱は？",
    intent: "revenue_breakdown",
    expectedFocus: ["セグメントまたは製品別売上", "地域別売上", "数字"],
    failureLabels: ["good", "too_generic", "missing_numbers", "wrong_section", "unsupported_claim", "bad_japanese", "too_short"]
  },
  {
    suffix: "08",
    question: "キャッシュフローは強い？",
    intent: "cash_flow",
    expectedFocus: ["営業キャッシュフロー", "純利益との関係", "前年同期比較"],
    failureLabels: ["good", "too_generic", "missing_numbers", "wrong_section", "unsupported_claim", "bad_japanese", "too_short"]
  },
  {
    suffix: "09",
    question: "投資家目線で良い点と悪い点は？",
    intent: "investment_takeaway",
    expectedFocus: ["良い点", "悪い点", "資料だけで言える範囲"],
    failureLabels: ["good", "too_generic", "missing_numbers", "wrong_section", "unsupported_claim", "bad_japanese", "too_short"]
  },
  {
    suffix: "10",
    question: "この資料だけでは分からないことは？",
    intent: "limits_of_filing",
    expectedFocus: ["資料外の情報", "市場価格や将来予測の限界", "過剰拒否しない"],
    failureLabels: ["good", "too_generic", "wrong_section", "unsupported_claim", "over_refusal", "bad_japanese", "too_short"]
  }
];
const maxQuestions = resolveMaxQuestions();

if (!baseURL) {
  console.error(
    "KABUYOMI_EVAL_BASE_URL is required, for example: KABUYOMI_EVAL_BASE_URL=https://kabuyomi-api.example.workers.dev npm run eval:chat:pilot"
  );
  process.exit(1);
}

const dataset = requestedTickers.length > 0 ? buildDynamicDataset(requestedTickers) : await loadDataset();
const rows = selectRows(dataset);
const outputPath = join(runsDir, `${runId}.jsonl`);
const results = [];
const filingKeyByTicker = new Map();
const runStartedAt = new Date().toISOString();

for (const row of rows) {
  const startedAt = Date.now();
  const rowStartedAt = new Date(startedAt).toISOString();
  const filingKey = await resolveFilingKey(row.ticker);
  const conversationContext = buildConversationContext(row, results);
  const response = await fetch(`${baseURL}/v1/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...requestHeaders()
    },
    body: JSON.stringify({
      filingKey,
      question: row.question,
      ...(conversationContext.length > 0 ? { conversationContext } : {}),
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
    conversationContext,
    intent: row.intent,
    expectedFocus: row.expectedFocus,
    failureLabels: row.failureLabels ?? [],
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

function buildDynamicDataset(tickers) {
  return tickers.flatMap((ticker) =>
    dynamicQuestionTemplates.map((template) => ({
      evalSetVersion: "chat-quality-v1-dynamic",
      questionId: `${ticker}-${template.suffix}`,
      ticker,
      question: template.question,
      intent: template.intent,
      expectedFocus: template.expectedFocus,
      failureLabels: template.failureLabels
    }))
  );
}

function buildConversationContext(row, previousResults) {
  if (!isDurabilityFollowUp(row)) {
    return [];
  }

  const priorRevenueDriver = [...previousResults]
    .reverse()
    .find((result) => result.ticker === row.ticker && result.question === "売上成長の要因は？");
  if (!priorRevenueDriver?.answer) {
    return [];
  }

  return [
    { role: "user", content: priorRevenueDriver.question },
    { role: "assistant", content: priorRevenueDriver.answer }
  ];
}

function isDurabilityFollowUp(row) {
  return row.question === "その要因は一時的？" || row.intent === "followup_durability";
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

function parseTickers(rawValue) {
  return (rawValue ?? "")
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function resolveMaxQuestions() {
  if (evalLimitRaw) {
    return Number.parseInt(evalLimitRaw, 10);
  }

  if (requestedTickers.length > 0 && evalMode === "full") {
    return requestedTickers.length * dynamicQuestionTemplates.length;
  }

  return 5;
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

function requestHeaders() {
  return {
    "x-device-key": deviceKey,
    ...(detachedAccess ? { "x-kabuyomi-detached-access": detachedAccess } : {})
  };
}
