import type { DurableObjectState } from "@cloudflare/workers-types";

const WINDOW_MS = 1_000;
/// SEC の fair-access は 10 req/s を**超えた**時点でIPブロック。
/// 上限ちょうどの 10 だとマージンがゼロで、計測誤差や再試行の取りこぼしが
/// そのまま超過になる。Node 版フェッチャ(`sec-fetcher/src/sec-service.mjs`)も
/// 既定 8 なので、実装間で値を揃える意味もある。
const MAX_REQUESTS = 8;

export class SecRateLimiterDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get("tokens") ?? "1");
    const tokens = Number.isFinite(requested) ? Math.min(Math.max(1, Math.trunc(requested)), MAX_REQUESTS) : 1;
    const grantedAt = await this.take(tokens);
    return new Response(JSON.stringify({ ok: true, grantedAt }), {
      headers: { "content-type": "application/json" }
    });
  }

  private async take(tokens: number): Promise<string> {
    while (true) {
      // read-modify-write を明示的に閉じる。`await sleep()` を挟むと input gate が
      // 開くため、暗黙のゲートに頼らず本リポジトリの他の変異経路
      // (`durable/user-quota.ts`)と同じ方針に揃える。
      const outcome = await this.state.blockConcurrencyWhile(async () => {
        const now = Date.now();
        const existing = ((await this.state.storage.get<number[]>("timestamps")) ?? []).filter(
          (timestamp) => now - timestamp < WINDOW_MS
        );

        if (existing.length + tokens <= MAX_REQUESTS) {
          const next = [...existing, ...Array.from({ length: tokens }, () => now)];
          await this.state.storage.put("timestamps", next);
          return { grantedAt: new Date(now).toISOString(), waitFor: 0 };
        }

        // 最も古い記録が窓から外れるまで待つ。`existing` は空ではない
        // (空なら上の分岐が必ず成立する)。
        return { grantedAt: null, waitFor: Math.max(5, WINDOW_MS - (now - existing[0]!) + 5) };
      });

      if (outcome.grantedAt) {
        return outcome.grantedAt;
      }

      await sleep(outcome.waitFor);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
