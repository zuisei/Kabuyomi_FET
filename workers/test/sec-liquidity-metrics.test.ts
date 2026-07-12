import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec-fetcher", () => ({
  fetchFilingAssetsFromFetcher: vi.fn(),
  fetchFilingHtmlFromFetcher: vi.fn(),
  fetchMetricsFromFetcher: vi.fn(),
  fetchPreparedFilingFromFetcher: vi.fn(),
  fetchSubmissionsFromFetcher: vi.fn(),
  fetchTickerSnapshotFromFetcher: vi.fn()
}));

import { fetchMetricSnapshots } from "../src/clients/sec";
import { fetchMetricsFromFetcher } from "../src/clients/sec-fetcher";
import type { FilingReference, MetricSnapshot } from "../src/env";
import { selectIntentMetrics } from "../src/lib/chat/context-metrics";
import { buildSourceChunks } from "../src/lib/filings/ingest";

const mockFetchMetricsFromFetcher = vi.mocked(fetchMetricsFromFetcher);

const currentFiling: FilingReference = {
  cik: "0000320193",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  exchange: "Nasdaq",
  formType: "10-Q",
  accessionNumber: "0000320193-26-000057",
  primaryDocument: "aapl-20260627.htm",
  filedAt: "2026-07-31",
  periodOfReport: "2026-06-27"
};

afterEach(() => {
  vi.clearAllMocks();
});

function metric(metrics: MetricSnapshot[], logicalName: MetricSnapshot["logicalName"]): MetricSnapshot | undefined {
  return metrics.find((candidate) => candidate.logicalName === logicalName);
}

