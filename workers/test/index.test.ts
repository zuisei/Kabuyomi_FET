import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

describe("worker routing", () => {
  const executionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn()
  } as never;

  it("disables billing sync during beta", async () => {
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
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Billing sync is disabled during beta"
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
          get: vi.fn().mockResolvedValue(null)
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
