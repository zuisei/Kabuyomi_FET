import type { Env } from "./env";
import { refreshTickerSnapshot } from "./clients/sec";
import { EntitlementDO } from "./durable/entitlement";
import { FilingLockDO } from "./durable/filing-lock";
import { SecRateLimiterDO } from "./durable/sec-rate-limiter";
import { UserQuotaDO } from "./durable/user-quota";
import { refreshTrackedFilings } from "./lib/daily-refresh";
import { isAppError } from "./lib/errors";
import { logErrorEvent, logEvent } from "./lib/logging";
import { loadRemoteConfig } from "./lib/remote-config";
import { json, notFound, serverError, unavailable } from "./lib/response";
import { handleBillingSyncRoute } from "./routes/billing-sync";
import { handleChatRoute } from "./routes/chat";
import { handleCompanyRoute } from "./routes/company";
import { handleCreditPurchaseGrantRoute } from "./routes/credit-purchase-grant";
import { handleInternalBackfillHistoryRoute } from "./routes/internal-backfill-history";
import { handleInternalCleanupFilingsRoute } from "./routes/internal-cleanup-filings";
import { handleInternalCreditPurchaseGrantRoute } from "./routes/internal-credit-purchase-grant";
import { handleInternalEvalCreditGrantRoute } from "./routes/internal-eval-credit-grant";
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
  handleInternalBackfillHistoryRoute,
  handleInternalCleanupFilingsRoute,
  handleInternalCreditPurchaseGrantRoute,
  handleInternalEvalCreditGrantRoute
];
const apiRoutes: RouteHandler[] = [
  handleSearchRoute,
  handleWatchlistAddRoute,
  handleWatchlistRemoveRoute,
  handleCompanyRoute,
  handleChatRoute,
  handleCreditPurchaseGrantRoute,
  handleTranslateQuoteRoute,
  handleUsageRoute,
  handleBillingSyncRoute
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
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

      for (const route of apiRoutes) {
        const response = await route({ request, url, env, config, ctx });
        if (response) {
          return response;
        }
      }

      return notFound();
    } catch (error) {
      if (isAppError(error)) {
        console.error(error.internalMessage ?? error.message);
        return json({ error: error.publicMessage }, { status: error.status });
      }

      console.error(error);
      return serverError();
    }
  },

  async scheduled(_: ScheduledController, env: Env): Promise<void> {
    const config = await loadRemoteConfig(env);
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
