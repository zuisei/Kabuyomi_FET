import type { Env } from "../env";
import { ensureLatestFiling } from "./pipeline";
import { logErrorEvent, logEvent, logWarnEvent } from "./logging";
import type { RemoteConfig } from "./remote-config";
import { resolveDailyRefreshConcurrency, resolveTrackedTickers } from "./tracked-tickers";

export interface DailyRefreshResult {
  attempted: string[];
  refreshed: string[];
  failed: Array<{ ticker: string; reason: string }>;
}

export async function refreshTrackedFilings(env: Env, config: RemoteConfig): Promise<DailyRefreshResult> {
  if (!config.dailyRefreshEnabled) {
    logEvent("tracked_filings_refresh_skipped", { reason: "disabled" });
    return {
      attempted: [],
      refreshed: [],
      failed: []
    };
  }

  const tickers = resolveTrackedTickers(config);
  if (tickers.length === 0) {
    logEvent("tracked_filings_refresh_skipped", { reason: "empty_targets" });
    return {
      attempted: [],
      refreshed: [],
      failed: []
    };
  }

  const refreshed: string[] = [];
  const failed: Array<{ ticker: string; reason: string }> = [];
  const concurrency = Math.min(resolveDailyRefreshConcurrency(config.dailyRefreshConcurrency), tickers.length);
  const queue = [...tickers];

  logEvent("daily_refresh_started", {
    attemptedCount: tickers.length,
    concurrency
  });

  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const ticker = queue.shift();
      if (!ticker) {
        return;
      }

      try {
        const filing = await ensureLatestFiling(ticker, env, config, { forceRemoteCheck: true });
        refreshed.push(`${ticker}:${filing.filingKey}`);
        logEvent("daily_refresh_ticker_success", {
          ticker,
          filingKey: filing.filingKey
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failed.push({ ticker, reason });
        logErrorEvent("daily_refresh_ticker_failure", {
          ticker,
          reason
        });
      }
    }
  });

  await Promise.all(workers);

  logEvent("tracked_filings_refresh_completed", {
    attemptedCount: tickers.length,
    refreshedCount: refreshed.length,
    failedCount: failed.length,
    failedTickers: failed.map((entry) => entry.ticker)
  });

  if (failed.length > 0) {
    logWarnEvent("daily_refresh_failure", {
      attemptedCount: tickers.length,
      refreshedCount: refreshed.length,
      failedCount: failed.length,
      failedTickers: failed.map((entry) => entry.ticker)
    });
  } else {
    logEvent("daily_refresh_success", {
      attemptedCount: tickers.length,
      refreshedCount: refreshed.length
    });
  }

  return {
    attempted: tickers,
    refreshed,
    failed
  };
}
