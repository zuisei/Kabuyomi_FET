import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REMOTE_CONFIG, loadRemoteConfig, resetRemoteConfigMemoryCache } from "../src/lib/remote-config";

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
    expect(config.creditBillingEnabled).toBe(false);
    expect(config.freeMonthlyCreditLimit).toBe(30);
    expect(config.proMonthlyCreditLimit).toBe(500);
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

    expect(first.freeDailyChatLimit).toBe(3);
    expect(second.freeDailyChatLimit).toBe(3);
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

    expect(first.freeDailyChatLimit).toBe(3);
    expect(second.freeDailyChatLimit).toBe(7);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
