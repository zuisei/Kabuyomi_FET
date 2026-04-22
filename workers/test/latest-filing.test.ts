import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec", () => ({
  fetchSubmissions: vi.fn(),
  lookupTicker: vi.fn(),
  pickComparisonFiling: vi.fn(),
  pickLatestSupportedFiling: vi.fn(),
  buildFilingKey: vi.fn((extractorVersion: string, filing: { cik: string; accessionNumber: string }) =>
    `${extractorVersion}:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}`
  )
}));

vi.mock("../src/lib/history-store", () => ({
  loadArchivedFilingByKey: vi.fn()
}));

vi.mock("../src/lib/filings/cache", () => ({
  buildCacheKey: vi.fn((extractorVersion: string, cik: string, accessionNumber: string) =>
    `filing_cache:${extractorVersion}:${cik}:${accessionNumber.replaceAll("-", "")}`
  ),
  buildTickerAliasKeys: vi.fn(() => []),
  isCurrentCacheRecord: vi.fn(() => true),
  loadCachedLatestFiling: vi.fn()
}));

vi.mock("../src/lib/filings/history-persistence", () => ({
  enqueueHistoricalPersistence: vi.fn()
}));

vi.mock("../src/lib/filings/ingest", () => ({
  ingestFiling: vi.fn()
}));

vi.mock("../src/lib/filings/lock", () => ({
  acquireFilingLock: vi.fn(async () => async () => {})
}));

import { fetchSubmissions, pickComparisonFiling, pickLatestSupportedFiling } from "../src/clients/sec";
import { loadArchivedFilingByKey } from "../src/lib/history-store";
import { loadCachedLatestFiling } from "../src/lib/filings/cache";
import { ingestFiling } from "../src/lib/filings/ingest";
import { ensureLatestFiling } from "../src/lib/filings/latest";

const mockFetchSubmissions = vi.mocked(fetchSubmissions);
const mockPickComparisonFiling = vi.mocked(pickComparisonFiling);
const mockPickLatestSupportedFiling = vi.mocked(pickLatestSupportedFiling);
const mockLoadArchivedFilingByKey = vi.mocked(loadArchivedFilingByKey);
const mockLoadCachedLatestFiling = vi.mocked(loadCachedLatestFiling);
const mockIngestFiling = vi.mocked(ingestFiling);

describe("ensureLatestFiling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reingests when forceRemoteCheck is enabled instead of returning a stale cache record", async () => {
    const tickerRecord = {
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      cik: "0001876042",
      exchange: "NYSE"
    };
    const currentFiling = {
      cik: "0001876042",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      exchange: "NYSE",
      formType: "10-K",
      accessionNumber: "0001876042-26-000062",
      primaryDocument: "crcl-20251231.htm",
      filedAt: "2026-03-09",
      periodOfReport: "2025-12-31"
    };
    const ingestedRecord = {
      filingKey: "v4:0001876042:000187604226000062",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      cik: "0001876042",
      formType: "10-K",
      filedAt: "2026-03-09",
      periodOfReport: "2025-12-31",
      primaryDocumentUrl: "https://example.com/crcl-20251231.htm",
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [],
      sourceChunks: [],
      summary: { verdict: "", highlights: [], changes: [] },
      generatedAt: "2026-04-22T00:00:00.000Z",
      extractorVersion: "v4",
      promptVersion: "v1"
    };
    const env = {
      KABUYOMI_CACHE: {
        get: vi.fn(),
        put: vi.fn()
      }
    };
    const config = {
      extractorVersion: "v4",
      promptVersion: "v1"
    };

    mockFetchSubmissions.mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
    mockPickLatestSupportedFiling.mockReturnValue(currentFiling as never);
    mockPickComparisonFiling.mockReturnValue(null);
    mockLoadCachedLatestFiling.mockResolvedValue(null);
    mockLoadArchivedFilingByKey.mockResolvedValue(ingestedRecord as never);
    mockIngestFiling.mockResolvedValue(ingestedRecord as never);

    const result = await ensureLatestFiling("CRCL", env as never, config as never, {
      forceRemoteCheck: true,
      tickerRecord: tickerRecord as never
    });

    expect(result).toEqual(ingestedRecord);
    expect(mockLoadCachedLatestFiling).not.toHaveBeenCalled();
    expect(mockLoadArchivedFilingByKey).not.toHaveBeenCalled();
    expect(env.KABUYOMI_CACHE.get).not.toHaveBeenCalled();
    expect(mockIngestFiling).toHaveBeenCalledWith(currentFiling, null, env, config);
  });
});
