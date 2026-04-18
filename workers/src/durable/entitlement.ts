import type { DurableObjectState } from "@cloudflare/workers-types";
import { EntitlementRequestSchema } from "../lib/contracts";

export class EntitlementDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    let requestBody: unknown;
    try {
      requestBody = await request.json();
    } catch {
      return this.reply({ error: "Invalid entitlement payload" }, 400);
    }

    const parsed = EntitlementRequestSchema.safeParse(requestBody);
    if (!parsed.success) {
      return this.reply({ error: "Invalid entitlement payload" }, 400);
    }

    const body = parsed.data;
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
      headers: { "content-type": "application/json" }
    });
  }
}
