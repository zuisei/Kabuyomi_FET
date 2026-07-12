import { BackfillHistoryRequestSchema } from "../lib/contracts";
import { ensureHistoricalFilingStored } from "../lib/filings/history-persistence";
import { backfillHistoricalFilings } from "../lib/history-store";
import { isAuthorizedInternalRequest } from "../lib/internal-auth";
import { json } from "../lib/response";
import { parseJsonBody } from "../lib/request";
import { resolveTrackedTickersForExecution } from "../lib/tracked-tickers";
import type { RouteHandler } from "./types";

const INTERNAL_BACKFILL_PAYLOAD_MAX_BYTES = 32_768;

export const handleInternalBackfillHistoryRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/internal/backfill/history")) {
    return null;
  }

  if (!isAuthorizedInternalRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await parseJsonBody(request, BackfillHistoryRequestSchema, {
    invalidMessage: "Invalid backfill payload",
    maxBytes: INTERNAL_BACKFILL_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Backfill payload is too large"
  });

  const result = await backfillHistoricalFilings(
    {
      ...payload,
      tickers:
        payload.tickers?.length
          ? await resolveTrackedTickersForExecution({ trackedTickers: payload.tickers }, env)
          : await resolveTrackedTickersForExecution(config, env)
    },
    env,
    config,
    (filing, comparisonFiling, routeEnv, routeConfig) =>
      ensureHistoricalFilingStored(filing, comparisonFiling, routeEnv, routeConfig, {
        contentMode: payload.contentMode
      })
  );

  return json(result);
};
