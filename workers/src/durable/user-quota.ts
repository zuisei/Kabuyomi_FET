import type { DurableObjectState } from "@cloudflare/workers-types";

interface QuotaBody {
  action: "state" | "consumeChat" | "consumeStock";
  quotaSubject: string;
  plan: "free" | "pro";
  dateJST: string;
  ticker?: string;
  chatLimit: number;
  stockLimit: number;
}

interface QuotaRecord {
  plan: "free" | "pro";
  dateJST: string;
  chatsUsed: number;
  chatLimit: number;
  stocksUsed: number;
  stockLimit: number;
  trackedTickers: string[];
  updatedAt: string;
}

export class UserQuotaDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as QuotaBody;
    const result = await this.state.blockConcurrencyWhile(async () => {
      const key = `${body.dateJST}:${body.quotaSubject}`;
      const current =
        ((await this.state.storage.get<QuotaRecord>(key)) as QuotaRecord | undefined) ?? {
          plan: body.plan,
          dateJST: body.dateJST,
          chatsUsed: 0,
          chatLimit: body.chatLimit,
          stocksUsed: 0,
          stockLimit: body.stockLimit,
          trackedTickers: [],
          updatedAt: new Date().toISOString()
        };

      current.plan = body.plan;
      current.chatLimit = body.chatLimit;
      current.stockLimit = body.stockLimit;
      current.trackedTickers = current.trackedTickers ?? [];

      if (body.action === "consumeChat") {
        if (current.chatsUsed >= current.chatLimit) {
          return { status: 429, payload: { error: "Daily chat quota exceeded", usage: usagePayload(current) } };
        }
        current.chatsUsed += 1;
      }

      if (body.action === "consumeStock") {
        const normalizedTicker = body.ticker?.trim().toUpperCase();
        const alreadyTracked = normalizedTicker ? current.trackedTickers.includes(normalizedTicker) : false;

        if (!alreadyTracked) {
          if (current.stocksUsed >= current.stockLimit) {
            return { status: 429, payload: { error: "Watchlist limit exceeded", usage: usagePayload(current) } };
          }

          current.stocksUsed += 1;
          if (normalizedTicker) {
            current.trackedTickers.push(normalizedTicker);
          }
        }
      }

      current.updatedAt = new Date().toISOString();
      await this.state.storage.put(key, current);
      return { status: 200, payload: { usage: usagePayload(current) } };
    });

    return this.reply(result.payload, result.status);
  }

  private reply(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" }
    });
  }
}

function usagePayload(record: QuotaRecord) {
  return {
    plan: record.plan,
    dateJST: record.dateJST,
    chatsUsed: record.chatsUsed,
    chatLimit: record.chatLimit,
    stocksUsed: record.stocksUsed,
    stockLimit: record.stockLimit,
    updatedAt: record.updatedAt
  };
}
