import type { Env } from "../env";
import {
  DEFAULT_TRACKED_TICKERS,
  normalizeTrackedTickers,
  resolveDailyRefreshBatchSize,
  resolveDailyRefreshConcurrency
} from "./tracked-tickers";

export interface RemoteConfig {
  freeStockLimit: number;
  freeDailyChatLimit: number;
  proDailyChatLimit: number;
  adsEnabled: boolean;
  chatEnabled: boolean;
  webSupplementEnabled: boolean;
  maintenanceMode: boolean;
  extractorVersion: string;
  promptVersion: string;
  dailyRefreshEnabled: boolean;
  dailyRefreshBatchSize: number;
  dailyRefreshConcurrency: number;
  trackedTickers: string[];
}

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  freeStockLimit: 3,
  freeDailyChatLimit: 3,
  proDailyChatLimit: 50,
  adsEnabled: true,
  chatEnabled: true,
  webSupplementEnabled: true,
  maintenanceMode: false,
  extractorVersion: "v1",
  promptVersion: "v1",
  dailyRefreshEnabled: true,
  dailyRefreshBatchSize: DEFAULT_TRACKED_TICKERS.length,
  dailyRefreshConcurrency: 4,
  trackedTickers: [...DEFAULT_TRACKED_TICKERS]
};

export async function loadRemoteConfig(env: Env): Promise<RemoteConfig> {
  const raw = await env.KABUYOMI_CACHE.get("remote_config", "json");
  if (!raw || typeof raw !== "object") {
    return DEFAULT_REMOTE_CONFIG;
  }

  const payload = raw as Partial<RemoteConfig> & {
    trackedTickers?: unknown;
    dailyRefreshBatchSize?: unknown;
    dailyRefreshConcurrency?: unknown;
  };

  return {
    ...DEFAULT_REMOTE_CONFIG,
    ...payload,
    trackedTickers: normalizeTrackedTickers(Array.isArray(payload.trackedTickers) ? payload.trackedTickers : []).slice(
      0,
      DEFAULT_TRACKED_TICKERS.length
    ),
    dailyRefreshEnabled:
      typeof payload.dailyRefreshEnabled === "boolean"
        ? payload.dailyRefreshEnabled
        : DEFAULT_REMOTE_CONFIG.dailyRefreshEnabled,
    dailyRefreshBatchSize: resolveDailyRefreshBatchSize(
      payload.dailyRefreshBatchSize,
      DEFAULT_REMOTE_CONFIG.dailyRefreshBatchSize
    ),
    dailyRefreshConcurrency: resolveDailyRefreshConcurrency(
      payload.dailyRefreshConcurrency,
      DEFAULT_REMOTE_CONFIG.dailyRefreshConcurrency
    )
  };
}
