import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REMOTE_CONFIG,
  isCreditBillingEnabledForIdentity,
  loadRemoteConfig,
  REMOTE_CONFIG_MAX_STALE_AGE_SECONDS,
  resetRemoteConfigMemoryCache
} from "../src/lib/remote-config";

function completeConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    ...DEFAULT_REMOTE_CONFIG,
    planCredits: { ...DEFAULT_REMOTE_CONFIG.planCredits },
    trackedTickers: [...DEFAULT_REMOTE_CONFIG.trackedTickers]
  };
  delete config.configVersion;
  delete config.configUpdatedAt;
  delete config.configSource;
  delete config.maxStaleAgeSeconds;
  return { ...config, ...overrides };
}

function completeEnvelope(
  configOverrides: Record<string, unknown> = {},
  envelopeOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    version: "complete-schema-v2",
    updatedAt: new Date().toISOString(),
    maxStaleAgeSeconds: 3600,
    config: completeConfig(configOverrides),
    ...envelopeOverrides
  };
}

describe("remote config", () => {
  afterEach(() => {
    resetRemoteConfigMemoryCache();
    vi.useRealTimers();
  });

  it("keeps the curated ticker seed but leaves scheduled refresh opt-in", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => null
      }
    } as never);

    expect(config.trackedTickers).toEqual(DEFAULT_REMOTE_CONFIG.trackedTickers);
    expect(config.dailyRefreshBatchSize).toBe(DEFAULT_REMOTE_CONFIG.dailyRefreshBatchSize);
    expect(config.trackedTickers).toHaveLength(30);
    expect(config.dailyRefreshEnabled).toBe(false);
    expect(config.webSupplementEnabled).toBe(false);
    expect(config.creditBillingEnabled).toBe(true);
    expect(config.freeDailyChatLimit).toBe(25);
    expect(config.planCredits).toEqual({
      free: 0,
      lite: 400,
      pro: 900,
      pro_max: 2000
    });
    expect(config.freeMonthlyCreditLimit).toBe(0);
    expect(config.liteMonthlyCreditLimit).toBe(400);
    expect(config.proMonthlyCreditLimit).toBe(900);
    expect(config.proMaxMonthlyCreditLimit).toBe(2000);
  });

  it("logs and falls back to defaults when remote config KV read fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => {
          throw new Error("kv unavailable");
        }
      }
    } as never);

    expect(config).toMatchObject({
      ...DEFAULT_REMOTE_CONFIG,
      configUpdatedAt: expect.any(String)
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"remote_config_fail_closed\""));
  });

  it("normalizes plan credit limits and keeps recurring Free credits at zero", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => ({
          planCredits: {
            free: 25,
            lite: 175,
            pro: 600,
            pro_max: 1500
          }
        })
      }
    } as never);

    expect(config.planCredits).toEqual({
      free: 0,
      lite: 175,
      pro: 600,
      pro_max: 1500
    });
    expect(config.freeMonthlyCreditLimit).toBe(0);
    expect(config.liteMonthlyCreditLimit).toBe(175);
    expect(config.proMonthlyCreditLimit).toBe(600);
    expect(config.proMaxMonthlyCreditLimit).toBe(1500);
  });

  it("keeps legacy Free chat limit at least 25", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => ({
          freeDailyChatLimit: 10
        })
      }
    } as never);

    expect(config.freeDailyChatLimit).toBe(25);
  });

  it("keeps legacy paid monthly fields as fallbacks without reviving recurring Free credits", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => ({
          freeMonthlyCreditLimit: 20,
          liteMonthlyCreditLimit: 120,
          proMonthlyCreditLimit: 450,
          proMaxMonthlyCreditLimit: 900
        })
      }
    } as never);

    expect(config.planCredits).toEqual({
      free: 0,
      lite: 120,
      pro: 450,
      pro_max: 900
    });
  });

  it("enables credit billing for detached dev access when the global credit flag is off", () => {
    const creditOffConfig = {
      ...DEFAULT_REMOTE_CONFIG,
      creditBillingEnabled: false
    };

    expect(isCreditBillingEnabledForIdentity(creditOffConfig, {})).toBe(false);
    expect(
      isCreditBillingEnabledForIdentity(creditOffConfig, {
        accessMode: "dev_unlimited"
      })
    ).toBe(true);
  });

  it("fails closed in production when KV is unavailable and no trusted LKG exists", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: { get: async () => { throw new Error("offline"); } }
    } as never);
    expect(config).toMatchObject({
      configSource: "safe_fail_closed",
      maintenanceMode: true,
      chatEnabled: false,
      adsEnabled: false,
      rewardedCreditEnabled: false,
      webSupplementEnabled: false,
      consumablePurchasesEnabled: false
    });
  });

  it("uses the same strict fail-closed path for the deployed test Worker", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "test",
      ENVIRONMENT: "test",
      KABUYOMI_CACHE: { get: async () => null }
    } as never);

    expect(config).toMatchObject({
      configSource: "safe_fail_closed",
      maintenanceMode: true,
      chatEnabled: false
    });
  });

  it("accepts a complete envelope on the deployed test Worker", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "test",
      ENVIRONMENT: "test",
      KABUYOMI_CACHE: { get: async () => completeEnvelope() }
    } as never);

    expect(config).toMatchObject({
      configSource: "kv",
      maintenanceMode: false,
      liteDailyChatLimit: 10
    });
  });

  it("never reuses a permissive local cache entry across the deployed boundary", async () => {
    const cache = { get: vi.fn().mockResolvedValue({ chatEnabled: true }) };
    const local = await loadRemoteConfig({ KABUYOMI_CACHE: cache } as never);
    const deployed = await loadRemoteConfig({
      KABUYOMI_ENV: "test",
      ENVIRONMENT: "test",
      KABUYOMI_CACHE: cache
    } as never);

    expect(local.configSource).toBe("kv");
    expect(deployed.configSource).toBe("safe_fail_closed");
    expect(cache.get).toHaveBeenCalledTimes(2);
  });

  it("rejects an undated legacy-flat config in a deployed environment", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: { get: async () => completeConfig() }
    } as never);

    expect(config.configSource).toBe("safe_fail_closed");
  });

  it.each([
    { label: "wrong-type", maxStaleAgeSeconds: "3600" },
    { label: "unbounded", maxStaleAgeSeconds: REMOTE_CONFIG_MAX_STALE_AGE_SECONDS + 1 }
  ])("rejects $label envelope metadata in a deployed environment", async ({ maxStaleAgeSeconds }) => {
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({}, { maxStaleAgeSeconds })
      }
    } as never);

    expect(config.configSource).toBe("safe_fail_closed");
  });

  it("rejects a missing capability field instead of inferring it", async () => {
    const incomplete = completeConfig();
    delete incomplete.rewardedSsvReady;
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({}, { config: incomplete })
      }
    } as never);

    expect(config.configSource).toBe("safe_fail_closed");
    expect(config.rewardedSsvReady).toBe(false);
  });

  it("rejects wrong-type capability fields instead of coercing them", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "test",
      ENVIRONMENT: "test",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({ chatEnabled: "true" })
      }
    } as never);

    expect(config.configSource).toBe("safe_fail_closed");
    expect(config.chatEnabled).toBe(false);
  });

  it("rejects a stale envelope on the deployed test Worker", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-11T02:00:00.000Z") });
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "test",
      ENVIRONMENT: "test",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({}, {
          updatedAt: "2026-07-11T00:00:00.000Z",
          maxStaleAgeSeconds: 60
        })
      }
    } as never);

    expect(config.configSource).toBe("safe_fail_closed");
  });

  it("keeps a reviewed config active after 7 days and emits the 14-day refresh warning", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-26T00:00:00.000Z") });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({}, {
          version: "reviewed-2026-07-11",
          updatedAt: "2026-07-11T00:00:00.000Z",
          maxStaleAgeSeconds: REMOTE_CONFIG_MAX_STALE_AGE_SECONDS
        })
      }
    } as never);

    expect(config).toMatchObject({
      configSource: "kv",
      configVersion: "reviewed-2026-07-11",
      maintenanceMode: false
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"remote_config_refresh_due\""));
  });

  it("emits a critical alert at 35 days while retaining the reviewed config", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-16T00:00:00.000Z") });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({}, {
          version: "reviewed-2026-07-11",
          updatedAt: "2026-07-11T00:00:00.000Z",
          maxStaleAgeSeconds: REMOTE_CONFIG_MAX_STALE_AGE_SECONDS
        })
      }
    } as never);

    expect(config.configSource).toBe("kv");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"remote_config_refresh_critical\""));
  });

  it("fails closed and logs expiry after the 45-day hard stop", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-26T00:00:00.000Z") });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({}, {
          version: "expired-2026-07-11",
          updatedAt: "2026-07-11T00:00:00.000Z",
          maxStaleAgeSeconds: REMOTE_CONFIG_MAX_STALE_AGE_SECONDS
        })
      }
    } as never);

    expect(config).toMatchObject({
      configSource: "safe_fail_closed",
      maintenanceMode: true,
      chatEnabled: false
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"remote_config_expired\""));
  });

  it("preserves the human-reviewed authored timestamp when storing the D1 LKG", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-20T00:00:00.000Z") });
    const run = vi.fn().mockResolvedValue(undefined);
    const bind = vi.fn(() => ({ run }));
    const reviewedAt = "2026-07-11T00:00:00.000Z";
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({}, {
          version: "reviewed-v1",
          updatedAt: reviewedAt,
          maxStaleAgeSeconds: REMOTE_CONFIG_MAX_STALE_AGE_SECONDS
        })
      },
      DB: { prepare: () => ({ bind }) }
    } as never);

    expect(config.configUpdatedAt).toBe(reviewedAt);
    expect(bind).toHaveBeenCalledWith(
      "reviewed-v1",
      reviewedAt,
      REMOTE_CONFIG_MAX_STALE_AGE_SECONDS,
      expect.any(String),
      "2026-07-20T00:00:00.000Z"
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it("accepts a complete, typed, fresh production envelope", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope()
      }
    } as never);

    expect(config).toMatchObject({
      configSource: "kv",
      liteDailyChatLimit: 10,
      adsEnabled: true,
      rewardedCreditEnabled: true,
      rewardedSsvReady: true,
      consumablePurchasesEnabled: true,
      accountRecoveryReady: false
    });
  });

  it("honors explicit monetization disables in a complete production envelope", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({
          rewardedCreditEnabled: false,
          rewardedSsvReady: false,
          consumablePurchasesEnabled: false
        })
      }
    } as never);

    expect(config).toMatchObject({
      adsEnabled: true,
      rewardedCreditEnabled: false,
      rewardedSsvReady: false,
      consumablePurchasesEnabled: false,
      accountRecoveryReady: false
    });
  });

  it("uses a fresh D1 last-known-good config when KV is unavailable", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-11T00:30:00.000Z") });
    const row = {
      version: "ops-v7",
      updated_at: "2026-07-11T00:00:00.000Z",
      max_stale_age_seconds: 3600,
      config_json: JSON.stringify(completeConfig({
        maintenanceMode: true,
        chatEnabled: false,
        adsEnabled: false,
        rewardedCreditEnabled: false,
        rewardedSsvReady: false
      }))
    };
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: { get: async () => { throw new Error("offline"); } },
      DB: { prepare: () => ({ first: async () => row }) }
    } as never);
    expect(config).toMatchObject({ configVersion: "ops-v7", configSource: "d1_lkg", maintenanceMode: true, chatEnabled: false });
  });

  it("rejects a fresh but malformed D1 last-known-good payload", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-11T00:30:00.000Z") });
    const row = {
      version: "malformed-lkg",
      updated_at: "2026-07-11T00:00:00.000Z",
      max_stale_age_seconds: 3600,
      config_json: JSON.stringify(completeConfig({ chatEnabled: "true" }))
    };
    const config = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: { get: async () => null },
      DB: { prepare: () => ({ first: async () => row }) }
    } as never);

    expect(config.configSource).toBe("safe_fail_closed");
    expect(config.chatEnabled).toBe(false);
  });

  it("rejects stale LKG and lets emergency disables override enabled KV", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-11T02:00:00.000Z") });
    const stale = {
      version: "stale",
      updated_at: "2026-07-11T00:00:00.000Z",
      max_stale_age_seconds: 60,
      config_json: JSON.stringify({ maintenanceMode: false, chatEnabled: true })
    };
    const failed = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      KABUYOMI_CACHE: { get: async () => null },
      DB: { prepare: () => ({ first: async () => stale }) }
    } as never);
    expect(failed.configSource).toBe("safe_fail_closed");

    resetRemoteConfigMemoryCache();
    const enabled = await loadRemoteConfig({
      KABUYOMI_ENV: "production",
      EMERGENCY_DISABLE_CHAT: "true",
      EMERGENCY_DISABLE_ADS: "1",
      KABUYOMI_CACHE: {
        get: async () => completeEnvelope({}, {
          version: "enabled-v1",
          updatedAt: "2026-07-11T02:00:00.000Z"
        })
      }
    } as never);
    expect(enabled.chatEnabled).toBe(false);
    expect(enabled.adsEnabled).toBe(false);
    expect(enabled.rewardedCreditEnabled).toBe(false);
  });

  it("normalizes tracked tickers and caps the beta warm set at 30 tickers", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => ({
          trackedTickers: [
            " msft ",
            "aapl",
            "AAPL",
            "bad symbol!",
            100,
            "NVDA",
            "AMZN",
            "GOOG",
            "META",
            "AVGO",
            "TSLA",
            "BRK-B",
            "JPM",
            "WMT",
            "V",
            "XOM",
            "LLY",
            "MU",
            "ORCL",
            "CAT",
            "PLTR",
            "INTC",
            "COST",
            "NFLX",
            "MA",
            "PG",
            "JNJ",
            "HD",
            "BAC",
            "ABBV",
            "CVX",
            "AMD",
            "CSCO",
            "LRCX"
          ],
          dailyRefreshBatchSize: 999,
          dailyRefreshConcurrency: 0,
          dailyRefreshEnabled: false,
          webSupplementEnabled: true
        })
      }
    } as never);

    expect(config.trackedTickers).toHaveLength(30);
    expect(config.trackedTickers[0]).toBe("MSFT");
    expect(config.trackedTickers[1]).toBe("AAPL");
    expect(config.trackedTickers.at(-1)).toBe("CSCO");
    expect(config.dailyRefreshBatchSize).toBe(30);
    expect(config.dailyRefreshConcurrency).toBe(DEFAULT_REMOTE_CONFIG.dailyRefreshConcurrency);
    expect(config.dailyRefreshEnabled).toBe(false);
    expect(config.webSupplementEnabled).toBe(true);
  });

  it("forces a reingest-worthy extractor version when remote config is still on an older extractor version", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => ({
          // v6 archives predate typed liquidity/debt facts.
          extractorVersion: "v6"
        })
      }
    } as never);

    expect(config.extractorVersion).toBe(DEFAULT_REMOTE_CONFIG.extractorVersion);
  });

  it("reuses the last KV value within the 60 second memory TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));

    const get = vi.fn().mockResolvedValue({
      freeDailyChatLimit: 3,
      extractorVersion: DEFAULT_REMOTE_CONFIG.extractorVersion
    });
    const env = {
      KABUYOMI_CACHE: { get }
    } as never;

    const first = await loadRemoteConfig(env);
    const second = await loadRemoteConfig(env);

    expect(first.freeDailyChatLimit).toBe(25);
    expect(second.freeDailyChatLimit).toBe(25);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("reads KV again after the memory TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));

    const get = vi
      .fn()
      .mockResolvedValueOnce({
        freeDailyChatLimit: 3,
        extractorVersion: DEFAULT_REMOTE_CONFIG.extractorVersion
      })
      .mockResolvedValueOnce({
        freeDailyChatLimit: 7,
        extractorVersion: DEFAULT_REMOTE_CONFIG.extractorVersion
      });
    const env = {
      KABUYOMI_CACHE: { get }
    } as never;

    const first = await loadRemoteConfig(env);
    vi.setSystemTime(new Date("2026-04-25T00:01:01.000Z"));
    const second = await loadRemoteConfig(env);

    expect(first.freeDailyChatLimit).toBe(25);
    expect(second.freeDailyChatLimit).toBe(25);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
