import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { compareReviewRowsToSourceRows } from "./review-row-projection.mjs";

export const COMPLETE_HUMAN_REVIEW_STATEMENT =
  "I reviewed every row and its returned evidence, and I approve this exact packet for release quality evaluation.";

export function computeReviewContentSha256(packet) {
  const reviewContent = {
    version: packet?.version ?? null,
    sourceRun: packet?.sourceRun ?? null,
    sourceRunSha256: packet?.sourceRunSha256 ?? null,
    runId: packet?.runId ?? null,
    appVersion: packet?.appVersion ?? null,
    baseURL: packet?.baseURL ?? null,
    reviewPolicy: packet?.reviewPolicy ?? null,
    expectedTickerCount: packet?.expectedTickerCount ?? null,
    expectedTemplateCount: packet?.expectedTemplateCount ?? null,
    expectedRows: packet?.expectedRows ?? null,
    totalRows: packet?.totalRows ?? null,
    selectedRows: packet?.selectedRows ?? null,
    rows: Array.isArray(packet?.rows) ? packet.rows : []
  };
  return createHash("sha256").update(JSON.stringify(reviewContent)).digest("hex");
}

export function evaluateHumanReviewPacket(packet, options = {}) {
  const errors = [];
  const rows = Array.isArray(packet?.rows) ? packet.rows : [];
  const requireAttestation = options.requireAttestation !== false;

  errors.push(...compareReviewRowsToSourceRows(rows, options.sourceRows));

  if (packet?.version !== "human-review-packet-v2") {
    errors.push("packet_version_must_be_v2");
  }
  if (packet?.reviewPolicy !== "complete_release_review") {
    errors.push("review_policy_must_be_complete_release_review");
  }
  if (!Number.isInteger(packet?.totalRows) || packet.totalRows <= 0) {
    errors.push("total_rows_must_be_positive");
  }
  if (!Number.isInteger(packet?.expectedRows) || packet.expectedRows <= 0) {
    errors.push("expected_rows_must_be_positive");
  } else if (packet.totalRows !== packet.expectedRows) {
    errors.push("source_run_row_count_incomplete");
  }
  if (!Number.isInteger(packet?.expectedTickerCount) || packet.expectedTickerCount <= 0) {
    errors.push("expected_ticker_count_must_be_positive");
  }
  if (!Number.isInteger(packet?.expectedTemplateCount) || packet.expectedTemplateCount <= 0) {
    errors.push("expected_template_count_must_be_positive");
  }
  if (
    Number.isInteger(packet?.expectedTickerCount)
    && Number.isInteger(packet?.expectedTemplateCount)
    && packet.expectedRows !== packet.expectedTickerCount * packet.expectedTemplateCount
  ) {
    errors.push("expected_run_shape_inconsistent");
  }
  if (packet?.selectedRows !== packet?.totalRows || rows.length !== packet?.totalRows) {
    errors.push("all_source_rows_must_be_present");
  }
  if (!/^[a-f0-9]{64}$/u.test(String(packet?.sourceRunSha256 ?? ""))) {
    errors.push("source_run_sha256_missing_or_invalid");
  }
  for (const [field, expected] of [
    ["expectedRows", options.expectedRows],
    ["expectedTickerCount", options.expectedTickerCount],
    ["expectedTemplateCount", options.expectedTemplateCount]
  ]) {
    if (Number.isInteger(expected) && packet?.[field] !== expected) {
      errors.push(`${field}_must_equal_${expected}`);
    }
  }

  const seenCaseIds = new Set();
  const seenTickerTemplates = new Set();
  for (const [index, row] of rows.entries()) {
    const caseId = String(row?.caseId ?? "").trim();
    const prefix = caseId || `row_${index + 1}`;
    if (!caseId) {
      errors.push(`${prefix}:case_id_missing`);
    } else if (seenCaseIds.has(caseId)) {
      errors.push(`${prefix}:duplicate_case_id`);
    } else {
      seenCaseIds.add(caseId);
    }
    const ticker = String(row?.ticker ?? "").trim();
    const templateId = String(row?.templateId ?? "").trim();
    const tickerTemplate = `${ticker}|${templateId}`;
    if (!ticker || !templateId) {
      errors.push(`${prefix}:ticker_or_template_missing`);
    } else if (seenTickerTemplates.has(tickerTemplate)) {
      errors.push(`${prefix}:duplicate_ticker_template`);
    } else {
      seenTickerTemplates.add(tickerTemplate);
    }
    if (!packet?.runId || row?.runId !== packet.runId) errors.push(`${prefix}:run_id_mismatch`);
    if (!packet?.appVersion || row?.appVersion !== packet.appVersion) errors.push(`${prefix}:app_version_mismatch`);
    if (!packet?.baseURL || row?.baseURL !== packet.baseURL) errors.push(`${prefix}:base_url_mismatch`);

    const review = row?.review;
    if (review?.result !== "pass") errors.push(`${prefix}:review_result_not_pass`);
    if (!String(review?.reviewer ?? "").trim()) errors.push(`${prefix}:reviewer_missing`);
    if (!isValidIsoDate(review?.reviewedAt)) errors.push(`${prefix}:reviewed_at_invalid`);
    for (const field of [
      "numericAndPeriodCorrect",
      "sourceClaimsSupported",
      "intentComplete",
      "languageNatural",
      "fallbackTaxonomyHonest"
    ]) {
      if (review?.[field] !== true) errors.push(`${prefix}:${field}_not_true`);
    }
    if (!Array.isArray(review?.failureLabels) || review.failureLabels.length > 0) {
      errors.push(`${prefix}:failure_labels_not_empty`);
    }
  }

  const observedTickers = new Set(rows.map((row) => row?.ticker).filter(Boolean));
  const observedTemplates = new Set(rows.map((row) => row?.templateId).filter(Boolean));
  if (observedTickers.size !== packet?.expectedTickerCount) errors.push("observed_ticker_count_mismatch");
  if (observedTemplates.size !== packet?.expectedTemplateCount) errors.push("observed_template_count_mismatch");
  if (Array.isArray(options.expectedTickers) && !sameStringSet(observedTickers, options.expectedTickers)) {
    errors.push("observed_ticker_set_mismatch");
  }
  if (Array.isArray(options.expectedTemplates) && !sameStringSet(observedTemplates, options.expectedTemplates)) {
    errors.push("observed_template_set_mismatch");
  }

  const reviewContentSha256 = computeReviewContentSha256(packet);
  if (requireAttestation) {
    const attestation = packet?.reviewAttestation;
    if (attestation?.version !== "complete-human-review-signoff-v1") errors.push("review_attestation_version_invalid");
    if (attestation?.status !== "accepted") errors.push("review_attestation_not_accepted");
    if (!String(attestation?.reviewer ?? "").trim()) errors.push("review_attestation_reviewer_missing");
    if (!isValidIsoDate(attestation?.signedAt)) errors.push("review_attestation_signed_at_invalid");
    if (attestation?.statement !== COMPLETE_HUMAN_REVIEW_STATEMENT) errors.push("review_attestation_statement_invalid");
    if (attestation?.reviewedRows !== packet?.totalRows) errors.push("review_attestation_row_count_mismatch");
    if (attestation?.sourceRunSha256 !== packet?.sourceRunSha256) errors.push("review_attestation_source_digest_mismatch");
    if (attestation?.reviewContentSha256 !== reviewContentSha256) errors.push("review_attestation_content_digest_mismatch");
    const latestReviewedAt = Math.max(...rows.map((row) => Date.parse(row?.review?.reviewedAt ?? "")).filter(Number.isFinite));
    if (Number.isFinite(latestReviewedAt) && isValidIsoDate(attestation?.signedAt) && Date.parse(attestation.signedAt) < latestReviewedAt) {
      errors.push("review_attestation_precedes_row_review");
    }
  }

  return {
    ok: errors.length === 0,
    totalRows: packet?.totalRows ?? null,
    expectedRows: packet?.expectedRows ?? null,
    expectedTickerCount: packet?.expectedTickerCount ?? null,
    expectedTemplateCount: packet?.expectedTemplateCount ?? null,
    reviewedRows: rows.filter((row) => row?.review?.result === "pass").length,
    reviewContentSha256,
    reviewer: String(packet?.reviewAttestation?.reviewer ?? "").trim() || null,
    signedAt: packet?.reviewAttestation?.signedAt ?? null,
    errorCount: errors.length,
    errors
  };
}

