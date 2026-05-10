import type { DurableObjectState } from "@cloudflare/workers-types";
import type { AccessPlan } from "../lib/billing-catalog";
import { QuotaRequestSchema } from "../lib/contracts";
import { isAppError } from "../lib/errors";
import { parseJsonBody } from "../lib/request";

const QUOTA_PAYLOAD_MAX_BYTES = 8_192;

interface QuotaRecord {
  plan: AccessPlan;
  dateJST: string;
  chatsUsed: number;
  chatLimit: number;
  updatedAt: string;
  trackedTickers?: string[];
}

interface SavedTickerRecord {
  plan: AccessPlan;
  stockLimit: number;
  savedTickers: string[];
  updatedAt: string;
  migratedFromLegacyAt?: string;
}

interface CreditStateRecord {
  plan: AccessPlan;
  periodStart: string;
  periodEnd: string;
  monthlyRemaining: number;
  monthlyLimit: number;
  rewardedAdRemaining?: number;
  rewardedAdExpiresAt?: string;
  purchasedRemaining: number;
  updatedAt: string;
}

interface CreditOperationRecord {
  operationId: string;
  type: "consume" | "refund" | "monthly_grant" | "purchase_grant" | "eval_grant" | "admob_rewarded_grant";
  status: "applied" | "insufficient" | "noop";
  delta: number;
  balanceAfter: number;
  monthlyBalanceAfter: number;
  rewardedAdBalanceAfter?: number;
  rewardedAdExpiresAt?: string;
  purchasedBalanceAfter: number;
  creditsRequired?: number;
  consumedMonthly?: number;
  consumedRewardedAd?: number;
  consumedPurchased?: number;
  originalOperationId?: string;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
  refundedBy?: string;
  refundedAt?: string;
}

interface PurchaseGrantRecord {
  transactionId: string;
  operation: CreditOperationRecord;
  productId: string;
  creditsGranted: number;
  originalTransactionId?: string;
  purchasedAt?: string;
  createdAt: string;
}

interface MonthlyGrantRecord {
  operationId: string;
  plan: AccessPlan;
  periodStart: string;
  periodEnd: string;
  creditsGranted: number;
  balanceAfter: number;
  monthlyBalanceAfter: number;
  purchasedBalanceAfter: number;
  createdAt: string;
}

interface ChatRefundRecord {
  operationId: string;
  dateJST: string;
  status: "applied" | "noop";
  chatsUsedAfter: number;
  createdAt: string;
}

interface RewardedAdDailyCapRecord {
  dateKey: string;
  count: number;
  transactionIds: string[];
  updatedAt: string;
}

