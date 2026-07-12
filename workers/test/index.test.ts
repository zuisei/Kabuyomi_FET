import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Environment } from "@apple/app-store-server-library";
import { EntitlementDO } from "../src/durable/entitlement";
import { UserQuotaDO } from "../src/durable/user-quota";
import { setAppleSignedDataVerifierFactoryForTests } from "../src/lib/apple-signed-data";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import worker, { resolveAppAttestAssertionPolicy } from "../src/index";

function completeRemoteConfigEnvelope(overrides: Record<string, unknown> = {}) {
  const config: Record<string, unknown> = {
    ...DEFAULT_REMOTE_CONFIG,
    planCredits: { ...DEFAULT_REMOTE_CONFIG.planCredits },
    trackedTickers: [...DEFAULT_REMOTE_CONFIG.trackedTickers],
    ...overrides
  };
  delete config.configVersion;
  delete config.configUpdatedAt;
  delete config.configSource;
  delete config.maxStaleAgeSeconds;
  return {
    version: "index-test-complete-v2",
    updatedAt: new Date().toISOString(),
    maxStaleAgeSeconds: 3600,
    config
  };
}

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

function createQuotaState() {
  const storage = new Map<string, unknown>();

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

function fakeJws(payload: Record<string, unknown>): string {
  return `${base64UrlEncodeJSON({ alg: "ES256", kid: "apple" })}.${base64UrlEncodeJSON(payload)}.signature`;
}

function decodeFakeJws(value: string): Record<string, unknown> {
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("invalid_test_jws");
  }
  const normalized = parts[1].replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) as Record<string, unknown>;
}

function base64UrlEncodeJSON(value: unknown): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function createEvalGrantEnv(options: {
  remoteConfigOverrides?: Record<string, unknown>;
  emergencyDisablePaidGrants?: string;
} = {}) {
  const quota = new UserQuotaDO(createQuotaState() as never);
  const dbRun = vi.fn().mockResolvedValue({});
  const dbBind = vi.fn().mockReturnValue({ run: dbRun });

  return {
    KABUYOMI_CACHE: {
      get: vi.fn().mockResolvedValue(
        options.remoteConfigOverrides
          ? completeRemoteConfigEnvelope(options.remoteConfigOverrides)
          : null
      )
    },
    EVAL_SHARED_SECRET: "eval-secret",
    EMERGENCY_DISABLE_PAID_GRANTS: options.emergencyDisablePaidGrants,
    USER_QUOTA: {
      getByName: vi.fn().mockReturnValue({
        fetch: (input: RequestInfo | URL, init?: RequestInit) => quota.fetch(new Request(input, init))
      })
    },
    DB: {
      prepare: vi.fn().mockReturnValue({ bind: dbBind })
    }
  };
}

async function createCreditPurchaseEnv() {
  const quota = new UserQuotaDO(createQuotaState() as never);
  const entitlement = new EntitlementDO(createEntitlementState() as never);
  const purchaseTransactions = new Map<string, Record<string, unknown>>();
  const creditLedgerRows: Record<string, unknown>[] = [];
  const monthlyGrantRows: Record<string, unknown>[] = [];

  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      async run() {
        if (sql.includes("INSERT OR IGNORE INTO purchase_transactions")) {
          const transactionId = String(args[3]);
          if (!purchaseTransactions.has(transactionId)) {
            purchaseTransactions.set(transactionId, {
              user_id: args[1],
              product_id: args[2],
              transaction_id: args[3],
              original_transaction_id: args[4],
              credits_granted: args[5],
              status: args[6],
              purchased_at: args[7],
              created_at: args[8],
              updated_at: args[9]
            });
          }
        }
        if (sql.includes("UPDATE purchase_transactions")) {
          const transactionId = String(args[3]);
          const existing = purchaseTransactions.get(transactionId);
          if (existing) {
            existing.status = args[0];
            existing.debt_offset_applied = args[1];
            existing.updated_at = args[2];
          }
        }
        if (sql.includes("INSERT OR IGNORE INTO credit_ledger")) {
          creditLedgerRows.push({
            user_id: args[1],
            operation_id: args[2],
            type: args[3],
            delta: args[4],
            balance_after: args[5],
            monthly_balance_after: args[6],
            purchased_balance_after: args[7],
            reference_type: args[8],
            reference_id: args[9],
            metadata_json: args[10]
          });
        }
        if (sql.includes("INSERT INTO monthly_grants")) {
          monthlyGrantRows.push({
            user_id: args[1],
            plan: args[2],
            period_start: args[3],
            period_end: args[4],
            credits_granted: args[5],
            operation_id: args[6]
          });
        }
        return {};
      },
      async first() {
        if (sql.includes("FROM purchase_transactions")) {
          return purchaseTransactions.get(String(args[0])) ?? null;
        }
        return null;
      }
    }))
  }));

  return {
    env: {
      KABUYOMI_CACHE: {
        get: vi.fn().mockResolvedValue(null)
      },
      APPLE_APP_STORE_ISSUER_ID: "issuer-id",
      APPLE_APP_STORE_KEY_ID: "key-id",
      APPLE_APP_STORE_PRIVATE_KEY: await testPrivateKeyPem(),
      APPLE_BUNDLE_ID: "app.kabuyomi.ios",
      APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox",
      SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1: "test-subscription-principal-secret",
      USER_QUOTA: {
        getByName: vi.fn().mockReturnValue({
          fetch: (input: RequestInfo | URL, init?: RequestInit) => quota.fetch(new Request(input, init))
        })
      },
      ENTITLEMENT: {
        getByName: vi.fn().mockReturnValue({
          fetch: (request: Request) => entitlement.fetch(request)
        })
      },
      DB: { prepare }
    },
    purchaseTransactions,
    creditLedgerRows,
    monthlyGrantRows
  };
}