describe("typed SEC period metadata", () => {
  it("preserves duration metadata for the current and comparative facts", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 101_000_000_000,
                start: "2026-03-29",
                end: "2026-06-27",
                filed: currentFiling.filedAt,
                form: "10-Q",
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3",
                frame: "CY2026Q2"
              },
              {
                val: 94_000_000_000,
                start: "2025-03-30",
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: "10-Q",
                accn: currentFiling.accessionNumber,
                // SEC comparative contexts embedded in the current filing
                // carry the current filing's FY metadata.
                fy: 2026,
                fp: "Q3",
                frame: "CY2025Q2"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);

    expect(metric(metrics, "revenue")).toMatchObject({
      periodStart: "2026-03-29",
      periodEnd: "2026-06-27",
      periodKind: "quarter",
      fiscalYear: 2026,
      fiscalQuarter: "Q3",
      comparisonValue: 94_000_000_000,
      comparisonPeriodStart: "2025-03-30",
      comparisonPeriodEnd: "2025-06-27",
      comparisonPeriodKind: "quarter",
      comparisonFiscalYear: 2025,
      comparisonFiscalQuarter: "Q3"
    });
  });

  it("does not invent fiscal metadata when SEC facts omit or malform it", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        NetIncomeLoss: {
          units: {
            USD: [
              {
                val: 24_000_000_000,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 12,
                fp: "H1"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);
    const netIncome = metric(metrics, "netIncome");

    expect(netIncome).toBeDefined();
    expect(netIncome).not.toHaveProperty("fiscalYear");
    expect(netIncome).not.toHaveProperty("fiscalQuarter");
  });

  it("does not emit an ordinary YoY percentage when current and comparison values cross zero", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        NetIncomeLoss: {
          units: {
            USD: [
              {
                val: 1_000_000_000,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: -2_570_000_000,
                start: "2025-03-30",
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2025,
                fp: "Q3"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);
    const netIncome = metric(metrics, "netIncome");

    expect(netIncome).toMatchObject({
      value: 1_000_000_000,
      comparisonValue: -2_570_000_000
    });
    expect(netIncome).not.toHaveProperty("yoyPercent");
  });

  it("does not emit YoY when a prior-period loss reaches exactly zero", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        OperatingIncomeLoss: {
          units: {
            USD: [
              {
                val: 0,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: -500_000_000,
                start: "2025-03-30",
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);
    const operatingIncome = metric(metrics, "operatingIncome");

    expect(operatingIncome).toMatchObject({ value: 0, comparisonValue: -500_000_000 });
    expect(operatingIncome).not.toHaveProperty("yoyPercent");
  });

  it("preserves a distinct prior-filing source identity when same-filing comparison is unavailable", async () => {
    const priorFiling: FilingReference = {
      ...currentFiling,
      accessionNumber: "0000320193-25-000079",
      primaryDocument: "aapl-20250628.htm",
      filedAt: "2025-08-01",
      periodOfReport: "2025-06-28"
    };
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 101_000_000_000,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 94_000_000_000,
                start: "2025-03-30",
                end: priorFiling.periodOfReport,
                filed: priorFiling.filedAt,
                form: priorFiling.formType,
                accn: priorFiling.accessionNumber,
                fy: 2025,
                fp: "Q3"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, priorFiling, {} as never);
    const revenue = metric(metrics, "revenue");
    const priorUrl = "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250628.htm";

    expect(revenue).toMatchObject({
      comparisonValue: 94_000_000_000,
      comparisonPeriodEnd: priorFiling.periodOfReport,
      comparisonAccessionNumber: priorFiling.accessionNumber,
      comparisonSourceUrl: priorUrl
    });

    const chunks = buildSourceChunks(currentFiling, "", metrics);
    const currentChunk = chunks.find((chunk) => chunk.tagName === "Revenues" && chunk.metricRole === "current");
    const comparisonChunk = chunks.find((chunk) => chunk.tagName === "Revenues" && chunk.metricRole === "comparison");
    expect(currentChunk).toMatchObject({
      filingAccessionNumber: currentFiling.accessionNumber,
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000057/aapl-20260627.htm"
    });
    expect(currentChunk?.text).not.toContain("94000000000");
    expect(comparisonChunk).toMatchObject({
      filingAccessionNumber: priorFiling.accessionNumber,
      sourceUrl: priorUrl,
      periodEnd: priorFiling.periodOfReport
    });
    expect(comparisonChunk?.sourceId).not.toBe(currentChunk?.sourceId);
  });

  it("does not label a two-year-old annual fact as an ordinary YoY comparison", async () => {
    const annualFiling: FilingReference = {
      ...currentFiling,
      formType: "10-K",
      accessionNumber: "0000320193-26-000120",
      primaryDocument: "annual-20260131.htm",
      filedAt: "2026-03-20",
      periodOfReport: "2026-01-31"
    };
    const staleAnnualFiling: FilingReference = {
      ...annualFiling,
      accessionNumber: "0000320193-24-000120",
      primaryDocument: "annual-20240203.htm",
      filedAt: "2024-03-22",
      periodOfReport: "2024-02-03"
    };
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 400_000_000_000,
                start: "2025-02-02",
                end: annualFiling.periodOfReport,
                filed: annualFiling.filedAt,
                form: annualFiling.formType,
                accn: annualFiling.accessionNumber,
                fy: 2026,
                fp: "FY"
              },
              {
                val: 350_000_000_000,
                start: "2023-02-05",
                end: staleAnnualFiling.periodOfReport,
                filed: staleAnnualFiling.filedAt,
                form: staleAnnualFiling.formType,
                accn: staleAnnualFiling.accessionNumber,
                fy: 2024,
                fp: "FY"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const revenue = metric(
      await fetchMetricSnapshots(annualFiling, staleAnnualFiling, {} as never),
      "revenue"
    );

    expect(revenue).toMatchObject({ value: 400_000_000_000, periodKind: "annual" });
    expect(revenue).not.toHaveProperty("comparisonValue");
    expect(revenue).not.toHaveProperty("comparisonSourceUrl");
    expect(revenue).not.toHaveProperty("yoyPercent");
  });

  it("keeps different current and comparison concepts distinct even within one filing", () => {
    const sameFilingUrl = "https://www.sec.gov/Archives/edgar/data/320193/000032019326000057/aapl-20260627.htm";
    const chunks = buildSourceChunks(currentFiling, "", [{
      logicalName: "revenue",
      tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
      value: 101_000_000_000,
      unit: "USD",
      periodStart: "2026-03-29",
      periodEnd: currentFiling.periodOfReport,
      periodKind: "quarter",
      comparisonValue: 94_000_000_000,
      comparisonTagUsed: "SalesRevenueNet",
      comparisonPeriodStart: "2025-03-30",
      comparisonPeriodEnd: "2025-06-27",
      comparisonPeriodKind: "quarter",
      comparisonSourceUrl: sameFilingUrl,
      comparisonAccessionNumber: currentFiling.accessionNumber
    }], { primaryDocumentUrl: sameFilingUrl });

    expect(chunks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metricRole: "current",
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sourceUrl: sameFilingUrl
      }),
      expect.objectContaining({
        metricRole: "comparison",
        tagName: "SalesRevenueNet",
        sourceUrl: sameFilingUrl
      })
    ]));
    expect(chunks[0]?.text).not.toContain("94000000000");
  });

  it("drops a comparison whose SEC fiscal period does not match the current fact", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 101_000_000_000,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 94_000_000_000,
                start: "2025-03-30",
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q2"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const revenue = metric(await fetchMetricSnapshots(currentFiling, null, {} as never), "revenue");
    expect(revenue).toBeDefined();
    expect(revenue).not.toHaveProperty("comparisonValue");
    expect(revenue).not.toHaveProperty("yoyPercent");
  });

  it("never treats a plain USD amount as EPS or compares mixed EPS units", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        EarningsPerShareBasic: {
          units: {
            "USD/shares": [{
              val: 1.55,
              start: "2026-03-29",
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber,
              fy: 2026,
              fp: "Q3"
            }],
            USD: [
              {
                val: 1.40,
                start: "2025-03-30",
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 9_999,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const eps = metric(await fetchMetricSnapshots(currentFiling, null, {} as never), "epsBasic");
    expect(eps).toMatchObject({ value: 1.55, unit: "USD/shares" });
    expect(eps).not.toHaveProperty("comparisonValue");
  });

  it("does not compare different XBRL concepts merely because they share a logical label", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        Revenues: {
          units: {
            USD: [{
              val: 101_000_000_000,
              start: "2026-03-29",
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber,
              fy: 2026,
              fp: "Q3"
            }]
          }
        },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [{
              val: 4_000_000_000,
              start: "2025-03-30",
              end: "2025-06-27",
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber,
              fy: 2026,
              fp: "Q3"
            }]
          }
        }
      },
      companyFacts: null
    });

    const revenue = metric(await fetchMetricSnapshots(currentFiling, null, {} as never), "revenue");
    expect(revenue).toMatchObject({ tagUsed: "Revenues", value: 101_000_000_000 });
    expect(revenue).not.toHaveProperty("comparisonValue");
    expect(revenue).not.toHaveProperty("yoyPercent");
  });

  it("does not compare materially different duration spans that both look quarterly", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        Revenues: {
          units: {
            USD: [
              {
                val: 101_000_000_000,
                start: "2026-02-27",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 94_000_000_000,
                start: "2025-04-28",
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const revenue = metric(await fetchMetricSnapshots(currentFiling, null, {} as never), "revenue");
    expect(revenue).toBeDefined();
    expect(revenue).not.toHaveProperty("comparisonValue");
    expect(revenue).not.toHaveProperty("yoyPercent");
  });

  it("keeps a preferred valid concept ahead of a lower-priority concept with a closer duration score", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        Revenues: {
          units: {
            USD: [{
              val: 101_000_000_000,
              start: "2026-03-29",
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber,
              fy: 2026,
              fp: "Q3"
            }]
          }
        },
        RevenueFromContractWithCustomerExcludingAssessedTax: {
          units: {
            USD: [{
              val: 4_000_000_000,
              start: "2026-03-19",
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber,
              fy: 2026,
              fp: "Q3"
            }]
          }
        }
      },
      companyFacts: null
    });

    expect(metric(await fetchMetricSnapshots(currentFiling, null, {} as never), "revenue")).toMatchObject({
      tagUsed: "Revenues",
      value: 101_000_000_000
    });
  });

  it("searches the current exact concept when resolving its comparison", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        SalesRevenueNet: {
          units: {
            USD: [
              {
                val: 101_000_000_000,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 94_000_000_000,
                start: "2025-03-30",
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              }
            ]
          }
        },
        Revenues: {
          units: {
            USD: [{
              val: 5_000_000_000,
              start: "2025-03-20",
              end: "2025-06-27",
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber,
              fy: 2026,
              fp: "Q3"
            }]
          }
        }
      },
      companyFacts: null
    });

    expect(metric(await fetchMetricSnapshots(currentFiling, null, {} as never), "revenue")).toMatchObject({
      tagUsed: "SalesRevenueNet",
      comparisonTagUsed: "SalesRevenueNet",
      comparisonValue: 94_000_000_000
    });
  });
});

