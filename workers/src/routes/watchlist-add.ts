import { WatchlistAddRequestSchema } from "../lib/contracts";
import { addWatchlistTickerUsecase } from "../lib/watchlist/usecase";
import { json, notFound } from "../lib/response";
import { parseJsonBody } from "../lib/request";
import type { RouteHandler } from "./types";

const WATCHLIST_PAYLOAD_MAX_BYTES = 1_024;
const WATCHLIST_ASYNC_MODE_HEADER = "x-kabuyomi-watchlist-mode";

export const handleWatchlistAddRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/watchlist/add")) {
    return null;
  }

  const payload = await parseJsonBody(request, WatchlistAddRequestSchema, {
    invalidMessage: "Invalid ticker payload",
    maxBytes: WATCHLIST_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Ticker payload is too large"
  });

  const result = await addWatchlistTickerUsecase({
    request,
    ticker: payload.ticker,
    asyncMode: request.headers.get(WATCHLIST_ASYNC_MODE_HEADER)?.toLowerCase() === "async",
    env,
    config,
    ctx
  });
  if (result.kind === "not_found") {
    return notFound(result.message);
  }

  return json(result.body);
};
