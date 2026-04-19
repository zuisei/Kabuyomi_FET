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
    expect(config.trackedTickers).toHaveLength(30);
    expect(config.webSupplementEnabled).toBe(false);
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
});
