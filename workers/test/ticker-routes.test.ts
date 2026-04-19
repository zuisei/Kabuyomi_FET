import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/sec", () => ({
  lookupTicker: vi.fn()
}));

vi.mock("../src/lib/pipeline", () => ({
  ensureLatestFiling: vi.fn()
}));

vi.mock("../src/lib/quota", () => ({
  readQuotaIdentity: vi.fn(),
  ensureStockQuotaAvailable: vi.fn(),
  consumeStockQuota: vi.fn(),
  removeTickerFromSavedQuota: vi.fn(),
  ensureCompanyAccessAllowed: vi.fn()
}));

import { handleCompanyRoute } from "../src/routes/company";
import { handleWatchlistAddRoute } from "../src/routes/watchlist-add";
import { handleWatchlistRemoveRoute } from "../src/routes/watchlist-remove";
import { lookupTicker } from "../src/clients/sec";
import { ensureLatestFiling } from "../src/lib/pipeline";
import {
  consumeStockQuota,
  ensureCompanyAccessAllowed,
  ensureStockQuotaAvailable,
  readQuotaIdentity,
  removeTickerFromSavedQuota
} from "../src/lib/quota";

const mockLookupTicker = vi.mocked(lookupTicker);
const mockEnsureLatestFiling = vi.mocked(ensureLatestFiling);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);
const mockEnsureStockQuotaAvailable = vi.mocked(ensureStockQuotaAvailable);
const mockConsumeStockQuota = vi.mocked(consumeStockQuota);
const mockRemoveTickerFromSavedQuota = vi.mocked(removeTickerFromSavedQuota);
const mockEnsureCompanyAccessAllowed = vi.mocked(ensureCompanyAccessAllowed);

const identity = {
  quotaSubject: "free:local:device-123",
  plan: "free",
  identityKind: "local_device"
} as const;

const usage = {
  plan: "free",
  dateJST: "2026-04-19",
  chatsUsed: 0,
  chatLimit: 3,
  stocksUsed: 1,
  stockLimit: 3,
  updatedAt: "2026-04-19T00:00:00.000Z"
};

function makeFiling(overrides: Record<string, unknown> = {}) {
  return {
    filingKey: "v3:0001652044:000165204426000001",
    ticker: "GOOGL",
    companyName: "Alphabet Inc.",
    cik: "0001652044",
    formType: "10-Q",
    filedAt: "2026-04-18",
    periodOfReport: "2026-03-31",
    primaryDocumentUrl: "https://example.com/googl10q.htm",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: [],
    summary: {
      verdict: "",
      highlights: [],
      changes: []
    },
    generatedAt: "2026-04-19T00:00:00.000Z",
    extractorVersion: "v3",
    promptVersion: "v1",
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadQuotaIdentity.mockResolvedValue(identity as never);
});

describe("ticker-aware routes", () => {
  it("returns the resolved ticker for watchlist add and saves quota state under that ticker", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "GOOG",
      companyName: "Alphabet Inc.",
      cik: "0001652044",
      exchange: "Nasdaq"
    });
    mockEnsureLatestFiling.mockResolvedValue(makeFiling({ ticker: "GOOGL" }) as never);
    mockEnsureStockQuotaAvailable.mockResolvedValue(usage as never);
    mockConsumeStockQuota.mockResolvedValue(usage as never);

    const response = await handleWatchlistAddRoute({
      request: new Request("https://kabuyomi.test/v1/watchlist/add", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({ ticker: "GOOG" })
      }),
      url: new URL("https://kabuyomi.test/v1/watchlist/add"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      company: {
        ticker: "GOOG"
      },
      usage
    });
    expect(mockEnsureStockQuotaAvailable).toHaveBeenCalledWith(identity, "GOOG", expect.anything(), expect.anything());
    expect(mockConsumeStockQuota).toHaveBeenCalledWith(identity, "GOOG", expect.anything(), expect.anything());
    expect(mockEnsureLatestFiling).toHaveBeenCalledWith(
      "GOOG",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        tickerRecord: expect.objectContaining({ ticker: "GOOG" })
      })
    );
  });

  it("normalizes separator aliases before company access checks and response serialization", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "BRK-B",
      companyName: "Berkshire Hathaway Inc.",
      cik: "0001067983",
      exchange: "NYSE"
    });
    mockEnsureCompanyAccessAllowed.mockResolvedValue(undefined);
    mockEnsureLatestFiling.mockResolvedValue(
      makeFiling({
        ticker: "BRK-A",
        companyName: "Berkshire Hathaway Inc.",
        cik: "0001067983",
        primaryDocumentUrl: "https://example.com/brk10q.htm"
      }) as never
    );

    const response = await handleCompanyRoute({
      request: new Request("https://kabuyomi.test/v1/company/BRK.B", {
        method: "GET",
        headers: {
          "x-device-key": "device-123"
        }
      }),
      url: new URL("https://kabuyomi.test/v1/company/BRK.B"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      ticker: "BRK-B"
    });
    expect(mockEnsureCompanyAccessAllowed).toHaveBeenCalledWith(identity, "BRK-B", expect.any(Array), expect.anything(), expect.anything());
    expect(mockEnsureLatestFiling).toHaveBeenCalledWith(
      "BRK-B",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        tickerRecord: expect.objectContaining({ ticker: "BRK-B" })
      })
    );
  });

  it("normalizes separator aliases before watchlist removal", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "BRK-B",
      companyName: "Berkshire Hathaway Inc.",
      cik: "0001067983",
      exchange: "NYSE"
    });
    mockRemoveTickerFromSavedQuota.mockResolvedValue(usage as never);

    const response = await handleWatchlistRemoveRoute({
      request: new Request("https://kabuyomi.test/v1/watchlist/remove", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({ ticker: "BRK.B" })
      }),
      url: new URL("https://kabuyomi.test/v1/watchlist/remove"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({ usage });
    expect(mockRemoveTickerFromSavedQuota).toHaveBeenCalledWith(identity, "BRK-B", expect.anything(), expect.anything());
  });
});
