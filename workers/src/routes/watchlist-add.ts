import { WatchlistAddRequestSchema } from "../lib/contracts";
import { ensureLatestFiling } from "../lib/pipeline";
import { ensureStockQuotaAvailable, consumeStockQuota, readQuotaIdentity } from "../lib/quota";
import { badRequest, json } from "../lib/response";
import { serializeCompanyResponse } from "../lib/company-response";
import type { RouteHandler } from "./types";

export const handleWatchlistAddRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/watchlist/add")) {
    return null;
  }

  const parsed = WatchlistAddRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid ticker payload");
  }

  const identity = await readQuotaIdentity(request, { requireDeviceKey: true });
  await ensureStockQuotaAvailable(identity, parsed.data.ticker, env, config);
  const filing = await ensureLatestFiling(parsed.data.ticker, env, config, { executionContext: ctx });
  const usage = await consumeStockQuota(identity, parsed.data.ticker, env, config);

  return json({
    company: serializeCompanyResponse(filing),
    usage
  });
};
