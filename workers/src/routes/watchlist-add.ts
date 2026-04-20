import { listTickersByCik, lookupTicker } from "../clients/sec";
import { WatchlistAddRequestSchema } from "../lib/contracts";
import { logErrorEvent } from "../lib/logging";
import { ensureLatestFiling } from "../lib/pipeline";
import { consumeStockQuotaWithMutation, promoteSavedTickerAlias, readQuotaIdentity, refundStockQuota } from "../lib/quota";
import { json, notFound } from "../lib/response";
import { parseJsonBody } from "../lib/request";
import { serializeCompanyResponse } from "../lib/company-response";
import type { RouteHandler } from "./types";

const WATCHLIST_PAYLOAD_MAX_BYTES = 1_024;

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

  const stockQuota = await consumeStockQuotaWithMutation(identity, tickerRecord.ticker, env, config, { relatedTickers });
  const filing = await (async () => {
    try {
      return await ensureLatestFiling(tickerRecord.ticker, env, config, {
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
    company: await serializeCompanyResponse(filing, env, { displayTicker: tickerRecord.ticker }),
    usage
  });
};
