import type { Env } from "../env";
import type { CreditPlan } from "./billing-catalog";
import { LEGACY_CLIENT_COMPATIBILITY_MAX_WINDOW_SECONDS } from "./legacy-client-compatibility";
import { logEvent, logWarnEvent } from "./logging";
import {
  DEFAULT_TRACKED_TICKERS,
  MAX_TRACKED_TICKERS,
  normalizeTrackedTickers,
  resolveDailyRefreshBatchSize,
  resolveDailyRefreshConcurrency
} from "./tracked-tickers";

export type RemoteConfigSource = "kv" | "d1_lkg" | "safe_fail_closed" | "local_test_default";

export interface RemoteConfig {
  configVersion: string;
  configUpdatedAt: string;
  configSource: RemoteConfigSource;
  maxStaleAgeSeconds: number;
  freeStockLimit: number;
  freeDailyChatLimit: number;
  liteDailyChatLimit: number;
  proStockLimit: number;
  proDailyChatLimit: number;
  adsEnabled: boolean;
  rewardedCreditEnabled: boolean;
  rewardedSsvReady: boolean;
  chatEnabled: boolean;
  webSupplementEnabled: boolean;
  creditBillingEnabled: boolean;
  consumablePurchasesEnabled: boolean;
  accountRecoveryReady: boolean;
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
  emergencyPaidGrantsDisabled: boolean;
  legacyClientCompatibility: LegacyClientCompatibilityConfig;
}

export interface LegacyClientCompatibilityConfig {
  enabled: boolean;
  expiresAt: string;
}

interface CreditBillingIdentity { accessMode?: string; }
interface RemoteConfigMemoryCache { config: RemoteConfig; expiresAt: number; strict: boolean; }
interface StoredEnvelope { version: string; updatedAt: string; maxStaleAgeSeconds: number; config: Partial<RemoteConfig>; }
interface LkgRow { version: string; updated_at: string; max_stale_age_seconds: number; config_json: string; }

// v9 carries bounded note evidence through the prepared-filing service path so
// derived reportable-segment revenue bridges survive remote extraction.
// Reusing a v8 filing archive would silently omit that primary-source evidence,
// so the schema change must invalidate the filing-cache namespace.
const CURRENT_EXTRACTOR_VERSION = "v9";
const REMOTE_CONFIG_MEMORY_TTL_MS = 60_000;
const DAY_SECONDS = 86_400;
export const REMOTE_CONFIG_REVIEW_DUE_AGE_SECONDS = 14 * DAY_SECONDS;
export const REMOTE_CONFIG_CRITICAL_AGE_SECONDS = 35 * DAY_SECONDS;
export const REMOTE_CONFIG_MAX_STALE_AGE_SECONDS = 45 * DAY_SECONDS;
const DEFAULT_MAX_STALE_AGE_SECONDS = REMOTE_CONFIG_MAX_STALE_AGE_SECONDS;
const MIN_FREE_DAILY_CHAT_LIMIT = 25;
let remoteConfigMemoryCaches = new WeakMap<KVNamespace, RemoteConfigMemoryCache>();

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  configVersion: "local-default-v2",
  configUpdatedAt: "2026-07-11T00:00:00.000Z",
  configSource: "local_test_default",
  maxStaleAgeSeconds: DEFAULT_MAX_STALE_AGE_SECONDS,
  freeStockLimit: 3,
  freeDailyChatLimit: 25,
  liteDailyChatLimit: 10,
  proStockLimit: 20,
  proDailyChatLimit: 50,
  adsEnabled: true,
  rewardedCreditEnabled: true,
  rewardedSsvReady: true,
  chatEnabled: true,
  webSupplementEnabled: false,
  creditBillingEnabled: true,
  consumablePurchasesEnabled: true,
  accountRecoveryReady: false,
  planCredits: { free: 0, lite: 400, pro: 900, pro_max: 2000 },
  freeMonthlyCreditLimit: 0,
  liteMonthlyCreditLimit: 400,
  proMonthlyCreditLimit: 900,
  proMaxMonthlyCreditLimit: 2000,
  maintenanceMode: false,
  extractorVersion: CURRENT_EXTRACTOR_VERSION,
  promptVersion: "v1",
  dailyRefreshEnabled: false,
  dailyRefreshBatchSize: DEFAULT_TRACKED_TICKERS.length,
  dailyRefreshConcurrency: 4,
  trackedTickers: [...DEFAULT_TRACKED_TICKERS],
  emergencyPaidGrantsDisabled: false,
  legacyClientCompatibility: {
    enabled: false,
    expiresAt: "1970-01-01T00:00:00.000Z"
  }
};

