import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetPath = join(__dirname, "../eval/chat-quality-v1.jsonl");

const expectedVersion = "chat-quality-v1";
const expectedTickers = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL"];
const allowedFailureLabels = new Set([
  "good",
  "too_generic",
  "missing_numbers",
  "wrong_section",
  "off_topic",
  "unsupported_claim",
  "missing_source",
  "wrong_source",
  "too_vague",
  "over_refusal",
  "missed_key_point",
  "numeric_error",
  "stale_context",
  "bad_comparison",
  "bad_japanese",
  "too_short"
]);

const raw = await readFile(datasetPath, "utf8");
const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
const errors = [];
const seenIds = new Set();
const countByTicker = new Map(expectedTickers.map((ticker) => [ticker, 0]));

for (const [index, line] of lines.entries()) {
  let row;
  try {
    row = JSON.parse(line);
  } catch (error) {
    errors.push(`line ${index + 1}: invalid JSON (${error.message})`);
    continue;
  }

  if (row.evalSetVersion !== expectedVersion) {
    errors.push(`line ${index + 1}: evalSetVersion must be ${expectedVersion}`);
  }
  if (!expectedTickers.includes(row.ticker)) {
    errors.push(`line ${index + 1}: unexpected ticker ${row.ticker}`);
  } else {
    countByTicker.set(row.ticker, countByTicker.get(row.ticker) + 1);
  }
  if (typeof row.questionId !== "string" || !new RegExp(`^${row.ticker}-\\d{2}$`).test(row.questionId)) {
    errors.push(`line ${index + 1}: invalid questionId ${row.questionId}`);
  } else if (seenIds.has(row.questionId)) {
    errors.push(`line ${index + 1}: duplicate questionId ${row.questionId}`);
  } else {
    seenIds.add(row.questionId);
  }
  if (typeof row.question !== "string" || row.question.trim().length === 0) {
    errors.push(`line ${index + 1}: question is required`);
  }
  if (typeof row.intent !== "string" || row.intent.trim().length === 0) {
    errors.push(`line ${index + 1}: intent is required`);
  }
  if (!Array.isArray(row.expectedFocus) || row.expectedFocus.length === 0) {
    errors.push(`line ${index + 1}: expectedFocus must be a non-empty array`);
  }
  if (!Array.isArray(row.failureLabels) || !row.failureLabels.includes("good")) {
    errors.push(`line ${index + 1}: failureLabels must include good`);
  } else {
    for (const label of row.failureLabels) {
      if (!allowedFailureLabels.has(label)) {
        errors.push(`line ${index + 1}: unknown failure label ${label}`);
      }
    }
  }
}

if (lines.length !== 50) {
  errors.push(`expected 50 rows, found ${lines.length}`);
}

for (const ticker of expectedTickers) {
  const count = countByTicker.get(ticker);
  if (count !== 10) {
    errors.push(`expected 10 rows for ${ticker}, found ${count}`);
  }
}

if (errors.length > 0) {
  console.error("Chat eval validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Chat eval validation passed: ${lines.length} rows, ${expectedTickers.length} tickers.`);
