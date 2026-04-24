import { CleanupFilingsRequestSchema } from "../lib/contracts";
import { cleanupFilingStorage } from "../lib/filings/cleanup";
import { isAuthorizedInternalRequest } from "../lib/internal-auth";
import { json } from "../lib/response";
import { parseJsonBody } from "../lib/request";
import type { RouteHandler } from "./types";

const INTERNAL_CLEANUP_PAYLOAD_MAX_BYTES = 32_768;

export const handleInternalCleanupFilingsRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/internal/cleanup/filings")) {
    return null;
  }

  if (!isAuthorizedInternalRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await parseJsonBody(request, CleanupFilingsRequestSchema, {
    invalidMessage: "Invalid cleanup payload",
    maxBytes: INTERNAL_CLEANUP_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Cleanup payload is too large"
  });

  return json(await cleanupFilingStorage(payload, env, config));
};