export const SAFE_FAIL_CLOSED_CONFIG: RemoteConfig = {
  ...DEFAULT_REMOTE_CONFIG,
  configVersion: "safe-fail-closed-v1",
  configSource: "safe_fail_closed",
  adsEnabled: false,
  rewardedCreditEnabled: false,
  rewardedSsvReady: false,
  chatEnabled: false,
  webSupplementEnabled: false,
  creditBillingEnabled: false,
  consumablePurchasesEnabled: false,
  accountRecoveryReady: false,
  maintenanceMode: true,
  emergencyPaidGrantsDisabled: true,
  trackedTickers: []
};

export async function loadRemoteConfig(env: Env): Promise<RemoteConfig> {
  const now = Date.now();
  const deployed = isDeployedEnvironment(env);
  const cached = remoteConfigMemoryCaches.get(env.KABUYOMI_CACHE);
  if (cached && cached.strict === deployed && cached.expiresAt > now) {
    return applyEmergencyOverrides(cached.config, env);
  }

  let kvFailureClass: string | null = null;
  try {
    const raw = await env.KABUYOMI_CACHE.get("remote_config", "json");
    const envelope = normalizeEnvelope(raw, now, deployed);
    if (envelope && isEnvelopeFresh(envelope, now)) {
      const config = normalizeConfig(envelope.config, {
        version: envelope.version,
        updatedAt: envelope.updatedAt,
        maxStaleAgeSeconds: envelope.maxStaleAgeSeconds,
        source: "kv"
      }, deployed);
      if (config) {
        await persistLkg(env, envelope).catch((error) => logWarnEvent("remote_config_lkg_write_failed", {
          failureClass: error instanceof Error ? error.name : typeof error
        }));
        cache(env, config, now, deployed);
        logConfigSelection(config, now);
        return applyEmergencyOverrides(config, env);
      }
      kvFailureClass = "invalid_kv_config_payload";
    } else {
      kvFailureClass = envelope ? "stale_kv_envelope" : "missing_or_invalid_kv_envelope";
      if (envelope) logRejectedEnvelopeLifecycle(envelope, "kv", now);
    }
  } catch (error) {
    kvFailureClass = error instanceof Error ? error.name : typeof error;
  }

  const lkg = await loadLkg(env).catch((error) => {
    logWarnEvent("remote_config_lkg_read_failed", { failureClass: error instanceof Error ? error.name : typeof error });
    return null;
  });
  if (lkg && isEnvelopeFresh(lkg, now)) {
    const config = normalizeConfig(lkg.config, {
      version: lkg.version,
      updatedAt: lkg.updatedAt,
      maxStaleAgeSeconds: lkg.maxStaleAgeSeconds,
      source: "d1_lkg"
    }, deployed);
    if (config) {
      cache(env, config, now, deployed);
      logConfigLifecycle(config, now);
      logWarnEvent("remote_config_kv_fallback_to_lkg", {
        configVersion: config.configVersion,
        configAgeSeconds: ageSeconds(config.configUpdatedAt, now),
        failureClass: kvFailureClass ?? "unknown"
      });
      return applyEmergencyOverrides(config, env);
    }
  } else if (lkg) {
    logRejectedEnvelopeLifecycle(lkg, "d1_lkg", now);
  }

  const fallback = !deployed
    ? { ...DEFAULT_REMOTE_CONFIG, configUpdatedAt: new Date(now).toISOString() }
    : { ...SAFE_FAIL_CLOSED_CONFIG, configUpdatedAt: new Date(now).toISOString() };
  cache(env, fallback, now, deployed);
  logWarnEvent("remote_config_fail_closed", {
    configVersion: fallback.configVersion,
    configSource: fallback.configSource,
    failureClass: kvFailureClass ?? "no_trusted_config"
  });
  return applyEmergencyOverrides(fallback, env);
}

export function resetRemoteConfigMemoryCache(): void {
  remoteConfigMemoryCaches = new WeakMap<KVNamespace, RemoteConfigMemoryCache>();
}

