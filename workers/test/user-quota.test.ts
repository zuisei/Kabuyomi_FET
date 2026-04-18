import { describe, expect, it } from "vitest";
import { UserQuotaDO } from "../src/durable/user-quota";

function createState(initialEntries: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>(Object.entries(initialEntries));

  return {
    storage: {
      async get<T>(key: string) {
        return storage.get(key) as T | undefined;
      },
      async put(key: string, value: unknown) {
        storage.set(key, value);
      },
      async delete(key: string) {
        storage.delete(key);
      },
      async list<T>({
        reverse,
        limit
      }: {
        reverse?: boolean;
        limit?: number;
      } = {}) {
        const entries = [...storage.entries()].sort(([left], [right]) => left.localeCompare(right));
        if (reverse) {
          entries.reverse();
        }
        return new Map(entries.slice(0, limit ?? entries.length)) as Map<string, T>;
      }
    },
    async blockConcurrencyWhile<T>(callback: () => Promise<T>) {
      return callback();
    }
  };
}

async function postQuota(
  quota: UserQuotaDO,
  body: Record<string, unknown>
) {
  return quota.fetch(
    new Request("https://do/quota", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

describe("UserQuotaDO", () => {
  it("returns 400 when the payload is not valid JSON", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const response = await quota.fetch(
      new Request("https://do/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid quota payload"
    });
  });

  it("returns 400 when required quota fields are missing", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const response = await quota.fetch(
      new Request("https://do/quota", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "consumeStock",
          quotaSubject: "free:test-device"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid quota payload"
    });
  });

  it("does not consume multiple stock slots for the same ticker", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const first = await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "AAPL",
      chatLimit: 3,
      stockLimit: 3
    });

    const second = await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "AAPL",
      chatLimit: 3,
      stockLimit: 3
    });

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

    const response = await postQuota(quota, {
      action: "checkCompanyAccess",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "AAPL",
      previewTickers: ["AAPL", "MSFT"],
      chatLimit: 3,
      stockLimit: 3
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 0
      }
    });
  });

  it("blocks non-starter company access until the ticker has been saved", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const blocked = await postQuota(quota, {
      action: "checkCompanyAccess",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "ORCL",
      previewTickers: ["AAPL", "MSFT"],
      chatLimit: 3,
      stockLimit: 3
    });

    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({
      error: "Ticker access requires watchlist add"
    });

    await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "ORCL",
      chatLimit: 3,
      stockLimit: 3
    });

    const allowed = await postQuota(quota, {
      action: "checkCompanyAccess",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "ORCL",
      previewTickers: ["AAPL", "MSFT"],
      chatLimit: 3,
      stockLimit: 3
    });

    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1
      }
    });
  });

  it("migrates legacy tracked tickers into saved_tickers once and does not overwrite the marker", async () => {
    const state = createState({
      "2026-04-15:free:test-device": {
        plan: "free",
        dateJST: "2026-04-15",
        chatsUsed: 0,
        chatLimit: 3,
        stocksUsed: 1,
        stockLimit: 3,
        trackedTickers: ["AAPL"],
        updatedAt: "2026-04-15T00:00:00.000Z"
      },
      "2026-04-14:free:test-device": {
        plan: "free",
        dateJST: "2026-04-14",
        chatsUsed: 0,
        chatLimit: 3,
        stocksUsed: 2,
        stockLimit: 3,
        trackedTickers: ["MSFT", "NVDA"],
        updatedAt: "2026-04-14T00:00:00.000Z"
      }
    });
    const quota = new UserQuotaDO(state as never);

    const migrated = await postQuota(quota, {
      action: "state",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3
    });
    const savedRecord = await state.storage.get<{
      savedTickers: string[];
      migratedFromLegacyAt?: string;
    }>("saved_tickers");
    const firstMigratedAt = savedRecord?.migratedFromLegacyAt;

    const repeated = await postQuota(quota, {
      action: "state",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3
    });

    expect(migrated.status).toBe(200);
    await expect(migrated.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1
      }
    });
    expect(savedRecord?.savedTickers).toEqual(["AAPL"]);
    expect(firstMigratedAt).toBeTruthy();
    await expect(repeated.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1
      }
    });
    await expect(state.storage.get<{ migratedFromLegacyAt?: string }>("saved_tickers")).resolves.toMatchObject({
      migratedFromLegacyAt: firstMigratedAt
    });
  });

  it("ignores legacy tracked tickers once saved_tickers exists", async () => {
    const state = createState({
      saved_tickers: {
        plan: "free",
        stockLimit: 3,
        savedTickers: ["MSFT"],
        updatedAt: "2026-04-16T00:00:00.000Z",
        migratedFromLegacyAt: "2026-04-16T00:00:00.000Z"
      },
      "2026-04-15:free:test-device": {
        plan: "free",
        dateJST: "2026-04-15",
        chatsUsed: 0,
        chatLimit: 3,
        stocksUsed: 1,
        stockLimit: 3,
        trackedTickers: ["AAPL"],
        updatedAt: "2026-04-15T00:00:00.000Z"
      }
    });
    const quota = new UserQuotaDO(state as never);

    const response = await postQuota(quota, {
      action: "checkCompanyAccess",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "AAPL",
      previewTickers: ["NVDA"],
      chatLimit: 3,
      stockLimit: 3
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Ticker access requires watchlist add",
      usage: {
        stocksUsed: 1
      }
    });
  });

  it("does not re-read legacy tracked tickers after removeTicker", async () => {
    const state = createState({
      "2026-04-15:free:test-device": {
        plan: "free",
        dateJST: "2026-04-15",
        chatsUsed: 0,
        chatLimit: 3,
        stocksUsed: 1,
        stockLimit: 3,
        trackedTickers: ["AAPL"],
        updatedAt: "2026-04-15T00:00:00.000Z"
      }
    });
    const quota = new UserQuotaDO(state as never);

    await postQuota(quota, {
      action: "state",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3
    });

    const removed = await postQuota(quota, {
      action: "removeTicker",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "AAPL",
      chatLimit: 3,
      stockLimit: 3
    });

    const blocked = await postQuota(quota, {
      action: "checkCompanyAccess",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-17",
      ticker: "AAPL",
      previewTickers: [],
      chatLimit: 3,
      stockLimit: 3
    });

    await expect(removed.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 0
      }
    });
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({
      error: "Ticker access requires watchlist add",
      usage: {
        stocksUsed: 0
      }
    });
  });

  it("keeps saved tickers across JST day boundaries while resetting chat usage", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "AAPL",
      chatLimit: 3,
      stockLimit: 3
    });
    await postQuota(quota, {
      action: "consumeChat",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      chatLimit: 3,
      stockLimit: 3
    });

    const nextDay = await postQuota(quota, {
      action: "state",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-15",
      chatLimit: 3,
      stockLimit: 3
    });

    await expect(nextDay.json()).resolves.toMatchObject({
      usage: {
        chatsUsed: 0,
        stocksUsed: 1
      }
    });
  });
});
