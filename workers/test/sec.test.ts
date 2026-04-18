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

  it("prefers the device key over the shared client IP for quota identity", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "cf-connecting-ip": "203.0.113.5",
          "x-device-key": "device-123",
          "x-quota-subject": "pro:forged"
        }
      }),
      {} as never
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
      {} as never
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
        {} as never,
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
      {} as never
    );

    expect(identity.plan).toBe("free");
    expect(identity.identityKind).toBe("ip_hash");
    expect(identity.quotaSubject).toMatch(/^free:[a-f0-9]{64}$/);
    expect(identity.quotaSubject).not.toContain("device-123");
  });

  it("uses the device key subject for explicit debug unlimited requests", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi.test/v1/usage", {
        headers: {
          "cf-connecting-ip": "203.0.113.5",
          "x-device-key": "dev-unlimited-chat-AAPL-123",
          "x-kabuyomi-debug-unlimited": "1"
        }
      }),
      { DEBUG_UNLIMITED_ENABLED: "true" } as never,
      { requireDeviceKey: true, allowDebugUnlimited: true }
    );

    expect(identity.plan).toBe("free");
    expect(identity.identityKind).toBe("debug_device");
    expect(identity.quotaSubject).toBe("free:debug:dev-unlimited-chat-AAPL-123");
  });

  it("ignores the debug unlimited header when the server-side gate is disabled", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi.test/v1/usage", {
        headers: {
          "cf-connecting-ip": "203.0.113.5",
          "x-device-key": "dev-unlimited-chat-AAPL-123",
          "x-kabuyomi-debug-unlimited": "1"
        }
      }),
      {} as never,
      { requireDeviceKey: true, allowDebugUnlimited: true }
    );

    expect(identity.plan).toBe("free");
    expect(identity.identityKind).toBe("local_device");
    expect(identity.quotaSubject).toBe("free:local:dev-unlimited-chat-AAPL-123");
  });

  it("ignores the debug unlimited header for non-local worker hosts even when enabled", async () => {
    const identity = await readQuotaIdentity(
      new Request("https://kabuyomi-api.example.workers.dev/v1/usage", {
        headers: {
          "cf-connecting-ip": "203.0.113.5",
          "x-device-key": "dev-unlimited-chat-AAPL-123",
          "x-kabuyomi-debug-unlimited": "1"
        }
      }),
      { DEBUG_UNLIMITED_ENABLED: "true" } as never,
      { requireDeviceKey: true, allowDebugUnlimited: true }
    );

    expect(identity.plan).toBe("free");
    expect(identity.identityKind).toBe("device_key");
    expect(identity.quotaSubject).toMatch(/^free:device:[a-f0-9]{64}$/);
  });
});
