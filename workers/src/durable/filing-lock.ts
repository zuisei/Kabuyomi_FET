import type { DurableObjectState } from "@cloudflare/workers-types";

const LOCK_TTL_MS = 30_000;
const LOCKED_UNTIL_KEY = "lockedUntil";
const LOCK_TOKEN_KEY = "lockToken";

export class FilingLockDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/lock") {
      return this.acquire();
    }
    if (request.method === "POST" && url.pathname === "/renew") {
      return this.renew(request);
    }
    if (request.method === "POST" && url.pathname === "/unlock") {
      return this.release(request);
    }
    return new Response("Not found", { status: 404 });
  }

  private async acquire(): Promise<Response> {
    while (true) {
      const now = Date.now();
      const token = crypto.randomUUID();
      const acquired = await this.state.blockConcurrencyWhile(async (): Promise<string | null> => {
        const lockedUntil = (await this.state.storage.get<number>(LOCKED_UNTIL_KEY)) ?? 0;
        if (lockedUntil > now) {
          return null;
        }

        await Promise.all([
          this.state.storage.put(LOCKED_UNTIL_KEY, now + LOCK_TTL_MS),
          this.state.storage.put(LOCK_TOKEN_KEY, token)
        ]);
        return token;
      });

      if (acquired) {
        return new Response(JSON.stringify({ ok: true, token: acquired, ttlMs: LOCK_TTL_MS }), {
          headers: { "content-type": "application/json" }
        });
      }

      const lockedUntil = (await this.state.storage.get<number>(LOCKED_UNTIL_KEY)) ?? now + 500;
      await sleep(Math.min(500, lockedUntil - now));
    }
  }

  private async renew(request: Request): Promise<Response> {
    const token = await readToken(request);
    if (!token) {
      return json({ ok: false, error: "Missing lock token" }, 400);
    }

    const renewed = await this.state.blockConcurrencyWhile(async () => {
      const currentToken = await this.state.storage.get<string>(LOCK_TOKEN_KEY);
      if (currentToken !== token) {
        return false;
      }

      await this.state.storage.put(LOCKED_UNTIL_KEY, Date.now() + LOCK_TTL_MS);
      return true;
    });

    return renewed
      ? json({ ok: true, ttlMs: LOCK_TTL_MS })
      : json({ ok: false, error: "Lock token no longer owns this filing" }, 409);
  }

  private async release(request: Request): Promise<Response> {
    const token = await readToken(request);
    if (!token) {
      return json({ ok: false, error: "Missing lock token" }, 400);
    }

    const released = await this.state.blockConcurrencyWhile(async () => {
      const currentToken = await this.state.storage.get<string>(LOCK_TOKEN_KEY);
      if (currentToken !== token) {
        return false;
      }

      await Promise.all([this.state.storage.delete(LOCKED_UNTIL_KEY), this.state.storage.delete(LOCK_TOKEN_KEY)]);
      return true;
    });

    return released ? json({ ok: true }) : json({ ok: false, error: "Lock token no longer owns this filing" }, 409);
  }
}

async function readToken(request: Request): Promise<string | null> {
  try {
    const payload = (await request.json()) as { token?: unknown };
    return typeof payload.token === "string" && payload.token.trim() ? payload.token : null;
  } catch {
    return null;
  }
}

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
