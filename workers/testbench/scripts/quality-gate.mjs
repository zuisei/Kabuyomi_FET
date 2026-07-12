import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { buildBenchmarkSummary, collectQualityIssueRows, evaluateQualityGate, qualityGateThresholdsFromEnv } from "./benchmark-quality.mjs";
import { evaluateHumanReviewPacket, verifySourceRunDigest } from "./human-review-gate.mjs";
import { runMetadataLines } from "./run-output-metadata.mjs";
import { applyStandardReleaseProfile, STANDARD_RELEASE_PROFILE } from "./standard-release-profile.mjs";
import { evaluateReleaseCandidateRows } from "./release-candidate-evidence.mjs";

const args = process.argv.slice(2);
const runPath = positionalArguments(args)[0];
const humanReviewPacketPath = optionValue(args, "--human-review-packet")
  ?? process.env.KABUYOMI_HUMAN_REVIEW_PACKET?.trim()
  ?? null;
const allowPendingHumanReview = args.includes("--allow-pending-human-review");
const standardReleaseProfile = args.includes("--standard-release-profile");
const gateEvidencePath = optionValue(args, "--gate-evidence-output")
  ?? (runPath?.endsWith(".jsonl") ? `${runPath.slice(0, -6)}-gate.json` : `${runPath}.gate.json`);

if (!runPath) {
  console.error(
    "Usage: npm run testbench:gate -- ./testbench/runs/<run-id>.jsonl " +
    "[--human-review-packet ./testbench/runs/<packet>.json] [--allow-pending-human-review]"
  );
  process.exit(1);
}

const runContents = await readFile(runPath, "utf8");
const runSha256 = createHash("sha256").update(runContents).digest("hex");
const rows = runContents
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

if (rows.length === 0) {
  console.error("Run file is empty.");
  process.exit(1);
}

const thresholds = standardReleaseProfile
  ? applyStandardReleaseProfile(qualityGateThresholdsFromEnv())
  : qualityGateThresholdsFromEnv();
let calibratedAlternative = null;
let humanReview = null;
if (humanReviewPacketPath) {
  const packet = JSON.parse(await readFile(humanReviewPacketPath, "utf8"));
  const review = evaluateHumanReviewPacket(packet, {
    expectedRows: thresholds.minRows,
    expectedTickerCount: thresholds.minCompanyTickers,
    expectedTemplateCount: thresholds.requiredTemplates?.length || undefined,
    expectedTickers: standardReleaseProfile ? [...STANDARD_RELEASE_PROFILE.tickers] : undefined,
    expectedTemplates: standardReleaseProfile ? [...STANDARD_RELEASE_PROFILE.templates] : undefined,
    sourceRows: rows
  });
  const source = await verifySourceRunDigest(packet, runPath);
  const reviewOutput = review.errors.length > 100
    ? { ...review, errors: review.errors.slice(0, 100), omittedErrors: review.errors.length - 100 }
    : review;
  humanReview = { packetPath: humanReviewPacketPath, review: reviewOutput, source: sourceResultForOutput(source) };
  if (!review.ok || !source.ok) {
    console.error("# Human Review Gate\n");
    console.error(JSON.stringify(humanReview, null, 2));
    process.exit(1);
  }
  calibratedAlternative = {
    type: "complete_human_review_v2",
    verified: true,
    reviewedRows: review.reviewedRows,
    sourceRunSha256: source.sha256,
    reviewContentSha256: review.reviewContentSha256,
    reviewer: review.reviewer,
    signedAt: review.signedAt
  };
}

const summary = buildBenchmarkSummary(rows, { calibratedAlternative });
const qualityGate = evaluateQualityGate(summary, thresholds);
const expectedReleaseCandidateId = process.env.KABUYOMI_EXPECTED_RELEASE_CANDIDATE_ID?.trim() || null;
const releaseCandidate = expectedReleaseCandidateId
  ? evaluateReleaseCandidateRows(rows, expectedReleaseCandidateId)
  : null;
