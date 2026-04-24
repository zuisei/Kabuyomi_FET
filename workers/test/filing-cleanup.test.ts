import { describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors";
import { cleanupFilingStorage } from "../src/lib/filings/cleanup";

const currentConfig = {
  extractorVersion: "v6",
  promptVersion: "v2"
};

function makeCleanupEnv() {
  const candidateRows = [
    {
      filingKey: "v3:0000320193:000032019326000006",
      ticker: "AAPL",
      cik: "0000320193",
      accession: "000032019326000006",
      formType: "10-Q",
      periodOfReport: "2025-12-27",
      version: "v3",
      hasCurrentVersion: 1,
      hasMetricDisagreement: 1
    }
  ];
  const kvKeys = [
    "filing_cache:v3:0000320193:000032019326000006",
    "latest_filing_by_ticker:v3:AAPL",
    "filing_cache:v6:0000320193:000032019326000006"
  ];

  const selectBind = vi.fn(() => ({
    all: vi.fn().mockResolvedValue({ results: candidateRows })
  }));
  const deleteBinds: Array<{ sql: string; args: unknown[] }> = [];

  return {
    DB: {
      prepare: vi.fn((sql: string) => {
        if (sql.includes("FROM filings old")) {
          return { bind: selectBind };
        }

        return {
          bind: vi.fn((...args: unknown[]) => {
            deleteBinds.push({ sql, args });
            return { sql, args };
          })
        };
      }),
      batch: vi.fn().mockResolvedValue([])
    },
    FILINGS_BUCKET: {
      delete: vi.fn().mockResolvedValue(undefined)
    },
    KABUYOMI_CACHE: {
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        keys: kvKeys.filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cursor: undefined
      })),
      delete: vi.fn().mockResolvedValue(undefined)
    },
    selectBind,
    deleteBinds
  };
}

describe("cleanupFilingStorage", () => {
  it("dry-runs obsolete filing cleanup without deleting storage", async () => {
    const env = makeCleanupEnv();

    const result = await cleanupFilingStorage(
      {
        execute: false,
        maxFilings: 50,
        maxKvKeys: 200,
        includeUnshadowed: false,
        onlyDisagreeingMetrics: false
      },
      env as never,
      currentConfig as never
    );

    expect(result.dryRun).toBe(true);
    expect(result.targetVersions).toEqual(["v1", "v2", "v3", "v4", "v5"]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        filingKey: "v3:0000320193:000032019326000006",
        hasCurrentVersion: true,
        hasMetricDisagreement: true,
        r2ObjectKey: "filings/v3:0000320193:000032019326000006.json",
        kvCacheKey: "filing_cache:v3:0000320193:000032019326000006"
      })
    ]);
    expect(result.kvKeys).toEqual([
      "filing_cache:v3:0000320193:000032019326000006",
      "latest_filing_by_ticker:v3:AAPL"
    ]);
    expect(env.KABUYOMI_CACHE.list).not.toHaveBeenCalled();
    expect(env.DB.batch).not.toHaveBeenCalled();
    expect(env.FILINGS_BUCKET.delete).not.toHaveBeenCalled();
    expect(env.KABUYOMI_CACHE.delete).not.toHaveBeenCalled();
  });

  it("executes D1, R2, and KV deletions only after execute is true", async () => {
    const env = makeCleanupEnv();

    const result = await cleanupFilingStorage(
      {
        execute: true,
        maxFilings: 50,
        maxKvKeys: 200,
        includeUnshadowed: false,
        onlyDisagreeingMetrics: true
      },
      env as never,
      currentConfig as never
    );

    expect(result.dryRun).toBe(false);
    expect(result.deleted).toEqual({
      d1Filings: 1,
      r2Objects: 1,
      kvKeys: 2
    });
    expect(env.DB.batch).toHaveBeenCalledTimes(1);
    expect(env.deleteBinds.map((statement) => statement.sql)).toEqual([
      "DELETE FROM metric_history WHERE filing_key = ?",
      "DELETE FROM segment_highlights WHERE filing_key = ?",
      "DELETE FROM filings WHERE filing_key = ?"
    ]);
    expect(env.FILINGS_BUCKET.delete).toHaveBeenCalledWith("filings/v3:0000320193:000032019326000006.json");
    expect(env.KABUYOMI_CACHE.delete).toHaveBeenCalledWith("filing_cache:v3:0000320193:000032019326000006");
    expect(env.KABUYOMI_CACHE.delete).toHaveBeenCalledWith("latest_filing_by_ticker:v3:AAPL");
  });

  it("refuses to target the current extractor version", async () => {
    const env = makeCleanupEnv();

    await expect(
      cleanupFilingStorage(
        {
          execute: false,
          targetVersions: ["v6"],
          maxFilings: 50,
          maxKvKeys: 200,
          includeUnshadowed: false,
          onlyDisagreeingMetrics: false
        },
        env as never,
        currentConfig as never
      )
    ).rejects.toBeInstanceOf(AppError);
  });
});
