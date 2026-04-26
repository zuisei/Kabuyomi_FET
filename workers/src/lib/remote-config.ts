import type { Env } from "../env";
import type { CreditPlan } from "./billing-catalog";
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
  creditBillingEnabled: boolean;
  planCredits: Record<CreditPlan, number>;
  freeMonthlyCreditLimit: number;
  liteMonthlyCreditLimit: number;
  proMonthlyCreditLimit: number;
  proMaxMonthlyCreditLimit: number;
  maintenanceMode: boolean;
  extractorVersion: string;
  promptVersion: string;
  dailyRefreshEnabled: boolean;
  dailyRefreshBatchSize: number;
  dailyRefreshConcurrency: number;
  trackedTickers: string[];
}

interface CreditBillingIdentity {
  accessMode?: string;
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
  creditBillingEnabled: false,
  planCredits: {
    free: 30,
    lite: 150,
    pro: 500,
    pro_max: 1200
  },
  freeMonthlyCreditLimit: 30,
  liteMonthlyCreditLimit: 150,
  proMonthlyCreditLimit: 500,
  proMaxMonthlyCreditLimit: 1200,
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
    planCredits?: unknown;
  };
  const planCredits = normalizePlanCredits(payload.planCredits, {
    free: normalizeNonNegativeInteger(payload.freeMonthlyCreditLimit, DEFAULT_REMOTE_CONFIG.freeMonthlyCreditLimit),
    lite: normalizeNonNegativeInteger(payload.liteMonthlyCreditLimit, DEFAULT_REMOTE_CONFIG.liteMonthlyCreditLimit),
    pro: normalizeNonNegativeInteger(payload.proMonthlyCreditLimit, DEFAULT_REMOTE_CONFIG.proMonthlyCreditLimit),
    pro_max: normalizeNonNegativeInteger(
      payload.proMaxMonthlyCreditLimit,
      DEFAULT_REMOTE_CONFIG.proMaxMonthlyCreditLimit
    )
  });

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
    creditBillingEnabled:
      typeof payload.creditBillingEnabled === "boolean"
        ? payload.creditBillingEnabled
        : DEFAULT_REMOTE_CONFIG.creditBillingEnabled,
    planCredits,
    freeMonthlyCreditLimit: planCredits.free,
    liteMonthlyCreditLimit: planCredits.lite,
    proMonthlyCreditLimit: planCredits.pro,
    proMaxMonthlyCreditLimit: planCredits.pro_max,
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

export function isCreditBillingEnabledForIdentity(
  config: Pick<RemoteConfig, "creditBillingEnabled">,
  identity: CreditBillingIdentity
): boolean {
  return config.creditBillingEnabled || identity.accessMode === "dev_unlimited";
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

function normalizeNonNegativeInteger(rawValue: unknown, fallback: number): number {
  return typeof rawValue === "number" && Number.isInteger(rawValue) && rawValue >= 0 ? rawValue : fallback;
}

function normalizePlanCredits(
  rawValue: unknown,
  fallback: Record<CreditPlan, number>
): Record<CreditPlan, number> {
  const rawPlanCredits = rawValue && typeof rawValue === "object" ? (rawValue as Partial<Record<CreditPlan, unknown>>) : {};
  return {
    free: normalizeNonNegativeInteger(rawPlanCredits.free, fallback.free),
    lite: normalizeNonNegativeInteger(rawPlanCredits.lite, fallback.lite),
    pro: normalizeNonNegativeInteger(rawPlanCredits.pro, fallback.pro),
    pro_max: normalizeNonNegativeInteger(rawPlanCredits.pro_max, fallback.pro_max)
  };
}
