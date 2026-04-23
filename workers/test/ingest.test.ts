import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec", () => ({
  buildPrimaryDocumentUrl: vi.fn(() => "https://www.sec.gov/Archives/test.htm"),
  fetchFilingAssets: vi.fn(),
  fetchMetricSnapshots: vi.fn()
}));

vi.mock("../src/clients/gemini", () => ({
  generateSummary: vi.fn(async () => ({
    summary: {
      verdict: "metrics only",
      highlights: [],
      changes: []
    },
    provider: "fallback"
  }))
}));

import type { FilingReference, MetricSnapshot } from "../src/env";
import { generateSummary } from "../src/clients/gemini";
import { buildPrimaryDocumentUrl, fetchFilingAssets, fetchMetricSnapshots } from "../src/clients/sec";
import { ingestFiling } from "../src/lib/filings/ingest";

afterEach(() => {
  vi.clearAllMocks();
});

function makeFiling(): FilingReference {
  return {
    cik: "0000320193",
    ticker: "AAPL",
    companyName: "Apple Inc.",
    exchange: "Nasdaq",
    formType: "10-K",
    accessionNumber: "0000320193-26-000001",
    primaryDocument: "a10k.htm",
    filedAt: "2026-01-30",
    periodOfReport: "2025-09-27"
  };
}

function makeMetric(logicalName: MetricSnapshot["logicalName"]): MetricSnapshot {
  return {
    logicalName,
    tagUsed: logicalName,
    value: 100,
    unit: "USDm",
    periodEnd: "2025-09-27",
    comparisonValue: 90,
    yoyPercent: 11.1
  };
}

describe("ingestFiling metrics-only mode", () => {
  it("skips HTML extraction and uses metrics-only source chunks", async () => {
    vi.mocked(fetchMetricSnapshots).mockResolvedValue([
      makeMetric("revenue"),
      makeMetric("operatingIncome")
    ]);

    const record = await ingestFiling(
      makeFiling(),
      null,
      {} as never,
      { extractorVersion: "v3", promptVersion: "v2" } as never,
      { summaryMode: "fallback_only", contentMode: "metrics_only" }
    );

    expect(fetchMetricSnapshots).toHaveBeenCalledTimes(1);
    expect(fetchFilingAssets).not.toHaveBeenCalled();
    expect(buildPrimaryDocumentUrl).toHaveBeenCalledTimes(1);
    expect(generateSummary).toHaveBeenCalledTimes(1);
    expect(record.mdaText).toBe("");
    expect(record.mdaTokenCount).toBe(0);
    expect(record.sourceChunks.every((chunk) => chunk.sectionType === "xbrl_metric")).toBe(true);
    expect(record.metrics).toHaveLength(2);
    expect(record.contentMode).toBe("metrics_only");
  });
});
