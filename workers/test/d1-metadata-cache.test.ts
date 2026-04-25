import { describe, expect, it, vi } from "vitest";
import { loadLatestFilingAliasFromD1, upsertLatestFilingAliases } from "../src/lib/filings/latest-alias-store";
import { loadSearchFormTypeCache, upsertSearchFormTypeCache } from "../src/lib/search-form-type-cache";

describe("D1 metadata caches", () => {
  it("treats unavailable search form type metadata as a cache miss", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn().mockRejectedValue(new Error("no such table: search_form_type_cache"))
          }))
        }))
      }
    } as never;

    await expect(loadSearchFormTypeCache(["AAPL"], env)).resolves.toEqual(new Map());
  });

  it("does not fail request paths when search form type metadata writes are unavailable", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            run: vi.fn().mockRejectedValue(new Error("no such table: search_form_type_cache"))
          }))
        }))
      }
    } as never;

    await expect(upsertSearchFormTypeCache("AAPL", "10-Q", env)).resolves.toBeUndefined();
  });

  it("falls back when latest filing alias metadata is unavailable", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockRejectedValue(new Error("no such table: latest_filing_aliases"))
          }))
        }))
      }
    } as never;

    await expect(loadLatestFilingAliasFromD1("v6", "AAPL", env)).resolves.toBeNull();
  });

  it("does not fail request paths when latest filing alias metadata writes are unavailable", async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn()
        })),
        batch: vi.fn().mockRejectedValue(new Error("no such table: latest_filing_aliases"))
      }
    } as never;

    await expect(upsertLatestFilingAliases("v6", "AAPL", "v6:0000320193:000032019326000006", env)).resolves.toBeUndefined();
  });
});
