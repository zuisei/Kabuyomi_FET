import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserQuotaDO } from "../src/durable/user-quota";

const REWARDED_AD_TEST_NOW = new Date("2026-04-16T00:00:00.000Z");

interface TestDurableStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string; reverse?: boolean; limit?: number }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  transaction<T>(callback: (storage: TestDurableStorage) => Promise<T>): Promise<T>;
}

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

function createCloningSerialState(initialEntries: Record<string, unknown> = {}) {
  const storage = new Map<string, unknown>(
    Object.entries(initialEntries).map(([key, value]) => [key, structuredClone(value)])
  );
  let tail = Promise.resolve();
  let alarmAt: number | null = null;

  const storageApi: TestDurableStorage = {
      async get<T>(key: string) {
        const value = storage.get(key);
        return value === undefined ? undefined : structuredClone(value) as T;
      },
      async put(key: string, value: unknown) {
        storage.set(key, structuredClone(value));
      },
      async delete(key: string) {
        return storage.delete(key);
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
        return new Map(
          entries.slice(0, limit ?? entries.length).map(([key, value]) => [key, structuredClone(value)])
        ) as Map<string, T>;
      },
      async getAlarm() {
        return alarmAt;
      },
      async setAlarm(scheduledTime: number | Date) {
        alarmAt = scheduledTime instanceof Date ? scheduledTime.getTime() : scheduledTime;
      },
      async deleteAlarm() {
        alarmAt = null;
      },
      async transaction<T>(callback: (storage: TestDurableStorage) => Promise<T>) {
        return callback(storageApi);
      }
  };

  return {
    storage: storageApi,
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

async function postRequestExecution(
  quota: UserQuotaDO,
  body: Record<string, unknown>
) {
  return quota.fetch(
    new Request("https://do/request-execution", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

async function postPurchaseAdjustment(
  quota: UserQuotaDO,
  body: Record<string, unknown>
) {
  return quota.fetch(
    new Request("https://do/purchase-adjustment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
}

async function postPrincipalMigration(quota: UserQuotaDO, body: Record<string, unknown>) {
  return quota.fetch(new Request("https://do/principal-migration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
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
      quotaSubject: "subscription:test",
      plan: "lite",
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

  it("claws back only available purchased credits and carries the spent portion as non-negative refund debt", async () => {
    const state = createState();
    const quota = new UserQuotaDO(state as never);
    const base = {
      quotaSubject: "account:test-refund",
      plan: "free",
      dateJST: "2026-07-11",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 0
    };
    await postQuota(quota, {
      ...base,
      action: "grantPurchasedCredit",
      operationId: "purchase:tx-refund-1",
      transactionId: "tx-refund-1",
      productId: "kabuyomi.credits.100",
      purchaseCredits: 100
    });
    await postQuota(quota, {
      ...base,
      action: "consumeCredit",
      operationId: "consume:spent-before-refund",
      creditsRequired: 60,
      referenceType: "chat",
      referenceId: "spent-before-refund"
    });

    const refund = await postPurchaseAdjustment(quota, {
      action: "refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-refund-1",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "refund-notification-a"
    });
    await expect(refund.json()).resolves.toMatchObject({
      outcome: "refunded",
      didMutate: true,
      purchaseState: "refunded",
      operation: {
        type: "purchase_refund",
        delta: -40,
        purchasedBalanceAfter: 0,
        purchaseRefundDebtAfter: 60,
        refundAvailableRemoved: 40,
        refundDebtCreated: 60
      }
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 60
    });

    const duplicate = await postPurchaseAdjustment(quota, {
      action: "refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-refund-1",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "a-distinct-duplicate-notification"
    });
    await expect(duplicate.json()).resolves.toMatchObject({
      outcome: "refunded",
      didMutate: false,
      operation: { delta: -40, refundDebtCreated: 60 }
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 60
    });

    const reversal = await postPurchaseAdjustment(quota, {
      action: "reverse_refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-refund-1",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "refund-reversed-notification-a"
    });
    await expect(reversal.json()).resolves.toMatchObject({
      outcome: "reinstated",
      didMutate: true,
      purchaseState: "reinstated",
      operation: {
        type: "purchase_refund_reversal",
        delta: 40,
        purchasedBalanceAfter: 40,
        purchaseRefundDebtAfter: 0,
        refundDebtReleased: 60,
        refundDebtSettledRestored: 0,
        refundCreditsRestored: 40
      }
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      purchasedRemaining: 40,
      purchasedRefundDebt: 0
    });

    const duplicateReversal = await postPurchaseAdjustment(quota, {
      action: "reverse_refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-refund-1",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "another-distinct-reversal-notification"
    });
    await expect(duplicateReversal.json()).resolves.toMatchObject({
      outcome: "reinstated",
      didMutate: false,
      operation: { delta: 40 }
    });
  });

  it("offsets refund debt with future purchase grants and never creates a negative purchased balance", async () => {
    const state = createState();
    const quota = new UserQuotaDO(state as never);
    const base = {
      quotaSubject: "account:test-refund-debt",
      plan: "free",
      dateJST: "2026-07-11",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 0
    };
    await postQuota(quota, {
      ...base,
      action: "grantPurchasedCredit",
      operationId: "purchase:tx-debt-original",
      transactionId: "tx-debt-original",
      productId: "kabuyomi.credits.100",
      purchaseCredits: 100
    });
    await postQuota(quota, {
      ...base,
      action: "consumeCredit",
      operationId: "consume:all-original",
      creditsRequired: 100,
      referenceType: "chat",
      referenceId: "all-original"
    });
    await postPurchaseAdjustment(quota, {
      action: "refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-debt-original",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "refund-debt-notification"
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 100
    });

    const firstFutureGrant = await postQuota(quota, {
      ...base,
      action: "grantPurchasedCredit",
      operationId: "purchase:tx-debt-offset-50",
      transactionId: "tx-debt-offset-50",
      productId: "kabuyomi.credits.50",
      purchaseCredits: 50
    });
    await expect(firstFutureGrant.json()).resolves.toMatchObject({
      didMutate: true,
      usage: { credits: { purchasedRemaining: 0, purchasedRefundDebt: 50 } },
      creditOperation: { delta: 0, purchaseDebtOffset: 50, purchaseRefundDebtAfter: 50 }
    });

    const secondFutureGrant = await postQuota(quota, {
      ...base,
      action: "grantPurchasedCredit",
      operationId: "purchase:tx-debt-offset-100",
      transactionId: "tx-debt-offset-100",
      productId: "kabuyomi.credits.100",
      purchaseCredits: 100
    });
    await expect(secondFutureGrant.json()).resolves.toMatchObject({
      usage: { credits: { purchasedRemaining: 50, purchasedRefundDebt: 0 } },
      creditOperation: { delta: 50, purchaseDebtOffset: 50, purchaseRefundDebtAfter: 0 }
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      purchasedRemaining: 50,
      purchasedRefundDebt: 0
    });
  });

  it("restores later purchase value that already settled debt when the original refund is reversed", async () => {
    const state = createState();
    const quota = new UserQuotaDO(state as never);
    const base = {
      quotaSubject: "account:test-settled-debt-reversal",
      plan: "free",
      dateJST: "2026-07-11",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 0
    };
    await postQuota(quota, {
      ...base,
      action: "grantPurchasedCredit",
      operationId: "purchase:tx-settled-a",
      transactionId: "tx-settled-a",
      productId: "kabuyomi.credits.100",
      purchaseCredits: 100
    });
    await postQuota(quota, {
      ...base,
      action: "consumeCredit",
      operationId: "consume:all-settled-a",
      creditsRequired: 100,
      referenceType: "chat",
      referenceId: "all-settled-a"
    });
    await postPurchaseAdjustment(quota, {
      action: "refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-settled-a",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "refund-settled-a"
    });
    await postQuota(quota, {
      ...base,
      action: "grantPurchasedCredit",
      operationId: "purchase:tx-settled-b",
      transactionId: "tx-settled-b",
      productId: "kabuyomi.credits.50",
      purchaseCredits: 50
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 50
    });

    const reversed = await postPurchaseAdjustment(quota, {
      action: "reverse_refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-settled-a",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "reverse-settled-a"
    });
    await expect(reversed.json()).resolves.toMatchObject({
      outcome: "reinstated",
      didMutate: true,
      operation: {
        type: "purchase_refund_reversal",
        delta: 50,
        purchasedBalanceAfter: 50,
        purchaseRefundDebtAfter: 0,
        refundAvailableRemoved: 0,
        refundDebtCreated: 100,
        refundDebtReleased: 50,
        refundDebtSettledRestored: 50,
        refundCreditsRestored: 50
      }
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      purchasedRemaining: 50,
      purchasedRefundDebt: 0
    });

    await postQuota(quota, {
      ...base,
      action: "consumeCredit",
      operationId: "consume:restored-settled-b",
      creditsRequired: 50,
      referenceType: "chat",
      referenceId: "restored-settled-b"
    });
    const duplicate = await postPurchaseAdjustment(quota, {
      action: "reverse_refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-settled-a",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "distinct-duplicate-reverse-settled-a"
    });
    await expect(duplicate.json()).resolves.toMatchObject({
      outcome: "reinstated",
      didMutate: false,
      operation: { delta: 50, refundDebtSettledRestored: 50 }
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      purchasedRemaining: 0,
      purchasedRefundDebt: 0
    });
  });

  it("never grants an unclaimed notification and rejects mismatched purchase authority", async () => {
    const state = createState();
    const quota = new UserQuotaDO(state as never);
    const unclaimed = await postPurchaseAdjustment(quota, {
      action: "refund",
      quotaSubject: "account:unclaimed",
      transactionId: "tx-unclaimed",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      notificationId: "refund-unclaimed"
    });
    await expect(unclaimed.json()).resolves.toEqual({
      outcome: "unclaimed",
      didMutate: false,
      purchaseState: "unclaimed"
    });
    await expect(state.storage.get("credit_state")).resolves.toBeUndefined();

    const base = {
      quotaSubject: "account:authority",
      plan: "free",
      dateJST: "2026-07-11",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 0
    };
    await postQuota(quota, {
      ...base,
      action: "grantPurchasedCredit",
      operationId: "purchase:tx-authority",
      transactionId: "tx-authority",
      productId: "kabuyomi.credits.100",
      purchaseCredits: 100
    });
    const mismatch = await postPurchaseAdjustment(quota, {
      action: "refund",
      quotaSubject: base.quotaSubject,
      transactionId: "tx-authority",
      productId: "kabuyomi.credits.50",
      creditsGranted: 50,
      notificationId: "refund-authority-mismatch"
    });
    expect(mismatch.status).toBe(409);
    await expect(mismatch.json()).resolves.toEqual({ error: "purchase_authority_mismatch" });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 100 });
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
      monthlyCreditLimit: 0,
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

  it("grants welcome 50 once to a verified installation and never regrants at month boundary", async () => {
    const state = createState();
    const quota = new UserQuotaDO(state as never);
    const base = {
      action: "state",
      quotaSubject: "installation:v1:test",
      plan: "free",
      accessMode: "verified_installation",
      chatLimit: 25,
      stockLimit: 3,
      monthlyCreditLimit: 0
    };
    const first = await postQuota(quota, { ...base, dateJST: "2026-07-11" });
    await expect(first.json()).resolves.toMatchObject({
      usage: { credits: { monthlyLimit: 0, monthlyRemaining: 0, welcomeRemaining: 50, totalRemaining: 50 } }
    });
    const nextMonth = await postQuota(quota, { ...base, dateJST: "2026-08-11" });
    await expect(nextMonth.json()).resolves.toMatchObject({
      usage: { credits: { welcomeRemaining: 50, totalRemaining: 50 } }
    });
  });

  it("never grants welcome or recurring Free credits to a legacy compatibility identity", async () => {
    const state = createState();
    const quota = new UserQuotaDO(state as never);
    const base = {
      action: "state",
      quotaSubject: "free:device:legacy-compatibility",
      plan: "free",
      accessMode: "legacy_client_compatibility",
      chatLimit: 25,
      stockLimit: 3,
      monthlyCreditLimit: 0
    };

    const first = await postQuota(quota, { ...base, dateJST: "2026-07-11" });
    await expect(first.json()).resolves.toMatchObject({
      usage: {
        credits: {
          monthlyLimit: 0,
          monthlyRemaining: 0,
          welcomeRemaining: 0,
          purchasedRemaining: 0,
          totalRemaining: 0
        }
      }
    });
    const nextMonth = await postQuota(quota, { ...base, dateJST: "2026-08-11" });
    await expect(nextMonth.json()).resolves.toMatchObject({
      usage: { credits: { welcomeRemaining: 0, totalRemaining: 0 } }
    });
  });

  it("migrates a legacy Free monthly balance into welcome without duplication", async () => {
    const quota = new UserQuotaDO(createState({
      credit_state: {
        plan: "free", periodStart: "2026-07-01T00:00:00+09:00", periodEnd: "2026-08-01T00:00:00+09:00",
        monthlyRemaining: 31, monthlyLimit: 50, purchasedRemaining: 7, updatedAt: "2026-07-10T00:00:00Z"
      }
    }) as never);
    const response = await postQuota(quota, {
      action: "state", quotaSubject: "legacy", plan: "free", dateJST: "2026-07-11",
      chatLimit: 25, stockLimit: 3, monthlyCreditLimit: 0
    });
    await expect(response.json()).resolves.toMatchObject({
      usage: { credits: { monthlyRemaining: 0, monthlyLimit: 0, welcomeRemaining: 31, purchasedRemaining: 7, totalRemaining: 38 } }
    });
  });
});

describe("UserQuotaDO request execution state machine", () => {
  const EXECUTION_NOW = new Date("2026-07-10T00:00:00.000Z");
  const REQUEST_HASH = "a".repeat(64);
  const OTHER_REQUEST_HASH = "b".repeat(64);

  const beginBody = (overrides: Record<string, unknown> = {}) => ({
    action: "begin",
    operationId: "chat-execution-1",
    requestHash: REQUEST_HASH,
    route: "chat",
    allowCreate: true,
    executionPolicyVersion: "chat-v1",
    configSnapshot: {
      provider: "openai",
      model: "gpt-5-nano"
    },
    reservation: {
      mode: "unmetered"
    },
    ...overrides
  });

  const completedChatResult = (answer = "Stable answer") => ({
    kind: "chat",
    answer,
    sources: [
      {
        sourceId: "S1",
        sourceKind: "sec_filing",
        sourceStrength: "filing_primary",
        sectionType: "md_a",
        sourceLabel: "10-Q",
        excerpt: "Stable source excerpt"
      }
    ],
    responsePath: "openai",
    modelName: "gpt-5-nano",
    creditsCharged: 0
  });

  const completeBody = (overrides: Record<string, unknown> = {}) => ({
    action: "complete",
    operationId: "chat-execution-1",
    requestHash: REQUEST_HASH,
    route: "chat",
    resultBody: completedChatResult(),
    resultMetadata: {
      provider: "openai",
      model: "gpt-5-nano",
      chargeable: true
    },
    chargeable: true,
    ...overrides
  });

  const failBody = (overrides: Record<string, unknown> = {}) => ({
    action: "fail",
    operationId: "chat-execution-1",
    requestHash: REQUEST_HASH,
    route: "chat",
    failureCode: "provider_unavailable",
    failureStatus: 503,
    failureDetails: {
      provider: "openai"
    },
    ...overrides
  });

  const creditBeginBody = (
    operationId: string,
    requestHash: string,
    creditsRequired: number,
    overrides: Record<string, unknown> = {}
  ) => beginBody({
    operationId,
    requestHash,
    reservation: {
      mode: "credits",
      creditsRequired,
      referenceType: "chat",
      referenceId: "filing-1",
      quota: {
        plan: "free",
        dateJST: "2026-07-10",
        monthlyCreditLimit: 0
      }
    },
    ...overrides
  });

  const legacyBeginBody = (
    operationId: string,
    requestHash: string,
    overrides: Record<string, unknown> = {}
  ) => beginBody({
    operationId,
    requestHash,
    reservation: {
      mode: "legacy_chat",
      slots: 1,
      quota: {
        plan: "free",
        dateJST: "2026-07-10",
        chatLimit: 1
      }
    },
    ...overrides
  });

  const creditState = (overrides: Record<string, unknown> = {}) => ({
    plan: "free",
    periodStart: "2026-07-01T00:00:00+09:00",
    periodEnd: "2026-08-01T00:00:00+09:00",
    monthlyRemaining: 0,
    monthlyLimit: 0,
    rewardedAdRemaining: 0,
    rewardedAdLots: [],
    welcomeRemaining: 0,
    welcomeMigrationVersion: 1,
    purchasedRemaining: 0,
    updatedAt: "2026-07-10T00:00:00.000Z",
    ...overrides
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(EXECUTION_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a dedicated validated endpoint with safe response headers and a 128 KiB body limit", async () => {
    const quota = new UserQuotaDO(createCloningSerialState() as never);

    const methodResponse = await quota.fetch(new Request("https://do/request-execution", { method: "GET" }));
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get("allow")).toBe("POST");
    expect(methodResponse.headers.get("cache-control")).toBe("no-store");
    expect(methodResponse.headers.get("x-content-type-options")).toBe("nosniff");

    const invalidResponse = await postRequestExecution(quota, {
      action: "begin",
      operationId: "missing-required-fields"
    });
    expect(invalidResponse.status).toBe(400);
    expect(invalidResponse.headers.get("cache-control")).toBe("no-store");
    await expect(invalidResponse.json()).resolves.toEqual({
      error: "Invalid request execution payload"
    });

    const oversizedResponse = await postRequestExecution(quota, {
      ...completeBody(),
      resultBody: completedChatResult("x".repeat(132_000))
    });
    expect(oversizedResponse.status).toBe(413);
    await expect(oversizedResponse.json()).resolves.toEqual({
      error: "Request execution payload is too large"
    });
  });

  it("does not create execution or quota state when allowCreate is false", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);

    const response = await postRequestExecution(quota, beginBody({ allowCreate: false }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ outcome: "not_started" });
    await expect(state.storage.list()).resolves.toEqual(new Map());
  });

  it("creates one leader and nineteen pending followers for twenty concurrent exact begins", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () => postRequestExecution(quota, beginBody()))
    );
    const payloads = await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        retryAfter: response.headers.get("retry-after"),
        body: await response.json() as Record<string, unknown>
      }))
    );

    expect(payloads.filter(({ body }) => body.outcome === "leader")).toHaveLength(1);
    expect(payloads.filter(({ body }) => body.outcome === "pending")).toHaveLength(19);
    expect(payloads.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(payloads.filter(({ status }) => status === 202)).toHaveLength(19);
    expect(
      payloads
        .filter(({ body }) => body.outcome === "pending")
        .every(({ retryAfter, body }) => retryAfter === "300" && body.retryAfterSeconds === 300)
    ).toBe(true);

    const stored = await state.storage.get<Record<string, unknown>>("request_execution:chat-execution-1");
    expect(stored).toMatchObject({
      operationId: "chat-execution-1",
      requestHash: REQUEST_HASH,
      route: "chat",
      status: "pending",
      executionPolicyVersion: "chat-v1",
      createdAt: "2026-07-10T00:00:00.000Z",
      pendingExpiresAt: "2026-07-10T00:05:00.000Z"
    });
    expect(stored).toHaveProperty("reservationId", "reservation:chat-execution-1");
    expect(stored).not.toHaveProperty("resultBody");
    expect(await state.storage.get("credit_state")).toBeUndefined();
  });

  it("rejects operation id reuse with a different hash or route without mutating the leader", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, beginBody());

    const changedHash = await postRequestExecution(
      quota,
      beginBody({ requestHash: OTHER_REQUEST_HASH })
    );
    const changedRoute = await postRequestExecution(
      quota,
      beginBody({ route: "quote_translation" })
    );

    for (const response of [changedHash, changedRoute]) {
      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        outcome: "payload_mismatch",
        error: "operation_id_payload_mismatch"
      });
    }
    await expect(state.storage.get("request_execution:chat-execution-1")).resolves.toMatchObject({
      requestHash: REQUEST_HASH,
      route: "chat",
      status: "pending"
    });
  });

  it("completes once, replays stable data across config changes, and preserves the first completion", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, beginBody());

    const firstComplete = await postRequestExecution(quota, completeBody());
    expect(firstComplete.status).toBe(200);
    await expect(firstComplete.json()).resolves.toEqual({
      outcome: "completed",
      didMutate: true,
      reservationStatus: "committed",
      creditsCharged: 0,
      completedAt: "2026-07-10T00:00:00.000Z",
      resultExpiresAt: "2026-07-17T00:00:00.000Z"
    });

    const duplicateComplete = await postRequestExecution(
      quota,
      completeBody({
        resultBody: completedChatResult("A later completion must not overwrite the first"),
        resultMetadata: { provider: "other-provider" }
      })
    );
    expect(duplicateComplete.status).toBe(200);
    await expect(duplicateComplete.json()).resolves.toMatchObject({
      outcome: "completed",
      didMutate: false,
      completedAt: "2026-07-10T00:00:00.000Z"
    });

    const replay = await postRequestExecution(
      quota,
      beginBody({
        executionPolicyVersion: "chat-v2",
        configSnapshot: {
          provider: "other-provider",
          model: "future-model"
        }
      })
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      outcome: "replay",
      result: completedChatResult(),
      resultMetadata: {
        provider: "openai",
        model: "gpt-5-nano",
        chargeable: true,
        creditsCharged: 0
      }
    });

    await expect(state.storage.get("request_execution:chat-execution-1")).resolves.toMatchObject({
      status: "completed",
      executionPolicyVersion: "chat-v1",
      configSnapshot: {
        provider: "openai",
        model: "gpt-5-nano"
      },
      resultBody: completedChatResult(),
      resultMetadata: {
        provider: "openai",
        model: "gpt-5-nano",
        chargeable: true,
        creditsCharged: 0
      }
    });
  });

  it("accepts a realistic cached result below 128 KiB", async () => {
    const quota = new UserQuotaDO(createCloningSerialState() as never);
    await postRequestExecution(quota, beginBody());
    const largeResult = completedChatResult("x".repeat(100_000));

    const completed = await postRequestExecution(
      quota,
      completeBody({ resultBody: largeResult })
    );
    expect(completed.status).toBe(200);

    const replay = await postRequestExecution(quota, beginBody());
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      outcome: "replay",
      result: largeResult
    });
  });

  it("expires only the cached body after seven days and never creates a new leader", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, beginBody());
    await postRequestExecution(quota, completeBody());

    vi.setSystemTime(new Date("2026-07-17T00:00:00.000Z"));
    const expired = await postRequestExecution(quota, beginBody());

    expect(expired.status).toBe(410);
    await expect(expired.json()).resolves.toEqual({
      outcome: "result_expired",
      error: "operation_result_expired"
    });
    const stored = await state.storage.get<Record<string, unknown>>("request_execution:chat-execution-1");
    expect(stored).toMatchObject({
      operationId: "chat-execution-1",
      requestHash: REQUEST_HASH,
      route: "chat",
      status: "completed",
      completedAt: "2026-07-10T00:00:00.000Z",
      resultExpiresAt: "2026-07-17T00:00:00.000Z"
    });
    expect(stored).not.toHaveProperty("resultBody");

    const expiredAgain = await postRequestExecution(quota, beginBody({ allowCreate: true }));
    expect(expiredAgain.status).toBe(410);
    await expect(expiredAgain.json()).resolves.toMatchObject({ outcome: "result_expired" });
  });

  it("terminalizes a five-minute-old pending execution instead of unsafely reclaiming it", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, beginBody());

    vi.setSystemTime(new Date("2026-07-10T00:05:00.000Z"));
    const expiredPending = await postRequestExecution(quota, beginBody());

    expect(expiredPending.status).toBe(504);
    await expect(expiredPending.json()).resolves.toEqual({
      outcome: "failed",
      failureCode: "credit_reservation_expired",
      failureStatus: 504,
      failureDetails: {
        reservationExpiredAt: "2026-07-10T00:05:00.000Z"
      },
      didMutate: false
    });
    await expect(state.storage.get("request_execution:chat-execution-1")).resolves.toMatchObject({
      status: "failed",
      failureCode: "credit_reservation_expired",
      failureStatus: 504,
      failedAt: "2026-07-10T00:05:00.000Z"
    });

    const lateComplete = await postRequestExecution(quota, completeBody());
    expect(lateComplete.status).toBe(409);
    await expect(lateComplete.json()).resolves.toMatchObject({
      outcome: "failed",
      error: "request_execution_already_failed"
    });

    const retriedBegin = await postRequestExecution(quota, beginBody());
    expect(retriedBegin.status).toBe(504);
    await expect(retriedBegin.json()).resolves.toMatchObject({
      outcome: "failed",
      failureCode: "credit_reservation_expired",
      didMutate: false
    });
  });

  it("persists explicit failure as an immutable terminal outcome and makes repeated failure idempotent", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, beginBody());

    const failed = await postRequestExecution(quota, failBody());
    expect(failed.status).toBe(200);
    await expect(failed.json()).resolves.toEqual({
      outcome: "failed",
      failureCode: "provider_unavailable",
      failureStatus: 503,
      failureDetails: {
        provider: "openai"
      },
      didMutate: true,
      reservationStatus: "released"
    });

    const duplicateFailure = await postRequestExecution(
      quota,
      failBody({
        failureCode: "different_failure",
        failureStatus: 500,
        failureDetails: { provider: "other" }
      })
    );
    expect(duplicateFailure.status).toBe(200);
    await expect(duplicateFailure.json()).resolves.toEqual({
      outcome: "failed",
      failureCode: "provider_unavailable",
      failureStatus: 503,
      failureDetails: {
        provider: "openai"
      },
      didMutate: false
    });

    const retriedBegin = await postRequestExecution(quota, beginBody());
    expect(retriedBegin.status).toBe(503);
    await expect(retriedBegin.json()).resolves.toEqual({
      outcome: "failed",
      failureCode: "provider_unavailable",
      failureStatus: 503,
      failureDetails: {
        provider: "openai"
      },
      didMutate: false
    });
    await expect(state.storage.get("request_execution:chat-execution-1")).resolves.toMatchObject({
      status: "failed",
      failureCode: "provider_unavailable",
      failureStatus: 503,
      failureDetails: {
        provider: "openai"
      }
    });
  });

  it("treats failure after completion as an idempotent no-op preserving replay", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, beginBody());
    await postRequestExecution(quota, completeBody());

    const lateFailure = await postRequestExecution(quota, failBody());
    expect(lateFailure.status).toBe(200);
    await expect(lateFailure.json()).resolves.toMatchObject({
      outcome: "completed",
      didMutate: false
    });

    const replay = await postRequestExecution(quota, beginBody());
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      outcome: "replay",
      result: completedChatResult()
    });
    const stored = await state.storage.get<Record<string, unknown>>("request_execution:chat-execution-1");
    expect(stored).toMatchObject({ status: "completed", resultBody: completedChatResult() });
    expect(stored).not.toHaveProperty("failureCode");
  });

  it("rejects missing or mismatched completion and failure transitions", async () => {
    const quota = new UserQuotaDO(createCloningSerialState() as never);

    const missingComplete = await postRequestExecution(quota, completeBody());
    const missingFail = await postRequestExecution(quota, failBody());
    expect(missingComplete.status).toBe(409);
    expect(missingFail.status).toBe(409);
    await expect(missingComplete.json()).resolves.toEqual({ error: "request_execution_not_found" });
    await expect(missingFail.json()).resolves.toEqual({ error: "request_execution_not_found" });

    await postRequestExecution(quota, beginBody());
    const mismatchedComplete = await postRequestExecution(
      quota,
      completeBody({ requestHash: OTHER_REQUEST_HASH })
    );
    const mismatchedFailure = await postRequestExecution(
      quota,
      failBody({ route: "quote_translation" })
    );
    expect(mismatchedComplete.status).toBe(409);
    expect(mismatchedFailure.status).toBe(409);
    await expect(mismatchedComplete.json()).resolves.toMatchObject({
      outcome: "payload_mismatch",
      error: "operation_id_payload_mismatch"
    });
    await expect(mismatchedFailure.json()).resolves.toMatchObject({
      outcome: "payload_mismatch",
      error: "operation_id_payload_mismatch"
    });
  });

  it.each([
    { balance: 2, expectedLeaders: 1 },
    { balance: 4, expectedLeaders: 2 }
  ])("admits only $expectedLeaders provider-eligible leaders from ten unique cost-two requests with balance $balance", async ({
    balance,
    expectedLeaders
  }) => {
    const state = createCloningSerialState({
      credit_state: creditState({ purchasedRemaining: balance })
    });
    const quota = new UserQuotaDO(state as never);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        postRequestExecution(
          quota,
          creditBeginBody(
            `unique-credit-${balance}-${index}`,
            index.toString(16).padStart(64, "0"),
            2
          )
        )
      )
    );
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<Record<string, unknown>>));

    expect(payloads.filter((payload) => payload.outcome === "leader")).toHaveLength(expectedLeaders);
    expect(payloads.filter((payload) => payload.failureCode === "insufficient_credits")).toHaveLength(10 - expectedLeaders);
    const storedCredit = await state.storage.get<Record<string, unknown>>("credit_state");
    expect(storedCredit).toMatchObject({
      monthlyRemaining: 0,
      rewardedAdRemaining: 0,
      purchasedRemaining: 0
    });
    const reservations = await state.storage.list({ prefix: "credit_reservation:" });
    expect(reservations.size).toBe(expectedLeaders);
  });

  it("creates one credit reservation and one deduction for twenty exact duplicate begins", async () => {
    const operationId = "exact-credit-duplicates";
    const requestHash = "c".repeat(64);
    const state = createCloningSerialState({
      credit_state: creditState({ purchasedRemaining: 2 })
    });
    const quota = new UserQuotaDO(state as never);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        postRequestExecution(quota, creditBeginBody(operationId, requestHash, 2))
      )
    );
    const payloads = await Promise.all(responses.map((response) => response.json() as Promise<Record<string, unknown>>));

    expect(payloads.filter((payload) => payload.outcome === "leader")).toHaveLength(1);
    expect(payloads.filter((payload) => payload.outcome === "pending")).toHaveLength(19);
    expect((await state.storage.list({ prefix: "credit_reservation:" })).size).toBe(1);
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 0 });
  });

  it("records monthly, FEFO ad-lot, and purchased allocations and restores them exactly on failure", async () => {
    const operationId = "mixed-allocation-release";
    const requestHash = "d".repeat(64);
    const state = createCloningSerialState({
      credit_state: creditState({
        monthlyRemaining: 1,
        monthlyLimit: 1,
        rewardedAdRemaining: 2,
        rewardedAdExpiresAt: "2026-07-20T00:00:00.000Z",
        rewardedAdLots: [
          { lotId: "ad-lot-1", remaining: 2, expiresAt: "2026-07-20T00:00:00.000Z" }
        ],
        purchasedRemaining: 3
      })
    });
    const quota = new UserQuotaDO(state as never);
    const begin = creditBeginBody(operationId, requestHash, 5);
    (begin.reservation as unknown as { quota: Record<string, unknown> }).quota.monthlyCreditLimit = 1;

    const response = await postRequestExecution(quota, begin);
    expect(response.status).toBe(200);
    const reservation = await state.storage.get<Record<string, any>>(`credit_reservation:${operationId}`);
    expect(reservation?.allocations).toEqual({
      monthly: {
        credits: 1,
        periodStart: "2026-07-01T00:00:00+09:00",
        periodEnd: "2026-08-01T00:00:00+09:00"
      },
      rewardedAd: [
        { lotId: "ad-lot-1", credits: 2, expiresAt: "2026-07-20T00:00:00.000Z" }
      ],
      purchased: { credits: 2 }
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      monthlyRemaining: 0,
      rewardedAdRemaining: 0,
      purchasedRemaining: 1
    });

    const failed = await postRequestExecution(
      quota,
      failBody({ operationId, requestHash })
    );
    expect(failed.status).toBe(200);
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      monthlyRemaining: 1,
      rewardedAdRemaining: 2,
      rewardedAdLots: [
        { lotId: "ad-lot-1", remaining: 2, expiresAt: "2026-07-20T00:00:00.000Z" }
      ],
      purchasedRemaining: 3
    });
  });

  it("commits a reserved credit operation once without a second deduction", async () => {
    const operationId = "credit-commit-once";
    const requestHash = "e".repeat(64);
    const state = createCloningSerialState({
      credit_state: creditState({ purchasedRemaining: 2 })
    });
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, creditBeginBody(operationId, requestHash, 2));

    const completed = await postRequestExecution(
      quota,
      completeBody({ operationId, requestHash, chargeable: true })
    );
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({
      outcome: "completed",
      didMutate: true,
      reservationStatus: "committed",
      creditsCharged: 2,
      creditOperation: {
        operationId,
        type: "consume",
        status: "applied",
        delta: -2,
        consumedPurchased: 2
      }
    });
    const duplicate = await postRequestExecution(
      quota,
      completeBody({ operationId, requestHash, chargeable: true })
    );
    await expect(duplicate.json()).resolves.toMatchObject({
      didMutate: false,
      reservationStatus: "committed",
      creditsCharged: 2,
      creditOperation: { operationId, delta: -2 }
    });
    expect((await state.storage.list({ prefix: `credit_operation:${operationId}` })).size).toBe(1);
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 0 });
  });

  it("releases a non-chargeable reservation while completing a replayable zero-charge result", async () => {
    const operationId = "non-chargeable-release";
    const requestHash = "f".repeat(64);
    const state = createCloningSerialState({
      credit_state: creditState({ purchasedRemaining: 2 })
    });
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, creditBeginBody(operationId, requestHash, 2));

    const completed = await postRequestExecution(
      quota,
      completeBody({ operationId, requestHash, chargeable: false })
    );
    await expect(completed.json()).resolves.toMatchObject({
      outcome: "completed",
      reservationStatus: "released",
      creditsCharged: 0
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 2 });
    expect(await state.storage.get(`credit_operation:${operationId}`)).toBeUndefined();

    const replay = await postRequestExecution(quota, creditBeginBody(operationId, requestHash, 2));
    await expect(replay.json()).resolves.toMatchObject({
      outcome: "replay",
      result: { creditsCharged: 0 }
    });
  });

  it("does not restore an old-period monthly allocation into a new month but always restores purchased credits", async () => {
    vi.setSystemTime(new Date("2026-07-31T14:59:00.000Z"));
    const operationId = "month-boundary-release";
    const requestHash = "1".repeat(64);
    const state = createCloningSerialState({
      credit_state: creditState({
        monthlyRemaining: 1,
        monthlyLimit: 1,
        purchasedRemaining: 1,
        updatedAt: "2026-07-31T14:59:00.000Z"
      })
    });
    const quota = new UserQuotaDO(state as never);
    const begin = creditBeginBody(operationId, requestHash, 2);
    (begin.reservation as unknown as { quota: Record<string, unknown> }).quota.dateJST = "2026-07-31";
    (begin.reservation as unknown as { quota: Record<string, unknown> }).quota.monthlyCreditLimit = 1;
    await postRequestExecution(quota, begin);

    vi.setSystemTime(new Date("2026-07-31T15:01:00.000Z"));
    await postQuota(quota, {
      action: "state",
      quotaSubject: "free:test-device",
      plan: "free",
      dateJST: "2026-08-01",
      chatLimit: 3,
      stockLimit: 3,
      monthlyCreditLimit: 4
    });
    await postRequestExecution(quota, failBody({ operationId, requestHash }));

    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      periodStart: "2026-08-01T00:00:00+09:00",
      monthlyRemaining: 4,
      monthlyLimit: 4,
      purchasedRemaining: 1
    });
  });

  it("discards an ad allocation that expires while reserved without converting it to purchased credit", async () => {
    const operationId = "ad-expiry-release";
    const requestHash = "2".repeat(64);
    const state = createCloningSerialState({
      credit_state: creditState({
        rewardedAdRemaining: 1,
        rewardedAdExpiresAt: "2026-07-10T00:01:00.000Z",
        rewardedAdLots: [
          { lotId: "short-ad", remaining: 1, expiresAt: "2026-07-10T00:01:00.000Z" }
        ],
        purchasedRemaining: 0
      })
    });
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, creditBeginBody(operationId, requestHash, 1));

    vi.setSystemTime(new Date("2026-07-10T00:02:00.000Z"));
    await postRequestExecution(quota, failBody({ operationId, requestHash }));
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      rewardedAdRemaining: 0,
      rewardedAdLots: [],
      purchasedRemaining: 0
    });
  });

  it("expires and restores an orphan reservation through the alarm exactly once", async () => {
    const operationId = "alarm-expiry";
    const requestHash = "3".repeat(64);
    const state = createCloningSerialState({
      credit_state: creditState({ purchasedRemaining: 2 })
    });
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, creditBeginBody(operationId, requestHash, 2));
    expect(await state.storage.getAlarm()).toBe(EXECUTION_NOW.getTime() + 5 * 60 * 1_000);

    vi.setSystemTime(new Date("2026-07-10T00:05:00.000Z"));
    await quota.alarm();
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 2 });
    await expect(state.storage.get(`credit_reservation:${operationId}`)).resolves.toMatchObject({
      status: "expired",
      expiredAt: "2026-07-10T00:05:00.000Z"
    });
    await expect(state.storage.get(`request_execution:${operationId}`)).resolves.toMatchObject({
      status: "failed",
      failureCode: "credit_reservation_expired"
    });
    expect(await state.storage.getAlarm()).toBeNull();

    await quota.alarm();
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 2 });
  });

  it("lazily expires an orphan before checking a new request so restored credit can be reserved atomically", async () => {
    const state = createCloningSerialState({
      credit_state: creditState({ purchasedRemaining: 2 })
    });
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, creditBeginBody("lazy-old", "4".repeat(64), 2));

    vi.setSystemTime(new Date("2026-07-10T00:05:00.000Z"));
    const next = await postRequestExecution(
      quota,
      creditBeginBody("lazy-new", "5".repeat(64), 2)
    );
    expect(next.status).toBe(200);
    await expect(next.json()).resolves.toMatchObject({ outcome: "leader", creditsReserved: 2 });
    await expect(state.storage.get("credit_reservation:lazy-old")).resolves.toMatchObject({ status: "expired" });
    await expect(state.storage.get("credit_reservation:lazy-new")).resolves.toMatchObject({ status: "reserved" });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 0 });
  });

  it("rejects new legacy chat reservations without mutating quota state", async () => {
    const state = createCloningSerialState();
    const quota = new UserQuotaDO(state as never);
    const response = await postRequestExecution(
      quota,
      legacyBeginBody("legacy-new", "6".repeat(64))
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      outcome: "failed",
      failureCode: "legacy_chat_creation_disabled",
      failureStatus: 409,
      didMutate: false
    });
    await expect(state.storage.list()).resolves.toEqual(new Map());
  });

  it("replays an existing legacy chat execution without creating a new reservation", async () => {
    const operationId = "legacy-existing";
    const requestHash = "7".repeat(64);
    const result = completedChatResult("Existing legacy answer");
    const state = createCloningSerialState({
      [`request_execution:${operationId}`]: {
        operationId,
        requestHash,
        route: "chat",
        status: "completed",
        executionPolicyVersion: "legacy-chat-v1",
        configSnapshot: { metering: "legacy_chat" },
        createdAt: "2026-07-09T00:00:00.000Z",
        pendingExpiresAt: "2026-07-09T00:05:00.000Z",
        completedAt: "2026-07-09T00:00:01.000Z",
        resultExpiresAt: "2026-07-16T00:00:01.000Z",
        resultBody: result,
        resultMetadata: { creditsCharged: 0 },
        stateVersion: 2
      }
    });
    const quota = new UserQuotaDO(state as never);

    const response = await postRequestExecution(
      quota,
      legacyBeginBody(operationId, requestHash)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      outcome: "replay",
      result,
      resultMetadata: { creditsCharged: 0 }
    });
    await expect(state.storage.list({ prefix: "credit_reservation:" })).resolves.toEqual(new Map());
  });

  it("allocates rewarded-ad lots in earliest-expiry-first order", async () => {
    const operationId = "ad-fefo";
    const requestHash = "9".repeat(64);
    const state = createCloningSerialState({
      credit_state: creditState({
        rewardedAdRemaining: 3,
        rewardedAdExpiresAt: "2026-07-12T00:00:00.000Z",
        rewardedAdLots: [
          { lotId: "late", remaining: 2, expiresAt: "2026-07-20T00:00:00.000Z" },
          { lotId: "early", remaining: 1, expiresAt: "2026-07-12T00:00:00.000Z" }
        ]
      })
    });
    const quota = new UserQuotaDO(state as never);
    await postRequestExecution(quota, creditBeginBody(operationId, requestHash, 2));

    await expect(state.storage.get(`credit_reservation:${operationId}`)).resolves.toMatchObject({
      allocations: {
        rewardedAd: [
          { lotId: "early", credits: 1, expiresAt: "2026-07-12T00:00:00.000Z" },
          { lotId: "late", credits: 1, expiresAt: "2026-07-20T00:00:00.000Z" }
        ]
      }
    });
    await expect(state.storage.get("credit_state")).resolves.toMatchObject({
      rewardedAdRemaining: 1,
      rewardedAdExpiresAt: "2026-07-20T00:00:00.000Z",
      rewardedAdLots: [
        { lotId: "late", remaining: 1, expiresAt: "2026-07-20T00:00:00.000Z" }
      ]
    });
  });

  it("fails closed when a version-one pending execution has no reservation", async () => {
    const operationId = "v1-pending";
    const requestHash = "8".repeat(64);
    const state = createCloningSerialState({
      [`request_execution:${operationId}`]: {
        operationId,
        requestHash,
        route: "chat",
        status: "pending",
        executionPolicyVersion: "chat-v1",
        configSnapshot: {},
        createdAt: "2026-07-10T00:00:00.000Z",
        pendingExpiresAt: "2026-07-10T00:05:00.000Z"
      }
    });
    const quota = new UserQuotaDO(state as never);

    const response = await postRequestExecution(
      quota,
      completeBody({ operationId, requestHash, chargeable: true })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "request_execution_reservation_required"
    });
  });

  it("exports without mutation and applies a principal migration idempotently", async () => {
    const sourceState = createCloningSerialState({
      credit_state: creditState({ monthlyRemaining: 37, monthlyLimit: 50, purchasedRemaining: 25 }),
      "purchase_transaction:tx-paid": { transactionId: "tx-paid", creditsGranted: 25 }
    });
    const source = new UserQuotaDO(sourceState as never);
    const exportedResponse = await postPrincipalMigration(source, { action: "export", migrationId: "migration-1" });
    expect(exportedResponse.status).toBe(200);
    const exported = await exportedResponse.json() as Record<string, unknown>;
    await expect(sourceState.storage.get("principal_migration:applied")).resolves.toBeUndefined();

    const targetState = createCloningSerialState();
    const target = new UserQuotaDO(targetState as never);
    const applyBody = {
      action: "apply",
      migrationId: "migration-1",
      sourceQuotaSubjectHash: "a".repeat(64),
      sourceSnapshotDigest: exported.sourceSnapshotDigest,
      snapshot: exported.snapshot
    };
    const applied = await postPrincipalMigration(target, applyBody);
    expect(applied.status).toBe(200);
    await expect(targetState.storage.get("credit_state")).resolves.toMatchObject({
      monthlyRemaining: 37,
      purchasedRemaining: 25
    });
    expect((await postPrincipalMigration(target, applyBody)).status).toBe(200);
    await expect(targetState.storage.get("purchase_transaction:tx-paid")).resolves.toMatchObject({ transactionId: "tx-paid" });
  });

  it("does not merge a migration into an existing target balance and can unlock the source", async () => {
    const sourceState = createCloningSerialState({ credit_state: creditState({ purchasedRemaining: 10 }) });
    const source = new UserQuotaDO(sourceState as never);
    const exported = await (await postPrincipalMigration(source, { action: "export", migrationId: "migration-2" })).json() as Record<string, unknown>;
    const target = new UserQuotaDO(createCloningSerialState({ credit_state: creditState({ purchasedRemaining: 5 }) }) as never);
    const conflict = await postPrincipalMigration(target, {
      action: "apply",
      migrationId: "migration-2",
      sourceQuotaSubjectHash: "b".repeat(64),
      sourceSnapshotDigest: exported.sourceSnapshotDigest,
      snapshot: exported.snapshot
    });
    expect(conflict.status).toBe(409);

    expect((await postPrincipalMigration(source, {
      action: "unlock",
      migrationId: "migration-2",
      sourceSnapshotDigest: exported.sourceSnapshotDigest
    })).status).toBe(200);
    const freshGrant = await postQuota(source, {
      action: "ensureMonthlyCreditGrant",
      quotaSubject: "legacy",
      plan: "pro",
      dateJST: "2026-07-11",
      chatLimit: 50,
      stockLimit: 20,
      monthlyCreditLimit: 900
    });
    expect(freshGrant.status).toBe(200);
  });

  it("atomically locks export, restores active reservations, and terminally blocks new execution", async () => {
    const operationId = "migration-pending-operation";
    const requestHash = "c".repeat(64);
    const state = createCloningSerialState({ credit_state: creditState({ purchasedRemaining: 2 }) });
    const source = new UserQuotaDO(state as never);
    await expect((await postRequestExecution(
      source, creditBeginBody(operationId, requestHash, 2)
    )).json()).resolves.toMatchObject({ outcome: "leader", creditsReserved: 2 });

    const exported = await (await postPrincipalMigration(source, {
      action: "export",
      migrationId: "migration-lock-1"
    })).json() as Record<string, any>;

    expect(exported).toMatchObject({ status: "locked", sourceSnapshotDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(exported.snapshot.creditState).toMatchObject({ purchasedRemaining: 2 });
    expect(exported.snapshot.requestExecutionRecords).toHaveLength(1);
    expect(exported.snapshot.creditReservationRecords).toHaveLength(1);
    await expect(state.storage.get(`credit_reservation:${operationId}`)).resolves.toMatchObject({
      status: "expired",
      releaseReason: "ttl_migration"
    });
    await expect(state.storage.get(`request_execution:${operationId}`)).resolves.toMatchObject({
      status: "failed",
      failureCode: "principal_migration_locked"
    });

    const duplicate = await postRequestExecution(source, creditBeginBody(operationId, requestHash, 2));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ outcome: "failed", failureCode: "principal_migration_locked" });
    const fresh = await postRequestExecution(source, creditBeginBody("migration-new-operation", "d".repeat(64), 1));
    expect(fresh.status).toBe(409);
    await expect(fresh.json()).resolves.toMatchObject({ failureCode: "principal_migration_locked" });

    const lockedState = await postQuota(source, {
      action: "state", quotaSubject: "source", plan: "free", dateJST: "2026-07-10",
      chatLimit: 25, stockLimit: 3, monthlyCreditLimit: 0
    });
    expect(lockedState.status).toBe(423);
    await expect(lockedState.json()).resolves.not.toHaveProperty("usage");

    const unlocked = await postPrincipalMigration(source, {
      action: "unlock",
      migrationId: "migration-lock-1",
      sourceSnapshotDigest: exported.sourceSnapshotDigest
    });
    expect(unlocked.status).toBe(200);
    await expect((await postRequestExecution(
      source, creditBeginBody("migration-after-unlock", "e".repeat(64), 1)
    )).json()).resolves.toMatchObject({ outcome: "leader" });
  });

  it("moves terminal replay state to the target and leaves tombstoned state unusable", async () => {
    const operationId = "migration-completed-operation";
    const requestHash = "f".repeat(64);
    const sourceState = createCloningSerialState({ credit_state: creditState({ purchasedRemaining: 5 }) });
    const source = new UserQuotaDO(sourceState as never);
    await postRequestExecution(source, creditBeginBody(operationId, requestHash, 2));
    await postRequestExecution(source, completeBody({ operationId, requestHash }));
    const exported = await (await postPrincipalMigration(source, {
      action: "export",
      migrationId: "migration-terminal-1"
    })).json() as Record<string, any>;

    const targetState = createCloningSerialState();
    const target = new UserQuotaDO(targetState as never);
    const applied = await postPrincipalMigration(target, {
      action: "apply",
      migrationId: "migration-terminal-1",
      sourceQuotaSubjectHash: "1".repeat(64),
      sourceSnapshotDigest: exported.sourceSnapshotDigest,
      snapshot: exported.snapshot
    });
    const appliedBody = await applied.clone().json() as Record<string, unknown>;
    expect(applied.status, JSON.stringify(appliedBody)).toBe(200);
    const targetReplay = await postRequestExecution(target, creditBeginBody(operationId, requestHash, 2));
    expect(targetReplay.status).toBe(200);
    await expect(targetReplay.json()).resolves.toMatchObject({ outcome: "replay", result: { kind: "chat" } });
    await expect(targetState.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 3 });

    const tombstoned = await postPrincipalMigration(source, {
      action: "tombstone",
      migrationId: "migration-terminal-1",
      targetPrincipal: "installation:v1:target",
      sourceSnapshotDigest: exported.sourceSnapshotDigest
    });
    expect(tombstoned.status).toBe(200);
    const sourceReplay = await postRequestExecution(source, creditBeginBody(operationId, requestHash, 2));
    await expect(sourceReplay.json()).resolves.toMatchObject({ outcome: "replay" });
    const sourceFresh = await postRequestExecution(source, creditBeginBody("post-tombstone-new", "2".repeat(64), 1));
    expect(sourceFresh.status).toBe(409);
    await expect(sourceFresh.json()).resolves.toMatchObject({ failureCode: "quota_principal_migrated" });
    const sourceStateRead = await postQuota(source, {
      action: "state", quotaSubject: "source", plan: "free", dateJST: "2026-07-10",
      chatLimit: 25, stockLimit: 3, monthlyCreditLimit: 0
    });
    expect(sourceStateRead.status).toBe(409);
    await expect(sourceStateRead.json()).resolves.toEqual({
      error: "quota_principal_migrated",
      targetPrincipal: "installation:v1:target",
      migrationId: "migration-terminal-1"
    });
  });

  it("can unlock a source after target apply conflict without losing restored credits", async () => {
    const sourceState = createCloningSerialState({ credit_state: creditState({ purchasedRemaining: 4 }) });
    const source = new UserQuotaDO(sourceState as never);
    const exported = await (await postPrincipalMigration(source, {
      action: "export",
      migrationId: "migration-conflict-unlock"
    })).json() as Record<string, any>;
    const target = new UserQuotaDO(createCloningSerialState({
      credit_state: creditState({ purchasedRemaining: 1 })
    }) as never);
    const conflict = await postPrincipalMigration(target, {
      action: "apply",
      migrationId: "migration-conflict-unlock",
      sourceQuotaSubjectHash: "3".repeat(64),
      sourceSnapshotDigest: exported.sourceSnapshotDigest,
      snapshot: exported.snapshot
    });
    expect(conflict.status).toBe(409);

    const unlocked = await postPrincipalMigration(source, {
      action: "unlock",
      migrationId: "migration-conflict-unlock",
      sourceSnapshotDigest: exported.sourceSnapshotDigest
    });
    expect(unlocked.status).toBe(200);
    await expect((await postRequestExecution(
      source, creditBeginBody("after-conflict-unlock", "4".repeat(64), 1)
    )).json()).resolves.toMatchObject({ outcome: "leader" });
    await expect(sourceState.storage.get("credit_state")).resolves.toMatchObject({ purchasedRemaining: 3 });
  });
});
