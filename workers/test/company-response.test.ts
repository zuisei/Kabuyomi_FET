import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/history-store", () => ({
  loadHistoricalOverview: vi.fn(async () => null)
}));

import { loadHistoricalOverview } from "../src/lib/history-store";
import { serializeCompanyResponse } from "../src/lib/company-response";

const mockLoadHistoricalOverview = vi.mocked(loadHistoricalOverview);

describe("serializeCompanyResponse", () => {
  it("does not block request responses on historical persistence by default", async () => {
    const filing = {
      filingKey: "v5:0000320193:000032019326000006",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      formType: "10-Q",
      filedAt: "2026-01-30",
      periodOfReport: "2025-12-27",
      primaryDocumentUrl: "https://example.com/aapl-10q.htm",
      companyWebsiteUrl: "https://www.apple.com/investor/",
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [],
      sourceChunks: [],
      summary: { verdict: "", highlights: [], changes: [] },
      generatedAt: "2026-04-23T00:00:00.000Z",
      extractorVersion: "v5",
      promptVersion: "v1"
    };

    await serializeCompanyResponse(filing as never, {} as never, { displayTicker: "AAPL" });

    expect(mockLoadHistoricalOverview).toHaveBeenCalledWith(filing, {}, {
      allowPersistence: false
    });
  });

  it("can opt into current filing persistence before building historical overview", async () => {
    const filing = {
      filingKey: "v5:0000320193:000032019326000006",
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      formType: "10-Q",
      filedAt: "2026-01-30",
      periodOfReport: "2025-12-27",
      primaryDocumentUrl: "https://example.com/aapl-10q.htm",
      companyWebsiteUrl: "https://www.apple.com/investor/",
      mdaText: "",
      mdaTokenCount: 0,
      metrics: [],
      sourceChunks: [],
      summary: { verdict: "", highlights: [], changes: [] },
      generatedAt: "2026-04-23T00:00:00.000Z",
      extractorVersion: "v5",
      promptVersion: "v1"
    };

    await serializeCompanyResponse(filing as never, {} as never, {
      displayTicker: "AAPL",
      allowHistoricalPersistence: true
    });

    expect(mockLoadHistoricalOverview).toHaveBeenCalledWith(filing, {}, {
      allowPersistence: true
    });
  });
});
