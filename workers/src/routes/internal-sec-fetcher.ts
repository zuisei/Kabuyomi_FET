import { z } from "zod";
import { createCloudflareSecFetcherService } from "../lib/sec-fetcher-service";
import { isAuthorizedSecFetcherRequest } from "../lib/internal-auth";
import { json } from "../lib/response";
import { parseJsonBody } from "../lib/request";
import type { RouteHandler } from "./types";

const INTERNAL_SEC_PAYLOAD_MAX_BYTES = 16 * 1024;

const EmptyPayloadSchema = z.object({}).passthrough();
const SubmissionsPayloadSchema = z.object({
  cik: z.string().trim().min(1),
  includeHistory: z.boolean().optional()
});
const FilingPayloadSchema = z.object({
  cik: z.string().trim().min(1),
  accessionNumber: z.string().trim().min(1),
  primaryDocument: z.string().trim().min(1)
});
const MetricsPayloadSchema = z.object({
  cik: z.string().trim().min(1),
  tags: z.array(z.string()).optional().default([])
});
const FilingAssetsPayloadSchema = FilingPayloadSchema.extend({
  tags: z.array(z.string()).optional().default([])
});
const PreparedFilingPayloadSchema = FilingAssetsPayloadSchema.extend({
  formType: z.enum(["10-K", "10-Q"])
});

export const handleInternalSecFetcherRoute: RouteHandler = async ({ request, url, env }) => {
  if (!url.pathname.startsWith("/internal/sec/")) {
    return null;
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!isAuthorizedSecFetcherRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createCloudflareSecFetcherService(env);

  if (url.pathname === "/internal/sec/tickers-snapshot") {
    await parsePayload(request, EmptyPayloadSchema);
    return json(await service.fetchTickerSnapshot());
  }

  if (url.pathname === "/internal/sec/submissions") {
    const payload = await parsePayload(request, SubmissionsPayloadSchema);
    return json(await service.fetchSubmissions(payload.cik, { includeHistory: payload.includeHistory === true }));
  }

  if (url.pathname === "/internal/sec/filing") {
    const payload = await parsePayload(request, FilingPayloadSchema);
    return json(await service.fetchFiling(payload));
  }

  if (url.pathname === "/internal/sec/metrics") {
    const payload = await parsePayload(request, MetricsPayloadSchema);
    return json(await service.fetchMetrics(payload));
  }

  if (url.pathname === "/internal/sec/filing-assets") {
    const payload = await parsePayload(request, FilingAssetsPayloadSchema);
    return json(await service.fetchFilingAssets(payload));
  }

  if (url.pathname === "/internal/sec/prepared-filing") {
    const payload = await parsePayload(request, PreparedFilingPayloadSchema);
    return json(await service.fetchPreparedFiling(payload));
  }

  return json({ error: "Not found" }, { status: 404 });
};

async function parsePayload<Schema extends z.ZodTypeAny>(request: Request, schema: Schema): Promise<z.infer<Schema>> {
  return parseJsonBody(request, schema, {
    invalidMessage: "Invalid SEC fetcher payload",
    maxBytes: INTERNAL_SEC_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "SEC fetcher payload is too large",
    allowEmptyObject: true
  });
}
