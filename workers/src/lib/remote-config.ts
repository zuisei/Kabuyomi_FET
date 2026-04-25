import type { Env } from "../env";
import {
  DEFAULT_TRACKED_TICKERS,
  MAX_TRACKED_TICKERS,
  normalizeTrackedTickers,
  resolveDailyRefreshBatchSize,
  resolveDailyRefreshConcurrency
} from "./tracked-tickers";

export interface RemoteConfig {
  freeStockLimit: number;
  freeDailyChatLimit: number;
  proStockLimit: number;
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

const CURRENT_EXTRACTOR_VERSION = "v6";
const REMOTE_CONFIG_MEMORY_TTL_MS = 60 * 1000;

interface RemoteConfigMemoryCache {
  config: RemoteConfig;
  expiresAt: number;
}

let remoteConfigMemoryCaches = new WeakMap<KVNamespace, RemoteConfigMemoryCache>();

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  freeStockLimit: 3,
  freeDailyChatLimit: 10,
  proStockLimit: 20,
  proDailyChatLimit: 50,
  adsEnabled: true,
  chatEnabled: true,
  webSupplementEnabled: false,
  maintenanceMode: false,
  extractorVersion: CURRENT_EXTRACTOR_VERSION,
  promptVersion: "v1",
  dailyRefreshEnabled: false,
  dailyRefreshBatchSize: DEFAULT_TRACKED_TICKERS.length,
  dailyRefreshConcurrency: 4,
  trackedTickers: [...DEFAULT_TRACKED_TICKERS]
};

export async function loadRemoteConfig(env: Env): Promise<RemoteConfig> {
  const now = Date.now();
  const cached = remoteConfigMemoryCaches.get(env.KABUYOMI_CACHE);
  if (cached && cached.expiresAt > now) {
    return cached.config;
  }

  let raw: unknown;
  try {
    raw = await env.KABUYOMI_CACHE.get("remote_config", "json");
  } catch {
    const fallback = DEFAULT_REMOTE_CONFIG;
    remoteConfigMemoryCaches.set(env.KABUYOMI_CACHE, {
      config: fallback,
      expiresAt: now + REMOTE_CONFIG_MEMORY_TTL_MS
    });
    return fallback;
  }

  if (!raw || typeof raw !== "object") {
    remoteConfigMemoryCaches.set(env.KABUYOMI_CACHE, {
      config: DEFAULT_REMOTE_CONFIG,
      expiresAt: now + REMOTE_CONFIG_MEMORY_TTL_MS
    });
    return DEFAULT_REMOTE_CONFIG;
  }

  const payload = raw as Partial<RemoteConfig> & {
    trackedTickers?: unknown;
    dailyRefreshBatchSize?: unknown;
    dailyRefreshConcurrency?: unknown;
  };

  const config = {
    ...DEFAULT_REMOTE_CONFIG,
    ...payload,
    extractorVersion: normalizeExtractorVersion(payload.extractorVersion),
    trackedTickers: normalizeTrackedTickers(Array.isArray(payload.trackedTickers) ? payload.trackedTickers : []).slice(
      0,
      MAX_TRACKED_TICKERS
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
  remoteConfigMemoryCaches.set(env.KABUYOMI_CACHE, {
    config,
    expiresAt: now + REMOTE_CONFIG_MEMORY_TTL_MS
  });
  return config;
}

export function resetRemoteConfigMemoryCache(): void {
  remoteConfigMemoryCaches = new WeakMap<KVNamespace, RemoteConfigMemoryCache>();
}

function normalizeExtractorVersion(rawValue: unknown): string {
  const trimmed = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!trimmed) {
    return CURRENT_EXTRACTOR_VERSION;
  }

  const currentMatch = CURRENT_EXTRACTOR_VERSION.match(/^v(\d+)$/i);
  const trimmedMatch = trimmed.match(/^v(\d+)$/i);
  if (!currentMatch?.[1] || !trimmedMatch?.[1]) {
    return trimmed;
  }

  const currentVersion = Number.parseInt(currentMatch[1], 10);
  const requestedVersion = Number.parseInt(trimmedMatch[1], 10);
  if (!Number.isFinite(currentVersion) || !Number.isFinite(requestedVersion)) {
    return trimmed;
  }

  return requestedVersion < currentVersion ? CURRENT_EXTRACTOR_VERSION : trimmed;
}
