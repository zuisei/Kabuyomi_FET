import { describe, expect, it } from "vitest";
import { resolveHardIntentRetrievalMode } from "../src/lib/chat/hard-intent-retrieval";

// @ts-ignore testbench helper is an ESM script consumed by Node, not part of the TS Worker build.
const quality = await import("../testbench/scripts/benchmark-quality.mjs");

describe("benchmark infra and quality metric separation", () => {
  it("marks rate_limit rows as infra errors and excludes them from quality metrics", () => {
    const row = quality.decorateBenchmarkRow(makeRow({ geminiApiErrorKind: "rate_limit" }));

    expect(row.infraError).toBe(true);
    expect(row.infraErrorKind).toBe("rate_limit");
    expect(row.qualityEvaluable).toBe(false);
    expect(row.excludedFromQualityMetricsReason).toBe("rate_limit");
  });

  it("counts rate_limit fallback rows in raw fallback but not quality fallback", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({ caseId: "AAPL-Q03", responsePath: "fallback", fallbackKind: "api_error", geminiApiErrorKind: "rate_limit" }),
      makeRow({ caseId: "AAPL-Q04", responsePath: "fallback", fallbackKind: "evidence_slot" }),
      makeRow({ caseId: "AAPL-Q05", responsePath: "gemini", fallbackKind: "none" })
    ]);

    expect(summary.rawFallbackTotal).toBe(2);
    expect(summary.qualityRows).toBe(2);
    expect(summary.qualityFallbackTotal).toBe(1);
    expect(summary.rateLimitRows).toBe(1);
  });

  it("marks a run infra contaminated when rate limits exceed the threshold", () => {
    const summary = quality.buildBenchmarkSummary(
      [
        makeRow({ caseId: "AAPL-Q01", geminiApiErrorKind: "rate_limit" }),
        makeRow({ caseId: "AAPL-Q02", geminiApiErrorKind: "rate_limit" }),
        makeRow({ caseId: "AAPL-Q03", geminiApiErrorKind: "rate_limit" }),
        makeRow({ caseId: "AAPL-Q04", geminiApiErrorKind: "rate_limit" })
      ],
      { rateLimitThreshold: 3 }
    );

    expect(summary.infraContaminated).toBe(true);
    expect(summary.infraContaminationReasons).toContain("rate_limit_rows>3");
  });

  it("keeps retry-success rows quality evaluable while preserving retry audit fields", () => {
    const row = quality.decorateBenchmarkRow(
      makeRow({
        benchmarkAttemptCount: 2,
        benchmarkRateLimitRetryCount: 1,
        benchmarkRateLimitBackoffMsTotal: 5000,
        rateLimitRetrySucceeded: true
      })
    );
    const summary = quality.buildBenchmarkSummary([row]);

    expect(row.qualityEvaluable).toBe(true);
    expect(row.rateLimitRetrySucceeded).toBe(true);
    expect(summary.qualityRows).toBe(1);
    expect(summary.rateLimitRetrySucceeded).toBe(1);
    expect(summary.benchmarkRateLimitRetryCount).toBe(1);
  });

  it("excludes retry-failure rows after all rate-limit attempts", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        responsePath: "fallback",
        fallbackKind: "api_error",
        geminiApiErrorKind: "rate_limit",
        benchmarkAttemptCount: 3,
        benchmarkRateLimitRetryCount: 2,
        rateLimitRetrySucceeded: false
      })
    ]);

    expect(summary.rawFallbackTotal).toBe(1);
    expect(summary.qualityRows).toBe(0);
    expect(summary.qualityFallbackTotal).toBe(0);
    expect(summary.rateLimitRows).toBe(1);
  });

  it("treats auth_error as infra contamination, not answer quality failure", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({ responsePath: "fallback", fallbackKind: "api_error", geminiApiErrorKind: "auth_error" })
    ]);

    expect(summary.authErrorRows).toBe(1);
    expect(summary.infraContaminated).toBe(true);
    expect(summary.qualityRows).toBe(0);
    expect(summary.qualityFallbackTotal).toBe(0);
  });

  it("keeps active hard retrieval disabled by default", () => {
    expect(resolveHardIntentRetrievalMode(undefined)).not.toBe("active");
  });
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    caseId: "AAPL-Q03",
    ticker: "AAPL",
    templateId: "Q03",
    intent: "revenue_driver",
    responsePath: "gemini",
    fallbackKind: "none",
    sourceIdsValid: true,
    latencyMs: 100,
    failureLabelsObserved: [],
    answerQualityFlags: [],
    sourceGateFailureLabels: [],
    bannedFallbackPhraseHits: [],
    ...overrides
  };
}
