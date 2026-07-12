import { describe, expect, it } from "vitest";
import { isCurrentCacheRecord } from "../src/lib/filings/cache";
import type { FilingCacheRecord } from "../src/env";

describe("filing cache freshness", () => {
  it("rejects amended annual filings as current analysis records", () => {
    const record = {
      extractorVersion: "v1",
      promptVersion: "2",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1318605/000110465926053166/tm2611837d1_10ka.htm"
    } as FilingCacheRecord;

    expect(isCurrentCacheRecord(record, { extractorVersion: "v1", promptVersion: "2" } as never)).toBe(false);
  });

  it("accepts non-amended current records", () => {
    const record = {
      extractorVersion: "v1",
      promptVersion: "2",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/1318605/000162828026003952/tsla-20251231.htm"
    } as FilingCacheRecord;

    expect(isCurrentCacheRecord(record, { extractorVersion: "v1", promptVersion: "2" } as never)).toBe(true);
  });

  it("rejects a v8 archive after the prepared-evidence v9 schema bump", () => {
    const record = {
      extractorVersion: "v8",
      promptVersion: "v2",
      primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000013/aapl-20260328.htm"
    } as FilingCacheRecord;

    expect(isCurrentCacheRecord(record, { extractorVersion: "v9", promptVersion: "v2" } as never)).toBe(false);
  });
});