const SAVED_TICKERS_KEY = "saved_tickers";
const CREDIT_STATE_KEY = "credit_state";
const CREDIT_OPERATION_PREFIX = "credit_operation:";
const MONTHLY_GRANT_PREFIX = "monthly_grant:";
const PURCHASE_TRANSACTION_PREFIX = "purchase_transaction:";
const CHAT_REFUND_PREFIX = "chat_refund:";
const REWARDED_AD_DAILY_CAP_PREFIX = "rewarded_ad_daily_cap:";
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
      const creditStateResult = await this.loadCreditState(
        body.dateJST,
        body.plan,
        body.monthlyCreditLimit ?? 0,
        {
          periodStart: body.monthlyCreditPeriodStart,
          periodEnd: body.monthlyCreditPeriodEnd,
          monthlyGrantOperationId: body.monthlyGrantOperationId
        }
      );
      const creditState = creditStateResult.creditState;
      const monthlyGrant = creditStateResult.monthlyGrant;
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
        if (monthlyGrant) {
          await this.saveMonthlyGrant(monthlyGrant);
        }
        return {
          status: creditResult.status,
          payload: {
            usage: currentUsage(),
            didMutate: creditResult.didMutate,
            creditOperation: creditResult.operation,
            monthlyGrant,
            error: creditResult.error,
            creditsRequired,
            creditsRemaining: totalCreditRemaining(creditState)
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
        if (monthlyGrant) {
          await this.saveMonthlyGrant(monthlyGrant);
        }
        return {
          status: 200,
          payload: {
            usage: currentUsage(),
            didMutate: creditResult.didMutate,
            creditOperation: creditResult.operation,
            monthlyGrant,
            creditsRemaining: totalCreditRemaining(creditState)
          }
        };
      }

      if (body.action === "grantPurchasedCredit") {
        const operationId = body.operationId;
        const transactionId = body.transactionId;
        const productId = body.productId;
        const purchaseCredits = body.purchaseCredits;
        if (!operationId || !transactionId || !productId || !purchaseCredits) {
          return {
            status: 400,
            payload: { error: "Invalid quota payload", usage: currentUsage(), didMutate }
          };
        }

        const creditResult = await this.grantPurchasedCredit({
          creditState,
          operationId,
          productId,
          transactionId,
          originalTransactionId: body.originalTransactionId,
          purchasedAt: body.purchasedAt,
          purchaseCredits
        });
        if (monthlyGrant) {
          await this.saveMonthlyGrant(monthlyGrant);
        }
        return {
          status: 200,
          payload: {
            usage: currentUsage(),
            didMutate: creditResult.didMutate,
            creditOperation: creditResult.operation,
            monthlyGrant,
            creditsRemaining: totalCreditRemaining(creditState)
          }
        };
      }

      if (body.action === "grantEvalCredit") {
        const operationId = body.operationId;
        const credits = body.credits;
        const referenceId = body.referenceId;
        if (!operationId || !credits || !referenceId) {
          return {
            status: 400,
            payload: { error: "Invalid quota payload", usage: currentUsage(), didMutate }
          };
        }

        const creditResult = await this.grantEvalCredit({
          creditState,
          operationId,
          credits,
          referenceId
        });
        if (monthlyGrant) {
          await this.saveMonthlyGrant(monthlyGrant);
        }
        return {
          status: 200,
          payload: {
            usage: currentUsage(),
            didMutate: creditResult.didMutate,
            creditOperation: creditResult.operation,
            monthlyGrant,
            creditsRemaining: totalCreditRemaining(creditState)
          }
        };
      }

      if (body.action === "grantRewardedAdCredit") {
        const operationId = body.operationId;
        const credits = body.credits;
        const referenceId = body.referenceId;
        const promoExpiresAt = body.promoExpiresAt;
        const transactionId = body.transactionId;
        const dailyRewardDateKey = body.dailyRewardDateKey;
        const dailyRewardCap = body.dailyRewardCap;
        if (!operationId || !credits || !referenceId || !promoExpiresAt || !transactionId || !dailyRewardDateKey || !dailyRewardCap) {
          return {
            status: 400,
            payload: { error: "Invalid quota payload", usage: currentUsage(), didMutate }
          };
        }

        const creditResult = await this.grantRewardedAdCredit({
          creditState,
          operationId,
          credits,
          referenceId,
          promoExpiresAt,
          transactionId,
          dailyRewardDateKey,
          dailyRewardCap
        });
        if (monthlyGrant) {
          await this.saveMonthlyGrant(monthlyGrant);
        }
        return {
          status: creditResult.status,
          payload: {
            usage: currentUsage(),
            didMutate: creditResult.didMutate,
            creditOperation: creditResult.operation,
            monthlyGrant,
            creditsRemaining: totalCreditRemaining(creditState),
            dailyRewardsUsed: creditResult.dailyRewardsUsed,
            dailyRewardsRemaining: creditResult.dailyRewardsRemaining,
            error: creditResult.error
          }
        };
      }

      if (body.action === "ensureMonthlyCreditGrant") {
        const now = new Date().toISOString();
        dailyRecord.updatedAt = now;
        savedTickerRecord.updatedAt = now;
        await Promise.all([
          this.state.storage.put(buildDailyKey(body.dateJST), dailyRecord),
          this.state.storage.put(SAVED_TICKERS_KEY, savedTickerRecord),
          this.state.storage.put(CREDIT_STATE_KEY, creditState),
          monthlyGrant ? this.saveMonthlyGrant(monthlyGrant) : Promise.resolve()
        ]);
        return {
          status: 200,
          payload: {
            usage: currentUsage(),
            didMutate: monthlyGrant ? true : didMutate,
            monthlyGrant,
            creditOperation: creditStateResult.monthlyAdjustment
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

      let pendingChatRefund: ChatRefundRecord | undefined;
      if (body.action === "refundChat") {
        const operationId = body.operationId;
        if (!operationId) {
          return {
            status: 400,
            payload: { error: "Invalid quota payload", usage: currentUsage(), didMutate }
          };
        }

        const existingRefund = await this.loadChatRefund(operationId);
        if (existingRefund) {
          await Promise.all([
            this.state.storage.put(buildDailyKey(body.dateJST), dailyRecord),
            this.state.storage.put(SAVED_TICKERS_KEY, savedTickerRecord),
            this.state.storage.put(CREDIT_STATE_KEY, creditState),
            monthlyGrant ? this.saveMonthlyGrant(monthlyGrant) : Promise.resolve()
          ]);
          return {
            status: 200,
            payload: { usage: currentUsage(), didMutate: false, monthlyGrant }
          };
        }

        const now = new Date().toISOString();
        if (dailyRecord.chatsUsed > 0) {
          dailyRecord.chatsUsed -= 1;
          didMutate = true;
        }
        pendingChatRefund = {
          operationId,
          dateJST: body.dateJST,
          status: didMutate ? "applied" : "noop",
          chatsUsedAfter: dailyRecord.chatsUsed,
          createdAt: now
        };
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
        this.state.storage.put(CREDIT_STATE_KEY, creditState),
        monthlyGrant ? this.saveMonthlyGrant(monthlyGrant) : Promise.resolve(),
        pendingChatRefund ? this.saveChatRefund(pendingChatRefund) : Promise.resolve()
      ]);

      return { status: 200, payload: { usage: currentUsage(), didMutate, monthlyGrant } };
    });

    return this.reply(result.payload, result.status);
  }

  private async loadDailyRecord(dateJST: string, plan: AccessPlan, chatLimit: number): Promise<QuotaRecord> {
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

  private async loadSavedTickerRecord(plan: AccessPlan, stockLimit: number): Promise<SavedTickerRecord> {
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
    plan: AccessPlan,
    monthlyCreditLimit: number,
    options: {
      periodStart?: string;
      periodEnd?: string;
      monthlyGrantOperationId?: string;
    } = {}
  ): Promise<{ creditState: CreditStateRecord; monthlyGrant?: MonthlyGrantRecord; monthlyAdjustment?: CreditOperationRecord }> {
    const period = buildCreditPeriod(dateJST, options);
    const now = new Date().toISOString();
    const existing = (await this.state.storage.get<CreditStateRecord>(CREDIT_STATE_KEY)) as
      | CreditStateRecord
      | undefined;

    if (!existing || existing.periodStart !== period.periodStart || existing.periodEnd !== period.periodEnd) {
      const creditState = {
        plan,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        monthlyRemaining: monthlyCreditLimit,
        monthlyLimit: monthlyCreditLimit,
        rewardedAdRemaining: nonExpiredRewardedAdRemaining(existing, now),
        rewardedAdExpiresAt: nonExpiredRewardedAdExpiresAt(existing, now),
        purchasedRemaining: existing?.purchasedRemaining ?? 0,
        updatedAt: now
      };
      return {
        creditState,
        monthlyGrant: await this.buildMonthlyGrantIfNeeded(
          creditState,
          monthlyCreditLimit,
          now,
          options.monthlyGrantOperationId
        )
      };
    }

    const previousMonthlyLimit = existing.monthlyLimit;
    const limitDelta = monthlyCreditLimit - previousMonthlyLimit;
    existing.plan = plan;
    expireRewardedAdCreditsIfNeeded(existing, now);
    let monthlyAdjustment: CreditOperationRecord | undefined;
    if (limitDelta > 0) {
      existing.monthlyLimit = monthlyCreditLimit;
      existing.monthlyRemaining = Math.max(0, Math.min(monthlyCreditLimit, existing.monthlyRemaining + limitDelta));
    } else if (limitDelta < 0) {
      existing.monthlyLimit = Math.max(previousMonthlyLimit, existing.monthlyRemaining);
      existing.monthlyRemaining = Math.max(0, existing.monthlyRemaining);
      monthlyAdjustment = await this.buildMonthlyNoClawbackOperationIfNeeded(
        existing,
        previousMonthlyLimit,
        monthlyCreditLimit,
        now,
        options.monthlyGrantOperationId
      );
    } else {
      existing.monthlyLimit = monthlyCreditLimit;
      existing.monthlyRemaining = Math.max(0, Math.min(monthlyCreditLimit, existing.monthlyRemaining));
    }
    existing.updatedAt = now;
    return {
      creditState: existing,
      monthlyGrant:
        limitDelta > 0
          ? await this.buildMonthlyGrantIfNeeded(existing, limitDelta, now, options.monthlyGrantOperationId)
          : undefined,
      monthlyAdjustment
    };
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

    const totalRemaining = totalCreditRemaining(creditState);
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
    const remainingAfterMonthly = creditsRequired - consumedMonthly;
    const consumedRewardedAd = Math.min(creditState.rewardedAdRemaining ?? 0, remainingAfterMonthly);
    const consumedPurchased = remainingAfterMonthly - consumedRewardedAd;
    creditState.monthlyRemaining -= consumedMonthly;
    creditState.rewardedAdRemaining = Math.max(0, (creditState.rewardedAdRemaining ?? 0) - consumedRewardedAd);
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
      consumedRewardedAd,
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
    const rewardedAdRefund = Math.min(original.consumedRewardedAd ?? 0, refundable - monthlyRefund);
    const purchasedRefund = Math.min(original.consumedPurchased ?? 0, refundable - monthlyRefund - rewardedAdRefund);
    creditState.monthlyRemaining = Math.min(creditState.monthlyLimit, creditState.monthlyRemaining + monthlyRefund);
    creditState.rewardedAdRemaining = (creditState.rewardedAdRemaining ?? 0) + rewardedAdRefund;
    creditState.purchasedRemaining += purchasedRefund;
    creditState.updatedAt = now;
    original.refundedBy = refundOperationId;
    original.refundedAt = now;
    const operation = buildCreditOperation({
      operationId: refundOperationId,
      type: "refund",
      status: "applied",
      delta: monthlyRefund + rewardedAdRefund + purchasedRefund,
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

  private async grantPurchasedCredit({
    creditState,
    operationId,
    productId,
    transactionId,
    originalTransactionId,
    purchasedAt,
    purchaseCredits
  }: {
    creditState: CreditStateRecord;
    operationId: string;
    productId: string;
    transactionId: string;
    originalTransactionId?: string;
    purchasedAt?: string;
    purchaseCredits: number;
  }): Promise<{ didMutate: boolean; operation: CreditOperationRecord }> {
    const existing = await this.loadPurchaseGrant(transactionId);
    if (existing) {
      return { didMutate: false, operation: existing.operation };
    }

    const now = new Date().toISOString();
    creditState.purchasedRemaining += purchaseCredits;
    creditState.updatedAt = now;
    const operation = buildCreditOperation({
      operationId,
      type: "purchase_grant",
      status: "applied",
      delta: purchaseCredits,
      creditState,
      referenceType: "purchase",
      referenceId: transactionId,
      createdAt: now
    });
    const grant: PurchaseGrantRecord = {
      transactionId,
      operation,
      productId,
      creditsGranted: purchaseCredits,
      originalTransactionId,
      purchasedAt,
      createdAt: now
    };
    await Promise.all([
      this.state.storage.put(CREDIT_STATE_KEY, creditState),
      this.saveCreditOperation(operation),
      this.savePurchaseGrant(grant)
    ]);
    await this.pruneOldCreditOperations(now);
    return { didMutate: true, operation };
  }

  private async grantEvalCredit({
    creditState,
    operationId,
    credits,
    referenceId
  }: {
    creditState: CreditStateRecord;
    operationId: string;
    credits: number;
    referenceId: string;
  }): Promise<{ didMutate: boolean; operation: CreditOperationRecord }> {
    const existing = await this.loadCreditOperation(operationId);
    if (existing) {
      return { didMutate: false, operation: existing };
    }

    const now = new Date().toISOString();
    creditState.purchasedRemaining += credits;
    creditState.updatedAt = now;
    const operation = buildCreditOperation({
      operationId,
      type: "eval_grant",
      status: "applied",
      delta: credits,
      creditState,
      referenceType: "eval_grant",
      referenceId,
      createdAt: now
    });
    await Promise.all([
      this.state.storage.put(CREDIT_STATE_KEY, creditState),
      this.saveCreditOperation(operation)
    ]);
    await this.pruneOldCreditOperations(now);
    return { didMutate: true, operation };
  }

  private async grantRewardedAdCredit({
    creditState,
    operationId,
    credits,
    referenceId,
    promoExpiresAt,
    transactionId,
    dailyRewardDateKey,
    dailyRewardCap
  }: {
    creditState: CreditStateRecord;
    operationId: string;
    credits: number;
    referenceId: string;
    promoExpiresAt: string;
    transactionId: string;
    dailyRewardDateKey: string;
    dailyRewardCap: number;
  }): Promise<{
    status: number;
    didMutate: boolean;
    operation: CreditOperationRecord;
    dailyRewardsUsed: number;
    dailyRewardsRemaining: number;
    error?: string;
  }> {
    const existing = await this.loadCreditOperation(operationId);
    const dailyCap = await this.loadRewardedAdDailyCap(dailyRewardDateKey);
    if (existing) {
      return {
        status: existing.status === "noop" ? 429 : 200,
        didMutate: false,
        operation: existing,
        dailyRewardsUsed: dailyCap.count,
        dailyRewardsRemaining: Math.max(0, dailyRewardCap - dailyCap.count),
        error: existing.status === "noop" ? "daily_cap_reached" : undefined
      };
    }

    const now = new Date().toISOString();
    if (dailyCap.count >= dailyRewardCap) {
      const operation = buildCreditOperation({
        operationId,
        type: "admob_rewarded_grant",
        status: "noop",
        delta: 0,
        creditState,
        referenceType: "admob_rewarded",
        referenceId,
        createdAt: now
      });
      await this.saveCreditOperation(operation);
      return {
        status: 429,
        didMutate: false,
        operation,
        dailyRewardsUsed: dailyCap.count,
        dailyRewardsRemaining: 0,
        error: "daily_cap_reached"
      };
    }

    creditState.rewardedAdRemaining = (creditState.rewardedAdRemaining ?? 0) + credits;
    creditState.rewardedAdExpiresAt = promoExpiresAt;
    creditState.updatedAt = now;
    dailyCap.count += 1;
    dailyCap.transactionIds = [...new Set([...dailyCap.transactionIds, transactionId])];
    dailyCap.updatedAt = now;
    const operation = buildCreditOperation({
      operationId,
      type: "admob_rewarded_grant",
      status: "applied",
      delta: credits,
      creditState,
      referenceType: "admob_rewarded",
      referenceId,
      createdAt: now
    });
    await Promise.all([
      this.state.storage.put(CREDIT_STATE_KEY, creditState),
      this.saveCreditOperation(operation),
      this.saveRewardedAdDailyCap(dailyCap)
    ]);
    await this.pruneOldCreditOperations(now);
    return {
      status: 200,
      didMutate: true,
      operation,
      dailyRewardsUsed: dailyCap.count,
      dailyRewardsRemaining: Math.max(0, dailyRewardCap - dailyCap.count)
    };
  }

  private async loadCreditOperation(operationId: string): Promise<CreditOperationRecord | undefined> {
    return (await this.state.storage.get<CreditOperationRecord>(buildCreditOperationKey(operationId))) as
      | CreditOperationRecord
      | undefined;
  }

  private async saveCreditOperation(operation: CreditOperationRecord): Promise<void> {
    await this.state.storage.put(buildCreditOperationKey(operation.operationId), operation);
  }

  private async loadPurchaseGrant(transactionId: string): Promise<PurchaseGrantRecord | undefined> {
    return (await this.state.storage.get<PurchaseGrantRecord>(buildPurchaseTransactionKey(transactionId))) as
      | PurchaseGrantRecord
      | undefined;
  }

  private async savePurchaseGrant(grant: PurchaseGrantRecord): Promise<void> {
    await this.state.storage.put(buildPurchaseTransactionKey(grant.transactionId), grant);
  }

  private async buildMonthlyGrantIfNeeded(
    creditState: CreditStateRecord,
    creditsGranted: number,
    createdAt: string,
    operationIdOverride?: string
  ): Promise<MonthlyGrantRecord | undefined> {
    if (creditsGranted <= 0) {
      return undefined;
    }

    const operationId =
      operationIdOverride ?? buildMonthlyGrantOperationId(creditState.plan, creditState.periodStart, creditState.periodEnd);
    const existing = (await this.state.storage.get<MonthlyGrantRecord>(buildMonthlyGrantKey(operationId))) as
      | MonthlyGrantRecord
      | undefined;
    if (existing) {
      return undefined;
    }

    return {
      operationId,
      plan: creditState.plan,
      periodStart: creditState.periodStart,
      periodEnd: creditState.periodEnd,
      creditsGranted,
      balanceAfter: totalCreditRemaining(creditState),
      monthlyBalanceAfter: creditState.monthlyRemaining,
      purchasedBalanceAfter: creditState.purchasedRemaining,
      createdAt
    };
  }

  private async saveMonthlyGrant(grant: MonthlyGrantRecord): Promise<void> {
    await this.state.storage.put(buildMonthlyGrantKey(grant.operationId), grant);
  }

  private async buildMonthlyNoClawbackOperationIfNeeded(
    creditState: CreditStateRecord,
    previousMonthlyLimit: number,
    requestedMonthlyLimit: number,
    createdAt: string,
    _operationIdOverride?: string
  ): Promise<CreditOperationRecord | undefined> {
    const operationId = buildMonthlyDowngradeNoClawbackOperationId(
      creditState.plan,
      previousMonthlyLimit,
      requestedMonthlyLimit,
      creditState.periodStart,
      creditState.periodEnd
    );
    const existing = await this.loadCreditOperation(operationId);
    if (existing) {
      return undefined;
    }

    const operation = buildCreditOperation({
      operationId,
      type: "monthly_grant",
      status: "noop",
      delta: 0,
      creditState,
      referenceType: "subscription_downgrade_no_clawback",
      referenceId: `${creditState.plan}:${previousMonthlyLimit}->${requestedMonthlyLimit}:${creditState.periodStart}:${creditState.periodEnd}`,
      createdAt
    });
    await this.saveCreditOperation(operation);
    return operation;
  }

  private async loadChatRefund(operationId: string): Promise<ChatRefundRecord | undefined> {
    return (await this.state.storage.get<ChatRefundRecord>(buildChatRefundKey(operationId))) as
      | ChatRefundRecord
      | undefined;
  }

  private async saveChatRefund(refund: ChatRefundRecord): Promise<void> {
    await this.state.storage.put(buildChatRefundKey(refund.operationId), refund);
  }

  private async loadRewardedAdDailyCap(dateKey: string): Promise<RewardedAdDailyCapRecord> {
    return (
      ((await this.state.storage.get<RewardedAdDailyCapRecord>(buildRewardedAdDailyCapKey(dateKey))) as
        | RewardedAdDailyCapRecord
        | undefined) ?? {
        dateKey,
        count: 0,
        transactionIds: [],
        updatedAt: new Date().toISOString()
      }
    );
  }

  private async saveRewardedAdDailyCap(record: RewardedAdDailyCapRecord): Promise<void> {
    await this.state.storage.put(buildRewardedAdDailyCapKey(record.dateKey), record);
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
  const totalRemaining = totalCreditRemaining(creditState);
  return {
    monthlyRemaining: creditState.monthlyRemaining,
    monthlyLimit: creditState.monthlyLimit,
    rewardedAdRemaining: creditState.rewardedAdRemaining ?? 0,
    rewardedAdExpiresAt: creditState.rewardedAdExpiresAt ?? null,
    purchasedRemaining: creditState.purchasedRemaining,
    totalRemaining,
    resetsAt: creditState.periodEnd
  };
}

function totalCreditRemaining(creditState: CreditStateRecord): number {
  return creditState.monthlyRemaining + (creditState.rewardedAdRemaining ?? 0) + creditState.purchasedRemaining;
}

function expireRewardedAdCreditsIfNeeded(creditState: CreditStateRecord, nowIso: string): void {
  const expiresAt = creditState.rewardedAdExpiresAt;
  if (!expiresAt || (creditState.rewardedAdRemaining ?? 0) <= 0) {
    creditState.rewardedAdRemaining = Math.max(0, creditState.rewardedAdRemaining ?? 0);
    return;
  }
  const expiresMs = Date.parse(expiresAt);
  const nowMs = Date.parse(nowIso);
  if (Number.isFinite(expiresMs) && Number.isFinite(nowMs) && expiresMs <= nowMs) {
    creditState.rewardedAdRemaining = 0;
    creditState.rewardedAdExpiresAt = undefined;
  }
}

function nonExpiredRewardedAdRemaining(existing: CreditStateRecord | undefined, nowIso: string): number {
  if (!existing) {
    return 0;
  }
  expireRewardedAdCreditsIfNeeded(existing, nowIso);
  return existing.rewardedAdRemaining ?? 0;
}

function nonExpiredRewardedAdExpiresAt(existing: CreditStateRecord | undefined, nowIso: string): string | undefined {
  if (!existing) {
    return undefined;
  }
  expireRewardedAdCreditsIfNeeded(existing, nowIso);
  return existing.rewardedAdExpiresAt;
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

function buildMonthlyGrantKey(operationId: string): string {
  return `${MONTHLY_GRANT_PREFIX}${operationId}`;
}

function buildPurchaseTransactionKey(transactionId: string): string {
  return `${PURCHASE_TRANSACTION_PREFIX}${transactionId}`;
}

function buildChatRefundKey(operationId: string): string {
  return `${CHAT_REFUND_PREFIX}${operationId}`;
}

function buildRewardedAdDailyCapKey(dateKey: string): string {
  return `${REWARDED_AD_DAILY_CAP_PREFIX}${dateKey}`;
}

function buildMonthlyGrantOperationId(plan: AccessPlan, periodStart: string, periodEnd: string): string {
  return `monthly-grant:${plan}:${periodStart}:${periodEnd}`;
}

function buildMonthlyDowngradeNoClawbackOperationId(
  plan: AccessPlan,
  previousMonthlyLimit: number,
  requestedMonthlyLimit: number,
  periodStart: string,
  periodEnd: string
): string {
  return `monthly-downgrade-no-clawback:${plan}:${previousMonthlyLimit}->${requestedMonthlyLimit}:${periodStart}:${periodEnd}`;
}

function maxIsoTimestamp(left: string, right: string): string {
  return left >= right ? left : right;
}

function buildCreditPeriod(
  dateJST: string,
  options: { periodStart?: string; periodEnd?: string } = {}
): { periodStart: string; periodEnd: string } {
  if (options.periodStart && options.periodEnd) {
    return {
      periodStart: options.periodStart,
      periodEnd: options.periodEnd
    };
  }

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
  consumedRewardedAd,
  consumedPurchased,
  originalOperationId,
  referenceType,
  referenceId,
  createdAt
}: {
  operationId: string;
  type: "consume" | "refund" | "monthly_grant" | "purchase_grant" | "eval_grant" | "admob_rewarded_grant";
  status: "applied" | "insufficient" | "noop";
  delta: number;
  creditState: CreditStateRecord;
  creditsRequired?: number;
  consumedMonthly?: number;
  consumedRewardedAd?: number;
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
    balanceAfter: totalCreditRemaining(creditState),
    monthlyBalanceAfter: creditState.monthlyRemaining,
    rewardedAdBalanceAfter: creditState.rewardedAdRemaining ?? 0,
    rewardedAdExpiresAt: creditState.rewardedAdExpiresAt,
    purchasedBalanceAfter: creditState.purchasedRemaining,
    creditsRequired,
    consumedMonthly,
    consumedRewardedAd,
    consumedPurchased,
    originalOperationId,
    referenceType,
    referenceId,
    createdAt
  };
}
