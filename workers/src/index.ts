import type { Env } from "./env";
import { refreshTickerSnapshot } from "./clients/sec";
import { EntitlementDO } from "./durable/entitlement";
import { FilingLockDO } from "./durable/filing-lock";
import { SecRateLimiterDO } from "./durable/sec-rate-limiter";
import { UserQuotaDO } from "./durable/user-quota";
import { refreshTrackedFilings } from "./lib/daily-refresh";
import { AppError, isAppError } from "./lib/errors";
import { logErrorEvent, logEvent } from "./lib/logging";
import { loadRemoteConfig } from "./lib/remote-config";
import { json, notFound, serverError, unavailable } from "./lib/response";
import { handleAdMobRewardRoutes } from "./routes/admob-rewards";
import { handleAccountRecoveryRoutes } from "./routes/account-recovery";
import { handleAppleNotificationsV2Route } from "./routes/apple-notifications-v2";
import { handleBillingSyncRoute } from "./routes/billing-sync";
import { handleChatRoute } from "./routes/chat";
import { handleCompanyRoute } from "./routes/company";
import { handleCreditPurchaseGrantRoute } from "./routes/credit-purchase-grant";
import { handleFilingPrepJobRoute } from "./routes/filing-prep-job";
import { handleInternalBackfillHistoryRoute } from "./routes/internal-backfill-history";
import { handleInternalCreditAuditRepairRoute } from "./routes/internal-credit-audit-repair";
import { handleInternalCleanupFilingsRoute } from "./routes/internal-cleanup-filings";
import { handleInternalCreditPurchaseGrantRoute } from "./routes/internal-credit-purchase-grant";
import { handleInternalEvalCreditGrantRoute } from "./routes/internal-eval-credit-grant";
import { handleInternalSecFetcherRoute } from "./routes/internal-sec-fetcher";
import { handleInternalSubscriptionPrincipalMigrationRoute } from "./routes/internal-subscription-principal-migration";
import { handleInstallationIdentityRoutes } from "./routes/installation-identity";
import { resolveInstallationCredential, verifyAppAttestAssertionForRequest } from "./lib/installation-identity";
import { loadTestAutomationAccessFromRequest } from "./lib/test-automation-access";
import { authorizeLegacyClientCompatibilityRequest } from "./lib/legacy-client-compatibility";
import { handleLegalRoute } from "./routes/legal";
import { handleSearchRoute } from "./routes/search";
import { handleTranslateQuoteRoute } from "./routes/translate-quote";
import type { RouteHandler } from "./routes/types";
import { handleUsageRoute } from "./routes/usage";
import { handleWatchlistAddRoute } from "./routes/watchlist-add";
import { handleWatchlistRemoveRoute } from "./routes/watchlist-remove";

export { EntitlementDO, FilingLockDO, SecRateLimiterDO, UserQuotaDO };

