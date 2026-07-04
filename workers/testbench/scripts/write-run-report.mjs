import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { buildBenchmarkSummary, collectQualityIssueRows } from "./benchmark-quality.mjs";
import { buildRunMetadata } from "./run-output-metadata.mjs";

const runPath = process.argv[2];
if (!runPath) {
  console.error("Usage: node ./testbench/scripts/write-run-report.mjs ./testbench/runs/<run-id>.jsonl");
  process.exit(1);
}

const resolvedRunPath = resolve(process.cwd(), runPath);
const rows = (await readFile(resolvedRunPath, "utf8"))
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const runId = rows[0]?.runId ?? basename(resolvedRunPath, ".jsonl");
const summary = buildSummary(rows);
const benchmarkSummary = buildBenchmarkSummary(rows);
const qualityIssueRows = collectQualityIssueRows(rows);
const metadata = buildRunMetadata(rows);
const outputPath = join(dirname(resolvedRunPath), `${runId}-answers.md`);

const lines = [
  `# ${runId} Answers`,
  "",
  "## Test Method",
  "",
  "- Scope: prompt v2 smoke response test against the Kabuyomi test Worker.",
  `- Base URL: ${rows[0]?.baseURL ?? "unknown"}`,
  `- Run started at: ${rows[0]?.runStartedAt ?? "unknown"}`,
  `- Tickers: ${summary.tickers.join(", ")}`,
  `- Rows: ${rows.length}`,
  `- Questions: ${metadata.questions}`,
  `- Company set: ${metadata.companySet}`,
  `- Question templates observed: ${metadata.questionTemplateCount}`,
  `- Company tickers observed: ${metadata.companyTickerCount}`,
  "- Note: hidden internal chain-of-thought is not recorded. This report records observable test rationale, criteria, outputs, and diagnostics.",
  "",
  "## Result Summary",
  "",
  `- Response paths: ${formatBreakdown(summary.responsePath)}`,
  `- Fallback reasons: ${formatBreakdown(summary.fallbackReason)}`,
  `- Infra errors: ${formatBreakdown(summary.infraErrorKind)}`,
  `- Source ID invalid rows: ${summary.sourceIdsInvalidFalse}`,
  `- Quality rows: ${benchmarkSummary.qualityRows}`,
  `- Quality fallback rate: ${(benchmarkSummary.qualityFallbackRate * 100).toFixed(1)}%`,
  `- Quality Q03/Q04/Q06 fallback: ${benchmarkSummary.qualityQ03Q04Q06Fallback}`,
  `- Quality hard-intent fallback: ${benchmarkSummary.qualityHardIntentFallback}`,
  `- Average latency: ${summary.averageLatencyMs} ms`,
  `- Max latency: ${summary.maxLatency.caseId} ${summary.maxLatency.latencyMs} ms`,
  "",
  "## Quality Gate Counters",
  "",
  `- rawEnglishSurfaced: ${benchmarkSummary.rawEnglishSurfaced}`,
  `- hybridEnglishJapaneseSurfaced: ${benchmarkSummary.hybridEnglishJapaneseSurfaced}`,
  `- genericBusinessModelAnswers: ${benchmarkSummary.genericBusinessModelAnswers}`,
  `- genericRevenueBreakdownAnswers: ${benchmarkSummary.genericRevenueBreakdownAnswers}`,
  `- misleadingRevenueDriverCauses: ${benchmarkSummary.misleadingRevenueDriverCauses}`,
  `- nonFinancialCashFlowBankLanguage: ${benchmarkSummary.nonFinancialCashFlowBankLanguage}`,
  `- metricOnlyImportantIntentAnswers: ${benchmarkSummary.metricOnlyImportantIntentAnswers}`,
  `- durabilityFollowupLostPriorDriver: ${benchmarkSummary.durabilityFollowupLostPriorDriver}`,
  `- numericDisplaySuspicious: ${benchmarkSummary.numericDisplaySuspicious}`,
  `- unsupportedDurabilityClassification: ${benchmarkSummary.unsupportedDurabilityClassification}`,
  `- unsupportedRiskOrLiquidityConclusion: ${benchmarkSummary.unsupportedRiskOrLiquidityConclusion}`,
  `- qualitySourceEvidenceWeak: ${benchmarkSummary.qualitySourceEvidenceWeak}`,
  `- fallbackTaxonomyIntentMismatch: ${benchmarkSummary.fallbackTaxonomyIntentMismatch}`,
  `- fallbackKindNoneOnFallbackRows: ${benchmarkSummary.fallbackKindNoneOnFallbackRows}`,
  "",
  "## Review Notes",
  "",
  "- Treat `fallbackReason=low_quality_answer` rows as the first human-review targets.",
  "- Deterministic rows are expected when the local deterministic answer path handles the question.",
  "- A row with no fallback is not automatically perfect; review the full answer text below for wording and grounding quality.",
  ""
];

