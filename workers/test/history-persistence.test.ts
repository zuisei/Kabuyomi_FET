import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec", () => ({
  buildFilingKey: vi.fn((extractorVersion: string, filing: { cik: string; accessionNumber: string }) =>
    `${extractorVersion}:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}`
  )
}));

vi.mock("../src/lib/history-store", () => ({
  ensureHistoricalArtifacts: vi.fn(),
  hasHistoricalBindings: vi.fn(() => true),
  loadArchivedFilingByKey: vi.fn(),
  upsertHistoricalArtifacts: vi.fn()
}));

vi.mock("../src/lib/filings/cache", () => ({
  isCurrentCacheRecord: vi.fn(() => true)
}));

vi.mock("../src/lib/filings/ingest", () => ({
  ingestFiling: vi.fn()
}));

vi.mock("../src/lib/filings/lock", () => ({
  acquireFilingLock: vi.fn(async () => async () => {})
}));

import type { Env, FilingCacheRecord, FilingReference } from "../src/env";
import { ensureHistoricalFilingStored } from "../src/lib/filings/history-persistence";
import {
  ensureHistoricalArtifacts,
  loadArchivedFilingByKey,
  upsertHistoricalArtifacts
} from "../src/lib/history-store";
import { ingestFiling } from "../src/lib/filings/ingest";
import { DEFAULT_REMOTE_CONFIG, type RemoteConfig } from "../src/lib/remote-config";

const mockEnsureHistoricalArtifacts = vi.mocked(ensureHistoricalArtifacts);
const mockLoadArchivedFilingByKey = vi.mocked(loadArchivedFilingByKey);
const mockUpsertHistoricalArtifacts = vi.mocked(upsertHistoricalArtifacts);
const mockIngestFiling = vi.mocked(ingestFiling);

const filing: FilingReference = {
  cik: "0000320193",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  exchange: "Nasdaq",
  formType: "10-Q",
  accessionNumber: "0000320193-25-000093",
  primaryDocument: "aapl-20250628.htm",
  filedAt: "2025-08-01",
  periodOfReport: "2025-06-28"
};

const config: RemoteConfig = {
  ...DEFAULT_REMOTE_CONFIG,
  extractorVersion: "v4",
  promptVersion: "v1"
};

const env = {} as Env;

const metricsOnlyRecord: FilingCacheRecord = {
  filingKey: "v4:0000320193:000032019325000093",
  ticker: "AAPL",
  companyName: "Apple Inc.",
  cik: "0000320193",
  formType: "10-Q",
  filedAt: "2025-08-01",
  periodOfReport: "2025-06-28",
  primaryDocumentUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000093/aapl-20250628.htm",
  mdaText: "",
  mdaTokenCount: 0,
  metrics: [],
  sourceChunks: [],
  summary: { verdict: "partial", highlights: [], changes: [] },
  summaryProvider: "fallback",
  contentMode: "metrics_only",
  generatedAt: "2026-04-23T00:00:00.000Z",
  extractorVersion: "v4",
  promptVersion: "v1"
};

const fullRecord: FilingCacheRecord = {
  ...metricsOnlyRecord,
  mdaText: "full md&a",
  mdaTokenCount: 10,
  contentMode: "full",
  generatedAt: "2026-04-24T00:00:00.000Z"
};

describe("ensureHistoricalFilingStored", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reingests a metrics-only archive when full historical content is required", async () => {
    mockLoadArchivedFilingByKey.mockResolvedValue(metricsOnlyRecord);
    mockIngestFiling.mockResolvedValue(fullRecord);

    const result = await ensureHistoricalFilingStored(filing, null, env, config, { contentMode: "full" });

    expect(mockIngestFiling).toHaveBeenCalledWith(filing, null, env, config, {
      summaryMode: "fallback_only",
      contentMode: "full"
    });
    expect(mockUpsertHistoricalArtifacts).toHaveBeenCalledWith(fullRecord, env);
    expect(mockEnsureHistoricalArtifacts).not.toHaveBeenCalled();
    expect(result.contentMode).toBe("full");
    expect(result.mdaText).toBe("full md&a");
  });

  it("reuses a metrics-only archive for metrics-only historical hydration", async () => {
    mockLoadArchivedFilingByKey.mockResolvedValue(metricsOnlyRecord);

    const result = await ensureHistoricalFilingStored(filing, null, env, config, { contentMode: "metrics_only" });

    expect(mockIngestFiling).not.toHaveBeenCalled();
    expect(mockEnsureHistoricalArtifacts).toHaveBeenCalledWith(metricsOnlyRecord, env);
    expect(mockUpsertHistoricalArtifacts).not.toHaveBeenCalled();
    expect(result.contentMode).toBe("metrics_only");
  });
});
