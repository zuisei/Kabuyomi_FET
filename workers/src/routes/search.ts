import { searchTickers } from "../clients/sec";
import { SearchQuerySchema } from "../lib/contracts";
import { logErrorEvent, logEvent } from "../lib/logging";
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
      query: parsed.data.q,
      resultCount: result.items.length
    });

    return json({
      items: result.items,
      snapshotUpdatedAt: result.updatedAt
    });
  } catch (error) {
    logErrorEvent("search_failure", {
      query: parsed.data.q,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};
