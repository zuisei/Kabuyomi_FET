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

interface CreditStateRecord {
  plan: "free" | "pro";
  periodStart: string;
  periodEnd: string;
  monthlyRemaining: number;
  monthlyLimit: number;
  purchasedRemaining: number;
  updatedAt: string;
}

interface CreditOperationRecord {
  operationId: string;
  type: "consume" | "refund";
  status: "applied" | "insufficient" | "noop";
  delta: number;
  balanceAfter: number;
  monthlyBalanceAfter: number;
  purchasedBalanceAfter: number;
  creditsRequired?: number;
  consumedMonthly?: number;
  consumedPurchased?: number;
  originalOperationId?: string;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
  refundedBy?: string;
  refundedAt?: string;
}

const SAVED_TICKERS_KEY = "saved_tickers";
const CREDIT_STATE_KEY = "credit_state";
const CREDIT_OPERATION_PREFIX = "credit_operation:";
const CREDIT_OPERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
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
      const creditState = await this.loadCreditState(body.dateJST, body.plan, body.monthlyCreditLimit ?? 0);
      const currentUsage = () => usagePayload(dailyRecord, savedTickerRecord, creditState, body.accessMode);

      const normalizedTicker = normalizeTicker(body.ticker);
      const relatedTickers = buildTickerGroup(normalizedTicker, body.relatedTickers ?? []);
      const trackedTicker = findTrackedTicker(savedTickerRecord.savedTickers, relatedTickers);
      const alreadyTracked = trackedTicker !== null;
      let didMutate = false;

      if (body.action === "consumeCredit") {
        const operationId = body.operationId;
        const creditsRequired = body.creditsRequired;
        if (!operationId || !creditsRequired) {
          return {
            status: 400,
            payload: { error: "Invalid quota payload", usage: currentUsage(), didMutate }
          };
        }

        const creditResult = await this.consumeCredit({
          creditState,
          operationId,
          creditsRequired,
          referenceType: body.referenceType,
          referenceId: body.referenceId
        });
        return {
          status: creditResult.status,
          payload: {
            usage: currentUsage(),
            didMutate: creditResult.didMutate,
            creditOperation: creditResult.operation,
            error: creditResult.error,
            creditsRequired,
            creditsRemaining: creditState.monthlyRemaining + creditState.purchasedRemaining
          }
        };
      }

      if (body.action === "refundCredit") {
        const refundOperationId = body.operationId;
        const originalOperationId = body.originalOperationId;
        const credits = body.credits;
        if (!refundOperationId || !originalOperationId || !credits) {
          return {
            status: 400,
            payload: { error: "Invalid quota payload", usage: currentUsage(), didMutate }
          };
        }

        const creditResult = await this.refundCredit({
          creditState,
          refundOperationId,
          originalOperationId,
          credits,
          referenceType: body.referenceType,
          referenceId: body.referenceId
        });
        return {
          status: 200,
          payload: {
            usage: currentUsage(),
            didMutate: creditResult.didMutate,
            creditOperation: creditResult.operation,
            creditsRemaining: creditState.monthlyRemaining + creditState.purchasedRemaining
          }
        };
      }

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
        this.state.storage.put(SAVED_TICKERS_KEY, savedTickerRecord),
        this.state.storage.put(CREDIT_STATE_KEY, creditState)
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

  private async loadCreditState(
    dateJST: string,
    plan: "free" | "pro",
    monthlyCreditLimit: number
  ): Promise<CreditStateRecord> {
    const period = buildCreditPeriod(dateJST);
    const now = new Date().toISOString();
    const existing = (await this.state.storage.get<CreditStateRecord>(CREDIT_STATE_KEY)) as
      | CreditStateRecord
      | undefined;

    if (!existing || existing.periodStart !== period.periodStart || existing.periodEnd !== period.periodEnd) {
      return {
        plan,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        monthlyRemaining: monthlyCreditLimit,
        monthlyLimit: monthlyCreditLimit,
        purchasedRemaining: existing?.purchasedRemaining ?? 0,
        updatedAt: now
      };
    }

    const limitDelta = monthlyCreditLimit - existing.monthlyLimit;
    existing.plan = plan;
    existing.monthlyLimit = monthlyCreditLimit;
    existing.monthlyRemaining = Math.max(0, Math.min(monthlyCreditLimit, existing.monthlyRemaining + limitDelta));
    existing.updatedAt = now;
    return existing;
  }

  private async consumeCredit({
    creditState,
    operationId,
    creditsRequired,
    referenceType,
    referenceId
  }: {
    creditState: CreditStateRecord;
    operationId: string;
    creditsRequired: number;
    referenceType?: string;
    referenceId?: string;
  }): Promise<{ status: number; didMutate: boolean; operation: CreditOperationRecord; error?: string }> {
    const existing = await this.loadCreditOperation(operationId);
    if (existing) {
      return {
        status: existing.status === "insufficient" ? 402 : 200,
        didMutate: false,
        operation: existing,
        error: existing.status === "insufficient" ? "insufficient_credits" : undefined
      };
    }

    const totalRemaining = creditState.monthlyRemaining + creditState.purchasedRemaining;
    const now = new Date().toISOString();
    if (totalRemaining < creditsRequired) {
      const operation = buildCreditOperation({
        operationId,
        type: "consume",
        status: "insufficient",
        delta: 0,
        creditState,
        creditsRequired,
        referenceType,
        referenceId,
        createdAt: now
      });
      await this.saveCreditOperation(operation);
      return {
        status: 402,
        didMutate: false,
        operation,
        error: "insufficient_credits"
      };
    }

    const consumedMonthly = Math.min(creditState.monthlyRemaining, creditsRequired);
    const consumedPurchased = creditsRequired - consumedMonthly;
    creditState.monthlyRemaining -= consumedMonthly;
    creditState.purchasedRemaining -= consumedPurchased;
    creditState.updatedAt = now;
    const operation = buildCreditOperation({
      operationId,
      type: "consume",
      status: "applied",
      delta: -creditsRequired,
      creditState,
      creditsRequired,
      consumedMonthly,
      consumedPurchased,
      referenceType,
      referenceId,
      createdAt: now
    });
    await Promise.all([this.state.storage.put(CREDIT_STATE_KEY, creditState), this.saveCreditOperation(operation)]);
    await this.pruneOldCreditOperations(now);
    return {
      status: 200,
      didMutate: true,
      operation
    };
  }

  private async refundCredit({
    creditState,
    refundOperationId,
    originalOperationId,
    credits,
    referenceType,
    referenceId
  }: {
    creditState: CreditStateRecord;
    refundOperationId: string;
    originalOperationId: string;
    credits: number;
    referenceType?: string;
    referenceId?: string;
  }): Promise<{ didMutate: boolean; operation: CreditOperationRecord }> {
    const existingRefund = await this.loadCreditOperation(refundOperationId);
    if (existingRefund) {
      return { didMutate: false, operation: existingRefund };
    }

    const now = new Date().toISOString();
    const original = await this.loadCreditOperation(originalOperationId);
    if (!original || original.type !== "consume" || original.status !== "applied" || original.refundedBy) {
      const operation = buildCreditOperation({
        operationId: refundOperationId,
        type: "refund",
        status: "noop",
        delta: 0,
        creditState,
        originalOperationId,
        referenceType,
        referenceId,
        createdAt: now
      });
      await this.saveCreditOperation(operation);
      return { didMutate: false, operation };
    }

    const refundable = Math.min(credits, original.creditsRequired ?? 0);
    const monthlyRefund = Math.min(original.consumedMonthly ?? 0, refundable);
    const purchasedRefund = Math.min(original.consumedPurchased ?? 0, refundable - monthlyRefund);
    creditState.monthlyRemaining = Math.min(creditState.monthlyLimit, creditState.monthlyRemaining + monthlyRefund);
    creditState.purchasedRemaining += purchasedRefund;
    creditState.updatedAt = now;
    original.refundedBy = refundOperationId;
    original.refundedAt = now;
    const operation = buildCreditOperation({
      operationId: refundOperationId,
      type: "refund",
      status: "applied",
      delta: monthlyRefund + purchasedRefund,
      creditState,
      originalOperationId,
      referenceType,
      referenceId,
      createdAt: now
    });
    await Promise.all([
      this.state.storage.put(CREDIT_STATE_KEY, creditState),
      this.saveCreditOperation(original),
      this.saveCreditOperation(operation)
    ]);
    await this.pruneOldCreditOperations(now);
    return { didMutate: true, operation };
  }

  private async loadCreditOperation(operationId: string): Promise<CreditOperationRecord | undefined> {
    return (await this.state.storage.get<CreditOperationRecord>(buildCreditOperationKey(operationId))) as
      | CreditOperationRecord
      | undefined;
  }

  private async saveCreditOperation(operation: CreditOperationRecord): Promise<void> {
    await this.state.storage.put(buildCreditOperationKey(operation.operationId), operation);
  }

  private async pruneOldCreditOperations(nowIso: string): Promise<void> {
    const cutoffMs = Date.parse(nowIso) - CREDIT_OPERATION_RETENTION_MS;
    if (!Number.isFinite(cutoffMs)) {
      return;
    }

    const entries = await this.state.storage.list<CreditOperationRecord>({
      prefix: CREDIT_OPERATION_PREFIX,
      limit: 500
    });

    for (const [key, operation] of entries) {
      const createdAtMs = Date.parse(operation?.createdAt ?? "");
      if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
        await this.state.storage.delete(key);
      }
    }
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

