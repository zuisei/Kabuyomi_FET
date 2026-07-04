import { readFile } from "node:fs/promises";
import { buildBenchmarkSummary, collectQualityIssueRows, evaluateQualityGate, qualityGateThresholdsFromEnv } from "./benchmark-quality.mjs";
import { runMetadataLines } from "./run-output-metadata.mjs";

const runPath = process.argv[2];

if (!runPath) {
  console.error("Usage: npm run testbench:gate -- ./testbench/runs/<run-id>.jsonl");
  process.exit(1);
}

const rows = (await readFile(runPath, "utf8"))
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

if (rows.length === 0) {
  console.error("Run file is empty.");
  process.exit(1);
}

const summary = buildBenchmarkSummary(rows);
const gate = evaluateQualityGate(summary, qualityGateThresholdsFromEnv());

console.log(`# Testbench Quality Gate`);
console.log(`file: ${runPath}`);
for (const line of runMetadataLines(rows)) {
  console.log(line);
}
console.log(`rows: ${summary.rows}`);
console.log(`templates: ${(summary.templates ?? []).join(", ") || "none"}`);
console.log(`observedCompanyTickers: ${(summary.tickers ?? []).length}`);
console.log(`qualityRows: ${summary.qualityRows}`);
console.log(`qualityFallbackRate: ${(summary.qualityFallbackRate * 100).toFixed(1)}%`);
console.log(`qualityQ03Q04Q06Fallback: ${summary.qualityQ03Q04Q06Fallback}`);
console.log(`qualityHardIntentFallback: ${summary.qualityHardIntentFallback}`);
console.log(`rawEnglishSurfaced: ${summary.rawEnglishSurfaced}`);
console.log(`hybridEnglishJapaneseSurfaced: ${summary.hybridEnglishJapaneseSurfaced}`);
console.log(`genericBusinessModelAnswers: ${summary.genericBusinessModelAnswers}`);
console.log(`genericRevenueBreakdownAnswers: ${summary.genericRevenueBreakdownAnswers}`);
console.log(`misleadingRevenueDriverCauses: ${summary.misleadingRevenueDriverCauses}`);
console.log(`nonFinancialCashFlowBankLanguage: ${summary.nonFinancialCashFlowBankLanguage}`);
console.log(`metricOnlyImportantIntentAnswers: ${summary.metricOnlyImportantIntentAnswers}`);
console.log(`durabilityFollowupLostPriorDriver: ${summary.durabilityFollowupLostPriorDriver}`);
console.log(`numericDisplaySuspicious: ${summary.numericDisplaySuspicious}`);
console.log(`unsupportedDurabilityClassification: ${summary.unsupportedDurabilityClassification}`);
console.log(`unsupportedRiskOrLiquidityConclusion: ${summary.unsupportedRiskOrLiquidityConclusion}`);
console.log(`qualitySourceEvidenceWeak: ${summary.qualitySourceEvidenceWeak}`);
console.log(`fallbackTaxonomyIntentMismatch: ${summary.fallbackTaxonomyIntentMismatch}`);
console.log(`fallbackKindNoneOnFallbackRows: ${summary.fallbackKindNoneOnFallbackRows}`);
console.log(`qualityLatency.p95: ${summary.qualityLatency.p95}`);

if (!gate.ok) {
  console.log("\n## Failed");
  for (const failure of gate.failures) {
    console.log(`- ${failure}`);
  }
  printIssueExamples(rows, gate.failures);
  process.exit(1);
}

console.log("\nPASS");

function printIssueExamples(rows, failures) {
  const issueRows = collectQualityIssueRows(rows);
  const failedCounters = new Set(
    failures
      .map((failure) => failure.match(/^([A-Za-z0-9.]+)/)?.[1])
      .filter(Boolean)
  );
  const printableCounters = Object.keys(issueRows).filter((counter) => failedCounters.has(counter) && issueRows[counter].length > 0);
  if (printableCounters.length === 0) {
    return;
  }

  console.log("\n## Failure Examples");
  for (const counter of printableCounters) {
    console.log(`\n### ${counter}`);
    for (const row of issueRows[counter].slice(0, 8)) {
      const label = [row.caseId, row.ticker, row.templateId, row.intent].filter(Boolean).join(" ");
      const fallback = [row.responsePath, row.fallbackKind, row.fallbackUserReason].filter(Boolean).join("/");
      console.log(`- ${label}${fallback ? ` (${fallback})` : ""}: ${row.answer}`);
    }
    if (issueRows[counter].length > 8) {
      console.log(`- ... ${issueRows[counter].length - 8} more`);
    }
  }
}
