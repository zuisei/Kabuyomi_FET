import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lookupTicker,
  pickComparisonFiling,
  pickLatestSupportedFiling,
  searchTickers,
  sortTickerSearchResults
} from "../src/clients/sec";
import { readQuotaIdentity } from "../src/lib/pipeline";
import type { FilingReference, TickerRecord } from "../src/env";

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
    SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1: "test-subscription-principal-secret",
    APPLE_APP_STORE_SERVER_ENVIRONMENT: "sandbox",
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

  it("skips amended 10-K/A filings when selecting the latest analyzable filing", () => {
    const filing = pickLatestSupportedFiling(ticker, {
      name: "Tesla, Inc.",
      filings: {
        recent: {
          form: ["8-K", "10-K/A", "10-K"],
          accessionNumber: ["0001-26-000003", "0001-26-000002", "0001-26-000001"],
          primaryDocument: ["8k.htm", "tsla-10ka.htm", "tsla-10k.htm"],
          filingDate: ["2026-05-01", "2026-04-30", "2026-01-29"],
          reportDate: ["2026-05-01", "2025-12-31", "2025-12-31"]
        }
      }
    });

    expect(filing?.formType).toBe("10-K");
    expect(filing?.accessionNumber).toBe("0001-26-000001");
    expect(filing?.primaryDocument).toBe("tsla-10k.htm");
  });

  it("picks a prior-year comparison for 10-Q", () => {
    const current = pickLatestSupportedFiling(ticker, submissions)!;
    const comparison = pickComparisonFiling(ticker, submissions, current);
    expect(comparison?.accessionNumber).toBe("0000320193-25-000093");
  });

  it("does not use the previous quarter when no prior-year 10-Q is available", () => {
    const current: FilingReference = {
      ...ticker,
      formType: "10-Q",
      accessionNumber: "0000320193-26-000057",
      primaryDocument: "current.htm",
      filedAt: "2026-01-30",
      periodOfReport: "2025-12-27"
    };
    const comparison = pickComparisonFiling(ticker, {
      name: ticker.companyName,
      filings: {
        recent: {
          form: ["10-Q", "10-Q"],
          accessionNumber: [current.accessionNumber, "0000320193-25-000101"],
          primaryDocument: [current.primaryDocument, "previous-quarter.htm"],
          filingDate: [current.filedAt, "2025-10-31"],
          reportDate: [current.periodOfReport, "2025-09-27"]
        }
      }
    }, current);

    expect(comparison).toBeNull();
  });

  it("excludes future filings during backfill and accepts a 53-week prior-year comparison", () => {
    const current: FilingReference = {
      ...ticker,
      formType: "10-Q",
      accessionNumber: "0000320193-26-000020",
      primaryDocument: "backfill-current.htm",
      filedAt: "2026-02-27",
      periodOfReport: "2026-02-01"
    };
    const comparison = pickComparisonFiling(ticker, {
      name: ticker.companyName,
      filings: {
        recent: {
          form: ["10-Q", "10-Q", "10-Q"],
          accessionNumber: [
            "0000320193-26-000090",
            current.accessionNumber,
            "0000320193-25-000020"
          ],
          primaryDocument: ["future.htm", current.primaryDocument, "prior-53-week.htm"],
          filingDate: ["2026-05-29", current.filedAt, "2025-02-28"],
          reportDate: ["2026-05-03", current.periodOfReport, "2025-01-26"]
        }
      }
    }, current);

    expect(comparison?.accessionNumber).toBe("0000320193-25-000020");
    expect(comparison?.periodOfReport).toBe("2025-01-26");
  });

  it("does not use a two-year-old 10-K as an annual comparison", () => {
    const current: FilingReference = {
      ...ticker,
      formType: "10-K",
      accessionNumber: "0000320193-26-000120",
      primaryDocument: "annual-2026.htm",
      filedAt: "2026-03-20",
      periodOfReport: "2026-01-31"
    };
    const comparison = pickComparisonFiling(ticker, {
      name: ticker.companyName,
      filings: {
        recent: {
          form: ["10-K", "10-K"],
          accessionNumber: [current.accessionNumber, "0000320193-24-000120"],
          primaryDocument: [current.primaryDocument, "annual-2024.htm"],
          filingDate: [current.filedAt, "2024-03-22"],
          reportDate: [current.periodOfReport, "2024-02-03"]
        }
      }
    }, current);

    expect(comparison).toBeNull();
  });

  it("accepts a 53-week prior-year 10-K as an annual comparison", () => {
    const current: FilingReference = {
      ...ticker,
      formType: "10-K",
      accessionNumber: "0000320193-26-000121",
      primaryDocument: "annual-current.htm",
      filedAt: "2026-03-20",
      periodOfReport: "2026-02-01"
    };
    const comparison = pickComparisonFiling(ticker, {
      name: ticker.companyName,
      filings: {
        recent: {
          form: ["10-K", "10-K"],
          accessionNumber: [current.accessionNumber, "0000320193-25-000121"],
          primaryDocument: [current.primaryDocument, "annual-prior-53-week.htm"],
          filingDate: [current.filedAt, "2025-03-14"],
          reportDate: [current.periodOfReport, "2025-01-26"]
        }
      }
    }, current);

    expect(comparison?.accessionNumber).toBe("0000320193-25-000121");
    expect(comparison?.periodOfReport).toBe("2025-01-26");
  });

  it("rejects a prior-year 10-K that was filed after the current backfill filing", () => {
    const current: FilingReference = {
      ...ticker,
      formType: "10-K",
      accessionNumber: "0000320193-26-000122",
      primaryDocument: "annual-backfill.htm",
      filedAt: "2026-03-20",
      periodOfReport: "2026-01-31"
    };
    const comparison = pickComparisonFiling(ticker, {
      name: ticker.companyName,
      filings: {
        recent: {
          form: ["10-K", "10-K"],
          accessionNumber: [current.accessionNumber, "0000320193-25-000122"],
          primaryDocument: [current.primaryDocument, "late-filed-prior.htm"],
          filingDate: [current.filedAt, "2026-04-01"],
          reportDate: [current.periodOfReport, "2025-02-01"]
        }
      }
    }, current);

    expect(comparison).toBeNull();
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

  it("reads multiple short-query latest form types from D1 without hot-path hydration", async () => {
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

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const kvPut = vi.fn();

    const result = await searchTickers("ge", {
      KABUYOMI_CACHE: {
        get: async (key: string) => cache.get(key),
        put: kvPut
      },
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue({
              results: [
                { ticker: "GE", latestFormType: "10-K" },
                { ticker: "GEF", latestFormType: "10-Q" }
              ]
            })
          }))
        }))
      }
    } as never);

    expect(result.items.map((item) => [item.ticker, item.latestFormType])).toEqual([
      ["GE", "10-K"],
      ["GEF", "10-Q"]
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kvPut).not.toHaveBeenCalled();
  });

  it("fills missing D1 latest form types with bounded submissions lookups", async () => {
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

    const fetchMock = vi.fn();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "Greif, Inc.",
          filings: {
            recent: {
              form: ["8-K", "10-Q"],
              accessionNumber: ["0000043920-26-000010", "0000043920-26-000008"],
              primaryDocument: ["gef-8k.htm", "gef-10q.htm"],
              filingDate: ["2026-04-01", "2026-02-26"],
              reportDate: ["2026-04-01", "2026-01-31"]
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const kvPut = vi.fn();
    const d1Run = vi.fn().mockResolvedValue({ success: true });

    const result = await searchTickers("ge", {
      SEC_FETCHER_BASE_URL: "https://sec-fetcher.test",
      KABUYOMI_CACHE: {
        get: async (key: string) => cache.get(key),
        put: kvPut
      },
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() =>
            sql.includes("SELECT")
              ? {
                  all: vi.fn().mockResolvedValue({
                    results: [{ ticker: "GE", latestFormType: "10-K" }]
                  })
                }
              : {
                  run: d1Run
                }
          )
        }))
      }
    } as never);

    expect(result.items.map((item) => [item.ticker, item.latestFormType])).toEqual([
      ["GE", "10-K"],
      ["GEF", "10-Q"]
    ]);
    expect(cache.has("search_latest_form_type:GE")).toBe(false);
    expect(cache.has("search_latest_form_type:GEF")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(d1Run).toHaveBeenCalledTimes(1);
    expect(kvPut).not.toHaveBeenCalled();
  });

  /// SASOL は 20-F 提出者。以前は「対応外の形式」として 6-K を返していたが、
  /// 2026-08-24 に外国企業へ対応したので **20-F を対応済みとして返す**のが正しい。
  it("resolves a foreign issuer to its 20-F rather than to a stray 6-K", async () => {
    const cache = new Map<string, unknown>([
      [
        "tickers_snapshot",
        {
          updatedAt: "2026-04-15T00:00:00.000Z",
          items: [{ ticker: "SSL", companyName: "SASOL LTD", cik: "0000314590", exchange: "NYSE" }]
        }
      ]
    ]);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "SASOL LTD",
          filings: {
            recent: {
              form: ["6-K", "20-F"],
              accessionNumber: ["0000000000-26-000010", "0000000000-26-000001"],
              primaryDocument: ["ssl-6k.htm", "ssl-20f.htm"],
              filingDate: ["2026-04-01", "2026-02-20"],
              reportDate: ["2026-04-01", "2025-12-31"]
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchTickers("ssl", {
      SEC_FETCHER_BASE_URL: "https://sec-fetcher.test",
      KABUYOMI_CACHE: {
        get: async (key: string) => cache.get(key),
        put: vi.fn()
      },
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() =>
            sql.includes("SELECT")
              ? {
                  all: vi.fn().mockResolvedValue({ results: [] })
                }
              : {
                  run: vi.fn().mockResolvedValue({ success: true })
                }
          )
        }))
      }
    } as never);

    expect(result.items.map((item) => [item.ticker, item.latestFormType])).toEqual([["SSL", "20-F"]]);
  });

  /// 対応外の形式を出す経路自体は残っている。投信は 10-K/10-Q/20-F のどれも出さない。
  it("still surfaces an unsupported recent form when nothing analyzable exists", async () => {
    const cache = new Map<string, unknown>([
      [
        "tickers_snapshot",
        {
          updatedAt: "2026-04-15T00:00:00.000Z",
          items: [{ ticker: "MUJ", companyName: "BLACKROCK MUNIYIELD NJ FUND", cik: "0000903914", exchange: "NYSE" }]
        }
      ]
    ]);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          name: "BLACKROCK MUNIYIELD NJ FUND",
          filings: {
            recent: {
              form: ["NPORT-P", "N-CSRS"],
              accessionNumber: ["0000000000-26-000010", "0000000000-26-000001"],
              primaryDocument: ["muj-nport.htm", "muj-ncsrs.htm"],
              filingDate: ["2026-04-01", "2026-02-20"],
              reportDate: ["2026-04-01", "2025-12-31"]
            }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchTickers("muj", {
      SEC_FETCHER_BASE_URL: "https://sec-fetcher.test",
      KABUYOMI_CACHE: {
        get: async (key: string) => cache.get(key),
        put: vi.fn()
      },
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() =>
            sql.includes("SELECT")
              ? { all: vi.fn().mockResolvedValue({ results: [] }) }
              : { run: vi.fn().mockResolvedValue({ success: true }) }
          )
        }))
      }
    } as never);

    expect(result.items.map((item) => [item.ticker, item.latestFormType])).toEqual([["MUJ", "NPORT-P"]]);
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
      publicMessage: "Installation credential is required"
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

  it("uses detached unlimited access when the device key is allowlisted and the header is present", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "x-device-key": "device-123",
          "x-kabuyomi-detached-access": "dev_unlimited"
        }
      }),
      {
        ...entitlementEnv(),
        KABUYOMI_ENV: "test",
        ENVIRONMENT: "test",
        DEV_DETACHED_ACCESS_DEVICE_KEYS: "device-123"
      } as any
    );

    expect(identity.plan).toBe("pro");
    expect(identity.identityKind).toBe("detached_device");
    expect(identity.accessMode).toBe("dev_unlimited");
    expect(identity.chatLimitOverride).toBe(Number.MAX_SAFE_INTEGER);
    expect(identity.stockLimitOverride).toBe(Number.MAX_SAFE_INTEGER);
    expect(identity.quotaSubject).toMatch(/^pro:detached:[a-f0-9]{64}$/);
  });

  it("uses detached unlimited access for allowlisted device-key prefixes", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "x-device-key": "bench-2026-07-02-aapl-q01",
          "x-kabuyomi-detached-access": "dev_unlimited"
        }
      }),
      {
        ...entitlementEnv(),
        KABUYOMI_ENV: "test",
        ENVIRONMENT: "test",
        DEV_DETACHED_ACCESS_DEVICE_KEYS: "device-123,bench-*"
      } as any
    );

    expect(identity.plan).toBe("pro");
    expect(identity.identityKind).toBe("detached_device");
    expect(identity.accessMode).toBe("dev_unlimited");
    expect(identity.chatLimitOverride).toBe(Number.MAX_SAFE_INTEGER);
    expect(identity.stockLimitOverride).toBe(Number.MAX_SAFE_INTEGER);
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
        status: "active",
        expiresAt: "2099-04-20T00:00:00.000Z",
        revokedAt: null,
        updatedAt: "2026-04-20T00:00:00.000Z",
        originalTransactionId: "tx-123",
        transactionId: "tx-123-current",
        periodStart: "2026-04-01T00:00:00.000Z",
        periodEnd: "2099-04-20T00:00:00.000Z",
        monthlyCredits: 900,
        monthlyGrantOperationId: "sub-grant:v1:test",
        lastVerifiedAt: new Date().toISOString(),
        verificationEnvironment: "sandbox",
        verificationVersion: "test"
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
