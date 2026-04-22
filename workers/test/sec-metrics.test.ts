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

const mockFetchMetricsFromFetcher = vi.mocked(fetchMetricsFromFetcher);

afterEach(() => {
  vi.clearAllMocks();
});

describe("fetchMetricSnapshots revenue precedence", () => {
  it("prefers total Revenues over contract-only revenue when both are present", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 2_746_642_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2025-01-01",
                end: "2025-12-31"
              },
              {
                val: 1_676_253_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2024-01-01",
                end: "2024-12-31"
              }
            ]
          }
        },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [
              {
                val: 109_820_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2025-01-01",
                end: "2025-12-31"
              },
              {
                val: 15_169_000,
                form: "10-K",
                filed: "2026-03-09",
                start: "2024-01-01",
                end: "2024-12-31"
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
      {
        cik: "0001876042",
        ticker: "CRCL",
        companyName: "Circle Internet Group, Inc.",
        exchange: "NYSE",
        formType: "10-K",
        accessionNumber: "0001876042-26-000062",
        primaryDocument: "crcl-20251231.htm",
        filedAt: "2026-03-09",
        periodOfReport: "2024-12-31"
      },
      {} as never
    );

    expect(metrics.find((metric) => metric.logicalName === "revenue")).toMatchObject({
      tagUsed: "Revenues",
      value: 2_746_642_000,
      comparisonValue: 1_676_253_000
    });
  });

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
