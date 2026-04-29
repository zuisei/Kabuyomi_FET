import { describe, expect, it } from "vitest";
import {
  matchesClassTickerAlias,
  matchesCompactTickerAlias,
  normalizeClassTickerAlias,
  normalizeCompactTicker,
  normalizeTickerInput,
  parseTickerAliasInput,
  resolveBaseTickerFallback
} from "../src/clients/sec-ticker-alias";

describe("SEC ticker alias helpers", () => {
  it("normalizes separator aliases without owning SEC fetch responsibilities", () => {
    expect(normalizeTickerInput(" brk  b ")).toBe("BRK B");
    expect(normalizeClassTickerAlias("BRK-B")).toBe("BRK.B");
    expect(normalizeCompactTicker("BRK.B")).toBe("BRKB");
    expect(parseTickerAliasInput("BRK B")).toEqual({
      baseTicker: "BRK",
      suffix: "B",
      compactTicker: "BRKB"
    });
  });

  it("matches class and compact aliases independently", () => {
    expect(matchesClassTickerAlias("BRK.B", "BRK-B")).toBe(true);
    expect(matchesCompactTickerAlias("BARK W", "BARKW")).toBe(true);
    expect(matchesClassTickerAlias("GOOG", "GOOGL")).toBe(false);
  });

  it("falls back to a base ticker only when a separated alias has one", () => {
    expect(
      resolveBaseTickerFallback("BARK A", [
        { ticker: "BARK", companyName: "BARK, Inc.", cik: "0001823529", exchange: "NYSE" },
        { ticker: "BARKW", companyName: "BARK, Inc. Warrant", cik: "0001823529", exchange: "NYSE" }
      ])?.ticker
    ).toBe("BARK");
    expect(resolveBaseTickerFallback("BARK", [])).toBeNull();
  });
});
