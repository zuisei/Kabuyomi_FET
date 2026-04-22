import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

describe("worker routing", () => {
  const executionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn()
  } as never;

  it("syncs the StoreKit entitlement and returns the resolved plan", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalTransactionId: "tx-1",
          productId: "app.kabuyomi.pro.monthly",
          active: true
        })
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        },
        ENTITLEMENT: {
          getByName: vi.fn().mockReturnValue({
            fetch: vi.fn().mockResolvedValue(
              new Response(
                JSON.stringify({
                  plan: "pro",
                  quotaSubject: "pro:abc123",
                  productId: "app.kabuyomi.pro.monthly",
                  syncedAt: "2026-04-20T00:00:00.000Z"
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" }
                }
              )
            )
          })
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      plan: "pro",
      quotaSubject: "pro:abc123",
      productId: "app.kabuyomi.pro.monthly",
      syncedAt: "2026-04-20T00:00:00.000Z"
    });
  });

  it("returns 415 for chat requests without a JSON content type", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "利益率は改善した？"
        })
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: "Content-Type must be application/json"
    });
  });

  it("returns 400 for invalid chat JSON instead of bubbling a 500", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid chat payload"
    });
  });

  it("returns 413 for oversized chat payloads before parsing the body", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "a".repeat(5_000)
        })
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "Chat payload is too large"
    });
  });

  it("returns 400 for invalid watchlist JSON instead of bubbling a 500", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/watchlist/add", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid ticker payload"
    });
  });

  it("returns 400 for invalid watchlist remove JSON instead of bubbling a 500", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/watchlist/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid ticker payload"
    });
  });

  it("returns 400 for invalid internal backfill JSON instead of bubbling a 500", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/backfill/history", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": "secret"
        },
        body: "{"
      }),
      {
        BACKFILL_SHARED_SECRET: "secret",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid backfill payload"
    });
  });

  it("returns 415 for quote translation requests without a JSON content type", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/translate-quote", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({
          text: "Revenue increased year over year.",
          targetLanguage: "ja"
        })
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      error: "Content-Type must be application/json"
    });
  });

  it("returns 400 for invalid quote translation JSON instead of bubbling a 500", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/translate-quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid quote translation payload"
    });
  });

  it("requires x-device-key on routes that opt into device-bound quota", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        method: "GET",
        headers: {
          "cf-connecting-ip": "203.0.113.5"
        }
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Device key is required"
    });
  });

  it("returns detached dev usage when the device key is allowlisted and the header is present", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        method: "GET",
        headers: {
          "x-device-key": "device-123",
          "x-kabuyomi-detached-access": "dev_unlimited"
        }
      }),
      {
        DEV_DETACHED_ACCESS_DEVICE_KEYS: "device-123",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        },
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({
            fetch: vi.fn().mockResolvedValue(
              new Response(
                JSON.stringify({
                  usage: {
                    plan: "pro",
                    accessMode: "dev_unlimited",
                    chatsUsed: 0,
                    chatLimit: Number.MAX_SAFE_INTEGER,
                    stocksUsed: 0,
                    stockLimit: Number.MAX_SAFE_INTEGER,
                    savedTickers: [],
                    dateJST: "2026-04-20"
                  }
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" }
                }
              )
            )
          })
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      plan: "pro",
      accessMode: "dev_unlimited",
      chatsUsed: 0,
      chatLimit: Number.MAX_SAFE_INTEGER,
      stocksUsed: 0,
      stockLimit: Number.MAX_SAFE_INTEGER,
      savedTickers: [],
      dateJST: "2026-04-20"
    });
  });

  it("blocks non-starter company access until the ticker has been added", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/company/ORCL", {
        method: "GET",
        headers: {
          "cf-connecting-ip": "203.0.113.5",
          "x-device-key": "device-123"
        }
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn(async (key: string) => {
            if (key === "tickers_snapshot") {
              return {
                updatedAt: "2026-04-17T00:00:00.000Z",
                items: [
                  {
                    ticker: "ORCL",
                    companyName: "Oracle Corporation",
                    cik: "0001341439",
                    exchange: "NYSE"
                  }
                ]
              };
            }
            return null;
          })
        },
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({
            fetch: vi.fn().mockResolvedValue(
              new Response(
                JSON.stringify({
                  error: "Ticker access requires watchlist add",
                  usage: {
                    plan: "free",
                    chatsUsed: 0,
                    chatLimit: 3,
                    stocksUsed: 0,
                    stockLimit: 3,
                    dateJST: "2026-04-17",
                    updatedAt: "2026-04-17T00:00:00.000Z"
                  }
                }),
                {
                  status: 403,
                  headers: { "content-type": "application/json" }
                }
              )
            )
          })
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Ticker access requires watchlist add"
    });
  });
});
