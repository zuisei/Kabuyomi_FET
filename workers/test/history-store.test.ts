import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec", () => ({
  fetchSubmissions: vi.fn(),
  fetchSubmissionsWithHistory: vi.fn(),
  listTickersByCik: vi.fn(),
  listSupportedFilings: vi.fn(),
  lookupTicker: vi.fn(),
  pickComparisonFiling: vi.fn().mockReturnValue(null),
  pickLatestSupportedFiling: vi.fn().mockReturnValue(null)
}));

import { backfillHistoricalFilings, loadHistoricalOverview, maybeBuildHistoricalChatResponse } from "../src/lib/history-store";
import type { FilingCacheRecord, FilingReference } from "../src/env";
import { fetchSubmissionsWithHistory, listSupportedFilings, lookupTicker } from "../src/clients/sec";
import { readHistoricalFinancialFactEvidence } from "../src/lib/chat/historical-financial-fact";

afterEach(() => {
  vi.clearAllMocks();
});

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          all: vi.fn().mockResolvedValue({ results: [] })
        })
      }),
      batch: vi.fn().mockResolvedValue([])
    },
    FILINGS_BUCKET: {
      get: vi.fn(),
      put: vi.fn(),
      head: vi.fn()
    }
  };
}

function makeHistoricalBindingsEnv() {
  return {
    DB: {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("SELECT filing_key FROM filings WHERE filing_key")) {
          return {
            bind: vi.fn(() => ({
              first: vi.fn().mockResolvedValue("existing")
            }))
          };
        }

        if (sql.includes("FROM metric_history")) {
          return {
            bind: vi.fn((subject: string) => ({
              all: vi.fn().mockResolvedValue({
                results:
                  subject === "0001067983"
                    ? [
                        {
                          filingKey: "v3:0001067983:3",
                          ticker: "BRK-B",
                          formType: "10-K",
                          filedAt: "2026-03-02",
                          periodOfReport: "2025-12-31",
                          periodEnd: "2025-12-31",
                          logicalName: "revenue",
                          value: 110,
                          unit: "USDm",
                          yoyPercent: 10,
                          sourceId: "S10"
                        },
                        {
                          filingKey: "v3:0001067983:1",
                          ticker: "BRK-A",
                          formType: "10-K",
                          filedAt: "2025-02-20",
                          periodOfReport: "2024-12-31",
                          periodEnd: "2024-12-31",
                          logicalName: "revenue",
                          value: 100,
                          unit: "USDm",
                          yoyPercent: 10,
                          sourceId: "S9"
                        },
                        {
                          filingKey: "v3:0001067983:2",
                          ticker: "BRK-A",
                          formType: "10-K",
                          filedAt: "2024-02-20",
                          periodOfReport: "2023-12-31",
                          periodEnd: "2023-12-31",
                          logicalName: "revenue",
                          value: 90,
                          unit: "USDm",
                          yoyPercent: 8,
                          sourceId: "S8"
                        }
                      ]
                    : []
              })
            }))
          };
        }

        if (sql.includes("FROM segment_highlights")) {
          return {
            bind: vi.fn((subject: string) => ({
              all: vi.fn().mockResolvedValue({
                results:
                  subject === "0001067983"
                    ? [
                        {
                          filingKey: "v3:0001067983:1",
                          ticker: "BRK-A",
                          formType: "10-K",
                          filedAt: "2025-02-20",
                          periodEnd: "2024-12-31",
                          dimension: "geography",
                          label: "米州",
                          summary: "保険料収入が伸びた",
                          sourceId: "S1"
                        }
                      ]
                    : []
              })
            }))
          };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      batch: vi.fn().mockResolvedValue([])
    },
    FILINGS_BUCKET: {
      get: vi.fn(async (key: string) => {
        const filingKey = key.replace(/^filings\//, "").replace(/\.json$/, "");
        const periodByKey: Record<string, { filedAt: string; periodEnd: string; value: number; sourceId: string }> = {
          "v3:0001067983:1": { filedAt: "2025-02-20", periodEnd: "2024-12-31", value: 100, sourceId: "S9" },
          "v3:0001067983:2": { filedAt: "2024-02-20", periodEnd: "2023-12-31", value: 90, sourceId: "S8" }
        };
        const entry = periodByKey[filingKey];
        if (!entry) return null;
        return {
          text: async () => JSON.stringify({
            filingKey,
            ticker: "BRK-A",
            companyName: "Berkshire Hathaway",
            cik: "0001067983",
            formType: "10-K",
            filedAt: entry.filedAt,
            periodOfReport: entry.periodEnd,
            primaryDocumentUrl: `https://example.com/${filingKey.at(-1)}`,
            mdaText: "",
            mdaTokenCount: 0,
            metrics: [{
              logicalName: "revenue",
              tagUsed: "Revenue",
              value: entry.value,
              unit: "USDm",
              periodEnd: entry.periodEnd,
              periodKind: "annual"
            }],
            sourceChunks: [{
              sourceId: entry.sourceId,
              sectionType: "xbrl_metric",
              sectionTitle: "Revenue",
              sourceLabel: "XBRL Revenue",
              text: `Revenue ${entry.value} USDm`,
              startOffset: 0,
              endOffset: 20,
              tagName: "Revenue",
              sortOrder: 1
            }],
            summary: { verdict: "", highlights: [], changes: [] },
            generatedAt: "2026-03-02T00:00:00Z",
            extractorVersion: "v3",
            promptVersion: "v2"
          })
        };
      }),
      put: vi.fn(),
      head: vi.fn().mockResolvedValue({ key: "archived" })
    }
  };
}

function makeFiling(
  ticker: string,
  formType: FilingReference["formType"],
  accessionNumber: string,
  periodOfReport: string
): FilingReference {
  return {
    ticker,
    companyName: `${ticker} Inc.`,
    cik: "0000000001",
    exchange: "Nasdaq",
    formType,
    accessionNumber,
    primaryDocument: `${accessionNumber}.htm`,
    filedAt: periodOfReport,
    periodOfReport
  };
}

describe("history backfill guardrails", () => {
  it("defaults to annual filings only", async () => {
    vi.mocked(lookupTicker).mockResolvedValue({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      exchange: "Nasdaq"
    });
    vi.mocked(fetchSubmissionsWithHistory).mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
    vi.mocked(listSupportedFilings).mockReturnValue([
      makeFiling("AAPL", "10-Q", "0001-01", "2026-03-31"),
      makeFiling("AAPL", "10-K", "0001-02", "2025-12-31"),
      makeFiling("AAPL", "10-K", "0001-03", "2024-12-31")
    ]);

    const ensureStoredFiling = vi.fn(async (filing: FilingReference) => ({ filingKey: `v1:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}` }));

    const result = await backfillHistoricalFilings(
      {
        tickers: ["AAPL"],
        years: 3,
        maxFilingsPerTicker: 2
      },
      makeEnv() as never,
      { extractorVersion: "v1" } as never,
      ensureStoredFiling as never
    );

    expect(result.forms).toEqual(["10-K"]);
    expect(ensureStoredFiling).toHaveBeenCalledTimes(2);
    expect(ensureStoredFiling.mock.calls.map((call) => call[0].formType)).toEqual(["10-K", "10-K"]);
  });

  it("caps total filings per run and returns cursors for continuation", async () => {
    vi.mocked(lookupTicker)
      .mockResolvedValueOnce({
        ticker: "AAPL",
        companyName: "Apple Inc.",
        cik: "0000320193",
        exchange: "Nasdaq"
      } as never)
      .mockResolvedValueOnce({
        ticker: "MSFT",
        companyName: "Microsoft Corp.",
        cik: "0000789019",
        exchange: "Nasdaq"
      } as never);
    vi.mocked(fetchSubmissionsWithHistory).mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
    vi.mocked(listSupportedFilings)
      .mockReturnValueOnce([
        makeFiling("AAPL", "10-K", "0001-01", "2025-12-31"),
        makeFiling("AAPL", "10-K", "0001-02", "2024-12-31")
      ])
      .mockReturnValueOnce([
        makeFiling("MSFT", "10-K", "0002-01", "2025-12-31"),
        makeFiling("MSFT", "10-K", "0002-02", "2024-12-31")
      ]);

    const ensureStoredFiling = vi.fn(async (filing: FilingReference) => ({ filingKey: `v1:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}` }));

    const result = await backfillHistoricalFilings(
      {
        tickers: ["AAPL", "MSFT"],
        years: 3,
        forms: ["10-K"],
        maxFilingsPerTicker: 2,
        maxTotalFilings: 2
      },
      makeEnv() as never,
      { extractorVersion: "v1" } as never,
      ensureStoredFiling as never
    );

    expect(result.maxTotalFilings).toBe(2);
    expect(result.totalCapReached).toBe(true);
    expect(ensureStoredFiling).toHaveBeenCalledTimes(2);
    expect(result.nextCursorByTicker).toEqual({
      MSFT: 0
    });
  });

  it("does not spend total-cap budget on already indexed filings", async () => {
    vi.mocked(lookupTicker).mockReset();
    vi.mocked(fetchSubmissionsWithHistory).mockReset();
    vi.mocked(listSupportedFilings).mockReset();
    vi.mocked(lookupTicker).mockResolvedValue({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      exchange: "Nasdaq"
    } as never);
    vi.mocked(fetchSubmissionsWithHistory).mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
    vi.mocked(listSupportedFilings).mockReturnValue([
      makeFiling("AAPL", "10-K", "0001-01", "2025-12-31"),
      makeFiling("AAPL", "10-K", "0001-02", "2024-12-31")
    ]);

    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            all: vi.fn().mockImplementation(async () => {
              if (!sql.includes("SELECT filing_key, ticker FROM filings")) {
                return { results: [] };
              }

              return {
                results: [
                  {
                    filing_key: "v1:0000000001:000101",
                    ticker: "AAPL"
                  }
                ]
              };
            }),
            first: vi.fn().mockImplementation(async () => {
              return null;
            })
          }))
        })),
        batch: vi.fn().mockResolvedValue([])
      },
      FILINGS_BUCKET: {
        get: vi.fn(),
        put: vi.fn(),
        head: vi.fn()
      }
    };
    const ensureStoredFiling = vi.fn(async (filing: FilingReference) => ({
      filingKey: `v1:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}`
    }));

    const result = await backfillHistoricalFilings(
      {
        tickers: ["AAPL"],
        years: 3,
        forms: ["10-K"],
        maxFilingsPerTicker: 2,
        maxTotalFilings: 1
      },
      env as never,
      { extractorVersion: "v1" } as never,
      ensureStoredFiling as never
    );

    expect(ensureStoredFiling).toHaveBeenCalledTimes(1);
    expect(ensureStoredFiling.mock.calls[0]?.[0].accessionNumber).toBe("0001-02");
    expect(result.processedFilings).toEqual([
      {
        ticker: "AAPL",
        filingKey: "v1:0000000001:000102"
      }
    ]);
    expect(result.skippedFilings).toEqual([
      {
        ticker: "AAPL",
        filingKey: "v1:0000000001:000101",
        reason: "already_indexed"
      }
    ]);
  });

  it("passes indexed filings through bounded storage when full content is requested", async () => {
    vi.mocked(lookupTicker).mockResolvedValue({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      exchange: "Nasdaq"
    });
    vi.mocked(fetchSubmissionsWithHistory).mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
    vi.mocked(listSupportedFilings).mockReturnValue([
      makeFiling("AAPL", "10-K", "0001-01", "2025-12-31"),
      makeFiling("AAPL", "10-K", "0001-02", "2024-12-31")
    ]);

    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue(sql.includes("SELECT filing_key, ticker FROM filings")
              ? { results: [{ filing_key: "v1:0000000001:000101", ticker: "AAPL" }] }
              : { results: [] }),
            first: vi.fn().mockResolvedValue(null)
          }))
        })),
        batch: vi.fn().mockResolvedValue([])
      },
      FILINGS_BUCKET: { get: vi.fn(), put: vi.fn(), head: vi.fn() }
    };
    const ensureStoredFiling = vi.fn(async (_filing: FilingReference) => ({
      filingKey: "v1:0000000001:000101",
      contentMode: "full"
    }));

    const result = await backfillHistoricalFilings(
      {
        tickers: ["AAPL"],
        years: 3,
        forms: ["10-K"],
        maxFilingsPerTicker: 2,
        maxTotalFilings: 1,
        contentMode: "full"
      },
      env as never,
      { extractorVersion: "v1" } as never,
      ensureStoredFiling as never
    );

    expect(ensureStoredFiling).toHaveBeenCalledTimes(1);
    expect(ensureStoredFiling.mock.calls[0]?.[0].accessionNumber).toBe("0001-01");
    expect(result.processedFilings).toEqual([{
      ticker: "AAPL",
      filingKey: "v1:0000000001:000101"
    }]);
    expect(result.skippedFilings).toEqual([]);
    expect(result.totalCapReached).toBe(true);
    expect(result.nextCursorByTicker).toEqual({ AAPL: 1 });
  });

  it("honors explicit total filing caps above the default batch size", async () => {
    vi.mocked(lookupTicker).mockImplementation(async (ticker: string) => ({
      ticker,
      companyName: `${ticker} Inc.`,
      cik: `0000${ticker}`,
      exchange: "Nasdaq"
    }) as never);
    vi.mocked(fetchSubmissionsWithHistory).mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
    vi.mocked(listSupportedFilings).mockImplementation((tickerRecord: { ticker: string }) => [
      makeFiling(tickerRecord.ticker, "10-K", `${tickerRecord.ticker}-01`, "2025-12-31")
    ]);

    const ensureStoredFiling = vi.fn(async (filing: FilingReference) => ({ filingKey: `v1:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}` }));

    const result = await backfillHistoricalFilings(
      {
        tickers: ["AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "BRK-B", "JPM", "WMT", "XOM"],
        years: 3,
        forms: ["10-K"],
        maxFilingsPerTicker: 1,
        maxTotalFilings: 20
      },
      makeEnv() as never,
      { extractorVersion: "v1" } as never,
      ensureStoredFiling as never
    );

    expect(result.maxTotalFilings).toBe(20);
    expect(result.totalCapReached).toBe(false);
    expect(ensureStoredFiling).toHaveBeenCalledTimes(10);
  });

  it("normalizes already-indexed filing rows to the current representative ticker", async () => {
    vi.mocked(lookupTicker).mockResolvedValue({
      ticker: "GOOG",
      companyName: "Alphabet Inc.",
      cik: "0001652044",
      exchange: "Nasdaq"
    } as never);
    vi.mocked(fetchSubmissionsWithHistory).mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
    vi.mocked(listSupportedFilings).mockReturnValue([
      {
        ...makeFiling("GOOG", "10-K", "0001652044-26-000018", "2025-12-31"),
        cik: "0001652044"
      }
    ]);

    const batch = vi.fn().mockResolvedValue([]);
    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn((...args: unknown[]) => ({
            sql,
            args,
            all: vi.fn().mockResolvedValue(
              sql.includes("SELECT filing_key, ticker FROM filings")
                ? {
                    results: [
                      {
                        filing_key: "v3:0001652044:000165204426000018",
                        ticker: "GOOGL"
                      }
                    ]
                  }
                : { results: [] }
            ),
            first: vi.fn().mockResolvedValue(
              sql.includes("SELECT filing_key, ticker FROM filings")
                ? {
                    filing_key: "v3:0001652044:000165204426000018",
                    ticker: "GOOGL"
                  }
                : null
            )
          }))
        })),
        batch
      },
      FILINGS_BUCKET: {
        get: vi.fn(),
        put: vi.fn(),
        head: vi.fn()
      }
    };

    const ensureStoredFiling = vi.fn();

    const result = await backfillHistoricalFilings(
      {
        tickers: ["GOOG"],
        years: 3,
        forms: ["10-K"],
        maxFilingsPerTicker: 1
      },
      env as never,
      { extractorVersion: "v3" } as never,
      ensureStoredFiling as never
    );

    expect(ensureStoredFiling).not.toHaveBeenCalled();
    expect(result.skippedFilings).toEqual([
      {
        ticker: "GOOG",
        filingKey: "v3:0001652044:000165204426000018",
        reason: "already_indexed"
      }
    ]);
    expect(batch).toHaveBeenCalledTimes(1);
    const statements = batch.mock.calls[0]?.[0] as Array<{ sql: string; args: unknown[] }>;
    expect(statements.map((statement) => statement.sql)).toEqual([
      "UPDATE filings SET ticker = ? WHERE filing_key = ?",
      "UPDATE metric_history SET ticker = ? WHERE filing_key = ?",
      "UPDATE segment_highlights SET ticker = ? WHERE filing_key = ?"
    ]);
    expect(statements.every((statement) => statement.args[0] === "GOOG")).toBe(true);
  });

  it("loads historical overview across class-share aliases via cik", async () => {
    const env = makeHistoricalBindingsEnv();
    const overview = await loadHistoricalOverview(
      {
        filingKey: "v3:0001067983:3",
        ticker: "BRK-B",
        companyName: "Berkshire Hathaway",
        cik: "0001067983",
        formType: "10-K",
        filedAt: "2026-03-02",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://www.sec.gov/Archives/test.htm",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [],
        sourceChunks: [],
        summary: { verdict: "", highlights: [], changes: [] },
        generatedAt: "2026-04-19T00:00:00.000Z",
        extractorVersion: "v3",
        promptVersion: "v2"
      },
      env as never
    );

    expect(overview?.comparisonBasis).toBe("annual");
    expect(overview?.series).toHaveLength(1);
    expect(overview?.series[0]?.points).toHaveLength(3);
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("substr(f.filing_key, 1, instr(f.filing_key, ':') - 1) = ?"));
  });

  it("loads historical chat evidence across class-share aliases via cik", async () => {
    const response = await maybeBuildHistoricalChatResponse(
      {
        filingKey: "v3:0001067983:3",
        ticker: "BRK-B",
        companyName: "Berkshire Hathaway",
        cik: "0001067983",
        formType: "10-K",
        filedAt: "2026-03-02",
        periodOfReport: "2025-12-31",
        primaryDocumentUrl: "https://www.sec.gov/Archives/test.htm",
        mdaText: "",
        mdaTokenCount: 0,
        metrics: [{
          logicalName: "revenue",
          tagUsed: "Revenue",
          value: 110,
          unit: "USDm",
          periodEnd: "2025-12-31",
          periodKind: "annual"
        }],
        sourceChunks: [{
          sourceId: "S10",
          sectionType: "xbrl_metric",
          sectionTitle: "Revenue",
          sourceLabel: "XBRL Revenue",
          text: "Revenue 110 USDm",
          startOffset: 0,
          endOffset: 17,
          tagName: "Revenue",
          sortOrder: 1
        }],
        summary: { verdict: "", highlights: [], changes: [] },
        generatedAt: "2026-04-19T00:00:00.000Z",
        extractorVersion: "v3",
        promptVersion: "v2"
      },
      "この3年の売上推移と地域要因は？",
      makeHistoricalBindingsEnv() as never
    );

    expect(response).not.toBeNull();
    expect(response?.sources.length).toBeGreaterThan(0);
  });

  it("refuses Q07 comparisons when typed duration scopes are incompatible", async () => {
    const current: FilingCacheRecord = {
      filingKey: "v6:0000320193:current",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      formType: "10-Q",
      filedAt: "2026-01-30",
      periodOfReport: "2025-12-27",
      primaryDocumentUrl: "https://example.com/current",
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [{
        logicalName: "revenue",
        tagUsed: "Revenue",
        value: 143_756_000_000,
        unit: "USD",
        periodStart: "2025-09-28",
        periodEnd: "2025-12-27",
        periodKind: "quarter"
      }],
      sourceChunks: [{
        sourceId: "S9", sectionType: "xbrl_metric", sectionTitle: "Revenue", sourceLabel: "XBRL Revenue",
        text: "Revenue 143756000000 USD", startOffset: 0, endOffset: 24, tagName: "Revenue", sortOrder: 1
      }],
      summary: { verdict: "", highlights: [], changes: [] },
      generatedAt: "2026-01-30T00:00:00Z",
      extractorVersion: "v6",
      promptVersion: "v2"
    };
    const prior: FilingCacheRecord = {
      ...current,
      filingKey: "v6:0000320193:prior",
      filedAt: "2025-08-01",
      periodOfReport: "2025-06-28",
      primaryDocumentUrl: "https://example.com/prior",
      metrics: [{
        ...current.metrics[0]!,
        value: 260_000_000_000,
        periodStart: "2024-09-29",
        periodEnd: "2025-06-28",
        periodKind: "year_to_date"
      }]
    };
    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(
              sql.includes("period_of_report < ?")
                ? {
                    filingKey: prior.filingKey,
                    filedAt: prior.filedAt,
                    periodOfReport: prior.periodOfReport,
                    primaryDocumentUrl: prior.primaryDocumentUrl
                  }
                : "existing"
            ),
            all: vi.fn().mockResolvedValue({ results: [] })
          }))
        })),
        batch: vi.fn().mockResolvedValue([])
      },
      FILINGS_BUCKET: {
        head: vi.fn().mockResolvedValue({ key: "existing" }),
        get: vi.fn().mockResolvedValue({ text: async () => JSON.stringify(prior) }),
        put: vi.fn().mockResolvedValue(undefined)
      }
    };

    const response = await maybeBuildHistoricalChatResponse(
      current,
      "前回決算と比べて大きく変わった点は？",
      env as never
    );

    expect(response).toBeNull();
  });

  it("does not treat a prewarmed prior-year 10-Q as the immediate prior filing", async () => {
    const current: FilingCacheRecord = {
      filingKey: "v7:0001018724:current",
      ticker: "AMZN",
      companyName: "Amazon.com, Inc.",
      cik: "0001018724",
      formType: "10-Q",
      filedAt: "2026-04-30",
      periodOfReport: "2026-03-31",
      primaryDocumentUrl: "https://example.com/current",
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [{
        logicalName: "revenue",
        tagUsed: "Revenue",
        value: 181_519_000_000,
        unit: "USD",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        periodKind: "quarter"
      }],
      sourceChunks: [{
        sourceId: "S1", sectionType: "xbrl_metric", sectionTitle: "Revenue", sourceLabel: "XBRL Revenue",
        text: "Revenue 181519000000 USD", startOffset: 0, endOffset: 24, tagName: "Revenue", sortOrder: 1
      }],
      summary: { verdict: "", highlights: [], changes: [] },
      generatedAt: "2026-04-30T00:00:00Z",
      extractorVersion: "v7",
      promptVersion: "v2"
    };
    const prior: FilingCacheRecord = {
      ...current,
      filingKey: "v7:0001018724:prior-year",
      filedAt: "2025-05-02",
      periodOfReport: "2025-03-31",
      primaryDocumentUrl: "https://example.com/prior-year",
      metrics: [{
        ...current.metrics[0]!,
        value: 155_667_000_000,
        periodStart: "2025-01-01",
        periodEnd: "2025-03-31"
      }]
    };
    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(
              sql.includes("period_of_report < ?")
                ? {
                    filingKey: prior.filingKey,
                    filedAt: prior.filedAt,
                    periodOfReport: prior.periodOfReport,
                    primaryDocumentUrl: prior.primaryDocumentUrl
                  }
                : "existing"
            ),
            all: vi.fn().mockResolvedValue({ results: [] })
          }))
        })),
        batch: vi.fn().mockResolvedValue([])
      },
      FILINGS_BUCKET: {
        head: vi.fn().mockResolvedValue({ key: "existing" }),
        get: vi.fn().mockResolvedValue({ text: async () => JSON.stringify(prior) }),
        put: vi.fn().mockResolvedValue(undefined)
      }
    };

    const response = await maybeBuildHistoricalChatResponse(
      current,
      "前回決算と比べて大きく変わった点は？",
      env as never
    );

    expect(response).toBeNull();
  });

  it("uses archived typed facts and excludes unlike quarters and YTD rows from a three-year trend", async () => {
    const makeRecord = ({
      filingKey,
      filedAt,
      periodEnd,
      periodStart,
      periodKind,
      value
    }: {
      filingKey: string;
      filedAt: string;
      periodEnd: string;
      periodStart: string;
      periodKind: "quarter" | "year_to_date";
      value: number;
    }): FilingCacheRecord => ({
      filingKey,
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      formType: "10-Q",
      filedAt,
      periodOfReport: periodEnd,
      primaryDocumentUrl: `https://example.com/${filingKey.split(":").at(-1)}`,
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [{
        logicalName: "revenue",
        tagUsed: "Revenue",
        value,
        unit: "USD",
        periodStart,
        periodEnd,
        periodKind
      }],
      sourceChunks: [{
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "Revenue",
        sourceLabel: "XBRL Revenue",
        text: `Revenue ${value} USD`,
        startOffset: 0,
        endOffset: 24,
        tagName: "Revenue",
        sortOrder: 1
      }],
      summary: { verdict: "", highlights: [], changes: [] },
      generatedAt: "2026-01-30T00:00:00Z",
      extractorVersion: "v6",
      promptVersion: "v2"
    });
    const current = makeRecord({
      filingKey: "v6:0000320193:current",
      filedAt: "2026-01-30",
      periodEnd: "2025-12-27",
      periodStart: "2025-09-28",
      periodKind: "quarter",
      value: 143_756_000_000
    });
    const wrongSeason = makeRecord({
      filingKey: "v6:0000320193:wrong-season",
      filedAt: "2025-10-31",
      periodEnd: "2025-09-27",
      periodStart: "2025-06-29",
      periodKind: "quarter",
      value: 130_000_000_000
    });
    const incompatibleYtd = makeRecord({
      filingKey: "v6:0000320193:ytd",
      filedAt: "2025-01-31",
      periodEnd: "2024-12-28",
      periodStart: "2024-03-31",
      periodKind: "year_to_date",
      value: 250_000_000_000
    });
    const comparableQuarter = makeRecord({
      filingKey: "v6:0000320193:comparable",
      filedAt: "2024-02-02",
      periodEnd: "2023-12-30",
      periodStart: "2023-10-01",
      periodKind: "quarter",
      value: 119_580_000_000
    });
    const archived = new Map([
      [wrongSeason.filingKey, wrongSeason],
      [incompatibleYtd.filingKey, incompatibleYtd],
      [comparableQuarter.filingKey, comparableQuarter]
    ]);
    const rows = [current, wrongSeason, incompatibleYtd, comparableQuarter].map((record) => ({
      filingKey: record.filingKey,
      ticker: record.ticker,
      formType: record.formType,
      filedAt: record.filedAt,
      periodOfReport: record.periodOfReport,
      periodEnd: record.metrics[0]!.periodEnd,
      logicalName: "revenue",
      value: record.metrics[0]!.value,
      unit: record.metrics[0]!.unit,
      yoyPercent: null,
      sourceId: "S9",
      primaryDocumentUrl: record.primaryDocumentUrl
    }));
    const env = {
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(sql.includes("SELECT filing_key FROM filings WHERE filing_key") ? "existing" : null),
            all: vi.fn().mockResolvedValue({ results: sql.includes("FROM metric_history") ? rows : [] })
          }))
        })),
        batch: vi.fn().mockResolvedValue([])
      },
      FILINGS_BUCKET: {
        head: vi.fn().mockResolvedValue({ key: "existing" }),
        get: vi.fn(async (key: string) => {
          const record = archived.get(key.replace(/^filings\//, "").replace(/\.json$/, ""));
          return record ? { text: async () => JSON.stringify(record) } : null;
        }),
        put: vi.fn().mockResolvedValue(undefined)
      }
    };

    const response = await maybeBuildHistoricalChatResponse(current, "この3年の売上推移は？", env as never);

    expect(response?.answer).toContain("2025年12月27日");
    expect(response?.answer).toContain("2023年12月30日");
    expect(response?.answer).not.toContain("2025年9月27日");
    expect(response?.answer).not.toContain("2024年12月28日");
    expect(response?.sources).toHaveLength(2);
    expect(response?.sources.every((source) => readHistoricalFinancialFactEvidence(source))).toBe(true);
  });
});
