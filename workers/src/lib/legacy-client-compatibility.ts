import type { Env } from "../env";
import { hashForLog, logEvent, logWarnEvent } from "./logging";
import type { RemoteConfig } from "./remote-config";

export const LEGACY_CLIENT_COMPATIBILITY_MAX_WINDOW_SECONDS = 30 * 24 * 60 * 60;

export type LegacyClientCoreRoute =
  | "usage"
  | "company_read"
  | "company_refresh"
  | "watchlist_add"
  | "watchlist_remove"
  | "chat"
  | "quote_translation";

const LEGACY_DEVICE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const authorizedLegacyRequests = new WeakSet<Request>();

export function authorizeLegacyClientCompatibilityRequest(
  request: Request,
  url: URL,
  env: Env,
  config: RemoteConfig,
  now = Date.now()
): boolean {
  const deviceKey = request.headers.get("x-device-key")?.trim() ?? "";
  if (!LEGACY_DEVICE_KEY_PATTERN.test(deviceKey)) return false;

  const routeClass = resolveLegacyClientCoreRoute(request.method, url.pathname);
  const state = resolveLegacyClientCompatibilityState(env, config, now);
  if (!routeClass || state !== "active") {
    logWarnEvent("legacy_client_compatibility_rejected", {
      deviceKeyHash: hashForLog(deviceKey),
      routeClass: routeClass ?? "not_allowed",
      reason: routeClass ? state : "route_not_allowed"
    });
    return false;
  }

  authorizedLegacyRequests.add(request);
  logEvent("legacy_client_compatibility_authorized", {
    deviceKeyHash: hashForLog(deviceKey),
    routeClass,
    secondsUntilExpiry: Math.max(
      0,
      Math.min(
        LEGACY_CLIENT_COMPATIBILITY_MAX_WINDOW_SECONDS,
        Math.floor((Date.parse(config.legacyClientCompatibility.expiresAt) - now) / 1_000)
      )
    )
  });
  return true;
}

export function isLegacyClientCompatibilityRequestAuthorized(request: Request): boolean {
  return authorizedLegacyRequests.has(request);
}

export function resolveLegacyClientCoreRoute(
  method: string,
  pathname: string
): LegacyClientCoreRoute | null {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" && pathname === "/v1/usage") return "usage";
  if (normalizedMethod === "POST" && pathname === "/v1/chat") return "chat";
  if (normalizedMethod === "POST" && pathname === "/v1/translate-quote") return "quote_translation";
  if (normalizedMethod === "POST" && pathname === "/v1/watchlist/add") return "watchlist_add";
  if (normalizedMethod === "POST" && pathname === "/v1/watchlist/remove") return "watchlist_remove";
  if (normalizedMethod === "POST" && /^\/v1\/company\/[^/]+\/refresh$/u.test(pathname)) {
    return "company_refresh";
  }
  if (normalizedMethod === "GET" && /^\/v1\/company\/[^/]+$/u.test(pathname)) {
    return "company_read";
  }
  return null;
}

export function resolveLegacyClientCompatibilityState(
  env: Pick<Env, "KABUYOMI_ENV" | "ENVIRONMENT">,
  config: Pick<RemoteConfig, "legacyClientCompatibility">,
  now = Date.now()
): "active" | "not_production" | "disabled" | "expired" {
  if (!isProductionEnvironment(env)) return "not_production";
  if (!config.legacyClientCompatibility.enabled) return "disabled";
  const expiresAt = Date.parse(config.legacyClientCompatibility.expiresAt);
  if (!Number.isFinite(expiresAt) || now >= expiresAt) return "expired";
  return "active";
}

function isProductionEnvironment(env: Pick<Env, "KABUYOMI_ENV" | "ENVIRONMENT">): boolean {
  const declared = [env.KABUYOMI_ENV, env.ENVIRONMENT]
    .map((value) => value?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  return declared.length > 0 && declared.every((value) => value === "production");
}
