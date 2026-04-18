import { describe, expect, it } from "vitest";
import { DEFAULT_REMOTE_CONFIG, loadRemoteConfig } from "../src/lib/remote-config";

describe("remote config", () => {
  it("falls back to default tracked tickers when none are configured", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => null
      }
    } as never);

    expect(config.trackedTickers).toEqual(DEFAULT_REMOTE_CONFIG.trackedTickers);
    expect(config.dailyRefreshBatchSize).toBe(DEFAULT_REMOTE_CONFIG.dailyRefreshBatchSize);
    expect(config.trackedTickers).toHaveLength(25);
    expect(config.webSupplementEnabled).toBe(false);
  });

  it("normalizes tracked tickers and caps the beta warm set at 25 tickers", async () => {
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
            "GOOGL",
            "META",
            "AVGO",
            "TSLA",
            "JPM",
            "WMT",
            "V",
            "XOM",
            "COST",
            "NFLX",
            "MA",
            "PG",
            "JNJ",
            "ORCL",
            "HD",
            "BAC",
            "KO",
            "ABBV",
            "CRM",
            "CVX",
            "AMD"
          ],
          dailyRefreshBatchSize: 999,
          dailyRefreshConcurrency: 0,
          dailyRefreshEnabled: false,
          webSupplementEnabled: true
        })
      }
    } as never);

    expect(config.trackedTickers).toHaveLength(25);
    expect(config.trackedTickers[0]).toBe("MSFT");
    expect(config.trackedTickers[1]).toBe("AAPL");
    expect(config.trackedTickers.at(-1)).toBe("AMD");
    expect(config.dailyRefreshBatchSize).toBe(25);
    expect(config.dailyRefreshConcurrency).toBe(DEFAULT_REMOTE_CONFIG.dailyRefreshConcurrency);
    expect(config.dailyRefreshEnabled).toBe(false);
    expect(config.webSupplementEnabled).toBe(true);
  });
});
