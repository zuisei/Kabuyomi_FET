import { describe, expect, it, vi } from "vitest";
import { EntitlementDO } from "../src/durable/entitlement";
import worker from "../src/index";

function createEntitlementState() {
  const storage = new Map<string, unknown>();

  return {
    storage: {
      async get<T>(key: string) {
        return storage.get(key) as T | undefined;
      },
      async put(key: string, value: unknown) {
        storage.set(key, value);
      }
    }
  };
}

describe("worker routing", () => {
  const executionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn()
  } as never;

  it("does not mint pro from a client-reported billing sync claim", async () => {
    const fetch = vi.fn();
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
            fetch
          })
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Billing verification is required"
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("syncs inactive billing state as free without minting pro", async () => {
    const entitlement = new EntitlementDO(createEntitlementState() as never);
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalTransactionId: "tx-1",
          productId: "app.kabuyomi.pro.monthly",
          active: false
        })
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        },
        ENTITLEMENT: {
          getByName: vi.fn().mockReturnValue({
            fetch: (request: Request) => entitlement.fetch(request)
          })
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      plan: string;
      quotaSubject: string;
      productId: string | null;
      syncedAt: string;
    };
    expect(payload.plan).toBe("free");
    expect(payload.productId).toBeNull();
    expect(payload.quotaSubject).toMatch(/^free:[a-f0-9]{64}$/);
    expect(typeof payload.syncedAt).toBe("string");
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

  it("returns 400 for invalid internal cleanup JSON instead of bubbling a 500", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/cleanup/filings", {
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
      error: "Invalid cleanup payload"
    });
  });

  it("requires the internal token for credit purchase grants", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/credits/purchase-grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          productId: "credit_pack_100",
          transactionId: "tx-100"
        })
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized"
    });
  });

  it("does not require the internal token on the public StoreKit credit grant route", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/credits/purchase-grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          productId: "credit_pack_100",
          transactionId: "tx-100"
        })
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Apple transaction verification is not configured"
    });
  });

  it("returns 400 for invalid internal credit purchase JSON instead of bubbling a 500", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/credits/purchase-grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": "secret",
          "x-device-key": "device-123"
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
      error: "Invalid credit purchase payload"
    });
  });

  it("allows internal credit purchase grants to target a quota subject without a client device key", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/credits/purchase-grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": "secret"
        },
        body: JSON.stringify({
          productId: "unsupported_pack",
          transactionId: "tx-recovery-1",
          quotaSubject: "free:device:recovery-target"
        })
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
      error: "Unsupported credit product"
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
      dateJST: "2026-04-20",
      creditBillingEnabled: false
    });
  });

});