export function isCreditBillingEnabledForIdentity(config: Pick<RemoteConfig, "creditBillingEnabled">, identity: CreditBillingIdentity): boolean {
  return config.creditBillingEnabled || identity.accessMode === "dev_unlimited";
}

function normalizeEnvelope(raw: unknown, now: number, strict: boolean): StoredEnvelope | null {
  if (!isRecord(raw)) return null;
  const object = raw as Record<string, unknown>;
  if (isRecord(object.config)) {
    const version = typeof object.version === "string" ? object.version.trim() : "";
    const updatedAt = typeof object.updatedAt === "string" ? object.updatedAt : "";
    const maxStaleAgeSeconds = strict
      ? strictStaleAgeSeconds(object.maxStaleAgeSeconds)
      : normalizePositiveInteger(object.maxStaleAgeSeconds, DEFAULT_MAX_STALE_AGE_SECONDS);
    if (!version || !Number.isFinite(Date.parse(updatedAt)) || maxStaleAgeSeconds === null) return null;
    return { version, updatedAt, maxStaleAgeSeconds, config: object.config as Partial<RemoteConfig> };
  }

  const datedVersion = typeof object.configVersion === "string" ? object.configVersion.trim() : "";
  const datedUpdatedAt = typeof object.configUpdatedAt === "string" ? object.configUpdatedAt : "";
  const hasTrustedFlatMetadata = Boolean(datedVersion) && Number.isFinite(Date.parse(datedUpdatedAt));
  if (strict && !hasTrustedFlatMetadata) {
    // Deployed Workers must never manufacture freshness for the undated
    // legacy-flat object. Operators must migrate it to a bounded envelope.
    return null;
  }
  const maxStaleAgeSeconds = strict
    ? strictStaleAgeSeconds(object.maxStaleAgeSeconds)
    : normalizePositiveInteger(object.maxStaleAgeSeconds, DEFAULT_MAX_STALE_AGE_SECONDS);
  if (maxStaleAgeSeconds === null) return null;
  return {
    version: hasTrustedFlatMetadata ? datedVersion : "local-legacy-flat-v1",
    updatedAt: hasTrustedFlatMetadata ? datedUpdatedAt : new Date(now).toISOString(),
    maxStaleAgeSeconds,
    config: object as Partial<RemoteConfig>
  };
}

