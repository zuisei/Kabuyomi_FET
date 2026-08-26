import { describe, expect, it } from "vitest";
import { isBankLike } from "../src/clients/gemini/fallback";
import type { FilingCacheRecord } from "../src/env";

/**
 * isBankLike gates the liquidity/funding fallback, which asks for "deposits" and
 * "credit quality" as missing source types. A non-bank filing can never satisfy
 * those, so a false positive steers an ordinary funding question into bank
 * framing and reports evidence gaps that do not apply.
 *
 * The regression it guards: the classifier used to search ticker + company name
 * + 5,000 characters of MD&A for an unbounded /financial|loans?|bank|.../, and
 * "consolidated financial statements" and "financial condition" are boilerplate
 * in every filing — so nearly every company came out bank-like.
 */

function filing(ticker: string, companyName: string, mdaText: string): FilingCacheRecord {
  return {
    filingKey: `v1:${ticker}:test`,
    ticker,
    companyName,
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText,
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: [],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}

describe("isBankLike", () => {
  it("recognises actual banks", () => {
    expect(isBankLike(filing("JPM", "JPMorgan Chase & Co.", "Net interest income rose on higher rates."))).toBe(true);
    expect(isBankLike(filing("BAC", "Bank of America Corporation", "Total deposits declined."))).toBe(true);
    expect(isBankLike(filing("C", "Citigroup Inc.", "Provision for credit losses increased."))).toBe(true);
  });

  it("recognises a bank from MD&A terms even without a bank-like name", () => {
    expect(
      isBankLike(filing("XYZ", "Example Holdings", "Net interest margin compressed and net charge-offs rose."))
    ).toBe(true);
  });

  it("does not treat boilerplate financial-statement language as a bank", () => {
    // "financial" — present in every MD&A.
    expect(
      isBankLike(filing("AAPL", "Apple Inc.", "The condensed consolidated financial statements and notes thereto."))
    ).toBe(false);
    expect(
      isBankLike(filing("KO", "The Coca-Cola Company", "Financial condition and results of operations remained strong."))
    ).toBe(false);
    expect(
      isBankLike(filing("NVDA", "NVIDIA Corporation", "Our consolidated financial statements reflect revenue growth."))
    ).toBe(false);
  });

  it("does not treat ordinary corporate borrowing as a bank", () => {
    // "loans" and "bank credit facilities" — ordinary industrial and consumer wording.
    expect(
      isBankLike(filing("CAT", "Caterpillar Inc.", "We had outstanding term loans and access to bank credit facilities."))
    ).toBe(false);
    expect(
      isBankLike(filing("PG", "Procter & Gamble", "We maintain committed bank credit facilities."))
    ).toBe(false);
  });
});