export function sealHumanReviewPacket(packet, reviewer, signedAt = new Date().toISOString(), options = {}) {
  const normalizedReviewer = String(reviewer ?? "").trim();
  if (!normalizedReviewer) {
    throw new Error("reviewer is required to seal a human review packet");
  }
  const review = evaluateHumanReviewPacket(packet, { ...options, requireAttestation: false });
  if (!review.ok) {
    throw new Error(`cannot seal an incomplete review packet: ${review.errors.join(", ")}`);
  }
  return {
    ...packet,
    reviewAttestation: {
      version: "complete-human-review-signoff-v1",
      status: "accepted",
      reviewer: normalizedReviewer,
      signedAt,
      statement: COMPLETE_HUMAN_REVIEW_STATEMENT,
      reviewedRows: packet.totalRows,
      sourceRunSha256: packet.sourceRunSha256,
      reviewContentSha256: review.reviewContentSha256
    }
  };
}

export async function verifySourceRunDigest(packet, sourceRunOverride) {
  const sourceRun = sourceRunOverride ?? packet?.sourceRun;
  if (!sourceRun) return { ok: false, error: "source_run_path_missing" };
  try {
    const contents = await readFile(sourceRun);
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== packet.sourceRunSha256) {
      return { ok: false, error: "source_run_sha256_mismatch", sourceRun, expected: packet.sourceRunSha256, actual };
    }
    let rows;
    try {
      rows = contents.toString("utf8").split(/\r?\n/u).filter(Boolean).map(JSON.parse);
    } catch (error) {
      return { ok: false, error: "source_run_invalid_jsonl", sourceRun, sha256: actual, detail: String(error) };
    }
    return { ok: true, sourceRun, sha256: actual, rows };
  } catch (error) {
    return { ok: false, error: "source_run_unreadable", sourceRun, detail: String(error) };
  }
}

function isValidIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

async function main() {
  const args = process.argv.slice(2);
  const sealIndex = args.indexOf("--seal");
  if (sealIndex >= 0) {
    const packetPath = args[sealIndex + 1];
    const reviewer = args[sealIndex + 2];
    const sourceRunOverride = args[sealIndex + 3];
    if (!packetPath || !reviewer) {
      console.error("Usage: node human-review-gate.mjs --seal <review-packet.json> <reviewer> [source-run.jsonl]");
      process.exit(1);
    }
    const packet = JSON.parse(await readFile(packetPath, "utf8"));
    const source = await verifySourceRunDigest(packet, sourceRunOverride);
    if (!source.ok) {
      console.error(JSON.stringify({ ok: false, packetPath, source }, null, 2));
      process.exit(1);
    }
    const sealed = sealHumanReviewPacket(packet, reviewer, new Date().toISOString(), { sourceRows: source.rows });
    await writeFile(packetPath, `${JSON.stringify(sealed, null, 2)}\n`);
    console.log(JSON.stringify({
      ok: true,
      packetPath,
      reviewer: sealed.reviewAttestation.reviewer,
      signedAt: sealed.reviewAttestation.signedAt,
      reviewedRows: sealed.reviewAttestation.reviewedRows,
      sourceRunSha256: sealed.reviewAttestation.sourceRunSha256,
      reviewContentSha256: sealed.reviewAttestation.reviewContentSha256
    }, null, 2));
    return;
  }

  const [packetPath, sourceRunOverride] = args;
  if (!packetPath) {
    console.error("Usage: node human-review-gate.mjs <review-packet.json> [source-run.jsonl]");
    process.exit(1);
  }

  const packet = JSON.parse(await readFile(packetPath, "utf8"));
  const source = await verifySourceRunDigest(packet, sourceRunOverride);
  const review = evaluateHumanReviewPacket(packet, { sourceRows: source.rows });
  const reviewOutput = review.errors.length > 100
    ? { ...review, errors: review.errors.slice(0, 100), omittedErrors: review.errors.length - 100 }
    : review;
  const result = {
    ok: review.ok && source.ok,
    packetPath,
    review: reviewOutput,
    source: sourceResultForOutput(source)
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

function sameStringSet(observed, expectedValues) {
  const expected = new Set(expectedValues.map((value) => String(value)));
  return observed.size === expected.size && [...observed].every((value) => expected.has(String(value)));
}

function sourceResultForOutput(source) {
  const { rows: _rows, ...output } = source ?? {};
  return output;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
