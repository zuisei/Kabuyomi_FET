import { beforeEach, describe, expect, it, vi } from "vitest";

const routeMocks = vi.hoisted(() => ({
  ensureLatestFiling: vi.fn()
}));

vi.mock("../src/clients/sec", () => ({
  lookupTicker: vi.fn(),
  listTickersByCik: vi.fn(),
  resolveLatestSearchFormType: vi.fn()
}));

vi.mock("../src/lib/pipeline", () => ({
  ensureLatestFiling: routeMocks.ensureLatestFiling
}));

vi.mock("../src/lib/filings/latest", () => ({
  ensureLatestFiling: routeMocks.ensureLatestFiling
}));

vi.mock("../src/lib/filings/cache", () => ({
  loadCachedLatestFiling: vi.fn()
}));

vi.mock("../src/lib/quota", () => ({
  readQuotaIdentity: vi.fn(),
  consumeStockQuotaWithMutation: vi.fn(),
  promoteSavedTickerAlias: vi.fn(),
  refundStockQuota: vi.fn(),
  removeTickerFromSavedQuota: vi.fn()
}));

import { handleCompanyRoute } from "../src/routes/company";
import { handleWatchlistAddRoute } from "../src/routes/watchlist-add";
import { handleWatchlistRemoveRoute } from "../src/routes/watchlist-remove";
import { listTickersByCik, lookupTicker, resolveLatestSearchFormType } from "../src/clients/sec";
import { ensureLatestFiling } from "../src/lib/pipeline";
import { loadCachedLatestFiling } from "../src/lib/filings/cache";
import {
  consumeStockQuotaWithMutation,
  promoteSavedTickerAlias,
  readQuotaIdentity,
  refundStockQuota,
  removeTickerFromSavedQuota
} from "../src/lib/quota";
import { AppError } from "../src/lib/errors";

