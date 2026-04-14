import type { Env } from "./env";
import { ChatRequestSchema, SearchQuerySchema, WatchlistAddRequestSchema } from "./lib/contracts";
import { ensureLatestFiling, buildChatResponse, consumeChatQuota, consumeStockQuota, loadFilingByKey, loadUsage, readQuotaIdentity } from "./lib/pipeline";
import { isAppError } from "./lib/errors";
import { logEvent } from "./lib/logging";
import { loadRemoteConfig } from "./lib/remote-config";
import { badRequest, json, notFound, serverError, unavailable } from "./lib/response";
import { refreshTickerSnapshot, searchTickers } from "./clients/sec";
import { EntitlementDO } from "./durable/entitlement";
import { FilingLockDO } from "./durable/filing-lock";
import { SecRateLimiterDO } from "./durable/sec-rate-limiter";
import { UserQuotaDO } from "./durable/user-quota";

export { EntitlementDO, FilingLockDO, SecRateLimiterDO, UserQuotaDO };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      const config = await loadRemoteConfig(env);

      if (config.maintenanceMode) {
        return unavailable("Kabuyomi is under maintenance");
      }

      if (request.method === "GET" && url.pathname === "/v1/search") {
        const parsed = SearchQuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
        if (!parsed.success) {
          return badRequest("Invalid search query");
        }
        const result = await searchTickers(parsed.data.q, env);
        logEvent("search_query", {
          query: parsed.data.q,
          resultCount: result.items.length
        });
        return json({
          items: result.items,
          snapshotUpdatedAt: result.updatedAt
        });
      }

      if (request.method === "POST" && url.pathname === "/v1/watchlist/add") {
        const parsed = WatchlistAddRequestSchema.safeParse(await request.json());
        if (!parsed.success) {
          return badRequest("Invalid ticker payload");
        }

        const identity = readQuotaIdentity(request, { requireDeviceKey: true });
        const filing = await ensureLatestFiling(parsed.data.ticker, env, config);
        const usage = await consumeStockQuota(identity, parsed.data.ticker, env, config);
        return json({
          company: serializeCompanyResponse(filing),
          usage
        });
      }

      if (request.method === "GET" && url.pathname.startsWith("/v1/company/")) {
        const ticker = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        if (!ticker) {
          return badRequest("Ticker is required");
        }
        const identity = readQuotaIdentity(request, { requireDeviceKey: true });
        const filing = await ensureLatestFiling(ticker, env, config);
        await consumeStockQuota(identity, ticker, env, config);
        return json(serializeCompanyResponse(filing));
      }

      if (request.method === "POST" && url.pathname.startsWith("/v1/company/") && url.pathname.endsWith("/refresh")) {
        const ticker = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        if (!ticker) {
          return badRequest("Ticker is required");
        }
        const identity = readQuotaIdentity(request, { requireDeviceKey: true });
        let filing;
        try {
          filing = await ensureLatestFiling(ticker, env, config, { forceRemoteCheck: true });
        } catch (error) {
          if (isAppError(error) && error.status >= 500) {
            filing = await ensureLatestFiling(ticker, env, config);
          } else {
            throw error;
          }
        }
        await consumeStockQuota(identity, ticker, env, config);
        return json(serializeCompanyResponse(filing));
      }

      if (request.method === "POST" && url.pathname === "/v1/chat") {
        if (!config.chatEnabled) {
          return unavailable("Chat is temporarily disabled");
        }

        const parsed = ChatRequestSchema.safeParse(await request.json());
        if (!parsed.success) {
          return badRequest("Invalid chat payload");
        }

        const filing = await loadFilingByKey(parsed.data.filingKey, env);
        if (!filing) {
          return notFound("Filing cache not found");
        }

        const identity = readQuotaIdentity(request, { requireDeviceKey: true });
        const startedAt = Date.now();
        const answer = await buildChatResponse(filing, parsed.data.question, env);
        const usage = await consumeChatQuota(identity, env, config);
        logEvent("chat_request", {
          filingKey: parsed.data.filingKey,
          quotaSubject: identity.quotaSubject,
          latencyMs: Date.now() - startedAt,
          sourceCount: answer.sources.length
        });
        return json({
          answer: answer.answer,
          sources: answer.sources,
          usage
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/usage") {
        const identity = readQuotaIdentity(request, { requireDeviceKey: true });
        const usage = await loadUsage(identity, env, config);
        return json(usage);
      }

      if (request.method === "POST" && url.pathname === "/v1/billing/sync") {
        logEvent("billing_sync_blocked", {
          path: url.pathname
        });
        return unavailable("Billing sync is disabled during beta");
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
    await refreshTickerSnapshot(env);
  }
};

function serializeCompanyResponse(filing: Awaited<ReturnType<typeof ensureLatestFiling>>) {
  return {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    companyName: filing.companyName,
    cik: filing.cik,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    primaryDocumentUrl: filing.primaryDocumentUrl,
    summary: filing.summary,
    metrics: filing.metrics,
    sourceChunks: filing.sourceChunks,
    lastUpdatedAt: filing.generatedAt
  };
}
