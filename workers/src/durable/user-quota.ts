import type { DurableObjectState } from "@cloudflare/workers-types";

interface QuotaBody {
  action: "state" | "checkChat" | "checkStock" | "consumeChat" | "consumeStock" | "checkCompanyAccess";
  quotaSubject: string;
  plan: "free" | "pro";
  dateJST: string;
  ticker?: string;
  chatLimit: number;
  stockLimit: number;
  previewTickers?: string[];
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
      const normalizedTicker = normalizeTicker(body.ticker);
      const alreadyTracked = normalizedTicker ? current.trackedTickers.includes(normalizedTicker) : false;
      const isPreviewTicker =
        normalizedTicker && Array.isArray(body.previewTickers)
          ? body.previewTickers.map(normalizeTicker).includes(normalizedTicker)
          : false;

      if (body.action === "checkChat") {
        if (current.chatsUsed >= current.chatLimit) {
          return { status: 429, payload: { error: "Daily chat quota exceeded", usage: usagePayload(current) } };
        }
        return { status: 200, payload: { usage: usagePayload(current) } };
      }

      if (body.action === "consumeChat") {
        if (current.chatsUsed >= current.chatLimit) {
          return { status: 429, payload: { error: "Daily chat quota exceeded", usage: usagePayload(current) } };
        }
        current.chatsUsed += 1;
      }

      if (body.action === "checkStock") {
        if (!alreadyTracked && current.stocksUsed >= current.stockLimit) {
          return { status: 429, payload: { error: "Watchlist limit exceeded", usage: usagePayload(current) } };
        }

        return { status: 200, payload: { usage: usagePayload(current) } };
      }

      if (body.action === "checkCompanyAccess") {
        if (body.plan === "pro" || alreadyTracked || isPreviewTicker) {
          return { status: 200, payload: { usage: usagePayload(current) } };
        }

        if (current.stocksUsed >= current.stockLimit) {
          return { status: 429, payload: { error: "Watchlist limit exceeded", usage: usagePayload(current) } };
        }

        return { status: 403, payload: { error: "Ticker access requires watchlist add", usage: usagePayload(current) } };
      }

      if (body.action === "consumeStock") {
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

function normalizeTicker(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}
