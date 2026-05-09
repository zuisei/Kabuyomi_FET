import { afterEach, describe, expect, it, vi } from "vitest";
import { EntitlementDO } from "../src/durable/entitlement";
import { UserQuotaDO } from "../src/durable/user-quota";
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

function base64UrlEncodeJSON(value: unknown): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(JSON.stringify(value))) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function createEvalGrantEnv() {
  const quota = new UserQuotaDO(createQuotaState() as never);
  const dbRun = vi.fn().mockResolvedValue({});
  const dbBind = vi.fn().mockReturnValue({ run: dbRun });

  return {
    KABUYOMI_CACHE: {
      get: vi.fn().mockResolvedValue(null)
    },
    EVAL_SHARED_SECRET: "eval-secret",
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
          const transactionId = String(args[2]);
          const existing = purchaseTransactions.get(transactionId);
          if (existing) {
            existing.status = args[0];
            existing.updated_at = args[1];
          }
        }
        if (sql.includes("INSERT OR IGNORE INTO credit_ledger")) {
          creditLedgerRows.push({
            user_id: args[1],
            operation_id: args[2],
            type: args[3],
            delta: args[4],
            reference_id: args[9]
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
  afterEach(() => {
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
    await expect(response.json()).resolves.toEqual({
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
      quotaSubject: "free:local:device-123",
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
          totalRemaining: 150
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
          totalRemaining: 150
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
      creditsRemaining: 550,
      didMutate: true,
      usage: {
        credits: {
          monthlyRemaining: 50,
          purchasedRemaining: 500,
          totalRemaining: 550
        }
      }
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      creditsGranted: 500,
      creditsRemaining: 550,
      didMutate: false
    });
    expect(usage.status).toBe(200);
    await expect(usage.json()).resolves.toMatchObject({
      credits: {
        monthlyRemaining: 50,
        purchasedRemaining: 500,
        totalRemaining: 550
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
      creditBillingEnabled: true
    });
  });

});
