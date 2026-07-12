import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// @ts-ignore testbench helper is an ESM script consumed by Node, not part of the TS Worker build.
const reviewGate = await import("../testbench/scripts/human-review-gate.mjs");
// @ts-ignore testbench helper is an ESM script consumed by Node, not part of the TS Worker build.
const reviewProjection = await import("../testbench/scripts/review-row-projection.mjs");

describe("complete human review gate", () => {
  it("passes only a complete, signed-off review packet", () => {
    const sourceRows = makeSourceRows();
    const result = reviewGate.evaluateHumanReviewPacket(makePacket(sourceRows), { sourceRows });

    expect(result.ok).toBe(true);
    expect(result.reviewedRows).toBe(1);
  });

  it("fails sampling or an omitted source row", () => {
    const sourceRows = makeSourceRows();
    const packet = makePacket(sourceRows);
    packet.expectedRows = 2;
    packet.expectedTickerCount = 2;
    packet.totalRows = 2;

    const result = reviewGate.evaluateHumanReviewPacket(packet, { sourceRows });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("all_source_rows_must_be_present");
  });

  it("fails when the source JSONL itself has fewer rows than its run metadata", () => {
    const sourceRows = makeSourceRows();
    const packet = makePacket(sourceRows);
    packet.expectedRows = 2;
    packet.expectedTickerCount = 2;

    const result = reviewGate.evaluateHumanReviewPacket(packet, { sourceRows });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("source_run_row_count_incomplete");
  });

  it("fails an incomplete or failed review dimension", () => {
    const sourceRows = makeSourceRows();
    const packet = makePacket(sourceRows);
    packet.rows[0].review.sourceClaimsSupported = false;
    packet.rows[0].review.result = "fail";
    packet.rows[0].review.failureLabels = ["unsupported_claim"];

    const result = reviewGate.evaluateHumanReviewPacket(packet, { sourceRows });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("AAPL-Q03:review_result_not_pass");
    expect(result.errors).toContain("AAPL-Q03:sourceClaimsSupported_not_true");
    expect(result.errors).toContain("AAPL-Q03:failure_labels_not_empty");
  });

  it("fails duplicate cases and missing reviewer provenance", () => {
    const sourceRows = makeSourceRows();
    const packet = makePacket(sourceRows);
    packet.expectedRows = 2;
    packet.expectedTickerCount = 2;
    packet.totalRows = 2;
    packet.selectedRows = 2;
    packet.rows = [packet.rows[0], structuredClone(packet.rows[0])];
    packet.rows[1].review.reviewer = null;

    const result = reviewGate.evaluateHumanReviewPacket(packet, { sourceRows: [sourceRows[0], sourceRows[0]] });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("AAPL-Q03:duplicate_case_id");
    expect(result.errors).toContain("AAPL-Q03:reviewer_missing");
  });

  it("fails an unsigned packet and detects review-content tampering after signoff", () => {
    const sourceRows = makeSourceRows();
    const unsigned = makeUnsignedPacket(sourceRows);
    expect(reviewGate.evaluateHumanReviewPacket(unsigned, { sourceRows }).errors).toContain("review_attestation_not_accepted");

    const sealed = makePacket(sourceRows);
    sealed.rows[0].review.notes = "changed after signoff";
    expect(reviewGate.evaluateHumanReviewPacket(sealed, { sourceRows }).errors).toContain("review_attestation_content_digest_mismatch");
  });

  it("rejects packet answer or source substitution before sealing", () => {
    const sourceRows = makeSourceRows();
    const packet = makeUnsignedPacket(sourceRows);
    packet.rows[0].answer = "置き換えられた回答です。";
    packet.rows[0].sources = [{ sourceId: "FAKE", sourceLabel: "Substituted evidence", excerpt: "not from the run" }];

    expect(reviewGate.evaluateHumanReviewPacket(packet, {
      sourceRows,
      requireAttestation: false
    }).errors).toContain("AAPL-Q03:source_run_projection_mismatch");
    expect(() => reviewGate.sealHumanReviewPacket(
      packet,
      "release-owner",
      "2026-07-12T12:05:00.000Z",
      { sourceRows }
    )).toThrow(/source_run_projection_mismatch/);
  });

  it("never validates or seals a packet without the exact source-run rows", () => {
    const sourceRows = makeSourceRows();
    const packet = makeUnsignedPacket(sourceRows);

    expect(reviewGate.evaluateHumanReviewPacket(packet, { requireAttestation: false }).errors)
      .toContain("source_run_rows_required_for_projection_verification");
    expect(() => reviewGate.sealHumanReviewPacket(
      packet,
      "release-owner",
      "2026-07-12T12:05:00.000Z"
    )).toThrow(/source_run_rows_required_for_projection_verification/);
  });

  it("can enforce the exact 15 by 10 release matrix", () => {
    const sourceRows = makeSourceRows();
    const result = reviewGate.evaluateHumanReviewPacket(makePacket(sourceRows), {
      expectedRows: 150,
      expectedTickerCount: 15,
      expectedTemplateCount: 10,
      sourceRows
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "expectedRows_must_equal_150",
      "expectedTickerCount_must_equal_15",
      "expectedTemplateCount_must_equal_10"
    ]));
  });

  it("keeps live CI two-phase and uses only the protected automation secret", () => {
    const workflow = readFileSync(resolve(process.cwd(), "../.github/workflows/live-test-worker-benchmark.yml"), "utf8");
    const fullSmoke = readFileSync(resolve(process.cwd(), "testbench/scripts/run-full-smoke.mjs"), "utf8");

    expect(workflow).toContain("Generate live evidence (pending human review)");
    expect(workflow).toContain("Verify sealed 150-row release evidence");
    expect(workflow).toContain("secrets.KABUYOMI_TEST_AUTOMATION_SECRET");
    expect(workflow).not.toContain("dev_unlimited");
    expect(workflow).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
    expect(fullSmoke).toContain("PENDING_HUMAN_REVIEW");
    expect(fullSmoke).toContain("RELEASE_COMPLETE");
    expect(fullSmoke).toContain("--human-review-packet");
    expect(fullSmoke).toContain("--standard-release-profile");
  });
});

