import { afterEach, describe, expect, it, vi } from "vitest";
import { UserQuotaDO } from "../src/durable/user-quota";

const REWARDED_AD_TEST_NOW = new Date("2026-04-16T00:00:00.000Z");

function useRewardedAdTestClock() {
  vi.useFakeTimers();
  vi.setSystemTime(REWARDED_AD_TEST_NOW);
}

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
        prefix,
        reverse,
        limit
      }: {
        prefix?: string;
        reverse?: boolean;
        limit?: number;
      } = {}) {
        const entries = [...storage.entries()]
          .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
          .sort(([left], [right]) => left.localeCompare(right));
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

function createSerialState(initialEntries: Record<string, unknown> = {}) {
  const state = createState(initialEntries);
  let tail = Promise.resolve();
  return {
    ...state,
    async blockConcurrencyWhile<T>(callback: () => Promise<T>) {
      const run = tail.then(callback, callback);
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("deduplicates saved ticker slots across related issuer tickers", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "BRK-A",
      relatedTickers: ["BRK-B"],
      chatLimit: 3,
      stockLimit: 3
    });

    const second = await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "BRK-B",
      relatedTickers: ["BRK-A"],
      chatLimit: 3,
      stockLimit: 3
    });

    await expect(second.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1,
        savedTickers: ["BRK-A"]
      },
      didMutate: false
    });
  });

  it("allows company access without consuming a stock slot", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const response = await postQuota(quota, {
      action: "checkCompanyAccess",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "ORCL",
      previewTickers: ["AAPL", "MSFT"],
      chatLimit: 3,
      stockLimit: 3
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usage: {
        savedTickers: [],
        stocksUsed: 0
      }
    });
  });

  it("returns saved_tickers in the usage payload for client resync", async () => {
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

    const response = await postQuota(quota, {
      action: "state",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      chatLimit: 3,
      stockLimit: 3
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usage: {
        savedTickers: ["AAPL"],
        stocksUsed: 1
      }
    });
  });

  it("allows non-saved company access without consuming a stock slot", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const opened = await postQuota(quota, {
      action: "checkCompanyAccess",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "ORCL",
      previewTickers: ["AAPL", "MSFT"],
      chatLimit: 3,
      stockLimit: 3
    });

    expect(opened.status).toBe(200);
    await expect(opened.json()).resolves.toMatchObject({
      usage: {
        savedTickers: [],
        stocksUsed: 0
      },
      didMutate: false
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

  it("allows company access through a related issuer ticker that shares the saved slot", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "BRK-B",
      relatedTickers: ["BRK-A"],
      chatLimit: 3,
      stockLimit: 3
    });

    const allowed = await postQuota(quota, {
      action: "checkCompanyAccess",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-14",
      ticker: "BRK-A",
      relatedTickers: ["BRK-B"],
      previewTickers: [],
      chatLimit: 3,
      stockLimit: 3
    });

    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1,
        savedTickers: ["BRK-B"]
      }
    });
  });

  it("migrates legacy tracked tickers into saved_tickers once and does not overwrite the marker", async () => {
    const state = createState({
      "daily:2026-04-15": {
        plan: "free",
        dateJST: "2026-04-15",
        chatsUsed: 0,
        chatLimit: 3,
        stocksUsed: 1,
        stockLimit: 3,
        trackedTickers: ["AAPL"],
        updatedAt: "2026-04-15T00:00:00.000Z"
      },
      "daily:2026-04-14": {
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
      "daily:2026-04-15": {
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
      action: "checkStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "AAPL",
      previewTickers: ["NVDA"],
      chatLimit: 3,
      stockLimit: 1
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: "Watchlist limit exceeded",
      usage: {
        stocksUsed: 1
      }
    });
  });

  it("does not re-read legacy tracked tickers after removeTicker", async () => {
    const state = createState({
      "daily:2026-04-15": {
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
      action: "checkStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-17",
      ticker: "AAPL",
      previewTickers: [],
      chatLimit: 3,
      stockLimit: 0
    });

    await expect(removed.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 0
      }
    });
    expect(blocked.status).toBe(429);
    await expect(blocked.json()).resolves.toMatchObject({
      error: "Watchlist limit exceeded",
      usage: {
        stocksUsed: 0
      }
    });
  });

  it("promotes the saved ticker label within a related issuer group", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "BRK-A",
      relatedTickers: ["BRK-B"],
      chatLimit: 3,
      stockLimit: 3
    });

    const promoted = await postQuota(quota, {
      action: "promoteTicker",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "BRK-B",
      relatedTickers: ["BRK-A"],
      chatLimit: 3,
      stockLimit: 3
    });

    await expect(promoted.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 1,
        savedTickers: ["BRK-B"]
      },
      didMutate: true
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

  it("only scans the latest 30 daily records during legacy migration", async () => {
    const initialEntries: Record<string, unknown> = {};

    for (let day = 1; day <= 31; day += 1) {
      const dateJST = `2026-03-${String(day).padStart(2, "0")}`;
      initialEntries[`daily:${dateJST}`] = {
        plan: "free",
        dateJST,
        chatsUsed: 0,
        chatLimit: 3,
        updatedAt: `${dateJST}T00:00:00.000Z`,
        trackedTickers: day === 1 ? ["AAPL"] : []
      };
    }

    const quota = new UserQuotaDO(createState(initialEntries) as never);

    const response = await postQuota(quota, {
      action: "state",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
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

  it("refunds a previously consumed chat slot", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeChat",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3
    });

    const refunded = await postQuota(quota, {
      action: "refundChat",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      operationId: "chat-op-1"
    });

    await expect(refunded.json()).resolves.toMatchObject({
      usage: {
        chatsUsed: 0
      },
      didMutate: true
    });
  });

  it("refunds a chat slot only once for the same operation id", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeChat",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3
    });
    await postQuota(quota, {
      action: "consumeChat",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3
    });

    const firstRefund = await postQuota(quota, {
      action: "refundChat",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      operationId: "chat-op-duplicate"
    });
    const secondRefund = await postQuota(quota, {
      action: "refundChat",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      operationId: "chat-op-duplicate"
    });

    await expect(firstRefund.json()).resolves.toMatchObject({
      usage: {
        chatsUsed: 1
      },
      didMutate: true
    });
    await expect(secondRefund.json()).resolves.toMatchObject({
      usage: {
        chatsUsed: 1
      },
      didMutate: false
    });
  });

  it("treats a chat refund with no consumed slot as a non-negative no-op", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const refunded = await postQuota(quota, {
      action: "refundChat",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      operationId: "chat-op-empty-refund"
    });

    await expect(refunded.json()).resolves.toMatchObject({
      usage: {
        chatsUsed: 0
      },
      didMutate: false
    });
  });

  it("refunds a newly saved ticker and reports mutation state", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "AAPL",
      chatLimit: 3,
      stockLimit: 3
    });

    const refunded = await postQuota(quota, {
      action: "refundStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "AAPL",
      chatLimit: 3,
      stockLimit: 3
    });

    await expect(refunded.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 0,
        savedTickers: []
      },
      didMutate: true
    });
  });

  it("removes a related issuer group when any sibling ticker is removed", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "BRK-A",
      relatedTickers: ["BRK-B"],
      chatLimit: 3,
      stockLimit: 3
    });

    const removed = await postQuota(quota, {
      action: "removeTicker",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "BRK-B",
      relatedTickers: ["BRK-A"],
      chatLimit: 3,
      stockLimit: 3
    });

    await expect(removed.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 0,
        savedTickers: []
      },
      didMutate: true
    });
  });

  it("treats refunding an unknown ticker as a no-op", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const refunded = await postQuota(quota, {
      action: "refundStock",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      ticker: "AAPL",
      chatLimit: 3,
      stockLimit: 3
    });

    await expect(refunded.json()).resolves.toMatchObject({
      usage: {
        stocksUsed: 0,
        savedTickers: []
      },
      didMutate: false
    });
  });

  it("returns monthly credit state in the usage payload", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const response = await postQuota(quota, {
      action: "state",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      usage: {
        credits: {
          monthlyRemaining: 30,
          monthlyLimit: 30,
          purchasedRemaining: 0,
          totalRemaining: 30,
          resetsAt: "2026-05-01T00:00:00+09:00"
        }
      }
    });
  });

  it("ensures a monthly credit grant only once per plan period", async () => {
    const quota = new UserQuotaDO(createState() as never);
    const body = {
      action: "ensureMonthlyCreditGrant",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30
    };

    const first = await postQuota(quota, body);
    const second = await postQuota(quota, body);

    await expect(first.json()).resolves.toMatchObject({
      didMutate: true,
      monthlyGrant: {
        operationId: "monthly-grant:free:2026-04-01T00:00:00+09:00:2026-05-01T00:00:00+09:00",
        plan: "free",
        creditsGranted: 30,
        balanceAfter: 30
      },
      usage: {
        credits: {
          monthlyRemaining: 30,
          monthlyLimit: 30,
          totalRemaining: 30
        }
      }
    });
    await expect(second.json()).resolves.toMatchObject({
      didMutate: false,
      usage: {
        credits: {
          monthlyRemaining: 30,
          totalRemaining: 30
        }
      }
    });
  });

  it("grants only the same-period subscription upgrade delta and keeps paid credits separate", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const lite = await postQuota(quota, {
      action: "ensureMonthlyCreditGrant",
      quotaSubject: "free:test-device",
      plan: "lite",
      dateJST: "2026-05-10",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 400,
      monthlyCreditPeriodStart: "2026-05-01T00:00:00.000Z",
      monthlyCreditPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyGrantOperationId: "sub-grant:lite"
    });
    await postQuota(quota, {
      action: "grantPurchasedCredit",
      quotaSubject: "free:test-device",
      plan: "lite",
      dateJST: "2026-05-10",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 400,
      monthlyCreditPeriodStart: "2026-05-01T00:00:00.000Z",
      monthlyCreditPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyGrantOperationId: "sub-grant:lite",
      operationId: "purchase:tx-50",
      productId: "kabuyomi.credits.50",
      transactionId: "tx-50",
      purchaseCredits: 50
    });
    const pro = await postQuota(quota, {
      action: "ensureMonthlyCreditGrant",
      quotaSubject: "free:test-device",
      plan: "pro",
      dateJST: "2026-05-10",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 900,
      monthlyCreditPeriodStart: "2026-05-01T00:00:00.000Z",
      monthlyCreditPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyGrantOperationId: "sub-grant:pro"
    });
    const downgrade = await postQuota(quota, {
      action: "ensureMonthlyCreditGrant",
      quotaSubject: "free:test-device",
      plan: "lite",
      dateJST: "2026-05-10",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 400,
      monthlyCreditPeriodStart: "2026-05-01T00:00:00.000Z",
      monthlyCreditPeriodEnd: "2026-06-01T00:00:00.000Z",
      monthlyGrantOperationId: "sub-grant:lite-downgrade"
    });

    await expect(lite.json()).resolves.toMatchObject({
      monthlyGrant: {
        operationId: "sub-grant:lite",
        creditsGranted: 400
      }
    });
    await expect(pro.json()).resolves.toMatchObject({
      monthlyGrant: {
        operationId: "sub-grant:pro",
        creditsGranted: 500
      },
      usage: {
        credits: {
          monthlyLimit: 900,
          monthlyRemaining: 900,
          purchasedRemaining: 50,
          totalRemaining: 950
        }
      }
    });
    await expect(downgrade.json()).resolves.toMatchObject({
      didMutate: false,
      creditOperation: {
        operationId: expect.stringContaining("monthly-downgrade-no-clawback:lite:900->400"),
        type: "monthly_grant",
        status: "noop",
        delta: 0,
        referenceType: "subscription_downgrade_no_clawback",
        monthlyBalanceAfter: 900,
        purchasedBalanceAfter: 50
      },
      usage: {
        plan: "lite",
        credits: {
          monthlyLimit: 900,
          monthlyRemaining: 900,
          purchasedRemaining: 50,
          totalRemaining: 950
        }
      }
    });
  });

  it("keeps same-period Max to Pro downgrades no-clawback and idempotent", async () => {
    const quota = new UserQuotaDO(createState() as never);
    const base = {
      action: "ensureMonthlyCreditGrant",
      quotaSubject: "free:test-device",
      dateJST: "2026-05-10",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditPeriodStart: "2026-05-01T00:00:00.000Z",
      monthlyCreditPeriodEnd: "2026-06-01T00:00:00.000Z"
    };

    await postQuota(quota, {
      ...base,
      plan: "pro_max",
      monthlyCreditLimit: 2000,
      monthlyGrantOperationId: "sub-grant:max"
    });
    const firstDowngrade = await postQuota(quota, {
      ...base,
      plan: "pro",
      monthlyCreditLimit: 900,
      monthlyGrantOperationId: "sub-grant:pro-downgrade"
    });
    const duplicateDowngrade = await postQuota(quota, {
      ...base,
      plan: "pro",
      monthlyCreditLimit: 900,
      monthlyGrantOperationId: "sub-grant:pro-downgrade"
    });

    await expect(firstDowngrade.json()).resolves.toMatchObject({
      creditOperation: {
        operationId: expect.stringContaining("monthly-downgrade-no-clawback:pro:2000->900"),
        status: "noop",
        delta: 0,
        referenceType: "subscription_downgrade_no_clawback",
        monthlyBalanceAfter: 2000
      },
      usage: {
        plan: "pro",
        credits: {
          monthlyLimit: 2000,
          monthlyRemaining: 2000,
          purchasedRemaining: 0,
          totalRemaining: 2000
        }
      }
    });
    const duplicatePayload = (await duplicateDowngrade.json()) as Record<string, unknown>;
    expect(duplicatePayload).not.toHaveProperty("creditOperation");
    expect(duplicatePayload).toMatchObject({
      usage: {
        plan: "pro",
        credits: {
          monthlyLimit: 2000,
          monthlyRemaining: 2000,
          purchasedRemaining: 0,
          totalRemaining: 2000
        }
      }
    });
  });

  it("grants exactly the same-period Pro to Max upgrade delta once", async () => {
    const quota = new UserQuotaDO(createState() as never);
    const base = {
      action: "ensureMonthlyCreditGrant",
      quotaSubject: "free:test-device",
      dateJST: "2026-05-10",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditPeriodStart: "2026-05-01T00:00:00.000Z",
      monthlyCreditPeriodEnd: "2026-06-01T00:00:00.000Z"
    };

    await postQuota(quota, {
      ...base,
      plan: "pro",
      monthlyCreditLimit: 900,
      monthlyGrantOperationId: "sub-grant:pro"
    });
    const max = await postQuota(quota, {
      ...base,
      plan: "pro_max",
      monthlyCreditLimit: 2000,
      monthlyGrantOperationId: "sub-grant:max"
    });
    const duplicateMax = await postQuota(quota, {
      ...base,
      plan: "pro_max",
      monthlyCreditLimit: 2000,
      monthlyGrantOperationId: "sub-grant:max"
    });

    await expect(max.json()).resolves.toMatchObject({
      monthlyGrant: {
        operationId: "sub-grant:max",
        creditsGranted: 1100,
        monthlyBalanceAfter: 2000
      },
      usage: {
        plan: "pro_max",
        credits: {
          monthlyLimit: 2000,
          monthlyRemaining: 2000,
          totalRemaining: 2000
        }
      }
    });
    const duplicatePayload = (await duplicateMax.json()) as Record<string, unknown>;
    expect(duplicatePayload).not.toHaveProperty("monthlyGrant");
    expect(duplicatePayload).toMatchObject({
      usage: {
        plan: "pro_max",
        credits: {
          monthlyLimit: 2000,
          monthlyRemaining: 2000,
          totalRemaining: 2000
        }
      }
    });
  });

  it("consumes credit once for the same operation id", async () => {
    const quota = new UserQuotaDO(createState() as never);
    const body = {
      action: "consumeCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "chat-op-1",
      creditsRequired: 1,
      referenceType: "chat",
      referenceId: "filing-1"
    };

    const first = await postQuota(quota, body);
    const second = await postQuota(quota, body);

    await expect(first.json()).resolves.toMatchObject({
      usage: {
        credits: {
          totalRemaining: 29
        }
      },
      didMutate: true,
      creditOperation: {
        operationId: "chat-op-1",
        type: "consume",
        status: "applied",
        delta: -1,
        balanceAfter: 29
      },
      creditsRemaining: 29
    });
    await expect(second.json()).resolves.toMatchObject({
      usage: {
        credits: {
          totalRemaining: 29
        }
      },
      didMutate: false,
      creditOperation: {
        operationId: "chat-op-1",
        status: "applied",
        delta: -1
      },
      creditsRemaining: 29
    });
  });

  it("returns insufficient_credits without decrementing the balance", async () => {
    const quota = new UserQuotaDO(createState() as never);

    const response = await postQuota(quota, {
      action: "consumeCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 0,
      operationId: "chat-op-empty",
      creditsRequired: 1,
      referenceType: "chat",
      referenceId: "filing-1"
    });

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toMatchObject({
      error: "insufficient_credits",
      usage: {
        credits: {
          totalRemaining: 0
        }
      },
      didMutate: false,
      creditOperation: {
        status: "insufficient",
        delta: 0
      },
      creditsRequired: 1,
      creditsRemaining: 0
    });
  });

  it("refunds a credit operation only once", async () => {
    const quota = new UserQuotaDO(createState() as never);

    await postQuota(quota, {
      action: "consumeCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "chat-op-2",
      creditsRequired: 1,
      referenceType: "chat",
      referenceId: "filing-1"
    });

    const firstRefund = await postQuota(quota, {
      action: "refundCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "refund-chat-op-2",
      originalOperationId: "chat-op-2",
      credits: 1,
      referenceType: "chat",
      referenceId: "filing-1"
    });
    const secondRefund = await postQuota(quota, {
      action: "refundCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "refund-chat-op-2-again",
      originalOperationId: "chat-op-2",
      credits: 1,
      referenceType: "chat",
      referenceId: "filing-1"
    });

    await expect(firstRefund.json()).resolves.toMatchObject({
      usage: {
        credits: {
          totalRemaining: 30
        }
      },
      didMutate: true,
      creditOperation: {
        type: "refund",
        status: "applied",
        delta: 1
      }
    });
    await expect(secondRefund.json()).resolves.toMatchObject({
      usage: {
        credits: {
          totalRemaining: 30
        }
      },
      didMutate: false,
      creditOperation: {
        type: "refund",
        status: "noop",
        delta: 0
      }
    });
  });

  it("grants purchased credits only once for the same transaction id", async () => {
    const quota = new UserQuotaDO(createState() as never);
    const body = {
      action: "grantPurchasedCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "purchase:tx-100",
      transactionId: "tx-100",
      productId: "kabuyomi.credits.100",
      originalTransactionId: "orig-tx-100",
      purchasedAt: "2026-04-16T00:00:00.000Z",
      purchaseCredits: 100
    };

    const first = await postQuota(quota, body);
    const second = await postQuota(quota, body);

    await expect(first.json()).resolves.toMatchObject({
      didMutate: true,
      usage: {
        credits: {
          monthlyRemaining: 30,
          purchasedRemaining: 100,
          totalRemaining: 130
        }
      },
      creditOperation: {
        operationId: "purchase:tx-100",
        type: "purchase_grant",
        status: "applied",
        delta: 100,
        balanceAfter: 130,
        monthlyBalanceAfter: 30,
        purchasedBalanceAfter: 100,
        referenceType: "purchase",
        referenceId: "tx-100"
      },
      creditsRemaining: 130
    });
    await expect(second.json()).resolves.toMatchObject({
      didMutate: false,
      usage: {
        credits: {
          monthlyRemaining: 30,
          purchasedRemaining: 100,
          totalRemaining: 130
        }
      },
      creditOperation: {
        operationId: "purchase:tx-100",
        type: "purchase_grant",
        delta: 100,
        balanceAfter: 130
      },
      creditsRemaining: 130
    });
  });

  it("prunes credit operation idempotency records after 30 days", async () => {
    const quota = new UserQuotaDO(
      createState({
        "credit_operation:old-op": {
          operationId: "old-op",
          type: "consume",
          status: "applied",
          delta: -1,
          balanceAfter: 29,
          monthlyBalanceAfter: 29,
          purchasedBalanceAfter: 0,
          createdAt: "2026-03-01T00:00:00.000Z"
        }
      }) as never
    );

    await postQuota(quota, {
      action: "consumeCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "new-op",
      creditsRequired: 1,
      referenceType: "chat",
      referenceId: "filing-1"
    });

    const repeatedOldOperation = await postQuota(quota, {
      action: "consumeCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "old-op",
      creditsRequired: 1,
      referenceType: "chat",
      referenceId: "filing-1"
    });

    await expect(repeatedOldOperation.json()).resolves.toMatchObject({
      didMutate: true,
      creditOperation: {
        operationId: "old-op",
        status: "applied"
      },
      usage: {
        credits: {
          totalRemaining: 28
        }
      }
    });
  });

  it("grants rewarded ad credits into a promotional bucket idempotently", async () => {
    useRewardedAdTestClock();
    const quota = new UserQuotaDO(createState() as never);

    const first = await postQuota(quota, {
      action: "grantRewardedAdCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "admob-reward:tx-1",
      credits: 2,
      promoExpiresAt: "2026-05-16T00:00:00.000Z",
      dailyRewardDateKey: "2026-04-16",
      dailyRewardCap: 3,
      transactionId: "tx-1",
      referenceType: "admob_rewarded",
      referenceId: "intent-1"
    });
    const duplicate = await postQuota(quota, {
      action: "grantRewardedAdCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "admob-reward:tx-1",
      credits: 2,
      promoExpiresAt: "2026-05-16T00:00:00.000Z",
      dailyRewardDateKey: "2026-04-16",
      dailyRewardCap: 3,
      transactionId: "tx-1",
      referenceType: "admob_rewarded",
      referenceId: "intent-1"
    });

    await expect(first.json()).resolves.toMatchObject({
      didMutate: true,
      creditOperation: {
        type: "admob_rewarded_grant",
        delta: 2,
        rewardedAdBalanceAfter: 2,
        rewardedAdExpiresAt: "2026-05-16T00:00:00.000Z"
      },
      usage: {
        credits: {
          monthlyRemaining: 30,
          rewardedAdRemaining: 2,
          purchasedRemaining: 0,
          totalRemaining: 32
        }
      },
      dailyRewardsUsed: 1,
      dailyRewardsRemaining: 2
    });
    await expect(duplicate.json()).resolves.toMatchObject({
      didMutate: false,
      usage: {
        credits: {
          rewardedAdRemaining: 2,
          totalRemaining: 32
        }
      },
      dailyRewardsUsed: 1,
      dailyRewardsRemaining: 2
    });
  });

  it("serializes rewarded ad daily cap grants per user and day", async () => {
    useRewardedAdTestClock();
    const quota = new UserQuotaDO(createSerialState() as never);
    const grantBody = (index: number) => ({
      action: "grantRewardedAdCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: `admob-reward:tx-${index}`,
      credits: 2,
      promoExpiresAt: "2026-05-16T00:00:00.000Z",
      dailyRewardDateKey: "2026-04-16",
      dailyRewardCap: 3,
      transactionId: `tx-${index}`,
      referenceType: "admob_rewarded",
      referenceId: `intent-${index}`
    });

    const responses = await Promise.all([1, 2, 3, 4, 5].map((index) => postQuota(quota, grantBody(index))));
    const payloads = await Promise.all(
      responses.map(async (response) => ({ status: response.status, body: (await response.json()) as Record<string, any> }))
    );

    expect(payloads.filter((payload) => payload.status === 200 && payload.body.didMutate === true)).toHaveLength(3);
    expect(payloads.filter((payload) => payload.status === 429 && payload.body.error === "daily_cap_reached")).toHaveLength(2);
    expect(payloads[payloads.length - 1]?.body).toMatchObject({
      dailyRewardsUsed: 3,
      dailyRewardsRemaining: 0,
      usage: {
        credits: {
          rewardedAdRemaining: 6,
          totalRemaining: 36
        }
      }
    });
  });

  it("does not increment rewarded ad daily count for concurrent duplicate transactions", async () => {
    useRewardedAdTestClock();
    const quota = new UserQuotaDO(createSerialState() as never);
    const body = {
      action: "grantRewardedAdCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "admob-reward:tx-duplicate",
      credits: 2,
      promoExpiresAt: "2026-05-16T00:00:00.000Z",
      dailyRewardDateKey: "2026-04-16",
      dailyRewardCap: 3,
      transactionId: "tx-duplicate",
      referenceType: "admob_rewarded",
      referenceId: "intent-duplicate"
    };

    const responses = await Promise.all([0, 1, 2, 3].map(() => postQuota(quota, body)));
    const payloads = await Promise.all(
      responses.map(async (response) => ({ status: response.status, body: (await response.json()) as Record<string, any> }))
    );

    expect(payloads.every((payload) => payload.status === 200)).toBe(true);
    expect(payloads.filter((payload) => payload.body.didMutate === true)).toHaveLength(1);
    expect(payloads.every((payload) => payload.body.dailyRewardsUsed === 1)).toBe(true);
    expect(payloads.every((payload) => payload.body.dailyRewardsRemaining === 2)).toBe(true);
    expect(payloads[payloads.length - 1]?.body).toMatchObject({
      usage: {
        credits: {
          rewardedAdRemaining: 2,
          totalRemaining: 32
        }
      }
    });
  });

  it("resets rewarded ad daily cap on the next day", async () => {
    useRewardedAdTestClock();
    const quota = new UserQuotaDO(createSerialState() as never);
    const grant = (index: number, day: string) =>
      postQuota(quota, {
        action: "grantRewardedAdCredit",
        quotaSubject: "free:test-device",
        plan: "free",
        dateJST: day,
        chatLimit: 3,
        stockLimit: 3,
        monthlyCreditLimit: 30,
        operationId: `admob-reward:${day}:tx-${index}`,
        credits: 2,
        promoExpiresAt: "2026-05-16T00:00:00.000Z",
        dailyRewardDateKey: day,
        dailyRewardCap: 3,
        transactionId: `${day}:tx-${index}`,
        referenceType: "admob_rewarded",
        referenceId: `${day}:intent-${index}`
      });

    await Promise.all([1, 2, 3].map((index) => grant(index, "2026-04-16")));
    const capped = await grant(4, "2026-04-16");
    const nextDay = await grant(1, "2026-04-17");

    expect(capped.status).toBe(429);
    await expect(capped.json()).resolves.toMatchObject({
      error: "daily_cap_reached",
      dailyRewardsUsed: 3,
      dailyRewardsRemaining: 0
    });
    expect(nextDay.status).toBe(200);
    await expect(nextDay.json()).resolves.toMatchObject({
      didMutate: true,
      dailyRewardsUsed: 1,
      dailyRewardsRemaining: 2,
      usage: {
        credits: {
          rewardedAdRemaining: 8,
          totalRemaining: 38
        }
      }
    });
  });

  it("consumes rewarded ad credits before paid credits after monthly credits are exhausted", async () => {
    useRewardedAdTestClock();
    const quota = new UserQuotaDO(
      createState({
        credit_state: {
          plan: "free",
          periodStart: "2026-04-01T00:00:00+09:00",
          periodEnd: "2026-05-01T00:00:00+09:00",
          monthlyRemaining: 0,
          monthlyLimit: 30,
          rewardedAdRemaining: 2,
          rewardedAdExpiresAt: "2026-05-16T00:00:00.000Z",
          purchasedRemaining: 10,
          updatedAt: "2026-04-16T00:00:00.000Z"
        }
      }) as never
    );

    const response = await postQuota(quota, {
      action: "consumeCredit",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-04-16",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 30,
      operationId: "chat-op-1",
      creditsRequired: 2,
      referenceType: "chat",
      referenceId: "filing-1"
    });

    await expect(response.json()).resolves.toMatchObject({
      creditOperation: {
        consumedRewardedAd: 2,
        consumedPurchased: 0
      },
      usage: {
        credits: {
          rewardedAdRemaining: 0,
          purchasedRemaining: 10,
          totalRemaining: 10
        }
      }
    });
  });
});
