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
  });

  it("normalizes tracked tickers and refresh settings from KV", async () => {
    const config = await loadRemoteConfig({
      KABUYOMI_CACHE: {
        get: async () => ({
          trackedTickers: [" msft ", "aapl", "AAPL", "bad symbol!", 100],
          dailyRefreshBatchSize: 999,
          dailyRefreshConcurrency: 0,
          dailyRefreshEnabled: false
        })
      }
    } as never);

    expect(config.trackedTickers).toEqual(["MSFT", "AAPL"]);
    expect(config.dailyRefreshBatchSize).toBe(200);
    expect(config.dailyRefreshConcurrency).toBe(DEFAULT_REMOTE_CONFIG.dailyRefreshConcurrency);
    expect(config.dailyRefreshEnabled).toBe(false);
  });
});
