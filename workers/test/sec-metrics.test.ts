import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec-fetcher", () => ({
  fetchFilingAssetsFromFetcher: vi.fn(),
  fetchFilingHtmlFromFetcher: vi.fn(),
  fetchMetricsFromFetcher: vi.fn(),
  fetchSubmissionsFromFetcher: vi.fn(),
  fetchTickerSnapshotFromFetcher: vi.fn()
}));

import { fetchMetricSnapshots } from "../src/clients/sec";
import { fetchMetricsFromFetcher } from "../src/clients/sec-fetcher";
import { REVENUE_REGRESSION_CASES } from "./fixtures/sec-metric-regressions";

const mockFetchMetricsFromFetcher = vi.mocked(fetchMetricsFromFetcher);

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchMetricSnapshots revenue precedence", () => {
  for (const testCase of REVENUE_REGRESSION_CASES) {
    it(testCase.name, async () => {
      mockFetchMetricsFromFetcher.mockResolvedValue(testCase.payload);

      const metrics = await fetchMetricSnapshots(
        testCase.currentFiling,
        testCase.comparisonFiling,
        {} as never
      );

      expect(metrics.find((metric) => metric.logicalName === "revenue")).toMatchObject(testCase.expected);
    });
  }

  it("falls back to contract-only revenue when total revenue tags are absent", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              {
                val: 109_820_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2025-01-01",
                end: "2025-12-31"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(
      {
        cik: "0001876042",
        ticker: "CRCL",
        companyName: "Circle Internet Group, Inc.",
        exchange: "NYSE",
        formType: "10-K",
        accessionNumber: "0001876042-26-000062",
        primaryDocument: "crcl-20251231.htm",
        filedAt: "2026-03-09",
        periodOfReport: "2025-12-31"
      },
      null,
      {} as never
    );

    expect(metrics.find((metric) => metric.logicalName === "revenue")).toMatchObject({
      tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
      value: 109_820_000
    });
  });
});
