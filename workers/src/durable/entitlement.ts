import type { DurableObjectState } from "@cloudflare/workers-types";
import { EntitlementRequestSchema } from "../lib/contracts";
import { isAppError } from "../lib/errors";
import { parseJsonBody } from "../lib/request";

const ENTITLEMENT_PAYLOAD_MAX_BYTES = 2_048;

export class EntitlementDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
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

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(body.originalTransactionId)
    );
    const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    const payload = {
      plan: body.active ? "pro" : "free",
      quotaSubject: body.active ? `pro:${hex}` : `free:${hex}`,
      productId: body.productId ?? null,
      syncedAt: new Date().toISOString()
    };

    await this.state.storage.put(hex, payload);
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
