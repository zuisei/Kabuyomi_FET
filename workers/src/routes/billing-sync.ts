import { BillingSyncRequestSchema } from "../lib/contracts";
import { isAppError } from "../lib/errors";
import { logEvent } from "../lib/logging";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import { syncBillingEntitlement } from "../lib/entitlements";
import type { RouteHandler } from "./types";

const BILLING_SYNC_PAYLOAD_MAX_BYTES = 20_000;

export const handleBillingSyncRoute: RouteHandler = async ({ request, url, env }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/billing/sync")) {
    return null;
  }

  let body;
  try {
    body = await parseJsonBody(request, BillingSyncRequestSchema, {
      invalidMessage: "Invalid billing sync payload",
      maxBytes: BILLING_SYNC_PAYLOAD_MAX_BYTES,
      tooLargeMessage: "Billing sync payload is too large"
    });
  } catch (error) {
    if (!isAppError(error)) {
      throw error;
    }
    return json({ error: error.publicMessage }, { status: error.status });
  }

  const payload = await syncBillingEntitlement(env, body);
  logEvent("billing_sync_succeeded", {
    path: url.pathname,
    plan: payload.plan,
    productId: payload.productId ?? "nil"
  });
  return json(payload);
};
