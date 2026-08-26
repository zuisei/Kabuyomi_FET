import type { Env } from "./env";
import { refreshTickerSnapshot } from "./clients/sec";
import { EntitlementDO } from "./durable/entitlement";
import { FilingLockDO } from "./durable/filing-lock";
import { SecRateLimiterDO } from "./durable/sec-rate-limiter";
import { UserQuotaDO } from "./durable/user-quota";
import { refreshTrackedFilings } from "./lib/daily-refresh";
import { AppError, isAppError } from "./lib/errors";
import { hashForLog, logErrorEvent, logEvent, logWarnEvent } from "./lib/logging";
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
  await enforceAppAttestAssertionPolicy(
    resolveAppAttestAssertionPolicy(request.method, url.pathname, credential.attestationStatus),
    () => verifyAppAttestAssertionForRequest(request, env, credential),
    {
      path: url.pathname,
      method: request.method.toUpperCase(),
      attestationStatus: credential.attestationStatus,
      principalHash: hashForLog(credential.principal)
    }
  );
}

/// "advisory" は「検証はする、落ちても通す」。失敗を握り潰す代わりに必ず 1 行残す
/// (握り潰しが見えないまま権限が落ちる、というのが 2026-08-21 監査の指摘そのものだった)。
export async function enforceAppAttestAssertionPolicy(
  policy: "none" | "advisory" | "required",
  verify: () => Promise<void>,
  context: { path: string; method: string; attestationStatus: string; principalHash: string | null }
): Promise<void> {
  if (policy === "none") return;
  if (policy === "required") {
    await verify();
    return;
  }
  try {
    await verify();
  } catch (error) {
    logWarnEvent("app_attest_assertion_ignored", {
      ...context,
      failureClass: error instanceof AppError
        ? `status_${error.status}`
        : error instanceof Error ? error.name : typeof error
    });
  }
}

/// App Attest でユーザーを締め出さない。締め出すのは「タダのクレジット」だけ。
///
/// 2026-08-24 のオーナー指摘「App Attest は無視できる形にするべきでは」。実際、元の形には
/// **証明に成功した端末ほど壊れやすい**という逆転があった: `unavailable`(一度も証明して
/// いない端末)は core パスの assertion を免除される一方、一度 `verified` になった端末は
/// 以後 /v1/chat が assertion 必須になり、Apple 側の不調・extensions 検査・counter 競合の
/// どれか一つで 403 に落ちる。本番の verified は 4 件、つまり真面目に証明した人だけが
/// 人質になっていた。
///
/// なので core パスは "advisory" に落とす — 検証は走らせてログにも残すが、失敗しても
/// リクエストは通す。守るべき対象がそこには無い: チャットはクレジットを消費する側で、
/// クレジット自体は購入か付与でしか増えない。
///
/// "required" のまま残すのは `/v1/admob/reward-intents` だけ。ここは広告視聴で
/// **クレジットが増える**唯一の経路で、偽装が直接タダ働きの原価になる。
/// ようこそクレジットも同様に verified 限定のまま(accessMode 経由)。
export function resolveAppAttestAssertionPolicy(
  method: string,
  pathname: string,
  attestationStatus: "pending" | "verified" | "unavailable"
): "none" | "advisory" | "required" {
  if (APP_ATTEST_STRICT_ASSERTION_PATHS.has(pathname)) return "required";
  const corePath = APP_ATTEST_CORE_ASSERTION_PATHS.has(pathname) ||
    (method.toUpperCase() === "POST" && /^\/v1\/company\/[^/]+\/refresh$/u.test(pathname));
  if (!corePath) return "none";
  return attestationStatus === "unavailable" ? "none" : "advisory";
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? "");
}