const preMaintenanceRoutes: RouteHandler[] = [
  handleLegalRoute,
  handleInstallationIdentityRoutes,
  handleAccountRecoveryRoutes,
  handleAppleNotificationsV2Route,
  handleInternalBackfillHistoryRoute,
  handleInternalCleanupFilingsRoute,
  handleInternalCreditAuditRepairRoute,
  handleInternalCreditPurchaseGrantRoute,
  handleInternalEvalCreditGrantRoute,
  handleInternalSecFetcherRoute,
  handleInternalSubscriptionPrincipalMigrationRoute
];
const apiRoutes: RouteHandler[] = [
  handleSearchRoute,
  handleFilingPrepJobRoute,
  handleWatchlistAddRoute,
  handleWatchlistRemoveRoute,
  handleCompanyRoute,
  handleChatRoute,
  handleCreditPurchaseGrantRoute,
  handleTranslateQuoteRoute,
  handleUsageRoute,
  handleAdMobRewardRoutes,
  handleBillingSyncRoute
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const emergencyResponse = emergencyRouteResponse(request, url, env);
      if (emergencyResponse) return emergencyResponse;
      const config = await loadRemoteConfig(env);

      for (const route of preMaintenanceRoutes) {
        const response = await route({ request, url, env, config, ctx });
        if (response) {
          return response;
        }
      }

      if (config.maintenanceMode) {
        return unavailable("Kabuyomi is under maintenance");
      }

      await enforceInstallationIdentity(request, url, env, config);

      for (const route of apiRoutes) {
        const response = await route({ request, url, env, config, ctx });
        if (response) {
          return response;
        }
      }

      return notFound();
    } catch (error) {
      if (isAppError(error)) {
        logErrorEvent("request_rejected", {
          status: error.status,
          errorClass: error.name,
          hasInternalDetail: Boolean(error.internalMessage)
        });
        return json({ error: error.publicMessage }, { status: error.status });
      }

      logErrorEvent("request_failed", {
        errorClass: error instanceof Error ? error.name : typeof error
      });
      return serverError();
    }
  },

  async scheduled(_: ScheduledController, env: Env): Promise<void> {
    if (truthy(env.EMERGENCY_DISABLE_BACKGROUND_JOBS)) {
      logEvent("scheduled_refresh_skipped", { reason: "emergency_background_jobs_disabled" });
      return;
    }
    if (truthy(env.EMERGENCY_DISABLE_SEC_REFRESH)) {
      logEvent("scheduled_refresh_skipped", { reason: "emergency_sec_refresh_disabled" });
      return;
    }
    const config = await loadRemoteConfig(env);
    if (config.maintenanceMode || !config.dailyRefreshEnabled) {
      logEvent("scheduled_refresh_skipped", {
        reason: config.maintenanceMode ? "maintenance_mode" : "daily_refresh_disabled",
        configVersion: config.configVersion,
        configSource: config.configSource
      });
      return;
    }
    try {
      await refreshTickerSnapshot(env);
      logEvent("search_snapshot_refresh_success");
    } catch (error) {
      logErrorEvent("search_snapshot_refresh_failure", {
        reason: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    await refreshTrackedFilings(env, config);
  }
};

const INSTALLATION_PUBLIC_PATHS = new Set(["/v1/search"]);
const APP_ATTEST_CORE_ASSERTION_PATHS = new Set([
  "/v1/chat",
  "/v1/translate-quote",
  "/v1/watchlist/add",
  "/v1/watchlist/remove"
]);
const APP_ATTEST_STRICT_ASSERTION_PATHS = new Set(["/v1/admob/reward-intents"]);

const BACKGROUND_JOB_PATHS = new Set([
  "/v1/internal/backfill/history",
  "/v1/internal/cleanup/filings",
  "/v1/internal/credit-audit/repair"
]);
const MIGRATION_PATHS = new Set([
  "/v1/identity/bootstrap",
  "/v1/account/paid-credit-migration",
  "/internal/subscription-principal-migration"
]);

function emergencyRouteResponse(request: Request, url: URL, env: Env): Response | null {
  if (request.method !== "POST") return null;
  const internalSecRequest = url.pathname.startsWith("/internal/sec/");
  if (
    truthy(env.EMERGENCY_DISABLE_BACKGROUND_JOBS) &&
    (BACKGROUND_JOB_PATHS.has(url.pathname) || internalSecRequest)
  ) {
    return unavailable("Background jobs are temporarily disabled");
  }
  const companyRefresh = /^\/v1\/company\/[^/]+\/refresh$/u.test(url.pathname);
  const secBackfill = url.pathname === "/v1/internal/backfill/history";
  if (truthy(env.EMERGENCY_DISABLE_SEC_REFRESH) && (internalSecRequest || companyRefresh || secBackfill)) {
    return unavailable("SEC refresh is temporarily disabled");
  }
  if (truthy(env.EMERGENCY_DISABLE_MIGRATIONS) && MIGRATION_PATHS.has(url.pathname)) {
    return unavailable("Migration operations are temporarily disabled");
  }
  return null;
}

async function enforceInstallationIdentity(
  request: Request,
  url: URL,
  env: Env,
  config: Awaited<ReturnType<typeof loadRemoteConfig>>
): Promise<void> {
  const isSignedAdMobCallback = request.method === "GET" && url.pathname === "/v1/admob/ssv";
  if (INSTALLATION_PUBLIC_PATHS.has(url.pathname) || isSignedAdMobCallback) return;
  if (!env.INSTALLATION_TOKEN_HMAC_KEY_V1?.trim()) {
    if (authorizeLegacyClientCompatibilityRequest(request, url, env, config)) return;
    const production = [env.KABUYOMI_ENV, env.ENVIRONMENT]
      .some((value) => value?.trim().toLowerCase() === "production");
    if (production) throw new AppError(503, "Installation identity is temporarily unavailable");
    return;
  }
  if (await loadTestAutomationAccessFromRequest(request, env)) return;
  const credential = await resolveInstallationCredential(request, env);
  if (!credential) {
    if (authorizeLegacyClientCompatibilityRequest(request, url, env, config)) return;
    throw new AppError(401, "Installation credential is required");
  }
  if (resolveAppAttestAssertionPolicy(
    request.method,
    url.pathname,
    credential.attestationStatus
  ) === "required") {
    await verifyAppAttestAssertionForRequest(request, env, credential);
  }
}

export function resolveAppAttestAssertionPolicy(
  method: string,
  pathname: string,
  attestationStatus: "pending" | "verified" | "unavailable"
): "none" | "required" {
  if (APP_ATTEST_STRICT_ASSERTION_PATHS.has(pathname)) return "required";
  const corePath = APP_ATTEST_CORE_ASSERTION_PATHS.has(pathname) ||
    (method.toUpperCase() === "POST" && /^\/v1\/company\/[^/]+\/refresh$/u.test(pathname));
  if (!corePath) return "none";
  return attestationStatus === "unavailable" ? "none" : "required";
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? "");
}
