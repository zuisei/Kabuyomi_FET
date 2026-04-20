import type { DurableObjectState } from "@cloudflare/workers-types";
import { EntitlementRequestSchema } from "../lib/contracts";
import { isAppError } from "../lib/errors";
import { buildSyncedEntitlement } from "../lib/entitlements";
import { parseJsonBody } from "../lib/request";

const ENTITLEMENT_PAYLOAD_MAX_BYTES = 2_048;
const CURRENT_ENTITLEMENT_KEY = "current";

export class EntitlementDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET") {
      const current = await this.state.storage.get(CURRENT_ENTITLEMENT_KEY);
      if (!current) {
        return this.reply({ error: "Entitlement not found" }, 404);
      }
      return this.reply(current, 200);
    }

    let body;
    try {
      body = await parseJsonBody(request, EntitlementRequestSchema, {
        invalidMessage: "Invalid entitlement payload",
        maxBytes: ENTITLEMENT_PAYLOAD_MAX_BYTES,
        tooLargeMessage: "Entitlement payload is too large"
      });
    } catch (error) {
      if (!isAppError(error)) {
        throw error;
      }
      return this.reply({ error: error.publicMessage }, error.status);
    }

    const payload = await buildSyncedEntitlement(body.originalTransactionId, body.productId, body.active);
    await this.state.storage.put(CURRENT_ENTITLEMENT_KEY, payload);
    return this.reply(payload, 200);
  }

  private reply(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
}