async function testPrivateKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  return `-----BEGIN PRIVATE KEY-----\n${base64Encode(new Uint8Array(pkcs8))}\n-----END PRIVATE KEY-----`;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe("worker routing", () => {
  const ACTIVE_SUBSCRIPTION_TEST_NOW = new Date("2026-05-15T00:00:00.000Z");

  function useActiveSubscriptionTestClock() {
    vi.useFakeTimers();
    vi.setSystemTime(ACTIVE_SUBSCRIPTION_TEST_NOW);
  }

  beforeEach(() => {
    setAppleSignedDataVerifierFactoryForTests((_env, environment) => ({
      verifyAndDecodeTransaction: async (value) => ({
        ...decodeFakeJws(value),
        environment: environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX
      }),
      verifyAndDecodeNotification: async (value) => decodeFakeJws(value),
      verifyAndDecodeRenewalInfo: async (value) => ({
        ...decodeFakeJws(value),
        environment: environment === "production" ? Environment.PRODUCTION : Environment.SANDBOX
      })
    }));
  });

  afterEach(() => {
    setAppleSignedDataVerifierFactoryForTests(undefined);
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const executionContext = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn()
  } as never;

  it("serves the public privacy policy without app authentication", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/legal/privacy"),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const body = await response.text();
    expect(body).toContain("Kabuyomi プライバシーポリシー");
    expect(body).toContain("kabuyomi.support@gmail.com");
    expect(body).toContain("Google AdMob");
  });

  it("serves the tokushoho page with disclosure-by-request legal identity wording", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/legal/tokushoho"),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("特定商取引法に基づく表記");
    expect(body).toContain("プライバシー保護のため");
    expect(body).toContain("開示請求があった場合");
    expect(body).toContain("遅滞なく開示します");
    expect(body).not.toContain("TODO_FINAL_LEGAL_IDENTITY");
    expect(body).toContain("kabuyomi.credits.100");
    expect(body).toContain("paid credit は失効しません");
  });

  it("serves legal pages even while maintenance mode is enabled", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/legal/terms"),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(JSON.stringify({ maintenanceMode: true }))
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Kabuyomi 利用条件");
  });

  it("does not mint pro from an unverifiable client-reported billing sync claim", async () => {
    const fetch = vi.fn();
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          originalTransactionId: "tx-1",
          productId: "kabuyomi.sub.pro.monthly",
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Subscription transaction id is required"
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a device key before syncing billing state", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalTransactionId: "tx-1",
          active: false
        })
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

  it("syncs inactive billing state as free without minting pro", async () => {
    const entitlement = new EntitlementDO(createEntitlementState() as never);
    const quota = new UserQuotaDO(createQuotaState() as never);
    const dbRun = vi.fn().mockResolvedValue({});
    const dbBind = vi.fn().mockReturnValue({ run: dbRun });
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          originalTransactionId: "tx-1",
          productId: "kabuyomi.sub.pro.monthly",
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
        },
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({
            fetch: (input: RequestInfo | URL, init?: RequestInit) => quota.fetch(new Request(input, init))
          })
        },
        DB: {
          prepare: vi.fn().mockReturnValue({ bind: dbBind })
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
    expect(payload.quotaSubject).toBe("free:local:device-123");
    expect(typeof payload.syncedAt).toBe("string");
  });

  it("syncs an active Lite subscription and grants the verified monthly period once", async () => {
    useActiveSubscriptionTestClock();
    const { env, monthlyGrantRows, creditLedgerRows } = await createCreditPurchaseEnv();
    const signedTransactionInfo = fakeJws({
      transactionId: "sub-tx-lite-1",
      originalTransactionId: "orig-sub-lite-1",
      productId: "kabuyomi.sub.lite.monthly",
      bundleId: "app.kabuyomi.ios",
      purchaseDate: Date.parse("2026-05-01T00:00:00.000Z"),
      expiresDate: Date.parse("2026-06-01T00:00:00.000Z")
    });
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ signedTransactionInfo }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );
    vi.stubGlobal("fetch", fetch);

    const request = new Request("https://kabuyomi.test/v1/ios/subscriptions/sync", {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-key": "device-123" },
      body: JSON.stringify({
        originalTransactionId: "orig-sub-lite-1",
        transactionId: "sub-tx-lite-1",
        productId: "kabuyomi.sub.lite.monthly",
        active: true,
        signedTransactionInfo
      })
    });

    const first = await worker.fetch(request.clone() as Request, env as never, executionContext);
    const second = await worker.fetch(request.clone() as Request, env as never, executionContext);

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      plan: "lite",
      productId: "kabuyomi.sub.lite.monthly",
      quotaSubject: expect.stringMatching(/^subscription:v1:/),
      activeSubscription: {
        plan: "lite",
        productId: "kabuyomi.sub.lite.monthly",
        periodStart: "2026-05-01T00:00:00.000Z",
        periodEnd: "2026-06-01T00:00:00.000Z",
        monthlyCredits: 400
      },
      usage: {
        plan: "lite",
        credits: {
          monthlyLimit: 400,
          monthlyRemaining: 400,
          purchasedRemaining: 0,
          totalRemaining: 400,
          resetsAt: "2026-06-01T00:00:00.000Z"
        }
      }
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      usage: {
        credits: {
          monthlyRemaining: 400,
          totalRemaining: 400
        }
      }
    });
    expect(monthlyGrantRows).toHaveLength(1);
    expect(monthlyGrantRows[0]).toMatchObject({
      plan: "lite",
      period_start: "2026-05-01T00:00:00.000Z",
      period_end: "2026-06-01T00:00:00.000Z",
      credits_granted: 400
    });
    expect(creditLedgerRows.filter((row) => row.type === "monthly_grant")).toHaveLength(1);
  });

  it("keeps paid credits on the same device quota subject when subscription credits are granted", async () => {
    useActiveSubscriptionTestClock();
    const { env } = await createCreditPurchaseEnv();
    const creditSignedTransactionInfo = fakeJws({
      transactionId: "tx-50",
      originalTransactionId: "orig-tx-50",
      productId: "kabuyomi.credits.50",
      bundleId: "app.kabuyomi.ios"
    });
    const subscriptionSignedTransactionInfo = fakeJws({
      transactionId: "sub-tx-pro-1",
      originalTransactionId: "orig-sub-pro-1",
      productId: "kabuyomi.sub.pro.monthly",
      bundleId: "app.kabuyomi.ios",
      purchaseDate: Date.parse("2026-05-01T00:00:00.000Z"),
      expiresDate: Date.parse("2026-06-01T00:00:00.000Z")
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ signedTransactionInfo: creditSignedTransactionInfo }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ signedTransactionInfo: subscriptionSignedTransactionInfo }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetch);

    const purchase = await worker.fetch(
      new Request("https://kabuyomi.test/v1/ios/purchases/credits/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          productId: "kabuyomi.credits.50",
          transactionId: "tx-50",
          originalTransactionId: "orig-tx-50",
          signedTransactionInfo: creditSignedTransactionInfo
        })
      }),
      env as never,
      executionContext
    );
    expect(purchase.status).toBe(200);

    const sync = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          originalTransactionId: "orig-sub-pro-1",
          transactionId: "sub-tx-pro-1",
          productId: "kabuyomi.sub.pro.monthly",
          active: true,
          signedTransactionInfo: subscriptionSignedTransactionInfo
        })
      }),
      env as never,
      executionContext
    );

    expect(sync.status).toBe(200);
    await expect(sync.json()).resolves.toMatchObject({
      usage: {
        plan: "pro",
        credits: {
          monthlyLimit: 900,
          monthlyRemaining: 900,
          purchasedRemaining: 50,
          totalRemaining: 950
        }
      }
    });
  });

  it.each([
    ["kabuyomi.sub.pro.monthly", "pro", 900],
    ["kabuyomi.sub.max.monthly", "pro_max", 2000]
  ])("syncs %s and grants its configured monthly credits", async (productId, plan, monthlyCredits) => {
    useActiveSubscriptionTestClock();
    const { env } = await createCreditPurchaseEnv();
    const signedTransactionInfo = fakeJws({
      transactionId: `sub-tx-${plan}`,
      originalTransactionId: `orig-sub-${plan}`,
      productId,
      bundleId: "app.kabuyomi.ios",
      purchaseDate: Date.parse("2026-05-01T00:00:00.000Z"),
      expiresDate: Date.parse("2026-06-01T00:00:00.000Z")
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ signedTransactionInfo }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          originalTransactionId: `orig-sub-${plan}`,
          transactionId: `sub-tx-${plan}`,
          productId,
          active: true,
          signedTransactionInfo
        })
      }),
      env as never,
      executionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan,
      productId,
      usage: {
        plan,
        credits: {
          monthlyLimit: monthlyCredits,
          monthlyRemaining: monthlyCredits,
          totalRemaining: monthlyCredits
        }
      }
    });
  });

  it.each([
    { label: "remote billing capability", config: { creditBillingEnabled: false }, emergency: undefined },
    { label: "emergency billing override", config: { creditBillingEnabled: true }, emergency: "1" }
  ])("blocks subscription sync before Apple verification when disabled by $label", async ({ config, emergency }) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/ios/subscriptions/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({ originalTransactionId: "original-disabled", transactionId: "tx-disabled" })
      }),
      {
        EMERGENCY_DISABLE_PAID_GRANTS: emergency,
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue({
            version: "subscription-gate-v1",
            updatedAt: new Date().toISOString(),
            maxStaleAgeSeconds: 3600,
            config
          })
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Subscription billing is temporarily unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses no-clawback semantics for same-period subscription downgrade and leaves paid credits untouched", async () => {
    useActiveSubscriptionTestClock();
    const { env, monthlyGrantRows, creditLedgerRows } = await createCreditPurchaseEnv();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const creditSignedTransactionInfo = fakeJws({
      transactionId: "tx-downgrade-paid-50",
      originalTransactionId: "orig-downgrade-paid-50",
      productId: "kabuyomi.credits.50",
      bundleId: "app.kabuyomi.ios"
    });
    const proSignedTransactionInfo = fakeJws({
      transactionId: "sub-tx-downgrade-pro",
      originalTransactionId: "orig-sub-downgrade",
      productId: "kabuyomi.sub.pro.monthly",
      bundleId: "app.kabuyomi.ios",
      purchaseDate: Date.parse("2026-05-01T00:00:00.000Z"),
      expiresDate: Date.parse("2026-06-01T00:00:00.000Z")
    });
    const liteSignedTransactionInfo = fakeJws({
      transactionId: "sub-tx-downgrade-lite",
      originalTransactionId: "orig-sub-downgrade",
      productId: "kabuyomi.sub.lite.monthly",
      bundleId: "app.kabuyomi.ios",
      purchaseDate: Date.parse("2026-05-01T00:00:00.000Z"),
      expiresDate: Date.parse("2026-06-01T00:00:00.000Z")
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ signedTransactionInfo: creditSignedTransactionInfo }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ signedTransactionInfo: proSignedTransactionInfo }), {
          status: 200,
          headers: { "content-type": "application/json" }
        }))
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ signedTransactionInfo: liteSignedTransactionInfo }), {
            status: 200,
            headers: { "content-type": "application/json" }
          }))
        )
    );

    const purchase = await worker.fetch(
      new Request("https://kabuyomi.test/v1/ios/purchases/credits/complete", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          productId: "kabuyomi.credits.50",
          transactionId: "tx-downgrade-paid-50",
          originalTransactionId: "orig-downgrade-paid-50",
          signedTransactionInfo: creditSignedTransactionInfo
        })
      }),
      env as never,
      executionContext
    );
    expect(purchase.status).toBe(200);

    const proSync = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          originalTransactionId: "orig-sub-downgrade",
          transactionId: "sub-tx-downgrade-pro",
          productId: "kabuyomi.sub.pro.monthly",
          active: true,
          signedTransactionInfo: proSignedTransactionInfo
        })
      }),
      env as never,
      executionContext
    );
    expect(proSync.status).toBe(200);

    const liteSync = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          originalTransactionId: "orig-sub-downgrade",
          transactionId: "sub-tx-downgrade-lite",
          productId: "kabuyomi.sub.lite.monthly",
          active: true,
          signedTransactionInfo: liteSignedTransactionInfo
        })
      }),
      env as never,
      executionContext
    );
    const duplicateLiteSync = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          originalTransactionId: "orig-sub-downgrade",
          transactionId: "sub-tx-downgrade-lite",
          productId: "kabuyomi.sub.lite.monthly",
          active: true,
          signedTransactionInfo: liteSignedTransactionInfo
        })
      }),
      env as never,
      executionContext
    );

    expect(liteSync.status).toBe(200);
    await expect(liteSync.json()).resolves.toMatchObject({
      plan: "lite",
      activePlan: "lite",
      activeSubscription: {
        plan: "lite",
        monthlyCredits: 400
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
    expect(duplicateLiteSync.status).toBe(200);
    await expect(duplicateLiteSync.json()).resolves.toMatchObject({
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

    const subscriptionGrantRows = monthlyGrantRows.filter((row) => row.plan !== "free");
    expect(subscriptionGrantRows).toHaveLength(1);
    expect(subscriptionGrantRows[0]).toMatchObject({
      plan: "pro",
      credits_granted: 900
    });
    const noClawbackRows = creditLedgerRows.filter((row) => row.reference_type === "subscription_downgrade_no_clawback");
    expect(noClawbackRows).toHaveLength(1);
    expect(noClawbackRows[0]).toMatchObject({
      type: "monthly_grant",
      delta: 0,
      monthly_balance_after: 900,
      purchased_balance_after: 50
    });
    const joinedLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(joinedLogs).toContain("subscription_downgrade_no_clawback");
    expect(joinedLogs).toContain("operationIdSuffix");
    expect(joinedLogs).toContain("quotaSubjectHash");
    expect(joinedLogs).not.toContain("orig-sub-downgrade");
    expect(joinedLogs).not.toContain("sub-tx-downgrade-lite");
    expect(joinedLogs).not.toContain("free:local:device-123");
    logSpy.mockRestore();
  });

  it("does not grant new subscription credits when billing sync reports inactive expiration", async () => {
    const { env, monthlyGrantRows, creditLedgerRows } = await createCreditPurchaseEnv();

    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          originalTransactionId: "orig-sub-expired-sync",
          transactionId: "sub-tx-expired-sync",
          productId: "kabuyomi.sub.pro.monthly",
          active: false
        })
      }),
      env as never,
      executionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: "free",
      activePlan: null,
      activeSubscription: null,
      usage: {
        plan: "free",
        credits: {
          monthlyLimit: 0,
          monthlyRemaining: 0,
          purchasedRemaining: 0,
          totalRemaining: 0
        }
      }
    });
    expect(monthlyGrantRows).toHaveLength(0);
    expect(creditLedgerRows.filter((row) => row.reference_id === "pro:2026-05-01T00:00:00.000Z:2026-06-01T00:00:00.000Z")).toHaveLength(0);
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
          question: "a".repeat(13_000)
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

  it("requires the internal token for credit audit repair", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/credit-audit/repair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}"
      }),
      {
        BACKFILL_SHARED_SECRET: "secret",
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

  it("runs the internal credit audit repair endpoint with count-only output", async () => {
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn().mockResolvedValue({ results: [] })
        }))
      }))
    };
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/credit-audit/repair", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": "secret"
        },
        body: JSON.stringify({ limit: 5 })
      }),
      {
        BACKFILL_SHARED_SECRET: "secret",
        DB: db,
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      scanned: 0,
      repaired: 0,
      failed: 0
    });
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("FROM credit_audit_repair_queue"));
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
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          signedTransactionInfo: fakeJws({
            transactionId: "tx-100",
            productId: "kabuyomi.credits.100"
          })
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

  it.each([
    {
      label: "reviewed remote config",
      remoteConfigOverrides: { emergencyPaidGrantsDisabled: true },
      emergencyDisablePaidGrants: undefined
    },
    {
      label: "environment emergency override",
      remoteConfigOverrides: { emergencyPaidGrantsDisabled: false },
      emergencyDisablePaidGrants: "true"
    }
  ])("blocks internal credit purchase grants before parsing or quota mutation under $label", async ({
    remoteConfigOverrides,
    emergencyDisablePaidGrants
  }) => {
    const quotaLookup = vi.fn();
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/credits/purchase-grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": "secret"
        },
        body: "{"
      }),
      {
        BACKFILL_SHARED_SECRET: "secret",
        EMERGENCY_DISABLE_PAID_GRANTS: emergencyDisablePaidGrants,
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(completeRemoteConfigEnvelope(remoteConfigOverrides))
        },
        USER_QUOTA: { getByName: quotaLookup }
      } as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Internal credit purchase grants are temporarily unavailable"
    });
    expect(quotaLookup).not.toHaveBeenCalled();
  });

  it.each(["/v1/ios/purchases/credits/complete", "/v1/credits/purchase-grant"])(
    "does not require the internal token on the public StoreKit credit grant route %s",
    async (path) => {
    const response = await worker.fetch(
      new Request(`https://kabuyomi.test${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          productId: "kabuyomi.credits.100",
          transactionId: "tx-100",
          signedTransactionInfo: fakeJws({
            transactionId: "tx-100",
            productId: "kabuyomi.credits.100"
          })
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
    }
  );

  it("rejects public StoreKit credit grants without signed transaction info", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/ios/purchases/credits/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          productId: "kabuyomi.credits.100",
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid credit purchase payload"
    });
  });

  it("verifies a public sandbox StoreKit credit purchase and treats duplicate transactions as already granted", async () => {
    const { env, purchaseTransactions, creditLedgerRows } = await createCreditPurchaseEnv();
    const signedTransactionInfo = fakeJws({
      transactionId: "tx-100",
      originalTransactionId: "orig-tx-100",
      productId: "kabuyomi.credits.100",
      bundleId: "app.kabuyomi.ios"
    });
    const fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ signedTransactionInfo }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
    );
    vi.stubGlobal("fetch", fetch);
    const request = new Request("https://kabuyomi.test/v1/ios/purchases/credits/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-device-key": "device-123"
      },
      body: JSON.stringify({
        productId: "kabuyomi.credits.100",
        transactionId: "tx-100",
        originalTransactionId: "orig-tx-100",
        signedTransactionInfo,
        purchasedAt: "2026-05-05T12:00:00.000Z"
      })
    });

    const first = await worker.fetch(request.clone() as Request, env as never, executionContext);
    const second = await worker.fetch(request.clone() as Request, env as never, executionContext);

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      status: "granted",
      transactionId: "tx-100",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      transactionStatus: "granted",
      didMutate: true,
      usage: {
        credits: {
          purchasedRemaining: 100,
          totalRemaining: 100
        }
      }
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      status: "already_granted",
      transactionId: "tx-100",
      productId: "kabuyomi.credits.100",
      creditsGranted: 100,
      transactionStatus: "granted",
      didMutate: false,
      usage: {
        credits: {
          purchasedRemaining: 100,
          totalRemaining: 100
        }
      }
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[0][0])).toContain("api.storekit-sandbox.itunes.apple.com/inApps/v1/transactions/tx-100");
    expect(purchaseTransactions.get("tx-100")).toMatchObject({
      product_id: "kabuyomi.credits.100",
      credits_granted: 100,
      status: "granted"
    });
    expect(creditLedgerRows.filter((row) => row.operation_id === "purchase:tx-100")).toHaveLength(1);
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

  it("requires the eval token for eval credit grants", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/eval/credits/grant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deviceKey: "eval-chat-quality-v1",
          credits: 500,
          referenceId: "chat-quality-v1-20260426"
        })
      }),
      createEvalGrantEnv() as never,
      executionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized"
    });
  });

  it("rejects the wrong eval token for eval credit grants", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/eval/credits/grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-eval-token": "wrong-secret"
        },
        body: JSON.stringify({
          deviceKey: "eval-chat-quality-v1",
          credits: 500,
          referenceId: "chat-quality-v1-20260426"
        })
      }),
      createEvalGrantEnv() as never,
      executionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Unauthorized"
    });
  });

  it("rejects non-eval device keys for eval credit grants", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/eval/credits/grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-eval-token": "eval-secret"
        },
        body: JSON.stringify({
          deviceKey: "device-123",
          credits: 500,
          referenceId: "chat-quality-v1-20260426"
        })
      }),
      createEvalGrantEnv() as never,
      executionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Eval device key is required"
    });
  });

  it("rejects eval credit grants above the capped amount", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/eval/credits/grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-eval-token": "eval-secret"
        },
        body: JSON.stringify({
          deviceKey: "eval-chat-quality-v1",
          credits: 1001,
          referenceId: "chat-quality-v1-20260426"
        })
      }),
      createEvalGrantEnv() as never,
      executionContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid eval credit grant payload"
    });
  });

  it.each([
    {
      label: "reviewed remote config",
      options: { remoteConfigOverrides: { emergencyPaidGrantsDisabled: true } }
    },
    {
      label: "environment emergency override",
      options: {
        remoteConfigOverrides: { emergencyPaidGrantsDisabled: false },
        emergencyDisablePaidGrants: "true"
      }
    }
  ])("blocks eval credit grants before quota mutation under $label", async ({ options }) => {
    const env = createEvalGrantEnv(options);
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/internal/eval/credits/grant", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-eval-token": "eval-secret"
        },
        body: JSON.stringify({
          deviceKey: "eval-chat-quality-v1",
          credits: 500,
          referenceId: "chat-quality-v1-emergency-gate"
        })
      }),
      env as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Eval credit grants are temporarily unavailable"
    });
    expect(env.USER_QUOTA.getByName).not.toHaveBeenCalled();
  });

  it("grants eval credits idempotently and exposes the increased balance through usage", async () => {
    const env = createEvalGrantEnv();
    const request = new Request("https://kabuyomi.test/v1/internal/eval/credits/grant", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eval-token": "eval-secret"
      },
      body: JSON.stringify({
        deviceKey: "eval-chat-quality-v1",
        credits: 500,
        referenceId: "chat-quality-v1-20260426"
      })
    });

    const first = await worker.fetch(request.clone() as Request, env as never, executionContext);
    const second = await worker.fetch(request.clone() as Request, env as never, executionContext);
    const usage = await worker.fetch(
      new Request("https://kabuyomi.test/v1/usage", {
        headers: { "x-device-key": "eval-chat-quality-v1" }
      }),
      env as never,
      executionContext
    );

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      operationId: "eval-grant:chat-quality-v1-20260426:eval-chat-quality-v1",
      referenceId: "chat-quality-v1-20260426",
      deviceKey: "eval-chat-quality-v1",
      creditsGranted: 500,
      creditsRemaining: 500,
      didMutate: true,
      usage: {
        credits: {
          monthlyRemaining: 0,
          purchasedRemaining: 500,
          totalRemaining: 500
        }
      }
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      creditsGranted: 500,
      creditsRemaining: 500,
      didMutate: false
    });
    expect(usage.status).toBe(200);
    await expect(usage.json()).resolves.toMatchObject({
      credits: {
        monthlyRemaining: 0,
        purchasedRemaining: 500,
        totalRemaining: 500
      }
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
      error: "Installation credential is required"
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
        KABUYOMI_ENV: "test",
        ENVIRONMENT: "test",
        DEV_DETACHED_ACCESS_DEVICE_KEYS: "device-123",
        APPLE_APP_STORE_ISSUER_ID: "issuer",
        APPLE_APP_STORE_KEY_ID: "key",
        APPLE_APP_STORE_PRIVATE_KEY: "private-key",
        APPLE_BUNDLE_ID: "app.kabuyomi.ios",
        SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1: "subscription-secret",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(completeRemoteConfigEnvelope())
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
    await expect(response.json()).resolves.toMatchObject({
      plan: "pro",
      accessMode: "dev_unlimited",
      chatsUsed: 0,
      chatLimit: Number.MAX_SAFE_INTEGER,
      stocksUsed: 0,
      stockLimit: Number.MAX_SAFE_INTEGER,
      savedTickers: [],
      dateJST: "2026-04-20",
      creditBillingEnabled: true,
      capabilities: {
        chatEnabled: true,
        consumablePurchasesEnabled: true,
        accountRecoveryReady: false,
        webSupplementEnabled: false
      }
    });
  });

  it("bypasses App Attest only for unavailable core clients while keeping pending, verified, and reward paths strict", () => {
    for (const [method, path] of [
      ["POST", "/v1/chat"],
      ["POST", "/v1/translate-quote"],
      ["POST", "/v1/watchlist/add"],
      ["POST", "/v1/watchlist/remove"],
      ["POST", "/v1/company/AAPL/refresh"]
    ] as const) {
      expect(resolveAppAttestAssertionPolicy(method, path, "unavailable")).toBe("none");
      expect(resolveAppAttestAssertionPolicy(method, path, "pending")).toBe("required");
      expect(resolveAppAttestAssertionPolicy(method, path, "verified")).toBe("required");
    }
    for (const status of ["unavailable", "pending", "verified"] as const) {
      expect(resolveAppAttestAssertionPolicy("POST", "/v1/admob/reward-intents", status)).toBe("required");
    }
    expect(resolveAppAttestAssertionPolicy("GET", "/v1/company/AAPL", "unavailable")).toBe("none");
  });

  it("allows secret-backed automation through installation and App Attest gates only on the test Worker", async () => {
    const testSecret = "test-secret-with-sufficient-entropy-0123456789";
    const quotaFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      usage: {
        plan: "pro",
        accessMode: "dev_unlimited",
        chatsUsed: 0,
        chatLimit: Number.MAX_SAFE_INTEGER,
        stocksUsed: 0,
        stockLimit: Number.MAX_SAFE_INTEGER,
        savedTickers: [],
        dateJST: "2026-07-11"
      }
    }), { headers: { "content-type": "application/json" } }));
    const baseEnv = {
      INSTALLATION_TOKEN_HMAC_KEY_V1: "installation-secret",
      TEST_AUTOMATION_SHARED_SECRET: testSecret,
      KABUYOMI_CACHE: { get: vi.fn().mockResolvedValue(completeRemoteConfigEnvelope()) },
      USER_QUOTA: { getByName: vi.fn().mockReturnValue({ fetch: quotaFetch }) }
    };
    const request = () => new Request("https://kabuyomi.test/v1/usage", {
      headers: { "x-kabuyomi-test-authorization": testSecret }
    });

    const accepted = await worker.fetch(request(), {
      ...baseEnv,
      KABUYOMI_ENV: "test",
      ENVIRONMENT: "test"
    } as never, executionContext);
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toMatchObject({ accessMode: "dev_unlimited" });

    for (const environment of [
      { KABUYOMI_ENV: "production", ENVIRONMENT: "test" },
      { KABUYOMI_ENV: "test", ENVIRONMENT: "production" },
      { KABUYOMI_ENV: "production", ENVIRONMENT: "production" }
    ]) {
      const rejected = await worker.fetch(request(), { ...baseEnv, ...environment } as never, executionContext);
      expect(rejected.status).toBe(401);
      await expect(rejected.json()).resolves.toEqual({ error: "Installation credential is required" });
    }
  });

  it("keeps a fresh shipped x-device-key client on the expiring production core bridge with zero grants", async () => {
    const deviceKey = "123e4567-e89b-42d3-a456-426614174000";
    const quotaFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      usage: {
        plan: "free",
        accessMode: "legacy_client_compatibility",
        chatsUsed: 0,
        chatLimit: 25,
        stocksUsed: 0,
        stockLimit: 3,
        savedTickers: [],
        dateJST: "2026-07-11",
        credits: {
          monthlyRemaining: 0,
          monthlyLimit: 0,
          welcomeRemaining: 0,
          rewardedAdRemaining: 0,
          purchasedRemaining: 0,
          totalRemaining: 0
        }
      }
    }), { headers: { "content-type": "application/json" } }));
    const response = await worker.fetch(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: { "x-device-key": deviceKey }
      }),
      {
        KABUYOMI_ENV: "production",
        ENVIRONMENT: "production",
        INSTALLATION_TOKEN_HMAC_KEY_V1: "installation-secret",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(completeRemoteConfigEnvelope({
            creditBillingEnabled: false,
            consumablePurchasesEnabled: false,
            accountRecoveryReady: false,
            emergencyPaidGrantsDisabled: true,
            legacyClientCompatibility: {
              enabled: true,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
            }
          }))
        },
        USER_QUOTA: { getByName: vi.fn().mockReturnValue({ fetch: quotaFetch }) }
      } as never,
      executionContext
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: "free",
      accessMode: "legacy_client_compatibility",
      creditBillingEnabled: false,
      credits: {
        monthlyRemaining: 0,
        welcomeRemaining: 0,
        purchasedRemaining: 0,
        totalRemaining: 0
      },
      capabilities: {
        consumablePurchasesEnabled: false,
        accountRecoveryReady: false
      }
    });
  });

  it.each([
    { label: "disabled", gate: { enabled: false, expiresAt: "1970-01-01T00:00:00.000Z" } },
    { label: "expired", gate: { enabled: true, expiresAt: "placeholder" } }
  ])("rejects a legacy production client when the compatibility bridge is $label", async ({ gate }) => {
    const quotaLookup = vi.fn();
    const remoteEnvelope = completeRemoteConfigEnvelope({
      legacyClientCompatibility: gate.enabled
        ? { enabled: true, expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString() }
        : gate
    });
    if (gate.enabled) {
      remoteEnvelope.updatedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString();
      remoteEnvelope.maxStaleAgeSeconds = 3_888_000;
    }
    const response = await worker.fetch(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: { "x-device-key": "123e4567-e89b-42d3-a456-426614174000" }
      }),
      {
        KABUYOMI_ENV: "production",
        ENVIRONMENT: "production",
        INSTALLATION_TOKEN_HMAC_KEY_V1: "installation-secret",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(remoteEnvelope)
        },
        USER_QUOTA: { getByName: quotaLookup }
      } as never,
      executionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Installation credential is required" });
    expect(quotaLookup).not.toHaveBeenCalled();
  });

  it("never extends the legacy production bridge to a grant-producing purchase route", async () => {
    const externalFetch = vi.fn();
    vi.stubGlobal("fetch", externalFetch);
    const response = await worker.fetch(
      new Request("https://kabuyomi-api.example.workers.dev/v1/ios/purchases/credits/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "123e4567-e89b-42d3-a456-426614174000"
        },
        body: "{}"
      }),
      {
        KABUYOMI_ENV: "production",
        ENVIRONMENT: "production",
        INSTALLATION_TOKEN_HMAC_KEY_V1: "installation-secret",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(completeRemoteConfigEnvelope({
            legacyClientCompatibility: {
              enabled: true,
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
            }
          }))
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Installation credential is required" });
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it("fails closed on protected production routes when installation identity secrets are missing", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/company/AAPL"),
      {
        KABUYOMI_ENV: "production",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(completeRemoteConfigEnvelope({ maintenanceMode: false }))
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Installation identity is temporarily unavailable"
    });
  });

  it("lets a signed AdMob callback reach signature validation without an installation credential", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/admob/ssv?custom_data=opaque"),
      {
        KABUYOMI_ENV: "production",
        INSTALLATION_TOKEN_HMAC_KEY_V1: "installation-secret",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(completeRemoteConfigEnvelope({
            maintenanceMode: false,
            adsEnabled: true,
            rewardedCreditEnabled: true,
            rewardedSsvReady: true
          }))
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "invalid_signature" });
  });

  it.each([
    { label: "remote capability", config: { creditBillingEnabled: true, consumablePurchasesEnabled: false }, emergency: undefined },
    { label: "emergency override", config: { creditBillingEnabled: true, consumablePurchasesEnabled: true }, emergency: "true" }
  ])("blocks StoreKit credit grants before Apple verification when disabled by $label", async ({ config, emergency }) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/credits/purchase-grant", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
        body: JSON.stringify({
          productId: "kabuyomi.credits.100",
          transactionId: "tx-disabled",
          signedTransactionInfo: fakeJws({
            transactionId: "tx-disabled",
            productId: "kabuyomi.credits.100"
          })
        })
      }),
      {
        EMERGENCY_DISABLE_PAID_GRANTS: emergency,
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue({
            version: "purchase-gate-v1",
            updatedAt: new Date().toISOString(),
            maxStaleAgeSeconds: 3600,
            config
          })
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Credit purchases are temporarily unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never writes unexpected error messages or payload details to production logs", async () => {
    const privateErrorText = "PRIVATE_USER_OR_TRANSACTION_DETAIL_MUST_NOT_LOG";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/usage", {
        headers: { "x-kabuyomi-test-authorization": "test-secret" }
      }),
      {
        KABUYOMI_ENV: "test",
        ENVIRONMENT: "test",
        TEST_AUTOMATION_SHARED_SECRET: "test-secret",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(completeRemoteConfigEnvelope())
        },
        USER_QUOTA: {
          getByName: vi.fn(() => {
            throw new Error(privateErrorText);
          })
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(500);
    const serializedLogs = errorSpy.mock.calls.map(([line]) => String(line)).join("\n");
    expect(serializedLogs).toContain('"event":"request_failed"');
    expect(serializedLogs).toContain('"errorClass":"Error"');
    expect(serializedLogs).not.toContain(privateErrorText);
  });

});