appendQualityIssueExamples(lines, qualityIssueRows);

lines.push("## Fallback Rows", "");

const fallbackRows = rows.filter((row) => row.fallbackReason);
if (fallbackRows.length === 0) {
  lines.push("- None", "");
} else {
  for (const row of fallbackRows) {
    lines.push(`- ${row.caseId}: ${row.fallbackReason} / ${row.fallbackKind ?? "unknown"} / ${row.fallbackUserReason ?? "none"}`);
  }
  lines.push("");
}

lines.push("## All Answers", "");

for (const row of rows) {
  lines.push(
    `### ${row.caseId}`,
    "",
    `- Ticker: ${row.ticker}`,
    `- Filing key: ${row.filingKey}`,
    `- Question: ${row.question}`,
    `- Intent: ${row.intent}`,
    `- Response path: ${row.responsePath ?? "unknown"}`,
    `- Fallback reason: ${row.fallbackReason ?? "none"}`,
    `- Fallback kind: ${row.fallbackKind ?? "none"}`,
    `- Fallback user reason: ${row.fallbackUserReason ?? "none"}`,
    `- Runtime intent: ${row.runtimeQuestionIntent ?? "unknown"}`,
    `- Model: ${row.modelProvider ?? "unknown"} / ${row.modelName ?? "unknown"}`,
    `- Tokens: prompt=${row.promptTokenCount ?? "n/a"}, completion=${row.completionTokenCount ?? "n/a"}, total=${row.totalTokenCount ?? "n/a"}`,
    `- Latency: ${row.latencyMs} ms`,
    `- Source count: ${row.sourceCount}`,
    `- Source IDs valid: ${row.sourceIdsValid}`,
    `- Answer quality flags: ${formatArray(row.answerQualityFlags)}`,
    "",
    "Answer:",
    "",
    "```text",
    row.answer || "",
    "```",
    "",
    "Sources:",
    ""
  );

  if (!Array.isArray(row.sources) || row.sources.length === 0) {
    lines.push("- None");
  } else {
    for (const source of row.sources) {
      lines.push(`- ${source.sourceId ?? "unknown"}: ${source.sourceLabel ?? "no label"} (${source.sectionType ?? "unknown"})`);
    }
  }
  lines.push("");
}

await writeFile(outputPath, `${lines.join("\n")}\n`);
console.log(outputPath);

function buildSummary(inputRows) {
  const tickers = [...new Set(inputRows.map((row) => row.ticker))];
  const maxLatency = inputRows.reduce((max, row) => (row.latencyMs > max.latencyMs ? row : max), inputRows[0]);
  return {
    tickers,
    responsePath: countBy(inputRows, (row) => row.responsePath ?? "unknown"),
    fallbackReason: countBy(inputRows, (row) => row.fallbackReason ?? "none"),
    infraErrorKind: countBy(inputRows, (row) => row.infraErrorKind ?? "none"),
    sourceIdsInvalidFalse: inputRows.filter((row) => row.sourceIdsValid === false).length,
    averageLatencyMs: Math.round(inputRows.reduce((sum, row) => sum + row.latencyMs, 0) / inputRows.length),
    maxLatency
  };
}

function countBy(inputRows, selector) {
  const counts = new Map();
  for (const row of inputRows) {
    const key = selector(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

function formatBreakdown(value) {
  return Object.entries(value)
    .map(([key, count]) => `${key}=${count}`)
    .join(", ");
}

function formatArray(value) {
  return Array.isArray(value) && value.length > 0 ? value.join(", ") : "none";
}

function appendQualityIssueExamples(lines, issueRows) {
  const entries = Object.entries(issueRows).filter(([, rows]) => rows.length > 0);
  lines.push("## Quality Issue Examples", "");
  if (entries.length === 0) {
    lines.push("- None", "");
    return;
  }

  for (const [counter, rows] of entries) {
    lines.push(`### ${counter}`, "");
    for (const row of rows.slice(0, 8)) {
      const label = [row.caseId, row.ticker, row.templateId, row.intent].filter(Boolean).join(" ");
      const fallback = [row.responsePath, row.fallbackKind, row.fallbackUserReason].filter(Boolean).join("/");
      lines.push(`- ${label}${fallback ? ` (${fallback})` : ""}: ${row.answer}`);
    }
    if (rows.length > 8) {
      lines.push(`- ... ${rows.length - 8} more`);
    }
    lines.push("");
  }
}
