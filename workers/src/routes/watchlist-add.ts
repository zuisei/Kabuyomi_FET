import { lookupTicker } from "../clients/sec";
import { WatchlistAddRequestSchema } from "../lib/contracts";
import { ensureLatestFiling } from "../lib/pipeline";
import { ensureStockQuotaAvailable, consumeStockQuota, readQuotaIdentity } from "../lib/quota";
import { badRequest, json, notFound } from "../lib/response";
import { serializeCompanyResponse } from "../lib/company-response";
import type { RouteHandler } from "./types";

export const handleWatchlistAddRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/watchlist/add")) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid ticker payload");
  }

  const parsed = WatchlistAddRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest("Invalid ticker payload");
  }

  const identity = await readQuotaIdentity(request, env, {
    requireDeviceKey: true,
    allowDebugUnlimited: true
  });
  const tickerRecord = await lookupTicker(parsed.data.ticker, env);
  if (!tickerRecord) {
    return notFound(`Ticker not found: ${parsed.data.ticker}`);
  }

  await ensureStockQuotaAvailable(identity, tickerRecord.ticker, env, config);
  const filing = await ensureLatestFiling(tickerRecord.ticker, env, config, {
    executionContext: ctx,
    tickerRecord
  });
  const usage = await consumeStockQuota(identity, tickerRecord.ticker, env, config);

  return json({
    company: await serializeCompanyResponse(filing, env, { displayTicker: tickerRecord.ticker }),
    usage
  });
};
