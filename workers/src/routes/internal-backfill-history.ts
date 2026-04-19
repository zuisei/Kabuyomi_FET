import { BackfillHistoryRequestSchema } from "../lib/contracts";
import { backfillHistoricalFilings } from "../lib/history-store";
import { isAuthorizedInternalRequest } from "../lib/internal-auth";
import { ensureHistoricalFilingStored } from "../lib/pipeline";
import { badRequest, json } from "../lib/response";
import { resolveTrackedTickersForExecution } from "../lib/tracked-tickers";
import type { RouteHandler } from "./types";

export const handleInternalBackfillHistoryRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/internal/backfill/history")) {
    return null;
  }

  if (!isAuthorizedInternalRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid backfill payload");
  }

  const parsed = BackfillHistoryRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest("Invalid backfill payload");
  }

  const result = await backfillHistoricalFilings(
    {
      ...parsed.data,
      tickers:
        parsed.data.tickers?.length
          ? await resolveTrackedTickersForExecution({ trackedTickers: parsed.data.tickers }, env)
          : await resolveTrackedTickersForExecution(config, env)
    },
    env,
    config,
    (filing, comparisonFiling, routeEnv, routeConfig) =>
      ensureHistoricalFilingStored(filing, comparisonFiling, routeEnv, routeConfig, { contentMode: "metrics_only" })
  );

  return json(result);
};
