import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec", () => ({
  fetchSubmissions: vi.fn(),
  listSupportedFilings: vi.fn(),
  lookupTicker: vi.fn(),
  pickComparisonFiling: vi.fn().mockReturnValue(null)
}));

import { backfillHistoricalFilings } from "../src/lib/history-store";
import type { FilingReference } from "../src/env";
import { fetchSubmissions, listSupportedFilings, lookupTicker } from "../src/clients/sec";

afterEach(() => {
  vi.clearAllMocks();
});

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null)
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
    vi.mocked(fetchSubmissions).mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
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
    vi.mocked(fetchSubmissions).mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
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
});