function normalizeConfig(payload: Partial<RemoteConfig>, metadata: {
  version: string; updatedAt: string; maxStaleAgeSeconds: number; source: RemoteConfigSource;
}, strict: boolean): RemoteConfig | null {
  if (strict && !isValidDeployedConfigPayload(payload, metadata.updatedAt)) return null;

  const adsEnabled = typeof payload.adsEnabled === "boolean"
    ? payload.adsEnabled
    : DEFAULT_REMOTE_CONFIG.adsEnabled;
  const creditBillingEnabled = typeof payload.creditBillingEnabled === "boolean"
    ? payload.creditBillingEnabled
    : DEFAULT_REMOTE_CONFIG.creditBillingEnabled;
  const rewardedCreditEnabled = typeof payload.rewardedCreditEnabled === "boolean"
    ? adsEnabled && payload.rewardedCreditEnabled
    : adsEnabled;
  const rewardedSsvReady = typeof payload.rewardedSsvReady === "boolean"
    ? rewardedCreditEnabled && payload.rewardedSsvReady
    : rewardedCreditEnabled;
  const consumablePurchasesEnabled = typeof payload.consumablePurchasesEnabled === "boolean"
    ? creditBillingEnabled && payload.consumablePurchasesEnabled
    : creditBillingEnabled;
  const planCredits = normalizePlanCredits(payload.planCredits, {
    free: normalizeNonNegativeInteger(payload.freeMonthlyCreditLimit, 0),
    lite: normalizeNonNegativeInteger(payload.liteMonthlyCreditLimit, DEFAULT_REMOTE_CONFIG.liteMonthlyCreditLimit),
    pro: normalizeNonNegativeInteger(payload.proMonthlyCreditLimit, DEFAULT_REMOTE_CONFIG.proMonthlyCreditLimit),
    pro_max: normalizeNonNegativeInteger(payload.proMaxMonthlyCreditLimit, DEFAULT_REMOTE_CONFIG.proMaxMonthlyCreditLimit)
  });
  planCredits.free = 0;
  return {
    ...DEFAULT_REMOTE_CONFIG,
    configVersion: metadata.version,
    configUpdatedAt: metadata.updatedAt,
    configSource: metadata.source,
    maxStaleAgeSeconds: metadata.maxStaleAgeSeconds,
    freeStockLimit: normalizeNonNegativeInteger(payload.freeStockLimit, DEFAULT_REMOTE_CONFIG.freeStockLimit),
    freeDailyChatLimit: Math.max(MIN_FREE_DAILY_CHAT_LIMIT, normalizeNonNegativeInteger(payload.freeDailyChatLimit, DEFAULT_REMOTE_CONFIG.freeDailyChatLimit)),
    liteDailyChatLimit: normalizeNonNegativeInteger(payload.liteDailyChatLimit, DEFAULT_REMOTE_CONFIG.liteDailyChatLimit),
    proStockLimit: normalizeNonNegativeInteger(payload.proStockLimit, DEFAULT_REMOTE_CONFIG.proStockLimit),
    proDailyChatLimit: normalizeNonNegativeInteger(payload.proDailyChatLimit, DEFAULT_REMOTE_CONFIG.proDailyChatLimit),
    adsEnabled,
    rewardedCreditEnabled,
    rewardedSsvReady,
    chatEnabled: normalizeBoolean(payload.chatEnabled, DEFAULT_REMOTE_CONFIG.chatEnabled),
    webSupplementEnabled: normalizeBoolean(payload.webSupplementEnabled, DEFAULT_REMOTE_CONFIG.webSupplementEnabled),
    creditBillingEnabled,
    consumablePurchasesEnabled,
    accountRecoveryReady: normalizeBoolean(payload.accountRecoveryReady, DEFAULT_REMOTE_CONFIG.accountRecoveryReady),
    planCredits,
    freeMonthlyCreditLimit: 0,
    liteMonthlyCreditLimit: planCredits.lite,
    proMonthlyCreditLimit: planCredits.pro,
    proMaxMonthlyCreditLimit: planCredits.pro_max,
    maintenanceMode: normalizeBoolean(payload.maintenanceMode, DEFAULT_REMOTE_CONFIG.maintenanceMode),
    extractorVersion: normalizeExtractorVersion(payload.extractorVersion),
    promptVersion: normalizeNonEmptyString(payload.promptVersion, DEFAULT_REMOTE_CONFIG.promptVersion),
    dailyRefreshEnabled: typeof payload.dailyRefreshEnabled === "boolean" ? payload.dailyRefreshEnabled : DEFAULT_REMOTE_CONFIG.dailyRefreshEnabled,
    dailyRefreshBatchSize: resolveDailyRefreshBatchSize(payload.dailyRefreshBatchSize, DEFAULT_REMOTE_CONFIG.dailyRefreshBatchSize),
    dailyRefreshConcurrency: resolveDailyRefreshConcurrency(payload.dailyRefreshConcurrency, DEFAULT_REMOTE_CONFIG.dailyRefreshConcurrency),
    trackedTickers: normalizeTrackedTickers(Array.isArray(payload.trackedTickers)
      ? payload.trackedTickers
      : DEFAULT_REMOTE_CONFIG.trackedTickers).slice(0, MAX_TRACKED_TICKERS),
    emergencyPaidGrantsDisabled: normalizeBoolean(
      payload.emergencyPaidGrantsDisabled,
      DEFAULT_REMOTE_CONFIG.emergencyPaidGrantsDisabled
    ),
    legacyClientCompatibility: normalizeLegacyClientCompatibility(payload.legacyClientCompatibility)
  };
}

const REQUIRED_DEPLOYED_BOOLEAN_FIELDS = [
  "adsEnabled",
  "rewardedCreditEnabled",
  "rewardedSsvReady",
  "chatEnabled",
  "webSupplementEnabled",
  "creditBillingEnabled",
  "consumablePurchasesEnabled",
  "accountRecoveryReady",
  "maintenanceMode",
  "dailyRefreshEnabled",
  "emergencyPaidGrantsDisabled"
] as const satisfies readonly (keyof RemoteConfig)[];

