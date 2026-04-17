import { BackfillHistoryRequestSchema } from "../lib/contracts";
import { backfillHistoricalFilings } from "../lib/history-store";
import { isAuthorizedInternalRequest } from "../lib/internal-auth";
import { ensureHistoricalFilingStored } from "../lib/pipeline";
import { badRequest, json } from "../lib/response";
import { resolveTrackedTickers } from "../lib/tracked-tickers";
import type { RouteHandler } from "./types";

export const handleInternalBackfillHistoryRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/internal/backfill/history")) {
    return null;
  }

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
};
