import { searchTickers } from "../clients/sec";
import { SearchQuerySchema } from "../lib/contracts";
import { hashForLog, logErrorEvent, logEvent } from "../lib/logging";
import { badRequest, json } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleSearchRoute: RouteHandler = async ({ request, url, env }) => {
  if (!(request.method === "GET" && url.pathname === "/v1/search")) {
    return null;
  }

  const parsed = SearchQuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return badRequest("Invalid search query");
  }

  try {
    const result = await searchTickers(parsed.data.q, env);
    logEvent("search_success", {
      queryHash: hashForLog(parsed.data.q),
      queryLength: parsed.data.q.length,
      resultCount: result.items.length
    });

    return json({
      items: result.items,
      snapshotUpdatedAt: result.updatedAt
    });
  } catch (error) {
    logErrorEvent("search_failure", {
      queryHash: hashForLog(parsed.data.q),
      queryLength: parsed.data.q.length,
      errorClass: error instanceof Error ? error.name : typeof error
    });
    throw error;
  }
};
