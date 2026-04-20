import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupTicker,
  pickComparisonFiling,
  pickLatestSupportedFiling,
  searchTickers,
  sortTickerSearchResults
} from "../src/clients/sec";
import { readQuotaIdentity } from "../src/lib/pipeline";
import type { TickerRecord } from "../src/env";

const ticker: TickerRecord = {
  ticker: "AAPL",
  companyName: "Apple Inc.",
  cik: "0000320193",
  exchange: "Nasdaq"
};

const submissions = {
  name: "Apple Inc.",
  filings: {
    recent: {
      form: ["8-K", "10-Q", "10-Q", "10-K"],
      accessionNumber: [
        "0000320193-26-000101",
        "0000320193-26-000057",
        "0000320193-25-000093",
        "0000320193-25-000071"
      ],
      primaryDocument: ["a8k.htm", "a10q.htm", "prior10q.htm", "a10k.htm"],
      filingDate: ["2026-03-01", "2026-02-03", "2025-05-02", "2025-11-01"],
      reportDate: ["2026-03-01", "2025-12-28", "2024-12-29", "2025-09-27"]
    }
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function entitlementEnv(payload?: Record<string, unknown>, status = 200) {
  return {
    ENTITLEMENT: {
      getByName: vi.fn().mockReturnValue({
        fetch: vi.fn().mockResolvedValue(
          new Response(payload ? JSON.stringify(payload) : JSON.stringify({ error: "Entitlement not found" }), {
            status: payload ? status : 404,
            headers: { "content-type": "application/json" }
          })
        )
      })
    }
  } as any;
}

describe("SEC filing selection", () => {
  it("picks the latest supported filing", () => {
    const filing = pickLatestSupportedFiling(ticker, submissions);
    expect(filing?.formType).toBe("10-Q");
    expect(filing?.accessionNumber).toBe("0000320193-26-000057");
  });

  it("picks a prior-year comparison for 10-Q", () => {
    const current = pickLatestSupportedFiling(ticker, submissions)!;
    const comparison = pickComparisonFiling(ticker, submissions, current);
    expect(comparison?.accessionNumber).toBe("0000320193-25-000093");
  });

  it("prioritizes exact and prefix ticker matches in search ordering", () => {
    const ranked = sortTickerSearchResults(
      [
        {
          ticker: "EDTK",
          companyName: "Skillful Craftsman Education Technology Ltd",
          cik: "0000000001",
          exchange: "Nasdaq"
        },
        {
          ticker: "TSM",
          companyName: "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD",
          cik: "0001046179",
          exchange: "NYSE"
        },
        {
          ticker: "TSMWF",
          companyName: "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD",
          cik: "0000000002",
          exchange: "OTC"
        }
      ],
      "tsm"
    );

    expect(ranked[0]?.ticker).toBe("TSM");
    expect(ranked[1]?.ticker).toBe("TSMWF");
  });

  it("resolves exact ticker lookups from the cached snapshot without search enrichment", async () => {
    const match = await lookupTicker("aapl", {
      KABUYOMI_CACHE: {
        get: async () => ({
          updatedAt: "2026-04-15T00:00:00.000Z",
          items: [
            {
              ticker: "AAPL",
              companyName: "Apple Inc.",
              cik: "0000320193",
              exchange: "Nasdaq"
            }
          ]
        })
      }
    } as never);

    expect(match).toEqual({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      exchange: "Nasdaq"
    });
  });

  it("resolves separator aliases for class tickers without crossing into other symbols", async () => {
    const match = await lookupTicker("BRK.B", {
      KABUYOMI_CACHE: {
        get: async () => ({
          updatedAt: "2026-04-19T00:00:00.000Z",
          items: [
            {
              ticker: "BRK-A",
              companyName: "Berkshire Hathaway Inc. Class A",
              cik: "0001067983",
              exchange: "NYSE"
            },
            {
              ticker: "BRK-B",
              companyName: "Berkshire Hathaway Inc. Class B",
              cik: "0001067983",
              exchange: "NYSE"
            }
          ]
        })
      }
    } as never);

    expect(match?.ticker).toBe("BRK-B");
  });

  it("falls back to the base ticker when a separated class-like suffix has no dedicated symbol", async () => {
    const match = await lookupTicker("BARK A", {
      KABUYOMI_CACHE: {
        get: async () => ({
          updatedAt: "2026-04-19T00:00:00.000Z",
          items: [
            {
              ticker: "BARK",
              companyName: "BARK, Inc.",
              cik: "0001823529",
              exchange: "NYSE"
            },
            {
              ticker: "BARKW",
              companyName: "BARK, Inc. Warrant",
              cik: "0001823529",
              exchange: "NYSE"
            }
          ]
        })
      }
    } as never);

    expect(match?.ticker).toBe("BARK");
  });

  it("resolves separated compact suffix aliases before falling back to the base ticker", async () => {
    const match = await lookupTicker("BARK W", {
      KABUYOMI_CACHE: {
        get: async () => ({
          updatedAt: "2026-04-19T00:00:00.000Z",
          items: [
            {
              ticker: "BARK",
              companyName: "BARK, Inc.",
              cik: "0001823529",
              exchange: "NYSE"
            },
            {
              ticker: "BARKW",
              companyName: "BARK, Inc. Warrant",
              cik: "0001823529",
              exchange: "NYSE"
            }
          ]
        })
      }
    } as never);

    expect(match?.ticker).toBe("BARKW");
  });

  it("keeps exact family ticker lookups distinct", async () => {
    const match = await lookupTicker("GOOG", {
      KABUYOMI_CACHE: {
        get: async () => ({
          updatedAt: "2026-04-19T00:00:00.000Z",
          items: [
            {
              ticker: "GOOG",
              companyName: "Alphabet Inc. Class C",
              cik: "0001652044",
              exchange: "Nasdaq"
            },
            {
              ticker: "GOOGL",
              companyName: "Alphabet Inc. Class A",
              cik: "0001652044",
              exchange: "Nasdaq"
            }
          ]
        })
      }
    } as never);

    expect(match?.ticker).toBe("GOOG");
  });

  it("hydrates multiple short-query search results instead of only the first unresolved ticker", async () => {
    const cache = new Map<string, unknown>([
      [
        "tickers_snapshot",
        {
          updatedAt: "2026-04-15T00:00:00.000Z",
          items: [
            { ticker: "GE", companyName: "GE Aerospace", cik: "0000040545", exchange: "NYSE" },
            { ticker: "GEF", companyName: "Greif, Inc.", cik: "0000043920", exchange: "NYSE" }
          ]
        }
      ]
    ]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const body = JSON.parse(String(init?.body ?? ""));
      void url;
      if (body.cik === "0000040545") {
        return new Response(JSON.stringify({
          name: "GE Aerospace",
          filings: {
            recent: {
              form: ["10-K"],
              accessionNumber: ["0000040545-26-000001"],
              primaryDocument: ["ge10k.htm"],
              filingDate: ["2026-02-13"],
              reportDate: ["2025-12-31"]
            }
          }
        }), { status: 200 });
      }

      if (body.cik === "0000043920") {
        return new Response(JSON.stringify({
          name: "Greif, Inc.",
          filings: {
            recent: {
              form: ["10-Q"],
              accessionNumber: ["0000043920-26-000002"],
              primaryDocument: ["gef10q.htm"],
              filingDate: ["2026-03-01"],
              reportDate: ["2026-01-31"]
            }
          }
        }), { status: 200 });
      }

      throw new Error(`Unexpected fetch body: ${JSON.stringify(body)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchTickers("ge", {
      KABUYOMI_CACHE: {
        get: async (key: string) => cache.get(key),
        put: async (key: string, value: unknown) => {
          cache.set(key, value);
        }
      },
      SEC_FETCHER_BASE_URL: "http://127.0.0.1:8789",
      SEC_FETCHER_SHARED_SECRET: "secret"
    } as never);

    expect(result.items.map((item) => [item.ticker, item.latestFormType])).toEqual([
      ["GE", "10-K"],
      ["GEF", "10-Q"]
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ranks separator-alias class ticker queries against the resolved ticker", () => {
    const ranked = sortTickerSearchResults(
      [
        {
          ticker: "BRK-A",
          companyName: "Berkshire Hathaway Inc. Class A",
          cik: "0001067983",
          exchange: "NYSE"
        },
        {
          ticker: "BRK-B",
          companyName: "Berkshire Hathaway Inc. Class B",
          cik: "0001067983",
          exchange: "NYSE"
        }
      ],
      "BRK.B"
    );

    expect(ranked[0]?.ticker).toBe("BRK-B");
  });

  it("ranks separated suffix queries against the compact or base ticker family", () => {
    const ranked = sortTickerSearchResults(
      [
        {
          ticker: "BARK",
          companyName: "BARK, Inc.",
          cik: "0001823529",
          exchange: "NYSE"
        },
        {
          ticker: "BARKW",
          companyName: "BARK, Inc. Warrant",
          cik: "0001823529",
          exchange: "NYSE"
        }
      ],
      "BARK A"
    );

    expect(ranked[0]?.ticker).toBe("BARK");
  });

  it("prefers the device key over the shared client IP for quota identity", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "cf-connecting-ip": "203.0.113.5",
          "x-device-key": "device-123",
          "x-quota-subject": "pro:forged"
        }
      }),
      entitlementEnv()
    );

    expect(identity.plan).toBe("free");
    expect(identity.identityKind).toBe("device_key");
    expect(identity.quotaSubject).toMatch(/^free:device:[a-f0-9]{64}$/);
    expect(identity.quotaSubject).not.toContain("203.0.113.5");
  });

  it("keeps the local-device override for localhost and test hosts", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi.test/v1/usage", {
        headers: {
          "cf-connecting-ip": "203.0.113.5",
          "x-device-key": "device-123"
        }
      }),
      entitlementEnv()
    );

    expect(identity.plan).toBe("free");
    expect(identity.identityKind).toBe("local_device");
    expect(identity.quotaSubject).toBe("free:local:device-123");
  });

  it("rejects requests without a device key when the route requires one", async () => {
    await expect(
      readQuotaIdentity(
        new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
          headers: {
            "cf-connecting-ip": "203.0.113.5"
          }
        }),
        entitlementEnv(),
        { requireDeviceKey: true }
      )
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Device key is required"
    });
  });

  it("falls back to the hashed client IP only when the route does not require a device key", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "cf-connecting-ip": "203.0.113.5"
        }
      }),
      entitlementEnv()
    );

    expect(identity.plan).toBe("free");
    expect(identity.identityKind).toBe("ip_hash");
    expect(identity.quotaSubject).toMatch(/^free:[a-f0-9]{64}$/);
    expect(identity.quotaSubject).not.toContain("device-123");
  });

  it("uses detached dev access ahead of synced billing when the dev gate is enabled", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "x-device-key": "device-123",
          "x-kabuyomi-original-transaction-id": "tx-123",
          "x-kabuyomi-detached-access": "dev_unlimited"
        }
      }),
      {
        ...entitlementEnv({
          plan: "pro",
          quotaSubject: "pro:abc123",
          productId: "app.kabuyomi.pro.monthly",
          syncedAt: "2026-04-20T00:00:00.000Z"
        }),
        DEV_DETACHED_ACCESS_ENABLED: "true"
      } as never
    );

    expect(identity.plan).toBe("pro");
    expect(identity.identityKind).toBe("detached_access");
    expect(identity.accessMode).toBe("dev_unlimited");
    expect(identity.chatLimitOverride).toBe(Number.MAX_SAFE_INTEGER);
    expect(identity.stockLimitOverride).toBe(Number.MAX_SAFE_INTEGER);
    expect(identity.quotaSubject).toMatch(/^detached:dev_unlimited:[a-f0-9]{64}$/);
  });

  it("uses the synced pro entitlement when the original transaction id resolves server-side", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "x-device-key": "device-123",
          "x-kabuyomi-original-transaction-id": "tx-123"
        }
      }),
      entitlementEnv({
        plan: "pro",
        quotaSubject: "pro:abc123",
        productId: "app.kabuyomi.pro.monthly",
        syncedAt: "2026-04-20T00:00:00.000Z"
      })
    );

    expect(identity.plan).toBe("pro");
    expect(identity.identityKind).toBe("entitlement");
    expect(identity.quotaSubject).toBe("pro:abc123");
  });

  it("falls back to the device identity when the synced entitlement is not active pro", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "x-device-key": "device-123",
          "x-kabuyomi-original-transaction-id": "tx-123"
        }
      }),
      entitlementEnv({
        plan: "free",
        quotaSubject: "free:abc123",
        productId: "app.kabuyomi.pro.monthly",
        syncedAt: "2026-04-20T00:00:00.000Z"
      })
    );

    expect(identity.plan).toBe("free");
    expect(identity.identityKind).toBe("device_key");
    expect(identity.quotaSubject).toMatch(/^free:device:[a-f0-9]{64}$/);
  });
});