function makePacket(sourceRows = makeSourceRows()): any {
  return reviewGate.sealHumanReviewPacket(
    makeUnsignedPacket(sourceRows),
    "release-owner",
    "2026-07-12T12:05:00.000Z",
    { sourceRows }
  );
}

function makeUnsignedPacket(sourceRows = makeSourceRows()): any {
  const tickers = new Set(sourceRows.map((row: any) => row.ticker));
  const templates = new Set(sourceRows.map((row: any) => row.templateId));
  return {
    version: "human-review-packet-v2",
    reviewPolicy: "complete_release_review",
    runId: "release-run",
    appVersion: "worker-version",
    baseURL: "https://test.example.com",
    expectedTickerCount: tickers.size,
    expectedTemplateCount: templates.size,
    expectedRows: sourceRows.length,
    sourceRun: "./testbench/runs/example.jsonl",
    sourceRunSha256: "a".repeat(64),
    totalRows: sourceRows.length,
    selectedRows: sourceRows.length,
    reviewAttestation: {
      version: "complete-human-review-signoff-v1",
      status: "pending",
      reviewer: null,
      signedAt: null,
      statement: reviewGate.COMPLETE_HUMAN_REVIEW_STATEMENT,
      reviewedRows: 0,
      sourceRunSha256: "a".repeat(64),
      reviewContentSha256: null
    },
    rows: sourceRows.map((row: any) => ({
      ...reviewProjection.createReviewPacketRow(row),
      review: {
          reviewer: "release-reviewer",
          reviewedAt: "2026-07-12T12:00:00.000Z",
          result: "pass",
          numericAndPeriodCorrect: true,
          sourceClaimsSupported: true,
          intentComplete: true,
          languageNatural: true,
          fallbackTaxonomyHonest: true,
          failureLabels: [],
          notes: null
      }
    }))
  };
}

function makeSourceRows(): any[] {
  return [{
    runId: "release-run",
    appVersion: "worker-version",
    baseURL: "https://test.example.com",
    caseId: "AAPL-Q03",
    ticker: "AAPL",
    templateId: "Q03",
    intent: "revenue_driver",
    question: "売上の主な要因は？",
    answer: "iPhoneとサービスの売上が増収要因です。",
    sourceIdsValid: true,
    sourceCount: 1,
    sources: [{
      sourceId: "S1",
      sourceLabel: "10-Q revenue discussion",
      sectionType: "md_a",
      excerpt: "iPhone and Services net sales increased during the period."
    }],
    selectedSourceIds: ["S1"],
    selectedSourceLabels: ["10-Q revenue discussion"],
    selectedSourceExcerpts: ["iPhone and Services net sales increased during the period."],
    goldChecklist: ["company-specific driver"],
    failureLabelsObserved: [],
    numericAlignmentLabels: [],
    answerQualityFlags: [],
    finalizerGuardLabels: [],
    languageGuardViolationLabels: [],
    semanticQualityLabels: [],
    sourceRepairLabels: []
  }];
}
