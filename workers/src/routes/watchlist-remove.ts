import { listTickersByCik, lookupTicker } from "../clients/sec";
import { WatchlistRemoveRequestSchema } from "../lib/contracts";
import { readQuotaIdentity, removeTickerFromSavedQuota } from "../lib/quota";
import { badRequest, json } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleWatchlistRemoveRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/watchlist/remove")) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid ticker payload");
  }

  const parsed = WatchlistRemoveRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest("Invalid ticker payload");
  }

  const identity = await readQuotaIdentity(request, env, {
    requireDeviceKey: true,
    allowDebugUnlimited: true
  });
  const tickerRecord = await lookupTicker(parsed.data.ticker, env);
  const relatedTickers = tickerRecord ? await listTickersByCik(tickerRecord.cik, env) : [];
  const usage = await removeTickerFromSavedQuota(
    identity,
    tickerRecord?.ticker ?? parsed.data.ticker.trim().toUpperCase(),
    env,
    config,
    { relatedTickers }
  );

  return json({ usage });
};
