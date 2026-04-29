import { readFile } from "node:fs/promises";

const allowedResponsePaths = new Set(["gemini", "deterministic", "fallback", "historical"]);
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

const runPath = process.argv[2];

if (!runPath) {
  console.error("Usage: node ./scripts/validate-chat-run.mjs ./eval/runs/<run-id>.jsonl");
  process.exit(1);
}

const raw = await readFile(runPath, "utf8");
const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
const errors = [];
const seenQuestionIds = new Set();

for (const [index, line] of lines.entries()) {
  const lineNumber = index + 1;
  let row;
  try {
    row = JSON.parse(line);
  } catch (error) {
    errors.push(`line ${lineNumber}: invalid JSON (${error.message})`);
    continue;
  }

  requireString(row, "evalSetVersion", lineNumber, errors);
  requireString(row, "runId", lineNumber, errors);
  requireString(row, "ticker", lineNumber, errors);
  requireString(row, "questionId", lineNumber, errors);
  requireString(row, "question", lineNumber, errors);
  requireString(row, "answer", lineNumber, errors);

  if (typeof row.questionId === "string") {
    if (seenQuestionIds.has(row.questionId)) {
      errors.push(`line ${lineNumber}: duplicate questionId ${row.questionId}`);
    }
    seenQuestionIds.add(row.questionId);
  }

  if (!allowedResponsePaths.has(row.responsePath)) {
    errors.push(`line ${lineNumber}: responsePath must be one of ${Array.from(allowedResponsePaths).join(", ")}`);
  }

  if (!Array.isArray(row.sources)) {
    errors.push(`line ${lineNumber}: sources must be an array`);
  }

  if (typeof row.sourceCount !== "number") {
    errors.push(`line ${lineNumber}: sourceCount must be a number`);
  } else if (Array.isArray(row.sources) && row.sourceCount !== row.sources.length) {
    errors.push(`line ${lineNumber}: sourceCount ${row.sourceCount} does not match sources length ${row.sources.length}`);
  }

  if (row.fallbackReason !== null && row.fallbackReason !== undefined && typeof row.fallbackReason !== "string") {
    errors.push(`line ${lineNumber}: fallbackReason must be null or string`);
  }

  if (typeof row.latencyMs !== "number" || row.latencyMs < 0) {
    errors.push(`line ${lineNumber}: latencyMs must be a non-negative number`);
  }

  if (!Array.isArray(row.failureLabelsObserved)) {
    errors.push(`line ${lineNumber}: failureLabelsObserved must be an array`);
  } else {
    for (const label of row.failureLabelsObserved) {
      if (!allowedFailureLabels.has(label)) {
        errors.push(`line ${lineNumber}: unknown failure label ${label}`);
      }
    }
  }

  if (row.answerRating !== null && row.answerRating !== undefined) {
    if (!Number.isInteger(row.answerRating) || row.answerRating < 1 || row.answerRating > 5) {
      errors.push(`line ${lineNumber}: answerRating must be null or an integer from 1 to 5`);
    }
  }
}

if (lines.length === 0) {
  errors.push("run file is empty");
}

if (errors.length > 0) {
  console.error("Chat run validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Chat run validation passed: ${lines.length} rows in ${runPath}`);

function requireString(row, field, lineNumber, errors) {
  if (typeof row[field] !== "string" || row[field].trim().length === 0) {
    errors.push(`line ${lineNumber}: ${field} is required`);
  }
}
