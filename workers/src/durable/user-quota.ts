import type { DurableObjectState } from "@cloudflare/workers-types";
import { QuotaRequestSchema } from "../lib/contracts";
import { isAppError } from "../lib/errors";
import { parseJsonBody } from "../lib/request";

const QUOTA_PAYLOAD_MAX_BYTES = 8_192;

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
    let body;
    try {
      body = await parseJsonBody(request, QuotaRequestSchema, {
        invalidMessage: "Invalid quota payload",
        maxBytes: QUOTA_PAYLOAD_MAX_BYTES,
        tooLargeMessage: "Quota payload is too large"
      });
    } catch (error) {
      if (!isAppError(error)) {
        throw error;
      }
      return this.reply({ error: error.publicMessage }, error.status);
    }

    const result = await this.state.blockConcurrencyWhile(async () => {
      const [dailyRecord, savedTickerRecord] = await Promise.all([
        this.loadDailyRecord(body.dateJST, body.plan, body.chatLimit),
        this.loadSavedTickerRecord(body.plan, body.stockLimit)
      ]);
      const currentUsage = () => usagePayload(dailyRecord, savedTickerRecord, body.accessMode);

      const normalizedTicker = normalizeTicker(body.ticker);
      const relatedTickers = buildTickerGroup(normalizedTicker, body.relatedTickers ?? []);
      const trackedTicker = findTrackedTicker(savedTickerRecord.savedTickers, relatedTickers);
      const alreadyTracked = trackedTicker !== null;
      let didMutate = false;

      if (body.action === "checkChat") {
        if (dailyRecord.chatsUsed >= dailyRecord.chatLimit) {
          return {
            status: 429,
            payload: { error: "Daily chat quota exceeded", usage: currentUsage(), didMutate }
          };
        }
        return { status: 200, payload: { usage: currentUsage(), didMutate } };
      }

      if (body.action === "consumeChat") {
        if (dailyRecord.chatsUsed >= dailyRecord.chatLimit) {
          return {
            status: 429,
            payload: { error: "Daily chat quota exceeded", usage: currentUsage(), didMutate }
          };
        }
        dailyRecord.chatsUsed += 1;
        didMutate = true;
      }

      if (body.action === "refundChat" && dailyRecord.chatsUsed > 0) {
        dailyRecord.chatsUsed -= 1;
        didMutate = true;
      }

      if (body.action === "checkStock") {
        if (!alreadyTracked && savedTickerRecord.savedTickers.length >= savedTickerRecord.stockLimit) {
          return {
            status: 429,
            payload: { error: "Watchlist limit exceeded", usage: currentUsage(), didMutate }
          };
        }

        return { status: 200, payload: { usage: currentUsage(), didMutate } };
      }

      if (body.action === "checkCompanyAccess") {
        return {
          status: 200,
          payload: { usage: currentUsage(), didMutate }
        };
      }

      if (body.action === "consumeStock") {
        if (!alreadyTracked) {
          if (savedTickerRecord.savedTickers.length >= savedTickerRecord.stockLimit) {
            return {
              status: 429,
              payload: { error: "Watchlist limit exceeded", usage: currentUsage(), didMutate }
            };
          }

          if (normalizedTicker) {
            savedTickerRecord.savedTickers.push(normalizedTicker);
            didMutate = true;
          }
        }
      }

      if (body.action === "promoteTicker" && normalizedTicker && trackedTicker && trackedTicker !== normalizedTicker) {
        savedTickerRecord.savedTickers = savedTickerRecord.savedTickers.map((ticker) =>
          ticker === trackedTicker ? normalizedTicker : ticker
        );
        didMutate = true;
      }

      if (body.action === "refundStock" && normalizedTicker) {
        const nextSavedTickers = savedTickerRecord.savedTickers.filter((ticker) => !relatedTickers.includes(ticker));
        didMutate = nextSavedTickers.length !== savedTickerRecord.savedTickers.length;
        savedTickerRecord.savedTickers = nextSavedTickers;
      }

      if (body.action === "removeTicker" && normalizedTicker) {
        const nextSavedTickers = savedTickerRecord.savedTickers.filter((ticker) => !relatedTickers.includes(ticker));
        didMutate = nextSavedTickers.length !== savedTickerRecord.savedTickers.length;
        savedTickerRecord.savedTickers = nextSavedTickers;
      }

      const now = new Date().toISOString();
      dailyRecord.updatedAt = now;
      savedTickerRecord.updatedAt = now;
      await Promise.all([
        this.state.storage.put(buildDailyKey(body.dateJST), dailyRecord),
        this.state.storage.put(SAVED_TICKERS_KEY, savedTickerRecord)
      ]);

      return { status: 200, payload: { usage: currentUsage(), didMutate } };
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
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
}

function usagePayload(dailyRecord: QuotaRecord, savedTickerRecord: SavedTickerRecord, accessMode?: string) {
  return {
    plan: dailyRecord.plan,
    accessMode,
    dateJST: dailyRecord.dateJST,
    chatsUsed: dailyRecord.chatsUsed,
    chatLimit: dailyRecord.chatLimit,
    stocksUsed: savedTickerRecord.savedTickers.length,
    stockLimit: savedTickerRecord.stockLimit,
    savedTickers: [...savedTickerRecord.savedTickers],
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

function buildTickerGroup(primaryTicker: string | null, relatedTickers: string[]): string[] {
  return normalizeTickerList(primaryTicker ? [primaryTicker, ...relatedTickers] : relatedTickers);
}

function findTrackedTicker(savedTickers: string[], tickerGroup: string[]): string | null {
  return savedTickers.find((ticker) => tickerGroup.includes(ticker)) ?? null;
}

function buildDailyKey(dateJST: string): string {
  return `${DAILY_KEY_PREFIX}${dateJST}`;
}

function maxIsoTimestamp(left: string, right: string): string {
  return left >= right ? left : right;
}
