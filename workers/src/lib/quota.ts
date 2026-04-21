import type { Env, UsageState } from "../env";
import { resolvePlanLimits } from "./billing-catalog";
import { loadDetachedAccessFromRequest } from "./detached-access";
import { loadActiveEntitlementFromRequest } from "./entitlements";
import { AppError } from "./errors";
import { logEvent } from "./logging";
import type { RemoteConfig } from "./remote-config";

export interface QuotaIdentity {
  quotaSubject: string;
  plan: "free" | "pro";
  identityKind: "device_key" | "ip_hash" | "local_device" | "entitlement" | "detached_device";
  accessMode?: string;
  chatLimitOverride?: number;
  stockLimitOverride?: number;
}

interface QuotaIdentityOptions {
  requireDeviceKey?: boolean;
}

interface UsageEnvelope {
  usage: UsageState;
  didMutate?: boolean;
}

export interface QuotaMutationResult {
  usage: UsageState;
  didMutate: boolean;
}

interface TickerQuotaOptions {
  relatedTickers?: readonly string[];
}
export async function readQuotaIdentity(
  request: Request,
  env: Env,
  options: QuotaIdentityOptions = {}
): Promise<QuotaIdentity> {
  const deviceKey = request.headers.get("x-device-key")?.trim();

  if (options.requireDeviceKey && !deviceKey) {
    throw new AppError(400, "Device key is required");
  }

  const detachedAccess = await loadDetachedAccessFromRequest(request, env);
  if (detachedAccess) {
    return {
      quotaSubject: detachedAccess.quotaSubject,
      plan: "pro",
      identityKind: "detached_device",
      accessMode: detachedAccess.accessMode,
      chatLimitOverride: detachedAccess.chatLimitOverride,
      stockLimitOverride: detachedAccess.stockLimitOverride
    };
  }

  const syncedEntitlement = await loadActiveEntitlementFromRequest(request, env);
  if (syncedEntitlement) {
    return {
      quotaSubject: syncedEntitlement.quotaSubject,
      plan: syncedEntitlement.plan,
      identityKind: "entitlement"
    };
  }

  if (isLocalQuotaFallbackRequest(request) && deviceKey) {
    return {
      quotaSubject: `free:local:${deviceKey}`,
      plan: "free",
      identityKind: "local_device"
    };
  }

  if (deviceKey) {
    return {
      quotaSubject: `free:device:${await sha256Hex(`free-device:${deviceKey}`)}`,
      plan: "free",
      identityKind: "device_key"
    };
  }

  const connectingIp = normalizeConnectingIp(request.headers.get("cf-connecting-ip"));
  if (connectingIp) {
    return {
      quotaSubject: `free:${await sha256Hex(`free-ip:${connectingIp}`)}`,
      plan: "free",
      identityKind: "ip_hash"
    };
  }

  throw new AppError(400, "Client identity is unavailable");
}

export async function ensureChatQuotaAvailable(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "checkChat")).usage;
}

export async function ensureStockQuotaAvailable(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: TickerQuotaOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "checkStock", ticker, options)).usage;
}

export async function consumeChatQuota(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "consumeChat")).usage;
}

export async function refundChatQuota(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "refundChat")).usage;
}

export async function consumeStockQuota(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: TickerQuotaOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "consumeStock", ticker, options)).usage;
}

export async function consumeStockQuotaWithMutation(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: TickerQuotaOptions = {}
): Promise<QuotaMutationResult> {
  return mutateUsage(identity, env, config, "consumeStock", ticker, options);
}

export async function refundStockQuota(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: TickerQuotaOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "refundStock", ticker, options)).usage;
}

export async function promoteSavedTickerAlias(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: TickerQuotaOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "promoteTicker", ticker, options)).usage;
}

export async function removeTickerFromSavedQuota(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: TickerQuotaOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "removeTicker", ticker, options)).usage;
}

export async function ensureCompanyAccessAllowed(
  identity: QuotaIdentity,
  ticker: string,
  previewTickers: readonly string[],
  env: Env,
  config: RemoteConfig,
  options: TickerQuotaOptions = {}
): Promise<void> {
  if (identity.plan === "pro") {
    return;
  }

  const limits = resolveIdentityLimits(identity, config);

  const dateJST = buildQuotaDateJST();
  const response = await env.USER_QUOTA.getByName(identity.quotaSubject).fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "checkCompanyAccess",
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      ticker,
      chatLimit: limits.chatLimit,
      stockLimit: limits.stockLimit,
      previewTickers: normalizePreviewTickers(previewTickers),
      relatedTickers: normalizePreviewTickers(options.relatedTickers ?? [])
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!response.ok || !payload.usage) {
    logEvent("quota_denial", {
      action: "checkCompanyAccess",
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      ticker: ticker.trim().toUpperCase(),
      reason: payload.error ?? "Quota request failed"
    });
    throw new AppError(response.status, payload.error ?? "Quota request failed");
  }
}

export async function loadUsage(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "state")).usage;
}

function normalizeConnectingIp(rawValue: string | null): string | null {
  const candidate = rawValue?.split(",")[0]?.trim().toLowerCase();
  return candidate ? candidate : null;
}

function isLocalQuotaFallbackRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname.endsWith(".test");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mutateUsage(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  action:
    | "state"
    | "checkChat"
    | "checkStock"
    | "consumeChat"
    | "refundChat"
    | "consumeStock"
    | "refundStock"
    | "removeTicker"
    | "promoteTicker",
  ticker?: string,
  options: TickerQuotaOptions = {}
): Promise<QuotaMutationResult> {
  const stub = env.USER_QUOTA.getByName(identity.quotaSubject);
  const dateJST = buildQuotaDateJST();
  const limits = resolveIdentityLimits(identity, config);

  const response = await stub.fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      ticker,
      relatedTickers: normalizePreviewTickers(options.relatedTickers ?? []),
      chatLimit: limits.chatLimit,
      stockLimit: limits.stockLimit
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!response.ok || !payload.usage) {
    logEvent("quota_denial", {
      action,
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      reason: payload.error ?? "Quota request failed"
    });
    throw new AppError(response.status, payload.error ?? "Quota request failed");
  }

  return {
    usage: payload.usage,
    didMutate: payload.didMutate === true
  };
}

function resolveIdentityLimits(identity: QuotaIdentity, config: RemoteConfig) {
  const planLimits = resolvePlanLimits(identity.plan, config);
  return {
    chatLimit: identity.chatLimitOverride ?? planLimits.chatLimit,
    stockLimit: identity.stockLimitOverride ?? planLimits.stockLimit
  };
}

function buildQuotaDateJST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function normalizePreviewTickers(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const ticker = value.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) {
      continue;
    }
    seen.add(ticker);
    normalized.push(ticker);
  }

  return normalized;
}