const REQUIRED_DEPLOYED_NON_NEGATIVE_INTEGER_FIELDS = [
  "freeStockLimit",
  "freeDailyChatLimit",
  "liteDailyChatLimit",
  "proStockLimit",
  "proDailyChatLimit"
] as const satisfies readonly (keyof RemoteConfig)[];

function isValidDeployedConfigPayload(payload: Partial<RemoteConfig>, configUpdatedAt: string): boolean {
  const object = payload as Record<string, unknown>;
  if (!REQUIRED_DEPLOYED_BOOLEAN_FIELDS.every((field) => typeof object[field] === "boolean")) return false;
  if (!REQUIRED_DEPLOYED_NON_NEGATIVE_INTEGER_FIELDS.every((field) => isNonNegativeInteger(object[field]))) return false;
  if ((object.freeDailyChatLimit as number) < MIN_FREE_DAILY_CHAT_LIMIT) return false;
  if (!isPositiveInteger(object.dailyRefreshBatchSize) || (object.dailyRefreshBatchSize as number) > MAX_TRACKED_TICKERS) return false;
  if (!isPositiveInteger(object.dailyRefreshConcurrency) || (object.dailyRefreshConcurrency as number) > 8) return false;
  if (!isNonEmptyString(object.extractorVersion) || !isNonEmptyString(object.promptVersion)) return false;
  if (!isValidPlanCredits(object.planCredits)) return false;
  if (!Array.isArray(object.trackedTickers) || object.trackedTickers.length > MAX_TRACKED_TICKERS) return false;
  if (normalizeTrackedTickers(object.trackedTickers).length !== object.trackedTickers.length) return false;
  if (object.rewardedCreditEnabled === true && object.adsEnabled !== true) return false;
  if (object.rewardedSsvReady === true && object.rewardedCreditEnabled !== true) return false;
  if (object.consumablePurchasesEnabled === true && object.creditBillingEnabled !== true) return false;
  if (!isValidLegacyClientCompatibility(object.legacyClientCompatibility, configUpdatedAt)) return false;
  return true;
}

function isValidLegacyClientCompatibility(value: unknown, configUpdatedAt: string): boolean {
  if (!isRecord(value) || typeof value.enabled !== "boolean" || !isCanonicalIsoTimestamp(value.expiresAt)) {
    return false;
  }
  if (!value.enabled) return true;
  const updatedAtMs = Date.parse(configUpdatedAt);
  const expiresAtMs = Date.parse(value.expiresAt as string);
  const maximumWindowMs = LEGACY_CLIENT_COMPATIBILITY_MAX_WINDOW_SECONDS * 1_000;
  return Number.isFinite(updatedAtMs)
    && expiresAtMs > updatedAtMs
    && expiresAtMs - updatedAtMs <= maximumWindowMs;
}

function isValidPlanCredits(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.free === 0 && [value.lite, value.pro, value.pro_max].every(isNonNegativeInteger);
}

function applyEmergencyOverrides(config: RemoteConfig, env: Env): RemoteConfig {
  const disableChat = truthy(env.EMERGENCY_DISABLE_CHAT);
  const disableAds = truthy(env.EMERGENCY_DISABLE_ADS);
  const disableRewards = truthy(env.EMERGENCY_DISABLE_REWARDS);
  const disableWeb = truthy(env.EMERGENCY_DISABLE_WEB);
  const disablePaid = truthy(env.EMERGENCY_DISABLE_PAID_GRANTS);
  if (!(disableChat || disableAds || disableRewards || disableWeb || disablePaid)) return config;
  return {
    ...config,
    chatEnabled: disableChat ? false : config.chatEnabled,
    adsEnabled: disableAds ? false : config.adsEnabled,
    rewardedCreditEnabled: disableAds || disableRewards ? false : config.rewardedCreditEnabled,
    rewardedSsvReady: disableAds || disableRewards ? false : config.rewardedSsvReady,
    webSupplementEnabled: disableWeb ? false : config.webSupplementEnabled,
    creditBillingEnabled: disablePaid ? false : config.creditBillingEnabled,
    consumablePurchasesEnabled: disablePaid ? false : config.consumablePurchasesEnabled,
    emergencyPaidGrantsDisabled: disablePaid || config.emergencyPaidGrantsDisabled
  };
}