function usagePayload(
  dailyRecord: QuotaRecord,
  savedTickerRecord: SavedTickerRecord,
  creditState: CreditStateRecord,
  accessMode?: string
) {
  return {
    plan: dailyRecord.plan,
    accessMode,
    dateJST: dailyRecord.dateJST,
    chatsUsed: dailyRecord.chatsUsed,
    chatLimit: dailyRecord.chatLimit,
    stocksUsed: savedTickerRecord.savedTickers.length,
    stockLimit: savedTickerRecord.stockLimit,
    savedTickers: [...savedTickerRecord.savedTickers],
    credits: creditUsagePayload(creditState),
    updatedAt: maxIsoTimestamp(dailyRecord.updatedAt, savedTickerRecord.updatedAt)
  };
}

function creditUsagePayload(creditState: CreditStateRecord) {
  const totalRemaining = creditState.monthlyRemaining + creditState.purchasedRemaining;
  return {
    monthlyRemaining: creditState.monthlyRemaining,
    monthlyLimit: creditState.monthlyLimit,
    purchasedRemaining: creditState.purchasedRemaining,
    totalRemaining,
    resetsAt: creditState.periodEnd
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

function buildCreditOperationKey(operationId: string): string {
  return `${CREDIT_OPERATION_PREFIX}${operationId}`;
}

function maxIsoTimestamp(left: string, right: string): string {
  return left >= right ? left : right;
}

function buildCreditPeriod(dateJST: string): { periodStart: string; periodEnd: string } {
  const [yearPart, monthPart] = dateJST.split("-");
  const year = Number.parseInt(yearPart ?? "", 10);
  const month = Number.parseInt(monthPart ?? "", 10);
  const safeYear = Number.isFinite(year) ? year : 1970;
  const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1;
  const nextYear = safeMonth === 12 ? safeYear + 1 : safeYear;
  const nextMonth = safeMonth === 12 ? 1 : safeMonth + 1;
  return {
    periodStart: `${safeYear.toString().padStart(4, "0")}-${safeMonth.toString().padStart(2, "0")}-01T00:00:00+09:00`,
    periodEnd: `${nextYear.toString().padStart(4, "0")}-${nextMonth.toString().padStart(2, "0")}-01T00:00:00+09:00`
  };
}

function buildCreditOperation({
  operationId,
  type,
  status,
  delta,
  creditState,
  creditsRequired,
  consumedMonthly,
  consumedPurchased,
  originalOperationId,
  referenceType,
  referenceId,
  createdAt
}: {
  operationId: string;
  type: "consume" | "refund";
  status: "applied" | "insufficient" | "noop";
  delta: number;
  creditState: CreditStateRecord;
  creditsRequired?: number;
  consumedMonthly?: number;
  consumedPurchased?: number;
  originalOperationId?: string;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
}): CreditOperationRecord {
  return {
    operationId,
    type,
    status,
    delta,
    balanceAfter: creditState.monthlyRemaining + creditState.purchasedRemaining,
    monthlyBalanceAfter: creditState.monthlyRemaining,
    purchasedBalanceAfter: creditState.purchasedRemaining,
    creditsRequired,
    consumedMonthly,
    consumedPurchased,
    originalOperationId,
    referenceType,
    referenceId,
    createdAt
  };
}
