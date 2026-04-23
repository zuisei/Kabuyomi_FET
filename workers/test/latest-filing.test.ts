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

vi.mock("../src/lib/filings/content-upgrade", () => ({
  backfillCompanyWebsite: vi.fn(async (record: { companyWebsiteUrl?: string }) =>
    record.companyWebsiteUrl ? record : { ...record, companyWebsiteUrl: "https://www.circle.com/" }
  ),
  enqueueContentUpgrade: vi.fn(),
  needsCompanyWebsiteBackfill: vi.fn((record: { companyWebsiteUrl?: string; contentMode?: string }) =>
    record.contentMode !== "metrics_only" && !record.companyWebsiteUrl
  ),
  isMetricsOnlyRecord: vi.fn((record: { contentMode?: string }) => record.contentMode === "metrics_only"),
  upgradeMetricsOnlyRecord: vi.fn(async (record: { contentMode?: string }) =>
    record.contentMode === "metrics_only" ? { ...record, contentMode: "full", mdaText: "upgraded md&a" } : record
  )
}));

vi.mock("../src/lib/filings/history-persistence", () => ({
  enqueueHistoricalPersistence: vi.fn(),
  enqueueHistoricalCoveragePreload: vi.fn()
}));

vi.mock("../src/lib/filings/ingest", () => ({
  ingestFiling: vi.fn()
}));

vi.mock("../src/lib/filings/summary-upgrade", () => ({
  enqueueSummaryUpgrade: vi.fn()
}));

vi.mock("../src/lib/filings/lock", () => ({
  acquireFilingLock: vi.fn(async () => async () => {})
}));

import { fetchSubmissions, pickComparisonFiling, pickLatestSupportedFiling } from "../src/clients/sec";
import { loadArchivedFilingByKey } from "../src/lib/history-store";
import { loadCachedLatestFiling } from "../src/lib/filings/cache";
import { backfillCompanyWebsite, enqueueContentUpgrade, upgradeMetricsOnlyRecord } from "../src/lib/filings/content-upgrade";
import { ingestFiling } from "../src/lib/filings/ingest";
import { ensureLatestFiling } from "../src/lib/filings/latest";
import { enqueueSummaryUpgrade } from "../src/lib/filings/summary-upgrade";

