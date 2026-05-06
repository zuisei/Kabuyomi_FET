import { readFile } from "node:fs/promises";

const [leftPath, rightPath] = process.argv.slice(2);

if (!leftPath || !rightPath) {
  console.error("Usage: node ./testbench/scripts/diff-runs.mjs <before.jsonl> <after.jsonl>");
  process.exit(1);
}

const leftRows = await readJsonl(leftPath);
const rightRows = await readJsonl(rightPath);
const leftByKey = new Map(leftRows.map((row) => [rowKey(row), row]));
const rightByKey = new Map(rightRows.map((row) => [rowKey(row), row]));
const keys = Array.from(new Set([...leftByKey.keys(), ...rightByKey.keys()])).sort();
const diffs = [];

for (const key of keys) {
  const before = leftByKey.get(key) ?? null;
  const after = rightByKey.get(key) ?? null;
  if (!before || !after) {
    diffs.push({
      key,
      status: before ? "missing_after" : "missing_before"
    });
    continue;
  }

  const changes = diffFields(before, after);
  if (Object.keys(changes).length > 0) {
    diffs.push({
      key,
      caseId: after.caseId ?? before.caseId ?? null,
      ticker: after.ticker ?? before.ticker ?? null,
      templateId: after.templateId ?? before.templateId ?? null,
      changes
    });
  }
}

const summary = {
  before: leftPath,
  after: rightPath,
  beforeRows: leftRows.length,
  afterRows: rightRows.length,
  matchedRows: keys.filter((key) => leftByKey.has(key) && rightByKey.has(key)).length,
  changedRows: diffs.filter((diff) => diff.changes).length,
  missingBeforeRows: diffs.filter((diff) => diff.status === "missing_before").length,
  missingAfterRows: diffs.filter((diff) => diff.status === "missing_after").length,
  responsePathChanges: countChanged(diffs, "responsePath"),
  fallbackReasonChanges: countChanged(diffs, "fallbackReason"),
  sourceIdsValidChanges: countChanged(diffs, "sourceIdsValid"),
  tokenFieldChanges: countAnyChanged(diffs, ["promptTokenCount", "completionTokenCount", "totalTokenCount"]),
  latencyChanges: summarizeNumericDelta(diffs, "latencyMs")
};

console.log(JSON.stringify({ summary, diffs }, null, 2));

async function readJsonl(path) {
  return (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function rowKey(row) {
  return [row.caseId ?? "", row.ticker ?? "", row.templateId ?? ""].join("|");
}

function diffFields(before, after) {
  const fields = [
    "responsePath",
    "fallbackReason",
    "fallbackKind",
    "sourceIdsValid",
    "selectedSourceCount",
    "selectedSourceLabels",
    "selectedSourceTypes",
    "selectedSourceSectionFamilies",
    "promptTokenCount",
    "completionTokenCount",
    "totalTokenCount",
    "latencyMs",
    "sourceGateFailureLabels",
    "hardIntentRetrievalMode",
    "hardIntentRetrievalAddedSourceCount"
  ];
  const changes = {};
  for (const field of fields) {
    if (stableJson(before[field]) !== stableJson(after[field])) {
      changes[field] = {
        before: before[field] ?? null,
        after: after[field] ?? null
      };
    }
  }
  return changes;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(sortObject(value));
  }
  return JSON.stringify(value ?? null);
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function countChanged(diffs, field) {
  return diffs.filter((diff) => diff.changes?.[field]).length;
}

function countAnyChanged(diffs, fields) {
  return diffs.filter((diff) => fields.some((field) => diff.changes?.[field])).length;
}

function summarizeNumericDelta(diffs, field) {
  const deltas = diffs
    .map((diff) => diff.changes?.[field])
    .filter(Boolean)
    .map((change) => {
      const before = typeof change.before === "number" ? change.before : null;
      const after = typeof change.after === "number" ? change.after : null;
      return before == null || after == null ? null : after - before;
    })
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  if (deltas.length === 0) {
    return {
      changedRows: 0,
      averageDelta: null,
      maxIncrease: null,
      maxDecrease: null
    };
  }
  return {
    changedRows: deltas.length,
    averageDelta: deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
    maxIncrease: Math.max(...deltas),
    maxDecrease: Math.min(...deltas)
  };
}