describe("10-Q operating cash-flow periods", () => {
  it("classifies Q1 operating cash flow as the exact quarter for both current and comparison facts", async () => {
    const q1Filing: FilingReference = {
      ...currentFiling,
      accessionNumber: "0000320193-26-000004",
      primaryDocument: "aapl-20251227.htm",
      filedAt: "2026-01-30",
      periodOfReport: "2025-12-27"
    };
    const priorQ1Filing: FilingReference = {
      ...currentFiling,
      accessionNumber: "0000320193-25-000004",
      primaryDocument: "aapl-20241228.htm",
      filedAt: "2025-01-31",
      periodOfReport: "2024-12-28"
    };
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              {
                val: 41_000_000_000,
                start: "2025-09-28",
                end: q1Filing.periodOfReport,
                accn: q1Filing.accessionNumber,
                fy: 2026,
                fp: "Q1",
                form: "10-Q",
                filed: q1Filing.filedAt
              },
              {
                val: 39_000_000_000,
                start: "2024-09-29",
                end: priorQ1Filing.periodOfReport,
                accn: priorQ1Filing.accessionNumber,
                fy: 2025,
                fp: "Q1",
                form: "10-Q",
                filed: priorQ1Filing.filedAt
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(q1Filing, priorQ1Filing, {} as never);

    expect(metric(metrics, "operatingCashFlow")).toMatchObject({
      value: 41_000_000_000,
      periodStart: "2025-09-28",
      periodEnd: "2025-12-27",
      periodKind: "quarter",
      fiscalYear: 2026,
      fiscalQuarter: "Q1",
      comparisonValue: 39_000_000_000,
      comparisonPeriodStart: "2024-09-29",
      comparisonPeriodEnd: "2024-12-28",
      comparisonPeriodKind: "quarter",
      comparisonFiscalYear: 2025,
      comparisonFiscalQuarter: "Q1"
    });
  });

  it("keeps a live-shaped Q2 YTD cash-flow fact and its prior-filing comparison", async () => {
    const q2Filing: FilingReference = {
      ...currentFiling,
      accessionNumber: "0000320193-26-000013",
      primaryDocument: "aapl-20260328.htm",
      filedAt: "2026-05-01",
      periodOfReport: "2026-03-28"
    };
    const priorQ2Filing: FilingReference = {
      ...currentFiling,
      accessionNumber: "0000320193-25-000057",
      primaryDocument: "aapl-20250329.htm",
      filedAt: "2025-05-02",
      periodOfReport: "2025-03-29"
    };
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              {
                val: 82_627_000_000,
                start: "2025-09-28",
                end: "2026-03-28",
                accn: "0000320193-26-000013",
                fy: 2026,
                fp: "Q2",
                form: "10-Q",
                filed: "2026-05-01"
              },
              {
                val: 53_887_000_000,
                start: "2024-09-29",
                end: "2025-03-29",
                accn: "0000320193-25-000057",
                fy: 2025,
                fp: "Q2",
                form: "10-Q",
                filed: "2025-05-02"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(q2Filing, priorQ2Filing, {} as never);

    expect(metric(metrics, "operatingCashFlow")).toMatchObject({
      value: 82_627_000_000,
      periodStart: "2025-09-28",
      periodEnd: "2026-03-28",
      periodKind: "year_to_date",
      fiscalYear: 2026,
      fiscalQuarter: "Q2",
      comparisonValue: 53_887_000_000,
      comparisonPeriodStart: "2024-09-29",
      comparisonPeriodEnd: "2025-03-29",
      comparisonPeriodKind: "year_to_date",
      comparisonFiscalYear: 2025,
      comparisonFiscalQuarter: "Q2"
    });
  });

  it("prefers the Q3 YTD operating cash flow while keeping income metrics discrete-quarter", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              {
                val: 28_000_000_000,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 81_754_000_000,
                start: "2025-09-28",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              }
            ]
          }
        },
        NetIncomeLoss: {
          units: {
            USD: [
              {
                val: 24_000_000_000,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 70_000_000_000,
                start: "2025-09-28",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);

    expect(metric(metrics, "operatingCashFlow")).toMatchObject({
      value: 81_754_000_000,
      periodStart: "2025-09-28",
      periodKind: "year_to_date"
    });
    expect(metric(metrics, "netIncome")).toMatchObject({
      value: 24_000_000_000,
      periodStart: "2026-03-29",
      periodKind: "quarter"
    });
  });

  it("omits a Q2 cash-flow candidate that is only a discrete quarter despite Q2 metadata", async () => {
    const q2Filing: FilingReference = {
      ...currentFiling,
      filedAt: "2026-05-01",
      periodOfReport: "2026-03-28"
    };
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        NetCashProvidedByUsedInOperatingActivities: {
          units: {
            USD: [
              {
                val: 28_000_000_000,
                start: "2025-12-28",
                end: q2Filing.periodOfReport,
                filed: q2Filing.filedAt,
                form: q2Filing.formType,
                accn: q2Filing.accessionNumber,
                fy: 2026,
                fp: "Q2"
              },
              {
                val: 99_000_000_000,
                start: "2025-06-29",
                end: q2Filing.periodOfReport,
                filed: q2Filing.filedAt,
                form: q2Filing.formType,
                accn: q2Filing.accessionNumber,
                fy: 2026,
                fp: "Q4"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(q2Filing, null, {} as never);
    expect(metric(metrics, "operatingCashFlow")).toBeUndefined();
  });
});

describe("typed SEC liquidity metrics", () => {
  it("selects exact consolidated instant concepts and preserves comparison metadata", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        CashAndCashEquivalentsAtCarryingValue: {
          units: {
            USD: [
              {
                val: 32_000_000_000,
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 29_000_000_000,
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2025,
                fp: "Q3"
              }
            ]
          }
        },
        LongTermDebtCurrent: {
          units: {
            USD: [
              {
                val: 10_500_000_000,
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 12_000_000_000,
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2025,
                fp: "Q3"
              }
            ]
          }
        },
        LongTermDebtNoncurrent: {
          units: {
            USD: [
              {
                val: 82_000_000_000,
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2026,
                fp: "Q3"
              },
              {
                val: 90_000_000_000,
                end: "2025-06-27",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber,
                fy: 2025,
                fp: "Q3"
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);

    expect(metric(metrics, "cashAndCashEquivalents")).toMatchObject({
      tagUsed: "CashAndCashEquivalentsAtCarryingValue",
      value: 32_000_000_000,
      periodEnd: currentFiling.periodOfReport,
      periodKind: "instant",
      fiscalYear: 2026,
      fiscalQuarter: "Q3",
      comparisonValue: 29_000_000_000,
      comparisonPeriodEnd: "2025-06-27",
      comparisonPeriodKind: "instant",
      comparisonFiscalYear: 2025,
      comparisonFiscalQuarter: "Q3"
    });
    expect(metric(metrics, "cashAndCashEquivalents")).not.toHaveProperty("periodStart");
    expect(metric(metrics, "currentDebt")).toMatchObject({
      tagUsed: "LongTermDebtCurrent",
      value: 10_500_000_000,
      periodKind: "instant",
      comparisonValue: 12_000_000_000
    });
    expect(metric(metrics, "longTermDebt")).toMatchObject({
      tagUsed: "LongTermDebtNoncurrent",
      value: 82_000_000_000,
      periodKind: "instant",
      comparisonValue: 90_000_000_000
    });
  });

  it("rejects wrong form, accession, period, unit, and duration-shaped instant candidates", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        CashAndCashEquivalentsAtCarryingValue: {
          units: {
            USD: [
              {
                val: 1,
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: "10-K",
                accn: currentFiling.accessionNumber
              },
              {
                val: 2,
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: "0000320193-26-999999"
              },
              {
                val: 3,
                end: "2026-03-28",
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber
              },
              {
                val: 4,
                start: "2026-03-29",
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber
              }
            ],
            shares: [
              {
                val: 5,
                end: currentFiling.periodOfReport,
                filed: currentFiling.filedAt,
                form: currentFiling.formType,
                accn: currentFiling.accessionNumber
              }
            ]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);
    expect(metric(metrics, "cashAndCashEquivalents")).toBeUndefined();
  });

  it("prefers the exact liquidity tags and omits broader or mismatched concepts", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        CashAndCashEquivalentsAtCarryingValue: {
          units: {
            USD: [{
              val: 20_000_000_000,
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber
            }]
          }
        },
        CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents: {
          units: {
            USD: [{
              val: 99_000_000_000,
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber
            }]
          }
        },
        ShortTermBorrowings: {
          units: {
            USD: [{
              val: 8_000_000_000,
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber
            }]
          }
        },
        LongTermDebtAndFinanceLeaseObligationsCurrent: {
          units: {
            USD: [{
              val: 11_000_000_000,
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber
            }]
          }
        },
        LongTermDebtAndFinanceLeaseObligationsNoncurrent: {
          units: {
            USD: [{
              val: 77_000_000_000,
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: currentFiling.accessionNumber
            }]
          }
        }
      },
      companyFacts: null
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);

    expect(metric(metrics, "cashAndCashEquivalents")?.value).toBe(20_000_000_000);
    expect(metric(metrics, "currentDebt")).toBeUndefined();
    expect(metric(metrics, "longTermDebt")).toBeUndefined();
    expect(metrics.some((candidate) => /RestrictedCash|FinanceLease|ShortTermBorrowings/.test(candidate.tagUsed))).toBe(false);
  });

  it("falls back from invalid concept candidates to an exact companyfacts fact", async () => {
    mockFetchMetricsFromFetcher.mockResolvedValue({
      concepts: {
        LongTermDebtNoncurrent: {
          units: {
            USD: [{
              val: 999_000_000_000,
              end: currentFiling.periodOfReport,
              filed: currentFiling.filedAt,
              form: currentFiling.formType,
              accn: "0000320193-26-999999"
            }]
          }
        }
      },
      companyFacts: {
        facts: {
          "us-gaap": {
            LongTermDebtNoncurrent: {
              units: {
                USD: [{
                  val: 84_000_000_000,
                  end: currentFiling.periodOfReport,
                  filed: currentFiling.filedAt,
                  form: currentFiling.formType,
                  accn: currentFiling.accessionNumber,
                  fy: 2026,
                  fp: "Q3"
                }]
              }
            }
          }
        }
      }
    });

    const metrics = await fetchMetricSnapshots(currentFiling, null, {} as never);

    expect(metric(metrics, "longTermDebt")).toMatchObject({
      tagUsed: "LongTermDebtNoncurrent",
      value: 84_000_000_000,
      periodKind: "instant",
      fiscalYear: 2026,
      fiscalQuarter: "Q3"
    });
  });
});

describe("liquidity metric context routing", () => {
  const metrics: MetricSnapshot[] = [
    {
      logicalName: "cashAndCashEquivalents",
      tagUsed: "CashAndCashEquivalentsAtCarryingValue",
      value: 32_000_000_000,
      unit: "USD",
      periodEnd: currentFiling.periodOfReport,
      periodKind: "instant"
    },
    {
      logicalName: "currentDebt",
      tagUsed: "LongTermDebtCurrent",
      value: 10_500_000_000,
      unit: "USD",
      periodEnd: currentFiling.periodOfReport,
      periodKind: "instant"
    },
    {
      logicalName: "longTermDebt",
      tagUsed: "LongTermDebtNoncurrent",
      value: 82_000_000_000,
      unit: "USD",
      periodEnd: currentFiling.periodOfReport,
      periodKind: "instant"
    },
    {
      logicalName: "operatingCashFlow",
      tagUsed: "NetCashProvidedByUsedInOperatingActivities",
      value: 81_754_000_000,
      unit: "USD",
      periodStart: "2025-09-28",
      periodEnd: currentFiling.periodOfReport,
      periodKind: "year_to_date",
      fiscalYear: 2026,
      fiscalQuarter: "Q3"
    },
    {
      logicalName: "revenue",
      tagUsed: "Revenues",
      value: 101_000_000_000,
      unit: "USD",
      periodStart: "2026-03-29",
      periodEnd: currentFiling.periodOfReport,
      periodKind: "quarter"
    }
  ];

  it("exposes exact cash and debt balances to liquidity questions", () => {
    expect(selectIntentMetrics(metrics, "liquidity_debt").map((candidate) => candidate.logicalName)).toEqual([
      "cashAndCashEquivalents",
      "currentDebt",
      "longTermDebt",
      "operatingCashFlow"
    ]);
  });

  it("adds the cash balance, but not debt balances, to cash-flow questions", () => {
    expect(selectIntentMetrics(metrics, "cash_flow").map((candidate) => candidate.logicalName)).toEqual([
      "cashAndCashEquivalents",
      "operatingCashFlow",
      "revenue"
    ]);
  });

  it("creates distinct citable XBRL source IDs for each typed liquidity balance", () => {
    const liquidityMetrics = selectIntentMetrics(metrics, "liquidity_debt");
    const chunks = buildSourceChunks(currentFiling, "", liquidityMetrics);

    expect(chunks.map((chunk) => ({ sourceId: chunk.sourceId, tagName: chunk.tagName }))).toEqual([
      { sourceId: "S1", tagName: "CashAndCashEquivalentsAtCarryingValue" },
      { sourceId: "S2", tagName: "LongTermDebtCurrent" },
      { sourceId: "S3", tagName: "LongTermDebtNoncurrent" },
      { sourceId: "S4", tagName: "NetCashProvidedByUsedInOperatingActivities" }
    ]);
  });
});
