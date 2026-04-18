import { describe, expect, it } from "vitest";
import { UserQuotaDO } from "../src/durable/user-quota";

function createState() {
  const storage = new Map<string, unknown>();

  return {
    storage: {
      async get<T>(key: string) {
        return storage.get(key) as T | undefined;
      },
      async put(key: string, value: unknown) {
        storage.set(key, value);
      }
    },
    async blockConcurrencyWhile<T>(callback: () => Promise<T>) {
      return callback();
    }
  };
}

describe("UserQuotaDO", () => {
  it("does not consume multiple stock slots for the same ticker", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const first = await quota.fetch(
      new Request("https://do/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "consumeStock",
          quotaSubject: "free:test-device",
          plan: "free",
          dateJST: "2026-04-14",
          ticker: "AAPL",
          chatLimit: 3,
          stockLimit: 3
        })
      })
    );

    const second = await quota.fetch(
      new Request("https://do/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "consumeStock",
          quotaSubject: "free:test-device",
          plan: "free",
          dateJST: "2026-04-14",
          ticker: "AAPL",
          chatLimit: 3,
          stockLimit: 3
        })
      })
    );

    await expect(first.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1
      }
    });
    await expect(second.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1
      }
    });
  });

  it("allows starter preview access without consuming a stock slot", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const response = await quota.fetch(
      new Request("https://do/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "checkCompanyAccess",
          quotaSubject: "free:test-device",
          plan: "free",
          dateJST: "2026-04-14",
          ticker: "AAPL",
          previewTickers: ["AAPL", "MSFT"],
          chatLimit: 3,
          stockLimit: 3
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 0
      }
    });
  });

  it("blocks non-starter company access until the ticker has been saved", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const blocked = await quota.fetch(
      new Request("https://do/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "checkCompanyAccess",
          quotaSubject: "free:test-device",
          plan: "free",
          dateJST: "2026-04-14",
          ticker: "ORCL",
          previewTickers: ["AAPL", "MSFT"],
          chatLimit: 3,
          stockLimit: 3
        })
      })
    );

    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({
      error: "Ticker access requires watchlist add"
    });

    await quota.fetch(
      new Request("https://do/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "consumeStock",
          quotaSubject: "free:test-device",
          plan: "free",
          dateJST: "2026-04-14",
          ticker: "ORCL",
          chatLimit: 3,
          stockLimit: 3
        })
      })
    );

    const allowed = await quota.fetch(
      new Request("https://do/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "checkCompanyAccess",
          quotaSubject: "free:test-device",
          plan: "free",
          dateJST: "2026-04-14",
          ticker: "ORCL",
          previewTickers: ["AAPL", "MSFT"],
          chatLimit: 3,
          stockLimit: 3
        })
      })
    );

    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1
      }
    });
  });
});
