import type { DurableObjectState } from "@cloudflare/workers-types";

export class FilingLockDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/lock") {
      return this.acquire();
    }
    if (request.method === "POST" && url.pathname === "/unlock") {
      await this.state.blockConcurrencyWhile(async () => {
        await this.state.storage.delete("lockedUntil");
      });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("Not found", { status: 404 });
  }

  private async acquire(): Promise<Response> {
    while (true) {
      const now = Date.now();
      const acquired = await this.state.blockConcurrencyWhile(async () => {
        const lockedUntil = (await this.state.storage.get<number>("lockedUntil")) ?? 0;
        if (lockedUntil > now) {
          return false;
        }

        await this.state.storage.put("lockedUntil", now + 30_000);
        return true;
      });

      if (acquired) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" }
        });
      }

      const lockedUntil = (await this.state.storage.get<number>("lockedUntil")) ?? now + 500;
      await sleep(Math.min(500, lockedUntil - now));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
