import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REMOTE_CONFIG,
  isCreditBillingEnabledForIdentity,
  loadRemoteConfig,
  resetRemoteConfigMemoryCache
} from "../src/lib/remote-config";

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
      free: 50,
      lite: 400,
      pro: 900,
      pro_max: 2000
    });
    expect(config.freeMonthlyCreditLimit).toBe(50);
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

    expect(config).toEqual(DEFAULT_REMOTE_CONFIG);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"remote_config_kv_read_failed\""));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("\"fallback\":\"default_config\""));
  });

  it("normalizes plan credit limits from the compact planCredits map and keeps Free at least 50", async () => {
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
      free: 50,
      lite: 175,
      pro: 600,
      pro_max: 1500
    });
    expect(config.freeMonthlyCreditLimit).toBe(50);
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

  it("keeps legacy monthly credit config fields as fallbacks and keeps Free at least 50", async () => {
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
      free: 50,
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
          extractorVersion: "v3"
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
