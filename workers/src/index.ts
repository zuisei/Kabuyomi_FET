import type { Env } from "./env";
import { BackfillHistoryRequestSchema, ChatRequestSchema, SearchQuerySchema, WatchlistAddRequestSchema } from "./lib/contracts";
import {
  ensureLatestFiling,
  buildChatResponse,
  consumeChatQuota,
  consumeStockQuota,
  ensureHistoricalFilingStored,
  loadFilingByKey,
  loadUsage,
  readQuotaIdentity
} from "./lib/pipeline";
import { refreshTrackedFilings } from "./lib/daily-refresh";
import { isAppError } from "./lib/errors";
import { backfillHistoricalFilings } from "./lib/history-store";
import { logEvent } from "./lib/logging";
import { loadRemoteConfig } from "./lib/remote-config";
import { badRequest, json, notFound, serverError, unavailable } from "./lib/response";
import { resolveTrackedTickers } from "./lib/tracked-tickers";
import { refreshTickerSnapshot, searchTickers } from "./clients/sec";
import { EntitlementDO } from "./durable/entitlement";
import { FilingLockDO } from "./durable/filing-lock";
import { SecRateLimiterDO } from "./durable/sec-rate-limiter";
import { UserQuotaDO } from "./durable/user-quota";

export { EntitlementDO, FilingLockDO, SecRateLimiterDO, UserQuotaDO };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      const config = await loadRemoteConfig(env);

      if (request.method === "POST" && url.pathname === "/v1/internal/backfill/history") {
        if (!isAuthorizedInternalRequest(request, env)) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        const parsed = BackfillHistoryRequestSchema.safeParse(await request.json());
        if (!parsed.success) {
          return badRequest("Invalid backfill payload");
        }

        const result = await backfillHistoricalFilings(
          {
            ...parsed.data,
            tickers: parsed.data.tickers?.length ? parsed.data.tickers : resolveTrackedTickers(config)
          },
          env,
          config,
          ensureHistoricalFilingStored
        );

        return json(result);
      }

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
        const filing = await ensureLatestFiling(parsed.data.ticker, env, config, { executionContext: ctx });
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
        readQuotaIdentity(request, { requireDeviceKey: true });
        const filing = await ensureLatestFiling(ticker, env, config, { executionContext: ctx });
        return json(serializeCompanyResponse(filing));
      }

      if (request.method === "POST" && url.pathname.startsWith("/v1/company/") && url.pathname.endsWith("/refresh")) {
        const ticker = decodeURIComponent(url.pathname.split("/")[3] ?? "");
        if (!ticker) {
          return badRequest("Ticker is required");
        }
        readQuotaIdentity(request, { requireDeviceKey: true });
        let filing;
        try {
          filing = await ensureLatestFiling(ticker, env, config, { forceRemoteCheck: true, executionContext: ctx });
        } catch (error) {
          if (isAppError(error) && error.status >= 500) {
            filing = await ensureLatestFiling(ticker, env, config, { executionContext: ctx });
          } else {
            throw error;
          }
        }
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
        const answer = await buildChatResponse(filing, parsed.data.question, env, config);
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
    const config = await loadRemoteConfig(env);
    await refreshTickerSnapshot(env);
    await refreshTrackedFilings(env, config);
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

function isAuthorizedInternalRequest(request: Request, env: Env): boolean {
  const configured = env.BACKFILL_SHARED_SECRET?.trim();
  if (!configured) {
    return false;
  }

  const supplied = request.headers.get("x-internal-token")?.trim() ?? "";
  return timingSafeEqual(configured, supplied);
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return mismatch === 0;
}
