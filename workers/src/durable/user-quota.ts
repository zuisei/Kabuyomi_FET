import type { DurableObjectState } from "@cloudflare/workers-types";
import { QuotaRequestSchema } from "../lib/contracts";

interface QuotaRecord {
  plan: "free" | "pro";
  dateJST: string;
  chatsUsed: number;
  chatLimit: number;
  updatedAt: string;
  trackedTickers?: string[];
}

interface SavedTickerRecord {
  plan: "free" | "pro";
  stockLimit: number;
  savedTickers: string[];
  updatedAt: string;
  migratedFromLegacyAt?: string;
}

const SAVED_TICKERS_KEY = "saved_tickers";
const DAILY_KEY_PREFIX = "daily:";
const LEGACY_DAILY_KEY_LIMIT = 30;

export class UserQuotaDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return this.reply({ error: "Invalid quota payload" }, 400);
    }

    const parsed = QuotaRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return this.reply({ error: "Invalid quota payload" }, 400);
    }

    const body = parsed.data;
    const result = await this.state.blockConcurrencyWhile(async () => {
      const [dailyRecord, savedTickerRecord] = await Promise.all([
        this.loadDailyRecord(body.dateJST, body.plan, body.chatLimit),
        this.loadSavedTickerRecord(body.plan, body.stockLimit)
      ]);

      const normalizedTicker = normalizeTicker(body.ticker);
      const alreadyTracked = normalizedTicker ? savedTickerRecord.savedTickers.includes(normalizedTicker) : false;
      const isPreviewTicker =
        normalizedTicker && Array.isArray(body.previewTickers)
          ? body.previewTickers.map(normalizeTicker).includes(normalizedTicker)
          : false;

      if (body.action === "checkChat") {
        if (dailyRecord.chatsUsed >= dailyRecord.chatLimit) {
          return {
            status: 429,
            payload: { error: "Daily chat quota exceeded", usage: usagePayload(dailyRecord, savedTickerRecord) }
          };
        }
        return { status: 200, payload: { usage: usagePayload(dailyRecord, savedTickerRecord) } };
      }

      if (body.action === "consumeChat") {
        if (dailyRecord.chatsUsed >= dailyRecord.chatLimit) {
          return {
            status: 429,
            payload: { error: "Daily chat quota exceeded", usage: usagePayload(dailyRecord, savedTickerRecord) }
          };
        }
        dailyRecord.chatsUsed += 1;
      }

      if (body.action === "checkStock") {
        if (!alreadyTracked && savedTickerRecord.savedTickers.length >= savedTickerRecord.stockLimit) {
          return {
            status: 429,
            payload: { error: "Watchlist limit exceeded", usage: usagePayload(dailyRecord, savedTickerRecord) }
          };
        }

        return { status: 200, payload: { usage: usagePayload(dailyRecord, savedTickerRecord) } };
      }

      if (body.action === "checkCompanyAccess") {
        if (body.plan === "pro" || alreadyTracked || isPreviewTicker) {
          return { status: 200, payload: { usage: usagePayload(dailyRecord, savedTickerRecord) } };
        }

        if (savedTickerRecord.savedTickers.length >= savedTickerRecord.stockLimit) {
          return {
            status: 429,
            payload: { error: "Watchlist limit exceeded", usage: usagePayload(dailyRecord, savedTickerRecord) }
          };
        }

        return {
          status: 403,
          payload: { error: "Ticker access requires watchlist add", usage: usagePayload(dailyRecord, savedTickerRecord) }
        };
      }

      if (body.action === "consumeStock") {
        if (!alreadyTracked) {
          if (savedTickerRecord.savedTickers.length >= savedTickerRecord.stockLimit) {
            return {
              status: 429,
              payload: { error: "Watchlist limit exceeded", usage: usagePayload(dailyRecord, savedTickerRecord) }
            };
          }

          if (normalizedTicker) {
            savedTickerRecord.savedTickers.push(normalizedTicker);
          }
        }
      }

      if (body.action === "removeTicker" && normalizedTicker) {
        savedTickerRecord.savedTickers = savedTickerRecord.savedTickers.filter((ticker) => ticker !== normalizedTicker);
      }

      const now = new Date().toISOString();
      dailyRecord.updatedAt = now;
      savedTickerRecord.updatedAt = now;
      await Promise.all([
        this.state.storage.put(buildDailyKey(body.dateJST), dailyRecord),
        this.state.storage.put(SAVED_TICKERS_KEY, savedTickerRecord)
      ]);

      return { status: 200, payload: { usage: usagePayload(dailyRecord, savedTickerRecord) } };
    });

    return this.reply(result.payload, result.status);
  }

  private async loadDailyRecord(dateJST: string, plan: "free" | "pro", chatLimit: number): Promise<QuotaRecord> {
    const current =
      ((await this.state.storage.get<QuotaRecord>(buildDailyKey(dateJST))) as QuotaRecord | undefined) ?? {
        plan,
        dateJST,
        chatsUsed: 0,
        chatLimit,
        updatedAt: new Date().toISOString()
      };

    current.plan = plan;
    current.dateJST = dateJST;
    current.chatLimit = chatLimit;
    return current;
  }

  private async loadSavedTickerRecord(plan: "free" | "pro", stockLimit: number): Promise<SavedTickerRecord> {
    const existing = (await this.state.storage.get<SavedTickerRecord>(SAVED_TICKERS_KEY)) as SavedTickerRecord | undefined;
    if (existing) {
      existing.plan = plan;
      existing.stockLimit = stockLimit;
      existing.savedTickers = normalizeTickerList(existing.savedTickers);
      return existing;
    }

    const legacyTrackedTickers = await this.findLegacyTrackedTickers();
    const now = new Date().toISOString();
    const created: SavedTickerRecord = {
      plan,
      stockLimit,
      savedTickers: legacyTrackedTickers.slice(0, stockLimit),
      updatedAt: now,
      migratedFromLegacyAt: legacyTrackedTickers.length > 0 ? now : undefined
    };
    await this.state.storage.put(SAVED_TICKERS_KEY, created);
    return created;
  }

  private async findLegacyTrackedTickers(): Promise<string[]> {
    const entries = await this.state.storage.list<QuotaRecord>({
      prefix: DAILY_KEY_PREFIX,
      reverse: true,
      limit: LEGACY_DAILY_KEY_LIMIT
    });

    for (const [, record] of entries) {
      const normalized = normalizeTickerList(record?.trackedTickers ?? []);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    return [];
  }

  private reply(payload: unknown, status: number): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" }
    });
  }
}

function usagePayload(dailyRecord: QuotaRecord, savedTickerRecord: SavedTickerRecord) {
  return {
    plan: dailyRecord.plan,
    dateJST: dailyRecord.dateJST,
    chatsUsed: dailyRecord.chatsUsed,
    chatLimit: dailyRecord.chatLimit,
    stocksUsed: savedTickerRecord.savedTickers.length,
    stockLimit: savedTickerRecord.stockLimit,
    updatedAt: maxIsoTimestamp(dailyRecord.updatedAt, savedTickerRecord.updatedAt)
  };
}

function normalizeTicker(value: string | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized ? normalized : null;
}

function normalizeTickerList(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const ticker = normalizeTicker(value);
    if (!ticker || seen.has(ticker)) {
      continue;
    }
    seen.add(ticker);
    normalized.push(ticker);
  }

  return normalized;
}

function buildDailyKey(dateJST: string): string {
  return `${DAILY_KEY_PREFIX}${dateJST}`;
}

function maxIsoTimestamp(left: string, right: string): string {
  return left >= right ? left : right;
}
