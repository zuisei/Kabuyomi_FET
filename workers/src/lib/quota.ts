import type { Env, UsageState } from "../env";
import { AppError } from "./errors";
import { logEvent } from "./logging";
import type { RemoteConfig } from "./remote-config";

export interface QuotaIdentity {
  quotaSubject: string;
  plan: "free" | "pro";
}

interface UsageEnvelope {
  usage: UsageState;
}

export async function readQuotaIdentity(
  request: Request,
  options: { requireDeviceKey?: boolean } = {}
): Promise<QuotaIdentity> {
  const deviceKey = request.headers.get("x-device-key")?.trim();
  if (options.requireDeviceKey && !deviceKey) {
    throw new AppError(400, "Device key is required");
  }

  const connectingIp = normalizeConnectingIp(request.headers.get("cf-connecting-ip"));
  if (connectingIp) {
    return {
      quotaSubject: `free:${await sha256Hex(`free-ip:${connectingIp}`)}`,
      plan: "free"
    };
  }

  if (isLocalQuotaFallbackRequest(request) && deviceKey) {
    return {
      quotaSubject: `free:local:${deviceKey}`,
      plan: "free"
    };
  }

  throw new AppError(400, "Client identity is unavailable");
}

export async function ensureChatQuotaAvailable(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return mutateUsage(identity, env, config, "checkChat");
}

export async function ensureStockQuotaAvailable(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return mutateUsage(identity, env, config, "checkStock", ticker);
}

export async function consumeChatQuota(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return mutateUsage(identity, env, config, "consumeChat");
}

export async function consumeStockQuota(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return mutateUsage(identity, env, config, "consumeStock", ticker);
}

export async function loadUsage(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return mutateUsage(identity, env, config, "state");
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
  action: "state" | "checkChat" | "checkStock" | "consumeChat" | "consumeStock",
  ticker?: string
): Promise<UsageState> {
  const stub = env.USER_QUOTA.getByName(identity.quotaSubject);
  const dateJST = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  const response = await stub.fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      dateJST,
      ticker,
      chatLimit: identity.plan === "pro" ? config.proDailyChatLimit : config.freeDailyChatLimit,
      stockLimit: identity.plan === "pro" ? Number.MAX_SAFE_INTEGER : config.freeStockLimit
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

  return payload.usage;
}
