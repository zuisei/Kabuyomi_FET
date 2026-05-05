import { describe, expect, it, vi } from "vitest";
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

describe("worker routing", () => {
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

  it("serves the tokushoho page with explicit legal identity blockers", async () => {
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
    expect(body).toContain("TODO_FINAL_LEGAL_IDENTITY");
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
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-key": "device-123" },
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
