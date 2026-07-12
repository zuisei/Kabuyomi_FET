import { afterEach, describe, expect, it, vi } from "vitest";

const refreshMocks = vi.hoisted(() => ({
  refreshTickerSnapshot: vi.fn(),
  refreshTrackedFilings: vi.fn()
}));

vi.mock("../src/clients/sec", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/clients/sec")>()),
  refreshTickerSnapshot: refreshMocks.refreshTickerSnapshot
}));

vi.mock("../src/lib/daily-refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/daily-refresh")>()),
  refreshTrackedFilings: refreshMocks.refreshTrackedFilings
}));

import worker from "../src/index";
import { resetRemoteConfigMemoryCache } from "../src/lib/remote-config";

const executionContext = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn()
} as never;

afterEach(() => {
  refreshMocks.refreshTickerSnapshot.mockReset();
  refreshMocks.refreshTrackedFilings.mockReset();
  resetRemoteConfigMemoryCache();
});

describe("emergency route controls", () => {
  it.each([
    {
      url: "https://kabuyomi.test/v1/internal/backfill/history",
      env: { EMERGENCY_DISABLE_BACKGROUND_JOBS: "true" },
      error: "Background jobs are temporarily disabled"
    },
    {
      url: "https://kabuyomi.test/internal/sec/tickers-snapshot",
      env: { EMERGENCY_DISABLE_SEC_REFRESH: "1" },
      error: "SEC refresh is temporarily disabled"
    },
    {
      url: "https://kabuyomi.test/v1/internal/backfill/history",
      env: { EMERGENCY_DISABLE_SEC_REFRESH: "true" },
      error: "SEC refresh is temporarily disabled"
    },
    {
      url: "https://kabuyomi.test/v1/company/AAPL/refresh",
      env: { EMERGENCY_DISABLE_SEC_REFRESH: "on" },
      error: "SEC refresh is temporarily disabled"
    },
    {
      url: "https://kabuyomi.test/v1/identity/bootstrap",
      env: { EMERGENCY_DISABLE_MIGRATIONS: "true" },
      error: "Migration operations are temporarily disabled"
    },
    {
      url: "https://kabuyomi.test/v1/account/paid-credit-migration",
      env: { EMERGENCY_DISABLE_MIGRATIONS: "yes" },
      error: "Migration operations are temporarily disabled"
    },
    {
      url: "https://kabuyomi.test/internal/subscription-principal-migration",
      env: { EMERGENCY_DISABLE_MIGRATIONS: "true" },
      error: "Migration operations are temporarily disabled"
    }
  ])("returns 503 before executing $url", async ({ url, env, error }) => {
    const get = vi.fn().mockResolvedValue(null);
    const response = await worker.fetch(
      new Request(url, { method: "POST" }),
      {
        ...env,
        KABUYOMI_CACHE: { get }
      } as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error });
    expect(get).not.toHaveBeenCalled();
  });

  it("also prevents the public search path from lazily refreshing a missing SEC snapshot", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/search?q=AAPL"),
      {
        EMERGENCY_DISABLE_SEC_REFRESH: "true",
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never,
      executionContext
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "SEC refresh is temporarily disabled" });
  });
});

describe("scheduled refresh controls", () => {
  it("does not load config or run work when background jobs are emergency-disabled", async () => {
    const get = vi.fn();
    await worker.scheduled({} as never, {
      EMERGENCY_DISABLE_BACKGROUND_JOBS: "true",
      KABUYOMI_CACHE: { get }
    } as never);

    expect(get).not.toHaveBeenCalled();
    expect(refreshMocks.refreshTickerSnapshot).not.toHaveBeenCalled();
    expect(refreshMocks.refreshTrackedFilings).not.toHaveBeenCalled();
  });

  it("does not load config or run work when SEC refresh is emergency-disabled", async () => {
    const get = vi.fn();
    await worker.scheduled({} as never, {
      EMERGENCY_DISABLE_SEC_REFRESH: "true",
      KABUYOMI_CACHE: { get }
    } as never);

    expect(get).not.toHaveBeenCalled();
    expect(refreshMocks.refreshTickerSnapshot).not.toHaveBeenCalled();
    expect(refreshMocks.refreshTrackedFilings).not.toHaveBeenCalled();
  });

  it("keeps all scheduled SEC work opt-in through remote config", async () => {
    await worker.scheduled({} as never, {
      KABUYOMI_CACHE: { get: vi.fn().mockResolvedValue(null) }
    } as never);

    expect(refreshMocks.refreshTickerSnapshot).not.toHaveBeenCalled();
    expect(refreshMocks.refreshTrackedFilings).not.toHaveBeenCalled();
  });

  it("runs both scheduled SEC stages only when explicitly enabled", async () => {
    refreshMocks.refreshTickerSnapshot.mockResolvedValue(undefined);
    refreshMocks.refreshTrackedFilings.mockResolvedValue(undefined);
    await worker.scheduled({} as never, {
      KABUYOMI_CACHE: {
        get: vi.fn().mockResolvedValue({ dailyRefreshEnabled: true })
      }
    } as never);

    expect(refreshMocks.refreshTickerSnapshot).toHaveBeenCalledOnce();
    expect(refreshMocks.refreshTrackedFilings).toHaveBeenCalledOnce();
  });
});