async function persistLkg(env: Env, envelope: StoredEnvelope): Promise<void> {
  if (!env.DB?.prepare) return;
  await env.DB.prepare(
    `INSERT INTO remote_config_lkg (singleton_key, version, updated_at, max_stale_age_seconds, config_json, stored_at)
     VALUES ('active', ?, ?, ?, ?, ?)
     ON CONFLICT(singleton_key) DO UPDATE SET
       version = excluded.version, updated_at = excluded.updated_at,
       max_stale_age_seconds = excluded.max_stale_age_seconds,
       config_json = excluded.config_json, stored_at = excluded.stored_at`
  ).bind(envelope.version, envelope.updatedAt, envelope.maxStaleAgeSeconds, JSON.stringify(envelope.config), new Date().toISOString()).run();
}

async function loadLkg(env: Env): Promise<StoredEnvelope | null> {
  if (!env.DB?.prepare) return null;
  const row = await env.DB.prepare(
    "SELECT version, updated_at, max_stale_age_seconds, config_json FROM remote_config_lkg WHERE singleton_key = 'active'"
  ).first<LkgRow>();
  if (
    !row ||
    !isNonEmptyString(row.version) ||
    typeof row.updated_at !== "string" ||
    !Number.isFinite(Date.parse(row.updated_at)) ||
    !isValidStaleAgeSeconds(row.max_stale_age_seconds)
  ) return null;
  try {
    const config = JSON.parse(row.config_json) as unknown;
    if (!isRecord(config)) return null;
    return {
      version: row.version.trim(),
      updatedAt: row.updated_at,
      maxStaleAgeSeconds: row.max_stale_age_seconds,
      config: config as Partial<RemoteConfig>
    };
  } catch { return null; }
}

function isEnvelopeFresh(envelope: StoredEnvelope, now: number): boolean {
  const age = now - Date.parse(envelope.updatedAt);
  return Number.isFinite(age) && age >= -5 * 60_000 && age <= envelope.maxStaleAgeSeconds * 1_000;
}

function logConfigSelection(config: RemoteConfig, now: number): void {
  const lifecycle = remoteConfigLifecycle(config.configUpdatedAt, config.maxStaleAgeSeconds, now);
  logEvent("remote_config_selected", {
    configVersion: config.configVersion,
    configSource: config.configSource,
    configAgeSeconds: lifecycle.ageSeconds,
    secondsUntilExpiry: lifecycle.secondsUntilExpiry,
    lifecycleStatus: lifecycle.status
  });
  logConfigLifecycle(config, now);
}

function logConfigLifecycle(config: Pick<RemoteConfig, "configVersion" | "configUpdatedAt" | "configSource" | "maxStaleAgeSeconds">, now: number): void {
  const lifecycle = remoteConfigLifecycle(config.configUpdatedAt, config.maxStaleAgeSeconds, now);
  if (lifecycle.status !== "review_due" && lifecycle.status !== "critical") return;
  logWarnEvent(lifecycle.status === "critical" ? "remote_config_refresh_critical" : "remote_config_refresh_due", {
    configVersion: config.configVersion,
    configSource: config.configSource,
    configAgeSeconds: lifecycle.ageSeconds,
    maxStaleAgeSeconds: config.maxStaleAgeSeconds,
    reviewDueAgeSeconds: lifecycle.reviewDueAgeSeconds,
    criticalAgeSeconds: lifecycle.criticalAgeSeconds,
    secondsUntilExpiry: lifecycle.secondsUntilExpiry
  });
}

function logRejectedEnvelopeLifecycle(envelope: StoredEnvelope, source: "kv" | "d1_lkg", now: number): void {
  const lifecycle = remoteConfigLifecycle(envelope.updatedAt, envelope.maxStaleAgeSeconds, now);
  const event = lifecycle.status === "future_invalid"
    ? "remote_config_timestamp_invalid"
    : "remote_config_expired";
  logWarnEvent(event, {
    configVersion: envelope.version,
    configSource: source,
    configAgeSeconds: lifecycle.ageSeconds,
    maxStaleAgeSeconds: envelope.maxStaleAgeSeconds,
    secondsUntilExpiry: lifecycle.secondsUntilExpiry
  });
}

