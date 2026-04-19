import { listTickersByCik, lookupTicker } from "../clients/sec";
import { WatchlistRemoveRequestSchema } from "../lib/contracts";
import { readQuotaIdentity, removeTickerFromSavedQuota } from "../lib/quota";
import { json } from "../lib/response";
import { parseJsonBody } from "../lib/request";
import type { RouteHandler } from "./types";

const WATCHLIST_PAYLOAD_MAX_BYTES = 1_024;

export const handleWatchlistRemoveRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/watchlist/remove")) {
    return null;
  }

  const payload = await parseJsonBody(request, WatchlistRemoveRequestSchema, {
    invalidMessage: "Invalid ticker payload",
    maxBytes: WATCHLIST_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Ticker payload is too large"
  });

  const identity = await readQuotaIdentity(request, env, {
    requireDeviceKey: true,
    allowDebugUnlimited: true
  });
  const tickerRecord = await lookupTicker(payload.ticker, env);
  const relatedTickers = tickerRecord ? await listTickersByCik(tickerRecord.cik, env) : [];
  const usage = await removeTickerFromSavedQuota(
    identity,
    tickerRecord?.ticker ?? payload.ticker.trim().toUpperCase(),
    env,
    config,
    { relatedTickers }
  );

  return json({ usage });
};
