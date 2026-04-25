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
      stockLimit: 3
    });

    await expect(refunded.json()).resolves.toMatchObject({
      usage: {
        chatsUsed: 0
      },
      didMutate: true
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
});
