import { describe, expect, it } from "vitest";
import { pickComparisonFiling, pickLatestSupportedFiling, sortTickerSearchResults } from "../src/clients/sec";
import { readQuotaIdentity } from "../src/lib/pipeline";
import type { TickerRecord } from "../src/env";

const ticker: TickerRecord = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  cik: "0000320193",
  exchange: "Nasdaq"
};

const submissions = {
  name: "Apple Inc.",
  filings: {
    recent: {
      form: ["8-K", "10-Q", "10-Q", "10-K"],
      accessionNumber: [
        "0000320193-26-000101",
        "0000320193-26-000057",
        "0000320193-25-000093",
        "0000320193-25-000071"
      ],
      primaryDocument: ["a8k.htm", "a10q.htm", "prior10q.htm", "a10k.htm"],
      filingDate: ["2026-03-01", "2026-02-03", "2025-05-02", "2025-11-01"],
      reportDate: ["2026-03-01", "2025-12-28", "2024-12-29", "2025-09-27"]
    }
  }
};

describe("SEC filing selection", () => {
  it("picks the latest supported filing", () => {
    const filing = pickLatestSupportedFiling(ticker, submissions);
    expect(filing?.formType).toBe("10-Q");
    expect(filing?.accessionNumber).toBe("0000320193-26-000057");
  });

  it("picks a prior-year comparison for 10-Q", () => {
    const current = pickLatestSupportedFiling(ticker, submissions)!;
    const comparison = pickComparisonFiling(ticker, submissions, current);
    expect(comparison?.accessionNumber).toBe("0000320193-25-000093");
  });

  it("prioritizes exact and prefix ticker matches in search ordering", () => {
    const ranked = sortTickerSearchResults(
      [
        {
          ticker: "EDTK",
          companyName: "Skillful Craftsman Education Technology Ltd",
          cik: "0000000001",
          exchange: "Nasdaq"
        },
        {
          ticker: "TSM",
          companyName: "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD",
          cik: "0001046179",
          exchange: "NYSE"
        },
        {
          ticker: "TSMWF",
          companyName: "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD",
          cik: "0000000002",
          exchange: "OTC"
        }
      ],
      "tsm"
    );

    expect(ranked[0]?.ticker).toBe("TSM");
    expect(ranked[1]?.ticker).toBe("TSMWF");
  });

  it("ignores client-supplied quota subjects and derives identity from device key", () => {
    const identity = readQuotaIdentity(
      new Request("https://kabuyomi.test/v1/usage", {
        headers: {
          "x-device-key": "device-123",
          "x-quota-subject": "pro:forged"
        }
      })
    );

    expect(identity).toEqual({
      quotaSubject: "free:device-123",
      plan: "free"
    });
  });
});