const mockLookupTicker = vi.mocked(lookupTicker);
const mockListTickersByCik = vi.mocked(listTickersByCik);
const mockResolveLatestSearchFormType = vi.mocked(resolveLatestSearchFormType);
const mockEnsureLatestFiling = vi.mocked(ensureLatestFiling);
const mockLoadCachedLatestFiling = vi.mocked(loadCachedLatestFiling);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);
const mockConsumeStockQuotaWithMutation = vi.mocked(consumeStockQuotaWithMutation);
const mockPromoteSavedTickerAlias = vi.mocked(promoteSavedTickerAlias);
const mockRefundStockQuota = vi.mocked(refundStockQuota);
const mockRemoveTickerFromSavedQuota = vi.mocked(removeTickerFromSavedQuota);

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
  mockListTickersByCik.mockResolvedValue(["GOOG", "GOOGL"] as never);
  mockResolveLatestSearchFormType.mockResolvedValue("10-Q");
  mockPromoteSavedTickerAlias.mockResolvedValue(usage as never);
  mockLoadCachedLatestFiling.mockResolvedValue(null);
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
    mockConsumeStockQuotaWithMutation.mockResolvedValue({ usage, didMutate: true } as never);

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
    expect(mockConsumeStockQuotaWithMutation).toHaveBeenCalledWith(
      identity,
      "GOOG",
      expect.anything(),
      expect.anything(),
      { relatedTickers: ["GOOG", "GOOGL"] }
    );
    expect(mockEnsureLatestFiling).toHaveBeenCalledWith(
      "GOOG",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        tickerRecord: expect.objectContaining({ ticker: "GOOG" })
      })
    );
    expect(mockConsumeStockQuotaWithMutation.mock.invocationCallOrder[0]).toBeLessThan(
      mockEnsureLatestFiling.mock.invocationCallOrder[0]!
    );
    expect(mockRefundStockQuota).not.toHaveBeenCalled();
    expect(mockPromoteSavedTickerAlias).not.toHaveBeenCalled();
  });

  it("returns a preparing state for async watchlist add and schedules filing ingestion", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "GOOG",
      companyName: "Alphabet Inc.",
      cik: "0001652044",
      exchange: "Nasdaq"
    });
    mockConsumeStockQuotaWithMutation.mockResolvedValue({ usage, didMutate: true } as never);

    let resolveFiling: (filing: unknown) => void = () => {};
    const pendingFiling = new Promise((resolve) => {
      resolveFiling = resolve;
    });
    mockEnsureLatestFiling.mockReturnValue(pendingFiling as never);
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      })
    };

    const response = await handleWatchlistAddRoute({
      request: new Request("https://kabuyomi.test/v1/watchlist/add", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123",
          "x-kabuyomi-watchlist-mode": "async"
        },
        body: JSON.stringify({ ticker: "GOOG" })
      }),
      url: new URL("https://kabuyomi.test/v1/watchlist/add"),
      env: {} as never,
      config: {} as never,
      ctx: ctx as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "preparing",
      ticker: "GOOG",
      companyName: "Alphabet Inc.",
      cik: "0001652044",
      retryAfterSeconds: 2,
      filingPrepJob: {
        status: "preparing",
        ticker: "GOOG",
        retryAfterSeconds: 2
      },
      usage
    });
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
    expect(mockResolveLatestSearchFormType).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: "GOOG" }),
      expect.anything()
    );
    expect(mockResolveLatestSearchFormType.mock.invocationCallOrder[0]).toBeLessThan(
      mockConsumeStockQuotaWithMutation.mock.invocationCallOrder[0]!
    );
    expect(mockEnsureLatestFiling).toHaveBeenCalledWith(
      "GOOG",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        executionContext: ctx,
        tickerRecord: expect.objectContaining({ ticker: "GOOG" })
      })
    );
    expect(mockRefundStockQuota).not.toHaveBeenCalled();
    expect(mockPromoteSavedTickerAlias).not.toHaveBeenCalled();

    resolveFiling(makeFiling({ ticker: "GOOG" }));
    await Promise.all(waitUntilPromises);
  });

  it("refunds a newly saved async watchlist slot when background filing ingestion fails", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "GOOG",
      companyName: "Alphabet Inc.",
      cik: "0001652044",
      exchange: "Nasdaq"
    });
    mockConsumeStockQuotaWithMutation.mockResolvedValue({ usage, didMutate: true } as never);
    mockRefundStockQuota.mockResolvedValue({ ...usage, stocksUsed: 0 } as never);

    let rejectFiling: (error: Error) => void = () => {};
    const pendingFiling = new Promise((_, reject) => {
      rejectFiling = reject;
    });
    mockEnsureLatestFiling.mockReturnValue(pendingFiling as never);
    const waitUntilPromises: Promise<unknown>[] = [];
    const ctx = {
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      })
    };

    const response = await handleWatchlistAddRoute({
      request: new Request("https://kabuyomi.test/v1/watchlist/add", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123",
          "x-kabuyomi-watchlist-mode": "async"
        },
        body: JSON.stringify({ ticker: "GOOG" })
      }),
      url: new URL("https://kabuyomi.test/v1/watchlist/add"),
      env: {} as never,
      config: {} as never,
      ctx: ctx as never
    });

    expect(response?.status).toBe(200);
    rejectFiling(new Error("Filing fetch failed"));
    await Promise.all(waitUntilPromises);

    expect(mockRefundStockQuota).toHaveBeenCalledWith(
      identity,
      "GOOG",
      expect.anything(),
      expect.anything(),
      { relatedTickers: ["GOOG", "GOOGL"] }
    );
  });

  it("rejects async watchlist add for unsupported filing forms before saving quota", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "SSL",
      companyName: "SASOL LTD",
      cik: "0000314590",
      exchange: "NYSE"
    });
    mockListTickersByCik.mockResolvedValue(["SSL"] as never);
    mockResolveLatestSearchFormType.mockResolvedValue("6-K");
    const ctx = {
      waitUntil: vi.fn()
    };

    await expect(
      handleWatchlistAddRoute({
        request: new Request("https://kabuyomi.test/v1/watchlist/add", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123",
            "x-kabuyomi-watchlist-mode": "async"
          },
          body: JSON.stringify({ ticker: "SSL" })
        }),
        url: new URL("https://kabuyomi.test/v1/watchlist/add"),
        env: {} as never,
        config: {} as never,
        ctx: ctx as never
      })
    ).rejects.toMatchObject({
      status: 422,
      publicMessage: "No supported filing found for SSL"
    });

    expect(mockConsumeStockQuotaWithMutation).not.toHaveBeenCalled();
    expect(mockEnsureLatestFiling).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("promotes the requested ticker label when the issuer group was already saved", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "BRK-B",
      companyName: "Berkshire Hathaway Inc.",
      cik: "0001067983",
      exchange: "NYSE"
    });
    mockListTickersByCik.mockResolvedValue(["BRK-A", "BRK-B"] as never);
    mockEnsureLatestFiling.mockResolvedValue(makeFiling({ ticker: "BRK-A", cik: "0001067983" }) as never);
    mockConsumeStockQuotaWithMutation.mockResolvedValue({ usage, didMutate: false } as never);

    const response = await handleWatchlistAddRoute({
      request: new Request("https://kabuyomi.test/v1/watchlist/add", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({ ticker: "BRK.B" })
      }),
      url: new URL("https://kabuyomi.test/v1/watchlist/add"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    expect(mockPromoteSavedTickerAlias).toHaveBeenCalledWith(
      identity,
      "BRK-B",
      expect.anything(),
      expect.anything(),
      { relatedTickers: ["BRK-A", "BRK-B"] }
    );
  });

  it("normalizes separator aliases before response serialization", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "BRK-B",
      companyName: "Berkshire Hathaway Inc.",
      cik: "0001067983",
      exchange: "NYSE"
    });
    mockEnsureLatestFiling.mockResolvedValue(
      makeFiling({
        ticker: "BRK-A",
        companyName: "Berkshire Hathaway Inc.",
        cik: "0001067983",
        primaryDocumentUrl: "https://example.com/brk10q.htm",
        companyWebsiteUrl: "https://www.berkshirehathaway.com"
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
      ticker: "BRK-B",
      companyWebsiteUrl: "https://www.berkshirehathaway.com"
    });
    expect(mockEnsureLatestFiling).toHaveBeenCalledWith(
      "BRK-B",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        tickerRecord: expect.objectContaining({ ticker: "BRK-B" })
      })
    );
  });

  it("returns stale company data instead of surfacing retryable SEC 503s", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      exchange: "Nasdaq"
    });
    mockEnsureLatestFiling.mockRejectedValue(new AppError(503, "SEC data is temporarily unavailable") as never);
    mockLoadCachedLatestFiling.mockResolvedValue(
      makeFiling({
        ticker: "AAPL",
        companyName: "Apple Inc.",
        cik: "0000320193",
        filingKey: "v2:0000320193:000032019325000001"
      }) as never
    );

    const response = await handleCompanyRoute({
      request: new Request("https://kabuyomi.test/v1/company/AAPL", {
        method: "GET",
        headers: {
          "x-device-key": "device-123"
        }
      }),
      url: new URL("https://kabuyomi.test/v1/company/AAPL"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      status: "stale_ready",
      ticker: "AAPL",
      filingKey: "v2:0000320193:000032019325000001",
      statusMessage: "SEC data is temporarily unavailable",
      retryAfterSeconds: 60
    });
  });

  it("returns stale company data for refresh when the remote check is temporarily unavailable", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      exchange: "Nasdaq"
    });
    mockEnsureLatestFiling.mockRejectedValue(new AppError(503, "SEC data is temporarily unavailable") as never);
    mockLoadCachedLatestFiling.mockResolvedValue(
      makeFiling({
        ticker: "AAPL",
        companyName: "Apple Inc.",
        cik: "0000320193",
        filingKey: "v2:0000320193:000032019325000001"
      }) as never
    );

    const response = await handleCompanyRoute({
      request: new Request("https://kabuyomi.test/v1/company/AAPL/refresh", {
        method: "POST",
        headers: {
          "x-device-key": "device-123"
        }
      }),
      url: new URL("https://kabuyomi.test/v1/company/AAPL/refresh"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    expect(mockEnsureLatestFiling).toHaveBeenCalledTimes(1);
    await expect(response?.json()).resolves.toMatchObject({
      status: "stale_ready",
      ticker: "AAPL",
      filingKey: "v2:0000320193:000032019325000001",
      statusMessage: "SEC data is temporarily unavailable",
      retryAfterSeconds: 60
    });
  });

  it("returns a retryable company state instead of HTTP 503 when no stale filing exists", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      exchange: "Nasdaq"
    });
    mockEnsureLatestFiling.mockRejectedValue(new AppError(503, "SEC data is temporarily unavailable") as never);
    mockLoadCachedLatestFiling.mockResolvedValue(null);

    const response = await handleCompanyRoute({
      request: new Request("https://kabuyomi.test/v1/company/AAPL", {
        method: "GET",
        headers: {
          "x-device-key": "device-123"
        }
      }),
      url: new URL("https://kabuyomi.test/v1/company/AAPL"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      status: "failed_retryable",
      ticker: "AAPL",
      message: "SEC data is temporarily unavailable",
      retryAfterSeconds: 60
    });
  });

  it("does not use stale fallback before the ticker has been resolved", async () => {
    mockLookupTicker.mockRejectedValue(new AppError(503, "SEC data is temporarily unavailable") as never);
    mockLoadCachedLatestFiling.mockResolvedValue(makeFiling({ ticker: "AAPL" }) as never);

    await expect(
      handleCompanyRoute({
        request: new Request("https://kabuyomi.test/v1/company/AAPL", {
          method: "GET",
          headers: {
            "x-device-key": "device-123"
          }
        }),
        url: new URL("https://kabuyomi.test/v1/company/AAPL"),
        env: {} as never,
        config: {} as never,
        ctx: {} as never
      })
    ).rejects.toMatchObject({ status: 503 });

    expect(mockLoadCachedLatestFiling).not.toHaveBeenCalled();
  });

  it("normalizes separator aliases before watchlist removal", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "BRK-B",
      companyName: "Berkshire Hathaway Inc.",
      cik: "0001067983",
      exchange: "NYSE"
    });
    mockListTickersByCik.mockResolvedValue(["BRK-A", "BRK-B"] as never);
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
    expect(mockRemoveTickerFromSavedQuota).toHaveBeenCalledWith(
      identity,
      "BRK-B",
      expect.anything(),
      expect.anything(),
      { relatedTickers: ["BRK-A", "BRK-B"] }
    );
  });

  it("returns notFound for unknown tickers before filing load", async () => {
    mockLookupTicker.mockResolvedValue(null);

    const response = await handleCompanyRoute({
      request: new Request("https://kabuyomi.test/v1/company/NOPE", {
        method: "GET",
        headers: {
          "x-device-key": "device-123"
        }
      }),
      url: new URL("https://kabuyomi.test/v1/company/NOPE"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toMatchObject({
      error: "Ticker not found: NOPE"
    });
    expect(mockEnsureLatestFiling).not.toHaveBeenCalled();
  });

  it("refunds a newly consumed stock slot when filing ingestion fails", async () => {
    mockLookupTicker.mockResolvedValue({
      ticker: "GOOG",
      companyName: "Alphabet Inc.",
      cik: "0001652044",
      exchange: "Nasdaq"
    });
    mockListTickersByCik.mockResolvedValue(["GOOG", "GOOGL"] as never);
    mockConsumeStockQuotaWithMutation.mockResolvedValue({ usage, didMutate: true } as never);
    mockRefundStockQuota.mockResolvedValue(usage as never);
    mockEnsureLatestFiling.mockRejectedValue(new Error("Filing fetch failed"));

    await expect(
      handleWatchlistAddRoute({
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
      })
    ).rejects.toThrow("Filing fetch failed");

    expect(mockRefundStockQuota).toHaveBeenCalledWith(
      identity,
      "GOOG",
      expect.anything(),
      expect.anything(),
      { relatedTickers: ["GOOG", "GOOGL"] }
    );
  });
});