function remoteConfigLifecycle(updatedAt: string, maxStaleAgeSeconds: number, now: number): {
  status: "fresh" | "review_due" | "critical" | "expired" | "future_invalid";
  ageSeconds: number;
  secondsUntilExpiry: number;
  reviewDueAgeSeconds: number;
  criticalAgeSeconds: number;
} {
  const rawAgeSeconds = Math.floor((now - Date.parse(updatedAt)) / 1_000);
  const ageSeconds = Math.max(0, rawAgeSeconds);
  const reviewDueAgeSeconds = Math.min(
    REMOTE_CONFIG_REVIEW_DUE_AGE_SECONDS,
    Math.max(1, Math.floor(maxStaleAgeSeconds / 2))
  );
  const criticalLeadSeconds = Math.min(7 * DAY_SECONDS, Math.max(1, Math.floor(maxStaleAgeSeconds / 5)));
  const criticalAgeSeconds = Math.min(
    REMOTE_CONFIG_CRITICAL_AGE_SECONDS,
    Math.max(reviewDueAgeSeconds, maxStaleAgeSeconds - criticalLeadSeconds)
  );
  const secondsUntilExpiry = maxStaleAgeSeconds - ageSeconds;
  const status = rawAgeSeconds < -5 * 60
    ? "future_invalid"
    : ageSeconds > maxStaleAgeSeconds
      ? "expired"
      : ageSeconds >= criticalAgeSeconds
        ? "critical"
        : ageSeconds >= reviewDueAgeSeconds
          ? "review_due"
          : "fresh";
  return { status, ageSeconds, secondsUntilExpiry, reviewDueAgeSeconds, criticalAgeSeconds };
}

function cache(env: Env, config: RemoteConfig, now: number, strict: boolean): void {
  remoteConfigMemoryCaches.set(env.KABUYOMI_CACHE, {
    config,
    expiresAt: now + REMOTE_CONFIG_MEMORY_TTL_MS,
    strict
  });
}

function ageSeconds(value: string, now: number): number { return Math.max(0, Math.floor((now - Date.parse(value)) / 1_000)); }
function isDeployedEnvironment(env: Env): boolean {
  return [env.KABUYOMI_ENV, env.ENVIRONMENT].some((value) => Boolean(value?.trim()));
}
function truthy(value: string | undefined): boolean { return /^(1|true|yes|on)$/iu.test(value?.trim() ?? ""); }
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function isValidStaleAgeSeconds(value: unknown): value is number {
  return isPositiveInteger(value) && value <= REMOTE_CONFIG_MAX_STALE_AGE_SECONDS;
}
function strictStaleAgeSeconds(value: unknown): number | null {
  return isValidStaleAgeSeconds(value) ? value : null;
}
function normalizePositiveInteger(value: unknown, fallback: number): number {
  return isPositiveInteger(value) ? value : fallback;
}
function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  return isNonNegativeInteger(value) ? value : fallback;
}
function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
function normalizeNonEmptyString(value: unknown, fallback: string): string {
  return isNonEmptyString(value) ? value.trim() : fallback;
}
function normalizePlanCredits(value: unknown, fallback: Record<CreditPlan, number>): Record<CreditPlan, number> {
  const raw = value && typeof value === "object" ? value as Partial<Record<CreditPlan, unknown>> : {};
  return {
    free: 0,
    lite: normalizeNonNegativeInteger(raw.lite, fallback.lite),
    pro: normalizeNonNegativeInteger(raw.pro, fallback.pro),
    pro_max: normalizeNonNegativeInteger(raw.pro_max, fallback.pro_max)
  };
}

function normalizeLegacyClientCompatibility(value: unknown): LegacyClientCompatibilityConfig {
  if (!isRecord(value)) return { ...DEFAULT_REMOTE_CONFIG.legacyClientCompatibility };
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : false,
    expiresAt: isCanonicalIsoTimestamp(value.expiresAt)
      ? value.expiresAt
      : DEFAULT_REMOTE_CONFIG.legacyClientCompatibility.expiresAt
  };
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function normalizeExtractorVersion(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return CURRENT_EXTRACTOR_VERSION;
  const current = Number(CURRENT_EXTRACTOR_VERSION.slice(1));
  const requested = /^v(\d+)$/iu.exec(trimmed);
  return requested && Number(requested[1]) < current ? CURRENT_EXTRACTOR_VERSION : trimmed;
}
