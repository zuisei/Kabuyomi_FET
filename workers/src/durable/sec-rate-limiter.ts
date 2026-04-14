import type { DurableObjectState } from "@cloudflare/workers-types";

const WINDOW_MS = 1_000;
const MAX_REQUESTS = 10;

export class SecRateLimiterDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const tokens = Number(url.searchParams.get("tokens") ?? "1");
    const grantedAt = await this.take(tokens);
    return new Response(JSON.stringify({ ok: true, grantedAt }), {
      headers: { "content-type": "application/json" }
    });
  }

  private async take(tokens: number): Promise<string> {
    while (true) {
      const now = Date.now();
      const existing = ((await this.state.storage.get<number[]>("timestamps")) ?? []).filter(
        (timestamp) => now - timestamp < WINDOW_MS
      );

      if (existing.length + tokens <= MAX_REQUESTS) {
        const next = [...existing, ...Array.from({ length: tokens }, () => now)];
        await this.state.storage.put("timestamps", next);
        return new Date(now).toISOString();
      }

      const waitFor = WINDOW_MS - (now - existing[0]) + 5;
      await sleep(waitFor);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

