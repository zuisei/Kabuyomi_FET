import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec", () => ({
  fetchFilingHtml: vi.fn()
}));

vi.mock("../src/clients/gemini", () => ({
  generateSummary: vi.fn()
}));

vi.mock("../src/extractors/mda", () => ({
  extractMDASectionWithDiagnostics: vi.fn(),
  normalizeFilingText: vi.fn((html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
}));

vi.mock("../src/lib/filings/company-website", () => ({
  extractCompanyWebsiteUrl: vi.fn()
}));

vi.mock("../src/lib/history-store", () => ({
  buildArchiveObjectKey: vi.fn((filingKey: string) => `filings/${filingKey}.json`),
  upsertHistoricalIndex: vi.fn()
}));

vi.mock("../src/lib/filings/cache", () => ({
  buildCacheKey: vi.fn((extractorVersion: string, cik: string, accessionNumber: string) =>
    `filing_cache:${extractorVersion}:${cik}:${accessionNumber}`
  ),
  loadFilingByKey: vi.fn()
}));

vi.mock("../src/lib/filings/lock", () => ({
  acquireFilingLock: vi.fn(async () => async () => {})
}));

import { fetchFilingHtml } from "../src/clients/sec";
import { generateSummary } from "../src/clients/gemini";
import { extractMDASectionWithDiagnostics } from "../src/extractors/mda";
import { loadFilingByKey } from "../src/lib/filings/cache";
import { backfillCompanyWebsite, enqueueContentUpgrade } from "../src/lib/filings/content-upgrade";
import { extractCompanyWebsiteUrl } from "../src/lib/filings/company-website";
import { upsertHistoricalIndex } from "../src/lib/history-store";

const mockFetchFilingHtml = vi.mocked(fetchFilingHtml);
const mockGenerateSummary = vi.mocked(generateSummary);
const mockExtractMDASectionWithDiagnostics = vi.mocked(extractMDASectionWithDiagnostics);
const mockLoadFilingByKey = vi.mocked(loadFilingByKey);
const mockExtractCompanyWebsiteUrl = vi.mocked(extractCompanyWebsiteUrl);
const mockUpsertHistoricalIndex = vi.mocked(upsertHistoricalIndex);

describe("enqueueContentUpgrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upgrades metrics-only records to full content in the background", async () => {
    const record = {
      filingKey: "v4:0000320193:000032019326000001",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      formType: "10-K",
      filedAt: "2026-01-30",
      periodOfReport: "2025-09-27",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a10k.htm",
      companyWebsiteUrl: undefined,
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [
        {
          logicalName: "revenue",
          tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
          value: 100,
          unit: "USDm",
          periodEnd: "2025-09-27",
          comparisonValue: 90,
          yoyPercent: 11.1
        }
      ],
      sourceChunks: [
        {
          sourceId: "S1",
          sectionType: "xbrl_metric",
          sectionTitle: "Revenue",
          sourceLabel: "XBRL Revenue",
          text: "Revenue: 100 USDm / 比較値: 90 / YoY: 11.1%",
          startOffset: 0,
          endOffset: 0,
          tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
          sortOrder: 1
        }
      ],
      summary: {
        verdict: "metrics only",
        highlights: [],
        changes: []
      },
      summaryProvider: "fallback" as const,
      contentMode: "metrics_only" as const,
      generatedAt: "2026-04-23T00:00:00.000Z",
      extractorVersion: "v4",
      promptVersion: "v1"
    };
    const env = {
      KABUYOMI_CACHE: {
        put: vi.fn()
      },
      FILINGS_BUCKET: {
        put: vi.fn()
      }
    };
    const executionContext = {
      waitUntil: vi.fn()
    };

    mockLoadFilingByKey.mockResolvedValue(record as never);
    mockFetchFilingHtml.mockResolvedValue("<html><body><p>Demand improved across iPhone and Services.</p></body></html>");
    mockExtractMDASectionWithDiagnostics.mockReturnValue({
      result: {
        text: "Demand improved across iPhone and Services.",
        tokenCount: 10,
        usedStartPattern: "item7",
        usedEndPattern: "item8"
      },
      diagnostics: {
        inputHtmlChars: 80,
        normalizedChars: 72,
        startMatchesCount: 1,
        endMatchesCount: 1,
        sanitizeMs: 0,
        domParseMs: 0,
        textReadMs: 0,
        cleanupMs: 0,
        normalizeMs: 0,
        boundaryScanMs: 0,
        selectionMs: 0,
        totalMs: 1
      }
    } as never);
    mockExtractCompanyWebsiteUrl.mockReturnValue("https://www.apple.com/investor/");
    mockGenerateSummary.mockResolvedValue({
      summary: {
        verdict: "full",
        highlights: [],
        changes: []
      },
      provider: "gemini"
    } as never);

    enqueueContentUpgrade(record as never, env as never, executionContext as never);

    expect(executionContext.waitUntil).toHaveBeenCalledTimes(1);
    await executionContext.waitUntil.mock.calls[0][0];

    expect(mockFetchFilingHtml).toHaveBeenCalledTimes(1);
    expect(mockGenerateSummary).toHaveBeenCalledTimes(1);
    expect(env.KABUYOMI_CACHE.put).not.toHaveBeenCalled();
    expect(env.FILINGS_BUCKET.put).toHaveBeenCalledTimes(1);
    expect(mockUpsertHistoricalIndex).toHaveBeenCalledTimes(1);

    const storedRecord = JSON.parse(env.FILINGS_BUCKET.put.mock.calls[0][1] as string);
    expect(storedRecord.contentMode).toBe("full");
    expect(storedRecord.summaryProvider).toBe("gemini");
    expect(storedRecord.companyWebsiteUrl).toBe("https://www.apple.com/investor/");
    expect(storedRecord.mdaText).toContain("Demand improved");
    expect(storedRecord.sourceChunks.some((chunk: { sectionType: string }) => chunk.sectionType === "md_a")).toBe(true);
  });

  it("backfills companyWebsiteUrl for full records without regenerating summary", async () => {
    const record = {
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
      summary: {
        verdict: "cached",
        highlights: [],
        changes: []
      },
      summaryProvider: "fallback" as const,
      contentMode: "full" as const,
      generatedAt: "2026-04-23T00:00:00.000Z",
      extractorVersion: "v4",
      promptVersion: "v1"
    };
    const env = {
      KABUYOMI_CACHE: {
        put: vi.fn()
      },
      FILINGS_BUCKET: {
        put: vi.fn()
      }
    };

    mockLoadFilingByKey.mockResolvedValue(record as never);
    mockFetchFilingHtml.mockResolvedValue("<html><body><p>Our website is located at www.circle.com.</p></body></html>");
    mockExtractCompanyWebsiteUrl.mockReturnValue("https://www.circle.com/");

    const upgraded = await backfillCompanyWebsite(record as never, env as never);

    expect(upgraded.companyWebsiteUrl).toBe("https://www.circle.com/");
    expect(mockFetchFilingHtml).toHaveBeenCalledTimes(1);
    expect(mockGenerateSummary).not.toHaveBeenCalled();
    expect(env.KABUYOMI_CACHE.put).not.toHaveBeenCalled();
    expect(env.FILINGS_BUCKET.put).toHaveBeenCalledTimes(1);
    expect(mockUpsertHistoricalIndex).toHaveBeenCalledTimes(1);
  });
});