const mockFetchSubmissions = vi.mocked(fetchSubmissions);
const mockPickComparisonFiling = vi.mocked(pickComparisonFiling);
const mockPickLatestSupportedFiling = vi.mocked(pickLatestSupportedFiling);
const mockLoadArchivedFilingByKey = vi.mocked(loadArchivedFilingByKey);
const mockLoadCachedLatestFiling = vi.mocked(loadCachedLatestFiling);
const mockBackfillCompanyWebsite = vi.mocked(backfillCompanyWebsite);
const mockEnqueueContentUpgrade = vi.mocked(enqueueContentUpgrade);
const mockUpgradeMetricsOnlyRecord = vi.mocked(upgradeMetricsOnlyRecord);
const mockIngestFiling = vi.mocked(ingestFiling);
const mockEnqueueSummaryUpgrade = vi.mocked(enqueueSummaryUpgrade);

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
    expect(mockIngestFiling).toHaveBeenCalledWith(currentFiling, null, env, config, {
      summaryMode: "default",
      contentMode: "full"
    });
  });

  it("keeps request-path ingests full and queues a background summary upgrade when needed", async () => {
    const executionContext = {
      waitUntil: vi.fn()
    };
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
      summaryProvider: "fallback",
      contentMode: "full",
      generatedAt: "2026-04-22T00:00:00.000Z",
      extractorVersion: "v4",
      promptVersion: "v1"
    };
    const env = {
      KABUYOMI_CACHE: {
        get: vi.fn().mockResolvedValue(null),
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
    mockLoadArchivedFilingByKey.mockResolvedValue(null);
    mockIngestFiling.mockResolvedValue(ingestedRecord as never);

    await ensureLatestFiling("CRCL", env as never, config as never, {
      executionContext: executionContext as never,
      tickerRecord: tickerRecord as never
    });

    expect(mockIngestFiling).toHaveBeenCalledWith(currentFiling, null, env, config, {
      summaryMode: "default",
      contentMode: "full"
    });
    expect(mockEnqueueContentUpgrade).not.toHaveBeenCalled();
    expect(mockEnqueueSummaryUpgrade).toHaveBeenCalledWith(ingestedRecord, env, executionContext);
  });

  it("backfills missing companyWebsiteUrl before returning a current cached filing", async () => {
    const cachedRecord = {
      filingKey: "v4:0001876042:000187604226000062",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      cik: "0001876042",
      formType: "10-K",
      filedAt: "2026-03-09",
      periodOfReport: "2025-12-31",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1876042/000187604226000062/crcl-20251231.htm",
      companyWebsiteUrl: undefined,
      mdaText: "cached",
      mdaTokenCount: 1,
      metrics: [],
      sourceChunks: [],
      summary: { verdict: "", highlights: [], changes: [] },
      summaryProvider: "fallback",
      contentMode: "full",
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

    mockLoadCachedLatestFiling.mockResolvedValue(cachedRecord as never);

    const result = await ensureLatestFiling("CRCL", env as never, config as never);

    expect(mockBackfillCompanyWebsite).toHaveBeenCalledWith(cachedRecord, env);
    expect(result.companyWebsiteUrl).toBe("https://www.circle.com/");
  });

  it("synchronously upgrades a metrics-only latest cache before returning it", async () => {
    const cachedRecord = {
      filingKey: "v4:0001876042:000187604226000062",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      cik: "0001876042",
      formType: "10-K",
      filedAt: "2026-03-09",
      periodOfReport: "2025-12-31",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1876042/000187604226000062/crcl-20251231.htm",
      companyWebsiteUrl: undefined,
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [],
      sourceChunks: [],
      summary: { verdict: "partial", highlights: [], changes: [] },
      summaryProvider: "fallback",
      contentMode: "metrics_only",
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

    mockLoadCachedLatestFiling.mockResolvedValue(cachedRecord as never);

    const result = await ensureLatestFiling("CRCL", env as never, config as never);

    expect(mockUpgradeMetricsOnlyRecord).toHaveBeenCalledWith(cachedRecord, env);
    expect(result.contentMode).toBe("full");
    expect(result.mdaText).toBe("upgraded md&a");
    expect(mockFetchSubmissions).not.toHaveBeenCalled();
    expect(mockBackfillCompanyWebsite).not.toHaveBeenCalled();
  });

  it("falls through to full ingest instead of taking a nested upgrade lock after acquiring the filing lock", async () => {
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
    const metricsOnlyRecord = {
      filingKey: "v4:0001876042:000187604226000062",
      ticker: "CRCL",
      companyName: "Circle Internet Group, Inc.",
      cik: "0001876042",
      formType: "10-K",
      filedAt: "2026-03-09",
      periodOfReport: "2025-12-31",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1876042/000187604226000062/crcl-20251231.htm",
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [],
      sourceChunks: [],
      summary: { verdict: "partial", highlights: [], changes: [] },
      summaryProvider: "fallback",
      contentMode: "metrics_only",
      generatedAt: "2026-04-22T00:00:00.000Z",
      extractorVersion: "v4",
      promptVersion: "v1"
    };
    const fullRecord = {
      ...metricsOnlyRecord,
      mdaText: "full md&a",
      mdaTokenCount: 10,
      summary: { verdict: "full", highlights: [], changes: [] },
      contentMode: "full"
    };
    const env = {
      KABUYOMI_CACHE: {
        get: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(metricsOnlyRecord),
        put: vi.fn()
      }
    };
    const config = {
      extractorVersion: "v4",
      promptVersion: "v1"
    };

    mockLoadCachedLatestFiling.mockResolvedValue(null);
    mockFetchSubmissions.mockResolvedValue({ filings: { recent: { form: [], accessionNumber: [], primaryDocument: [], filingDate: [], reportDate: [] } } } as never);
    mockPickLatestSupportedFiling.mockReturnValue(currentFiling as never);
    mockPickComparisonFiling.mockReturnValue(null);
    mockLoadArchivedFilingByKey.mockResolvedValue(null);
    mockIngestFiling.mockResolvedValue(fullRecord as never);

    const result = await ensureLatestFiling("CRCL", env as never, config as never, {
      tickerRecord: tickerRecord as never
    });

    expect(mockUpgradeMetricsOnlyRecord).not.toHaveBeenCalled();
    expect(mockIngestFiling).toHaveBeenCalledWith(currentFiling, null, env, config, {
      summaryMode: "default",
      contentMode: "full"
    });
    expect(result.contentMode).toBe("full");
    expect(result.mdaText).toBe("full md&a");
  });
});