const candidateFailures = releaseCandidate?.errors.map((error) => `releaseCandidateEvidence=${error}`) ?? [];
const gate = {
  ...qualityGate,
  ok: qualityGate.ok && candidateFailures.length === 0,
  failures: [...qualityGate.failures, ...candidateFailures]
};

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
console.log(`evaluationCoverageMode: ${summary.evaluationCoverageMode}`);
console.log(`judgeRows: ${summary.judgeRows}/${summary.qualityRows}`);
console.log(`calibratedAlternative: ${summary.calibratedAlternative?.type ?? "none"}`);
console.log(`releaseProfile: ${standardReleaseProfile ? STANDARD_RELEASE_PROFILE.version : "diagnostic"}`);
console.log(`releaseCandidateId: ${releaseCandidate?.expectedReleaseCandidateId ?? "not-enforced"}`);
console.log(`releaseCandidateRows: ${releaseCandidate?.ok === true ? "MATCH" : releaseCandidate ? "MISMATCH" : "not-enforced"}`);
console.log(`rawEnglishSurfaced: ${summary.rawEnglishSurfaced}`);
console.log(`hybridEnglishJapaneseSurfaced: ${summary.hybridEnglishJapaneseSurfaced}`);
console.log(`genericBusinessModelAnswers: ${summary.genericBusinessModelAnswers}`);
console.log(`genericRevenueBreakdownAnswers: ${summary.genericRevenueBreakdownAnswers}`);
console.log(`misleadingRevenueDriverCauses: ${summary.misleadingRevenueDriverCauses}`);
console.log(`nonFinancialCashFlowBankLanguage: ${summary.nonFinancialCashFlowBankLanguage}`);
console.log(`metricOnlyImportantIntentAnswers: ${summary.metricOnlyImportantIntentAnswers}`);
console.log(`durabilityFollowupLostPriorDriver: ${summary.durabilityFollowupLostPriorDriver}`);
console.log(`q03Q04Q06FinalEvidenceMissing: ${summary.q03Q04Q06FinalEvidenceMissing}`);
console.log(`q05TypedMarginDirectionMissing: ${summary.q05TypedMarginDirectionMissing}`);
console.log(`q05CitedFactorMissing: ${summary.q05CitedFactorMissing}`);
console.log(`q07HistoricalLookupMissing: ${summary.q07HistoricalLookupMissing}`);
console.log(`q07SourcePeriodMismatch: ${summary.q07SourcePeriodMismatch}`);
console.log(`q07TypedClaimMappingMissing: ${summary.q07TypedClaimMappingMissing}`);
console.log(`q08CompletenessMissing: ${summary.q08CompletenessMissing}`);
console.log(`q08EvidenceMappingMissing: ${summary.q08EvidenceMappingMissing}`);
console.log(`q09CompletenessMissing: ${summary.q09CompletenessMissing}`);
console.log(`q09EvidenceMappingMissing: ${summary.q09EvidenceMappingMissing}`);
console.log(`q10CompletenessMissing: ${summary.q10CompletenessMissing}`);
console.log(`q10EvidenceMappingMissing: ${summary.q10EvidenceMappingMissing}`);
console.log(`numericDisplaySuspicious: ${summary.numericDisplaySuspicious}`);
console.log(`unsupportedDurabilityClassification: ${summary.unsupportedDurabilityClassification}`);
console.log(`unsupportedRiskOrLiquidityConclusion: ${summary.unsupportedRiskOrLiquidityConclusion}`);
console.log(`qualitySourceEvidenceWeak: ${summary.qualitySourceEvidenceWeak}`);
console.log(`fallbackTaxonomyIntentMismatch: ${summary.fallbackTaxonomyIntentMismatch}`);
console.log(`fallbackTaxonomyTupleMismatch: ${summary.fallbackTaxonomyTupleMismatch}`);
console.log(`fallbackKindNoneOnFallbackRows: ${summary.fallbackKindNoneOnFallbackRows}`);
console.log(`qualityLatency.p95: ${summary.qualityLatency.p95}`);

const pendingOnlyFailures = gate.failures.filter((failure) => failure.startsWith("evaluationCoverageMissing="));
const releaseBlockingFailures = gate.failures.filter((failure) => !failure.startsWith("evaluationCoverageMissing="));
if (!gate.ok && allowPendingHumanReview && !humanReviewPacketPath && pendingOnlyFailures.length > 0 && releaseBlockingFailures.length === 0) {
  await writeGateEvidence("PENDING_HUMAN_REVIEW");
  console.log("\nPENDING_HUMAN_REVIEW");
  console.log("Automated evidence passed, but this run is not release-complete until the exact 150-row packet is reviewed and sealed.");
  process.exit(0);
}

if (!gate.ok) {
  await writeGateEvidence("FAILED");
  console.log("\n## Failed");
  for (const failure of gate.failures) {
    console.log(`- ${failure}`);
  }
  printIssueExamples(rows, gate.failures);
  process.exit(1);
}

await writeGateEvidence("RELEASE_QUALITY_PASS");
console.log("\nRELEASE_QUALITY_PASS");
console.log(`calibratedAlternative=${summary.calibratedAlternative?.type ?? "model_judge_full"}`);
if (humanReview) {
  console.log(`humanReviewPacket=${humanReview.packetPath}`);
  console.log(`humanReviewContentSha256=${humanReview.review.reviewContentSha256}`);
}

function optionValue(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : null;
}

function positionalArguments(values) {
  const result = [];
  const optionsWithValues = new Set(["--human-review-packet", "--gate-evidence-output"]);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (optionsWithValues.has(value)) {
      index += 1;
    } else if (!value.startsWith("--")) {
      result.push(value);
    }
  }
  return result;
}

function sourceResultForOutput(source) {
  const { rows: _rows, ...output } = source ?? {};
  return output;
}

async function writeGateEvidence(status) {
  const evidence = {
    version: "testbench-quality-gate-evidence-v2",
    status,
    generatedAt: new Date().toISOString(),
    runPath,
    runSha256,
    humanReviewPacketPath,
    releaseCandidateId: releaseCandidate?.expectedReleaseCandidateId ?? null,
    releaseCandidate: releaseCandidate ?? null,
    evaluationCoverageMode: summary.evaluationCoverageMode,
    releaseProfile: standardReleaseProfile ? STANDARD_RELEASE_PROFILE.version : "diagnostic",
    calibratedAlternative: summary.calibratedAlternative,
    humanReview: humanReview ? {
      packetPath: humanReview.packetPath,
      ok: humanReview.review.ok && humanReview.source.ok,
      reviewedRows: humanReview.review.reviewedRows,
      reviewer: humanReview.review.reviewer,
      signedAt: humanReview.review.signedAt,
      sourceRunSha256: humanReview.source.sha256 ?? null,
      reviewContentSha256: humanReview.review.reviewContentSha256
    } : null,
    gate
  };
  await writeFile(gateEvidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`gateEvidence: ${gateEvidencePath}`);
}

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
