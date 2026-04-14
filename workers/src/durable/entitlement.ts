import type { DurableObjectState } from "@cloudflare/workers-types";

interface EntitlementBody {
  originalTransactionId: string;
  active: boolean;
  productId?: string;
}

export class EntitlementDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as EntitlementBody;
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
    return new Response(JSON.stringify(payload), {
      headers: { "content-type": "application/json" }
    });
  }
}

