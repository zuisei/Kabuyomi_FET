import { z } from "zod";
import { isAuthorizedInternalRequest } from "../lib/internal-auth";
import { processCreditAuditRepairQueue } from "../lib/credit-audit-repair";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import type { RouteHandler } from "./types";

const CreditAuditRepairRequestSchema = z.object({
  limit: z.number().int().min(1).max(50).optional()
});

const CREDIT_AUDIT_REPAIR_PAYLOAD_MAX_BYTES = 512;

export const handleInternalCreditAuditRepairRoute: RouteHandler = async ({ request, url, env }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/internal/credit-audit/repair")) {
    return null;
  }

  if (!isAuthorizedInternalRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await parseJsonBody(request, CreditAuditRepairRequestSchema, {
    invalidMessage: "Invalid credit audit repair payload",
    maxBytes: CREDIT_AUDIT_REPAIR_PAYLOAD_MAX_BYTES,
    allowEmptyObject: true
  });
  const result = await processCreditAuditRepairQueue(env, { limit: payload.limit });

  return json(result);
};
