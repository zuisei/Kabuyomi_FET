import { listTickersByCik, lookupTicker, resolveLatestSearchFormType } from "../clients/sec";
import { WatchlistAddRequestSchema } from "../lib/contracts";
import { AppError } from "../lib/errors";
import { logErrorEvent, logEvent } from "../lib/logging";
import { ensureLatestFiling } from "../lib/pipeline";
import { consumeStockQuotaWithMutation, promoteSavedTickerAlias, readQuotaIdentity, refundStockQuota } from "../lib/quota";
import { json, notFound } from "../lib/response";
import { parseJsonBody } from "../lib/request";
import { serializeCompanyResponse } from "../lib/company-response";
import type { RouteHandler } from "./types";

const WATCHLIST_PAYLOAD_MAX_BYTES = 1_024;
const WATCHLIST_ASYNC_MODE_HEADER = "x-kabuyomi-watchlist-mode";
const WATCHLIST_PREPARING_MESSAGE = "SEC filing is being prepared";
const WATCHLIST_PREPARING_RETRY_AFTER_SECONDS = 2;

export const handleWatchlistAddRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/watchlist/add")) {
    return null;
  }

  const payload = await parseJsonBody(request, WatchlistAddRequestSchema, {
    invalidMessage: "Invalid ticker payload",
    maxBytes: WATCHLIST_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Ticker payload is too large"
  });

  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const tickerRecord = await lookupTicker(payload.ticker, env);
  if (!tickerRecord) {
    return notFound(`Ticker not found: ${payload.ticker}`);
  }
  const relatedTickers = await listTickersByCik(tickerRecord.cik, env);

  const asyncMode = request.headers.get(WATCHLIST_ASYNC_MODE_HEADER)?.toLowerCase() === "async";
  if (asyncMode) {
    const latestFormType = await resolveLatestSearchFormType(tickerRecord, env);
    if (latestFormType !== "10-K" && latestFormType !== "10-Q") {
      logEvent("watchlist_add_async_unsupported_filing", {
        ticker: tickerRecord.ticker,
        cik: tickerRecord.cik,
        latestFormType: latestFormType ?? "unknown"
      });
      throw new AppError(422, `No supported filing found for ${tickerRecord.ticker}`);
    }
  }

  const stockQuota = await consumeStockQuotaWithMutation(identity, tickerRecord.ticker, env, config, { relatedTickers });
  if (asyncMode) {
    const usage = stockQuota.didMutate
      ? stockQuota.usage
      : await promoteSavedTickerAlias(identity, tickerRecord.ticker, env, config, { relatedTickers });

    ctx.waitUntil(
      ensureLatestFiling(tickerRecord.ticker, env, config, {
        deferFullContent: true,
        executionContext: ctx,
        tickerRecord
      })
        .then((filing) => {
          logEvent("watchlist_add_async_filing_ready", {
            ticker: tickerRecord.ticker,
            filingKey: filing.filingKey
          });
        })
        .catch((error) => {
          logErrorEvent("watchlist_add_async_filing_failed", {
            ticker: tickerRecord.ticker,
            reason: error instanceof Error ? error.message : String(error)
          });
          if (stockQuota.didMutate) {
            return refundStockQuota(identity, tickerRecord.ticker, env, config, { relatedTickers }).catch((refundError) => {
              logErrorEvent("watchlist_add_async_quota_refund_failed", {
                ticker: tickerRecord.ticker,
                quotaSubject: identity.quotaSubject,
                reason: refundError instanceof Error ? refundError.message : String(refundError)
              });
            });
          }
          return undefined;
        })
    );

    return json({
      status: "preparing",
      ticker: tickerRecord.ticker,
      companyName: tickerRecord.companyName,
      cik: tickerRecord.cik,
      message: WATCHLIST_PREPARING_MESSAGE,
      retryAfterSeconds: WATCHLIST_PREPARING_RETRY_AFTER_SECONDS,
      usage
    });
  }

  const filing = await (async () => {
    try {
      return await ensureLatestFiling(tickerRecord.ticker, env, config, {
        deferFullContent: true,
        executionContext: ctx,
        tickerRecord
      });
    } catch (error) {
      if (stockQuota.didMutate) {
        try {
          await refundStockQuota(identity, tickerRecord.ticker, env, config, { relatedTickers });
        } catch (refundError) {
          logErrorEvent("watchlist_add_quota_refund_failed", {
            ticker: tickerRecord.ticker,
            quotaSubject: identity.quotaSubject,
            reason: refundError instanceof Error ? refundError.message : String(refundError)
          });
        }
      }
      throw error;
    }
  })();
  const usage = stockQuota.didMutate
    ? stockQuota.usage
    : await promoteSavedTickerAlias(identity, tickerRecord.ticker, env, config, { relatedTickers });

  return json({
    company: await serializeCompanyResponse(filing, env, {
      displayTicker: tickerRecord.ticker,
      allowHistoricalPersistence: true
    }),
    usage
  });
};
