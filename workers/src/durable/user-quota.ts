import type {
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectTransaction
} from "@cloudflare/workers-types";
import type { z } from "zod";
import type { AccessPlan } from "../lib/billing-catalog";
import {
  PurchaseCreditAdjustmentRequestSchema,
  QuotaRequestSchema,
  RequestExecutionRequestSchema
} from "../lib/contracts";
import { AppError, isAppError } from "../lib/errors";
import { hashForLog, logEvent, suffixForLog } from "../lib/logging";
import { parseJsonBody } from "../lib/request";

const QUOTA_PAYLOAD_MAX_BYTES = 8_192;
const REQUEST_EXECUTION_PAYLOAD_MAX_BYTES = 128 * 1_024;
const REQUEST_EXECUTION_PENDING_TTL_MS = 5 * 60 * 1_000;
const REQUEST_EXECUTION_RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
// Terminal execution records move with the balance so exact retries keep their
// replay/failure semantics after the principal changes. This endpoint is only
// reached over the internal Durable Object binding, not from a public request.
const PRINCIPAL_MIGRATION_PAYLOAD_MAX_BYTES = 8 * 1_024 * 1_024;
const PRINCIPAL_MIGRATION_MARKER_KEY = "principal_migration:applied";
const PRINCIPAL_MIGRATION_TOMBSTONE_KEY = "principal_migration:tombstone";
const PRINCIPAL_MIGRATION_LOCK_KEY = "principal_migration:lock";

type RequestExecutionRequest = z.infer<typeof RequestExecutionRequestSchema>;
type RequestExecutionRoute = RequestExecutionRequest["route"];
type RequestExecutionDetails = Record<string, string | number | boolean | null>;
type RequestExecutionReservationIntent = Extract<RequestExecutionRequest, { action: "begin" }>["reservation"];
type RequestExecutionStorage = Pick<
  DurableObjectStorage | DurableObjectTransaction,
  "get" | "put" | "delete" | "list" | "getAlarm" | "setAlarm" | "deleteAlarm"
>;

interface RequestExecutionRecord {
  operationId: string;
  requestHash: string;
  route: RequestExecutionRoute;
  status: "pending" | "completed" | "failed";
  executionPolicyVersion: string;
  configSnapshot: RequestExecutionDetails;
  createdAt: string;
  pendingExpiresAt: string;
  completedAt?: string;
  resultExpiresAt?: string;
  resultBody?: Record<string, unknown>;
  resultMetadata?: RequestExecutionDetails;
  failedAt?: string;
  failureCode?: string;
  failureStatus?: number;
  failureDetails?: RequestExecutionDetails;
  stateVersion?: 1 | 2;
  reservationId?: string;
}

interface RequestExecutionMutationResult {
  status: number;
  payload: Record<string, unknown>;
}

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
  rewardedAdLots?: RewardedAdCreditLot[];
  welcomeRemaining?: number;
  welcomeGrantedAt?: string;
  welcomeGrantOperationId?: string;
  welcomeMigrationVersion?: 1;
  purchasedRemaining: number;
  purchasedRefundDebt?: number;
  updatedAt: string;
}

interface RewardedAdCreditLot {
  lotId: string;
  remaining: number;
  expiresAt: string | null;
}

interface CreditReservationAllocations {
  monthly?: {
    credits: number;
    periodStart: string;
    periodEnd: string;
  };
  rewardedAd: Array<{
    lotId: string;
    credits: number;
    expiresAt: string | null;
  }>;
  welcome?: { credits: number };
  purchased?: {
    credits: number;
  };
  legacyChat?: {
    slots: 1;
    dateJST: string;
    dailyKey: string;
  };
}

interface CreditReservationRecord {
  reservationId: string;
  operationId: string;
  requestHash: string;
  route: RequestExecutionRoute;
  mode: "credits" | "legacy_chat" | "unmetered";
  credits: number;
  legacyChatSlots: 0 | 1;
  allocations: CreditReservationAllocations;
  referenceType?: string;
  referenceId?: string;
  monthlyGrant?: MonthlyGrantRecord;
  status: "reserved" | "committed" | "released" | "expired";
  createdAt: string;
  expiresAt: string;
  dueIndexKey: string;
  committedAt?: string;
  releasedAt?: string;
  expiredAt?: string;
  releaseReason?: string;
}

interface CreditOperationRecord {
  operationId: string;
  type:
    | "consume"
    | "refund"
    | "monthly_grant"
    | "purchase_grant"
    | "purchase_refund"
    | "purchase_refund_reversal"
    | "eval_grant"
    | "admob_rewarded_grant";
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
  consumedWelcome?: number;
  consumedPurchased?: number;
  consumedMonthlyPeriodStart?: string;
  consumedMonthlyPeriodEnd?: string;
  consumedRewardedAdLots?: Array<{
    lotId: string;
    credits: number;
    expiresAt: string | null;
  }>;
  originalOperationId?: string;
  referenceType?: string;
  referenceId?: string;
  purchaseRefundDebtAfter?: number;
  purchaseDebtOffset?: number;
  refundAvailableRemoved?: number;
  refundDebtCreated?: number;
  refundDebtReleased?: number;
  refundDebtSettledRestored?: number;
  refundCreditsRestored?: number;
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
  refund?: {
    state: "refunded" | "reinstated";
    availableRemoved: number;
    debtCreated: number;
    debtOutstanding: number;
    notificationId: string;
    refundedAt: string;
    operation: CreditOperationRecord;
    reversedAt?: string;
    reversalNotificationId?: string;
    reversalOperation?: CreditOperationRecord;
  };
}

interface PurchaseCreditAdjustmentResult {
  outcome: "unclaimed" | "refunded" | "reinstated" | "already_reinstated" | "not_refunded";
  didMutate: boolean;
  purchaseState: "unclaimed" | "granted" | "refunded" | "reinstated";
  operation?: CreditOperationRecord;
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

interface PrincipalMigrationSnapshot {
  version: 1;
  creditState: CreditStateRecord | null;
  purchaseRecords: Array<[string, unknown]>;
  monthlyGrantRecords: Array<[string, unknown]>;
  creditOperationRecords: Array<[string, unknown]>;
  requestExecutionRecords?: Array<[string, unknown]>;
  creditReservationRecords?: Array<[string, unknown]>;
  exportedAt: string;
}

interface PrincipalMigrationMarker {
  migrationId: string;
  sourceSnapshotDigest: string;
  sourceQuotaSubjectHash: string;
  appliedAt: string;
}

interface PrincipalMigrationLock {
  migrationId: string;
  lockedAt: string;
  sourceSnapshotDigest: string;
}

interface PrincipalMigrationTombstone extends PrincipalMigrationLock {
  targetPrincipal: string;
  migratedAt: string;
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
const REQUEST_EXECUTION_PREFIX = "request_execution:";
const CREDIT_RESERVATION_PREFIX = "credit_reservation:";
const CREDIT_RESERVATION_DUE_PREFIX = "credit_reservation_due:";
const CREDIT_OPERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const CREDIT_OPERATION_PRUNE_PAGE_SIZE = 500;
// Bounds the work one mutation can do. 20 pages covers 10,000 operations, far
// past the 30-day retention window for any real account, while keeping a single
// request from scanning without limit.
const CREDIT_OPERATION_PRUNE_MAX_PAGES = 20;
const DAILY_KEY_PREFIX = "daily:";
const LEGACY_DAILY_KEY_LIMIT = 30;
const WELCOME_CREDIT_AMOUNT = 50;

export class UserQuotaDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/request-execution") {
      return this.handleRequestExecution(request);
    }
    if (new URL(request.url).pathname === "/principal-migration") {
      return this.handlePrincipalMigration(request);
    }
    if (new URL(request.url).pathname === "/purchase-adjustment") {
      return this.handlePurchaseCreditAdjustment(request);
    }

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
      const [tombstone, migrationLock] = await Promise.all([
        this.state.storage.get<PrincipalMigrationTombstone>(PRINCIPAL_MIGRATION_TOMBSTONE_KEY),
        this.state.storage.get<PrincipalMigrationLock>(PRINCIPAL_MIGRATION_LOCK_KEY)
      ]);
      if (tombstone) {
        return {
          status: 409,
          payload: {
            error: "quota_principal_migrated",
            targetPrincipal: tombstone.targetPrincipal,
            migrationId: tombstone.migrationId
          }
        };
      }
      if (migrationLock) {
        return {
          status: 423,
          payload: {
            error: "quota_principal_migration_locked",
            migrationId: migrationLock.migrationId
          }
        };
      }
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
          monthlyGrantOperationId: body.monthlyGrantOperationId,
          welcomeEligible: body.accessMode === "verified_installation"
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

        let creditResult;
        try {
          creditResult = await this.grantPurchasedCredit({
            creditState,
            operationId,
            productId,
            transactionId,
            originalTransactionId: body.originalTransactionId,
            purchasedAt: body.purchasedAt,
            purchaseCredits
          });
        } catch (error) {
          if (!isAppError(error)) throw error;
          return {
            status: error.status,
            payload: { error: error.publicMessage, usage: currentUsage(), didMutate: false }
          };
        }
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

  private async handlePurchaseCreditAdjustment(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return this.reply({ error: "Method not allowed" }, 405);
    }

    let body;
    try {
      body = await parseJsonBody(request, PurchaseCreditAdjustmentRequestSchema, {
        invalidMessage: "Invalid purchase adjustment payload",
        maxBytes: QUOTA_PAYLOAD_MAX_BYTES,
        tooLargeMessage: "Purchase adjustment payload is too large"
      });
    } catch (error) {
      if (!isAppError(error)) throw error;
      return this.reply({ error: error.publicMessage }, error.status);
    }

    return this.state.blockConcurrencyWhile(() =>
      this.withStorageTransaction(async (storage) => {
        const [tombstone, migrationLock] = await Promise.all([
          storage.get<PrincipalMigrationTombstone>(PRINCIPAL_MIGRATION_TOMBSTONE_KEY),
          storage.get<PrincipalMigrationLock>(PRINCIPAL_MIGRATION_LOCK_KEY)
        ]);
        if (tombstone) {
          return this.reply({
            error: "quota_principal_migrated",
            targetPrincipal: tombstone.targetPrincipal,
            migrationId: tombstone.migrationId
          }, 409);
        }
        if (migrationLock) {
          return this.reply({
            error: "quota_principal_migration_locked",
            migrationId: migrationLock.migrationId
          }, 423);
        }

        const storedGrant = await this.loadPurchaseGrant(body.transactionId, storage);
        if (!storedGrant) {
          const result: PurchaseCreditAdjustmentResult = {
            outcome: "unclaimed",
            didMutate: false,
            purchaseState: "unclaimed"
          };
          return this.reply(result, 200);
        }
        if (
          storedGrant.productId !== body.productId ||
          storedGrant.creditsGranted !== body.creditsGranted
        ) {
          return this.reply({ error: "purchase_authority_mismatch" }, 409);
        }

        const storedCreditState = await storage.get<CreditStateRecord>(CREDIT_STATE_KEY);
        if (!storedCreditState) {
          return this.reply({ error: "purchase_credit_state_missing" }, 409);
        }
        const creditState = structuredClone(storedCreditState);
        const grant = structuredClone(storedGrant);
        const invariantError = await this.purchaseRefundInvariantError(creditState, storage);
        if (invariantError) {
          return this.reply({ error: invariantError }, 409);
        }

        const result = body.action === "refund"
          ? await this.refundPurchasedCredit({
              storage,
              creditState,
              grant,
              notificationId: body.notificationId
            })
          : await this.reversePurchasedCreditRefund({
              storage,
              creditState,
              grant,
              notificationId: body.notificationId
            });
        return this.reply(result, 200);
      })
    );
  }

  private async handlePrincipalMigration(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return this.reply({ error: "Method not allowed" }, 405);
    }
    let raw: unknown;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).byteLength > PRINCIPAL_MIGRATION_PAYLOAD_MAX_BYTES) {
        return this.reply({ error: "Principal migration payload is too large" }, 413);
      }
      raw = JSON.parse(text);
    } catch {
      return this.reply({ error: "Invalid principal migration payload" }, 400);
    }
    const body = raw as Record<string, unknown>;
    const action = body.action;
    const migrationId = typeof body.migrationId === "string" ? body.migrationId.trim() : "";
    if (!migrationId || !/^[a-zA-Z0-9:_-]{1,128}$/u.test(migrationId)) {
      return this.reply({ error: "Invalid principal migration payload" }, 400);
    }

    return this.state.blockConcurrencyWhile(() =>
      this.withStorageTransaction(async (storage) => {
        const [tombstone, existingLock] = await Promise.all([
          storage.get<PrincipalMigrationTombstone>(PRINCIPAL_MIGRATION_TOMBSTONE_KEY),
          storage.get<PrincipalMigrationLock>(PRINCIPAL_MIGRATION_LOCK_KEY)
        ]);

        if (action === "export") {
          if (tombstone) {
            return tombstone.migrationId === migrationId
              ? this.reply({
                  status: "already_tombstoned",
                  sourceSnapshotDigest: tombstone.sourceSnapshotDigest,
                  tombstone
                }, 200)
              : this.reply({ error: "Principal already migrated" }, 409);
          }
          if (existingLock && existingLock.migrationId !== migrationId) {
            return this.reply({ error: "Principal migration already locked" }, 423);
          }
          const migrationLock: PrincipalMigrationLock = existingLock ?? {
            migrationId,
            lockedAt: new Date().toISOString(),
            sourceSnapshotDigest: ""
          };
          if (!existingLock) await storage.put(PRINCIPAL_MIGRATION_LOCK_KEY, migrationLock);
          await this.quiescePrincipalForMigration(storage, migrationId);
          const snapshot = canonicalJsonValue<PrincipalMigrationSnapshot>({
            version: 1,
            creditState: await storage.get<CreditStateRecord>(CREDIT_STATE_KEY) ?? null,
            purchaseRecords: [...(await storage.list({ prefix: PURCHASE_TRANSACTION_PREFIX })).entries()],
            monthlyGrantRecords: [...(await storage.list({ prefix: MONTHLY_GRANT_PREFIX })).entries()],
            creditOperationRecords: [...(await storage.list({ prefix: CREDIT_OPERATION_PREFIX })).entries()],
            requestExecutionRecords: [...(await storage.list({ prefix: REQUEST_EXECUTION_PREFIX })).entries()],
            creditReservationRecords: [...(await storage.list({ prefix: CREDIT_RESERVATION_PREFIX })).entries()],
            exportedAt: migrationLock.lockedAt
          });
          const sourceSnapshotDigest = await sha256Hex(stableJson(snapshot));
          migrationLock.sourceSnapshotDigest = sourceSnapshotDigest;
          await storage.put(PRINCIPAL_MIGRATION_LOCK_KEY, migrationLock);
          return this.reply({
            migrationId,
            status: "locked",
            sourceSnapshotDigest,
            snapshot,
            counts: {
              purchaseRecords: snapshot.purchaseRecords.length,
              monthlyGrantRecords: snapshot.monthlyGrantRecords.length,
              requestExecutionRecords: snapshot.requestExecutionRecords?.length ?? 0,
              creditReservationRecords: snapshot.creditReservationRecords?.length ?? 0
            }
          }, 200);
        }

        if (action === "apply") {
          const sourceSnapshotDigest = typeof body.sourceSnapshotDigest === "string" ? body.sourceSnapshotDigest : "";
          const sourceQuotaSubjectHash = typeof body.sourceQuotaSubjectHash === "string" ? body.sourceQuotaSubjectHash : "";
          const snapshot = body.snapshot;
          if (!isPrincipalMigrationSnapshot(snapshot) || !/^[a-f0-9]{64}$/u.test(sourceSnapshotDigest) ||
              !/^[a-f0-9]{64}$/u.test(sourceQuotaSubjectHash)) {
            return this.reply({ error: "Invalid principal migration payload" }, 400);
          }
          if (await sha256Hex(stableJson(snapshot)) !== sourceSnapshotDigest) {
            return this.reply({ error: "Principal migration snapshot mismatch" }, 409);
          }
          const existingMarker = await storage.get<PrincipalMigrationMarker>(PRINCIPAL_MIGRATION_MARKER_KEY);
          if (existingMarker) {
            return existingMarker.migrationId === migrationId && existingMarker.sourceSnapshotDigest === sourceSnapshotDigest
              ? this.reply({ status: "already_applied", marker: existingMarker }, 200)
              : this.reply({ error: "Principal migration conflict" }, 409);
          }
          if (tombstone || existingLock) {
            return this.reply({ error: "Target principal is not writable" }, 409);
          }
          const [existingState, existingExecutions, existingReservations] = await Promise.all([
            storage.get<CreditStateRecord>(CREDIT_STATE_KEY),
            storage.list({ prefix: REQUEST_EXECUTION_PREFIX }),
            storage.list({ prefix: CREDIT_RESERVATION_PREFIX })
          ]);
          if (existingState || existingExecutions.size > 0 || existingReservations.size > 0) {
            return this.reply({ error: "Target principal already has quota state" }, 409);
          }
          const marker: PrincipalMigrationMarker = {
            migrationId,
            sourceSnapshotDigest,
            sourceQuotaSubjectHash,
            appliedAt: new Date().toISOString()
          };
          if (snapshot.creditState) await storage.put(CREDIT_STATE_KEY, snapshot.creditState);
          for (const [key, value] of principalMigrationSnapshotEntries(snapshot)) {
            await storage.put(key, value);
          }
          await storage.put(PRINCIPAL_MIGRATION_MARKER_KEY, marker);
          logEvent("principal_migration_applied", {
            sourceQuotaSubjectHash,
            purchasedRemaining: snapshot.creditState?.purchasedRemaining ?? 0,
            monthlyRemaining: snapshot.creditState?.monthlyRemaining ?? 0,
            purchaseRecordCount: snapshot.purchaseRecords.length,
            requestExecutionRecordCount: snapshot.requestExecutionRecords?.length ?? 0
          });
          return this.reply({ status: "applied", marker }, 200);
        }

        if (action === "tombstone") {
          const targetPrincipal = typeof body.targetPrincipal === "string" ? body.targetPrincipal.trim() : "";
          const sourceSnapshotDigest = typeof body.sourceSnapshotDigest === "string" ? body.sourceSnapshotDigest : "";
          if (!targetPrincipal || targetPrincipal.length > 256 || !/^[a-f0-9]{64}$/u.test(sourceSnapshotDigest)) {
            return this.reply({ error: "Invalid principal migration payload" }, 400);
          }
          if (tombstone) {
            return tombstone.migrationId === migrationId && tombstone.sourceSnapshotDigest === sourceSnapshotDigest &&
              tombstone.targetPrincipal === targetPrincipal
              ? this.reply({ status: "already_tombstoned", tombstone }, 200)
              : this.reply({ error: "Principal migration tombstone conflict" }, 409);
          }
          if (!existingLock || existingLock.migrationId !== migrationId ||
              existingLock.sourceSnapshotDigest !== sourceSnapshotDigest) {
            return this.reply({ error: "Principal migration lock mismatch" }, 409);
          }
          const migratedAt = new Date().toISOString();
          const nextTombstone: PrincipalMigrationTombstone = {
            ...existingLock,
            targetPrincipal,
            migratedAt
          };
          await storage.put(PRINCIPAL_MIGRATION_TOMBSTONE_KEY, nextTombstone);
          await storage.delete(PRINCIPAL_MIGRATION_LOCK_KEY);
          return this.reply({ status: "tombstoned", tombstone: nextTombstone }, 200);
        }

        if (action === "unlock") {
          const sourceSnapshotDigest = typeof body.sourceSnapshotDigest === "string" ? body.sourceSnapshotDigest : "";
          if (tombstone) return this.reply({ error: "Principal is already migrated" }, 409);
          if (!existingLock) return this.reply({ status: "already_unlocked" }, 200);
          if (existingLock.migrationId !== migrationId || existingLock.sourceSnapshotDigest !== sourceSnapshotDigest) {
            return this.reply({ error: "Principal migration lock mismatch" }, 409);
          }
          await storage.delete(PRINCIPAL_MIGRATION_LOCK_KEY);
          return this.reply({ status: "unlocked" }, 200);
        }

        return this.reply({ error: "Invalid principal migration payload" }, 400);
      })
    );
  }

  async alarm(): Promise<void> {
    try {
      await this.state.blockConcurrencyWhile(() =>
        this.withStorageTransaction((storage) => this.expireDueReservations(storage, Date.now(), "alarm"))
      );
    } catch (error) {
      try {
        await this.state.storage.setAlarm(Date.now() + 60_000);
      } catch {
        // Cloudflare will still retry the failed alarm delivery when possible.
      }
      throw error;
    }
  }

  private async quiescePrincipalForMigration(
    storage: RequestExecutionStorage,
    migrationId: string
  ): Promise<void> {
    const nowMs = Date.now();
    const reservations = await storage.list<CreditReservationRecord>({ prefix: CREDIT_RESERVATION_PREFIX });
    for (const reservation of reservations.values()) {
      if (reservation.status === "reserved") {
        await this.expireReservation(reservation, storage, nowMs, "migration");
      }
    }
    const executions = await storage.list<RequestExecutionRecord>({ prefix: REQUEST_EXECUTION_PREFIX });
    for (const [key, execution] of executions) {
      if (execution.status === "pending") {
        execution.status = "failed";
        execution.failedAt = new Date(nowMs).toISOString();
        execution.failureCode = "principal_migration_locked";
        execution.failureStatus = 409;
        execution.failureDetails = { migrationId };
        await storage.put(key, execution);
        continue;
      }
      const resultExpiresAtMs = Date.parse(execution.resultExpiresAt ?? "");
      if (execution.status === "completed" && (!Number.isFinite(resultExpiresAtMs) || resultExpiresAtMs <= nowMs)) {
        delete execution.resultBody;
        delete execution.resultMetadata;
        execution.configSnapshot = {};
        await storage.put(key, execution);
      }
    }
    await this.rescheduleReservationAlarm(storage);
  }

  private async handleRequestExecution(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return this.reply({ error: "Method not allowed" }, 405, { allow: "POST" });
    }

    let body: RequestExecutionRequest;
    try {
      body = await parseJsonBody(request, RequestExecutionRequestSchema, {
        invalidMessage: "Invalid request execution payload",
        maxBytes: REQUEST_EXECUTION_PAYLOAD_MAX_BYTES,
        tooLargeMessage: "Request execution payload is too large"
      });
    } catch (error) {
      if (!isAppError(error)) {
        throw error;
      }
      return this.reply({ error: error.publicMessage }, error.status);
    }

    const result = await this.state.blockConcurrencyWhile(() =>
      this.withStorageTransaction(async (storage) => {
        const [tombstone, migrationLock] = await Promise.all([
          storage.get<PrincipalMigrationTombstone>(PRINCIPAL_MIGRATION_TOMBSTONE_KEY),
          storage.get<PrincipalMigrationLock>(PRINCIPAL_MIGRATION_LOCK_KEY)
        ]);
        if (tombstone || migrationLock) {
          const existing = await this.loadRequestExecution(body.operationId, storage);
          if (!existing || existing.status === "pending") {
            return {
              status: 409,
              payload: {
                outcome: "failed",
                failureCode: tombstone ? "quota_principal_migrated" : "principal_migration_locked",
                failureStatus: 409,
                ...(tombstone ? { targetPrincipal: tombstone.targetPrincipal } : {})
              }
            };
          }
        }
        await this.expireDueReservations(storage, Date.now(), "lazy");
        if (body.action === "begin") {
          return this.beginRequestExecution(body, storage);
        }
        if (body.action === "complete") {
          return this.completeRequestExecution(body, storage);
        }
        return this.failRequestExecution(body, storage);
      })
    );

    const retryAfterSeconds = result.payload.retryAfterSeconds;
    return this.reply(
      result.payload,
      result.status,
      result.status === 202 && typeof retryAfterSeconds === "number"
        ? { "retry-after": String(retryAfterSeconds) }
        : undefined
    );
  }

  private async beginRequestExecution(
    body: Extract<RequestExecutionRequest, { action: "begin" }>,
    storage: RequestExecutionStorage
  ): Promise<RequestExecutionMutationResult> {
    const existing = await this.loadRequestExecution(body.operationId, storage);
    if (!existing) {
      if (!body.allowCreate) {
        return { status: 200, payload: { outcome: "not_started" } };
      }
      if (body.reservation.mode === "legacy_chat") {
        return {
          status: 409,
          payload: {
            outcome: "failed",
            failureCode: "legacy_chat_creation_disabled",
            failureStatus: 409,
            didMutate: false
          }
        };
      }
      return this.reserveNewRequestExecution(body, storage);
    }

    if (existing.requestHash !== body.requestHash || existing.route !== body.route) {
      return {
        status: 409,
        payload: {
          outcome: "payload_mismatch",
          error: "operation_id_payload_mismatch"
        }
      };
    }

    if (existing.status === "pending") {
      const nowMs = Date.now();
      const pendingExpiresMs = Date.parse(existing.pendingExpiresAt);
      if (!Number.isFinite(pendingExpiresMs) || pendingExpiresMs <= nowMs) {
        const failedAt = new Date(nowMs).toISOString();
        existing.status = "failed";
        existing.failedAt = failedAt;
        existing.failureCode = "execution_pending_expired";
        existing.failureStatus = 504;
        existing.failureDetails = {
          pendingExpiresAt: existing.pendingExpiresAt
        };
        await this.saveRequestExecution(existing, storage);
        return {
          status: 504,
          payload: this.failedExecutionPayload(existing, true)
        };
      }

      return {
        status: 202,
        payload: {
          outcome: "pending",
          retryAfterSeconds: Math.max(1, Math.ceil((pendingExpiresMs - nowMs) / 1_000))
        }
      };
    }

    if (existing.status === "failed") {
      return {
        status: existing.failureStatus ?? 409,
        payload: this.failedExecutionPayload(existing, false)
      };
    }

    const resultExpiresMs = Date.parse(existing.resultExpiresAt ?? "");
    if (!existing.resultBody || !Number.isFinite(resultExpiresMs) || resultExpiresMs <= Date.now()) {
      if (existing.resultBody) {
        delete existing.resultBody;
        await this.saveRequestExecution(existing, storage);
      }
      return {
        status: 410,
        payload: {
          outcome: "result_expired",
          error: "operation_result_expired"
        }
      };
    }

    return {
      status: 200,
      payload: {
        outcome: "replay",
        result: existing.resultBody,
        resultMetadata: existing.resultMetadata ?? {}
      }
    };
  }

  private async completeRequestExecution(
    body: Extract<RequestExecutionRequest, { action: "complete" }>,
    storage: RequestExecutionStorage
  ): Promise<RequestExecutionMutationResult> {
    const existing = await this.loadRequestExecution(body.operationId, storage);
    if (!existing) {
      return {
        status: 409,
        payload: { error: "request_execution_not_found" }
      };
    }
    if (existing.requestHash !== body.requestHash || existing.route !== body.route) {
      return {
        status: 409,
        payload: {
          outcome: "payload_mismatch",
          error: "operation_id_payload_mismatch"
        }
      };
    }
    if (existing.status === "completed") {
      return this.completedExecutionPayload(existing, storage, false);
    }
    if (existing.status === "failed") {
      return {
        status: 409,
        payload: {
          ...this.failedExecutionPayload(existing, false),
          error: "request_execution_already_failed"
        }
      };
    }

    if (!existing.reservationId) {
      return {
        status: 409,
        payload: { error: "request_execution_reservation_required" }
      };
    }
    const reservation = await this.loadCreditReservation(existing.operationId, storage);
    if (!reservation || reservation.reservationId !== existing.reservationId) {
      return {
        status: 409,
        payload: { error: "request_execution_reservation_missing" }
      };
    }
    if (reservation.status !== "reserved") {
      return {
        status: 409,
        payload: { error: `credit_reservation_${reservation.status}` }
      };
    }

    const nowMs = Date.now();
    if (Date.parse(reservation.expiresAt) <= nowMs) {
      await this.expireReservation(reservation, storage, nowMs, "lazy");
      return {
        status: 409,
        payload: { error: "credit_reservation_expired" }
      };
    }

    let creditOperation: CreditOperationRecord | undefined;
    let creditsCharged = 0;
    if (body.chargeable) {
      reservation.status = "committed";
      reservation.committedAt = new Date(nowMs).toISOString();
      if (reservation.mode === "credits") {
        const creditState = await storage.get<CreditStateRecord>(CREDIT_STATE_KEY);
        if (!creditState) {
          throw new Error("credit_state_missing_for_reservation_commit");
        }
        normalizeRewardedAdLots(creditState, new Date(nowMs).toISOString());
        creditOperation = buildCreditOperation({
          operationId: reservation.operationId,
          type: "consume",
          status: "applied",
          delta: -reservation.credits,
          creditState,
          creditsRequired: reservation.credits,
          consumedMonthly: reservation.allocations.monthly?.credits ?? 0,
          consumedRewardedAd: reservation.allocations.rewardedAd.reduce((sum, item) => sum + item.credits, 0),
          consumedWelcome: reservation.allocations.welcome?.credits ?? 0,
          consumedPurchased: reservation.allocations.purchased?.credits ?? 0,
          consumedMonthlyPeriodStart: reservation.allocations.monthly?.periodStart,
          consumedMonthlyPeriodEnd: reservation.allocations.monthly?.periodEnd,
          consumedRewardedAdLots: reservation.allocations.rewardedAd,
          referenceType: reservation.referenceType,
          referenceId: reservation.referenceId,
          createdAt: reservation.committedAt
        });
        await storage.put(buildCreditOperationKey(reservation.operationId), creditOperation);
        creditsCharged = reservation.credits;
      }
    } else {
      await this.restoreReservationAllocations(reservation, storage, nowMs);
      reservation.status = "released";
      reservation.releasedAt = new Date(nowMs).toISOString();
      reservation.releaseReason = "non_chargeable";
    }

    const completedAt = new Date(nowMs).toISOString();
    existing.status = "completed";
    existing.completedAt = completedAt;
    existing.resultExpiresAt = new Date(nowMs + REQUEST_EXECUTION_RESULT_TTL_MS).toISOString();
    existing.resultBody = { ...body.resultBody, creditsCharged };
    existing.resultMetadata = { ...body.resultMetadata, creditsCharged };
    await storage.put(buildCreditReservationKey(reservation.operationId), reservation);
    await storage.delete(reservation.dueIndexKey);
    await this.saveRequestExecution(existing, storage);
    await this.rescheduleReservationAlarm(storage);
    this.logReservationEvent(
      body.chargeable ? "credit_reservation_committed" : "credit_reservation_released",
      reservation
    );
    return {
      status: 200,
      payload: {
        outcome: "completed",
        didMutate: true,
        reservationStatus: reservation.status,
        creditsCharged,
        completedAt: existing.completedAt,
        resultExpiresAt: existing.resultExpiresAt,
        creditOperation,
        monthlyGrant: reservation.monthlyGrant
      }
    };
  }

  private async failRequestExecution(
    body: Extract<RequestExecutionRequest, { action: "fail" }>,
    storage: RequestExecutionStorage
  ): Promise<RequestExecutionMutationResult> {
    const existing = await this.loadRequestExecution(body.operationId, storage);
    if (!existing) {
      return {
        status: 409,
        payload: { error: "request_execution_not_found" }
      };
    }
    if (existing.requestHash !== body.requestHash || existing.route !== body.route) {
      return {
        status: 409,
        payload: {
          outcome: "payload_mismatch",
          error: "operation_id_payload_mismatch"
        }
      };
    }
    if (existing.status === "completed") {
      const completed = await this.completedExecutionPayload(existing, storage, false);
      return {
        ...completed,
        payload: {
          ...completed.payload,
          outcome: "completed"
        }
      };
    }
    if (existing.status === "failed") {
      return {
        status: 200,
        payload: this.failedExecutionPayload(existing, false)
      };
    }

    let reservationStatus: CreditReservationRecord["status"] | "none" = "none";
    const reservation = existing.reservationId
      ? await this.loadCreditReservation(existing.operationId, storage)
      : undefined;
    if (reservation?.status === "reserved") {
      await this.restoreReservationAllocations(reservation, storage, Date.now());
      reservation.status = "released";
      reservation.releasedAt = new Date().toISOString();
      reservation.releaseReason = body.failureCode;
      await storage.put(buildCreditReservationKey(reservation.operationId), reservation);
      await storage.delete(reservation.dueIndexKey);
      await this.rescheduleReservationAlarm(storage);
      this.logReservationEvent("credit_reservation_released", reservation);
    }
    reservationStatus = reservation?.status ?? "none";
    existing.status = "failed";
    existing.failedAt = new Date().toISOString();
    existing.failureCode = body.failureCode;
    existing.failureStatus = body.failureStatus;
    existing.failureDetails = body.failureDetails;
    await this.saveRequestExecution(existing, storage);
    return {
      status: 200,
      payload: {
        ...this.failedExecutionPayload(existing, true),
        reservationStatus
      }
    };
  }

  private async reserveNewRequestExecution(
    body: Extract<RequestExecutionRequest, { action: "begin" }>,
    storage: RequestExecutionStorage
  ): Promise<RequestExecutionMutationResult> {
    const nowMs = Date.now();
    const createdAt = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + REQUEST_EXECUTION_PENDING_TTL_MS).toISOString();
    const record: RequestExecutionRecord = {
      operationId: body.operationId,
      requestHash: body.requestHash,
      route: body.route,
      status: "pending",
      executionPolicyVersion: body.executionPolicyVersion,
      configSnapshot: body.configSnapshot,
      createdAt,
      pendingExpiresAt: expiresAt,
      stateVersion: 2
    };

    const allocations: CreditReservationAllocations = { rewardedAd: [] };
    let monthlyGrant: MonthlyGrantRecord | undefined;
    let credits = 0;
    let legacyChatSlots: 0 | 1 = 0;
    if (body.reservation.mode === "credits") {
      const quota = body.reservation.quota;
      const creditStateResult = await this.loadCreditState(
        quota.dateJST,
        quota.plan,
        quota.monthlyCreditLimit,
        {
          periodStart: quota.monthlyCreditPeriodStart,
          periodEnd: quota.monthlyCreditPeriodEnd,
          monthlyGrantOperationId: quota.monthlyGrantOperationId,
          welcomeEligible: quota.accessMode === "verified_installation"
        },
        storage
      );
      const creditState = creditStateResult.creditState;
      monthlyGrant = creditStateResult.monthlyGrant;
      if (totalCreditRemaining(creditState) < body.reservation.creditsRequired) {
        record.status = "failed";
        record.failedAt = createdAt;
        record.failureCode = "insufficient_credits";
        record.failureStatus = 402;
        record.failureDetails = {
          creditsRequired: body.reservation.creditsRequired,
          creditsRemaining: totalCreditRemaining(creditState)
        };
        await storage.put(CREDIT_STATE_KEY, creditState);
        if (monthlyGrant) {
          await this.saveMonthlyGrant(monthlyGrant, storage);
        }
        await this.saveRequestExecution(record, storage);
        return {
          status: 402,
          payload: {
            ...this.failedExecutionPayload(record, true),
            monthlyGrant
          }
        };
      }
      credits = body.reservation.creditsRequired;
      Object.assign(allocations, allocateCreditReservation(creditState, credits));
      creditState.updatedAt = createdAt;
      await storage.put(CREDIT_STATE_KEY, creditState);
      if (monthlyGrant) {
        await this.saveMonthlyGrant(monthlyGrant, storage);
      }
    } else if (body.reservation.mode === "legacy_chat") {
      const quota = body.reservation.quota;
      const dailyRecord = await this.loadDailyRecord(quota.dateJST, quota.plan, quota.chatLimit, storage);
      if (dailyRecord.chatsUsed >= dailyRecord.chatLimit) {
        record.status = "failed";
        record.failedAt = createdAt;
        record.failureCode = "daily_chat_quota_exceeded";
        record.failureStatus = 429;
        record.failureDetails = {
          chatsUsed: dailyRecord.chatsUsed,
          chatLimit: dailyRecord.chatLimit
        };
        await this.saveRequestExecution(record, storage);
        return { status: 429, payload: this.failedExecutionPayload(record, true) };
      }
      dailyRecord.chatsUsed += 1;
      dailyRecord.updatedAt = createdAt;
      await storage.put(buildDailyKey(quota.dateJST), dailyRecord);
      legacyChatSlots = 1;
      allocations.legacyChat = {
        slots: 1,
        dateJST: quota.dateJST,
        dailyKey: buildDailyKey(quota.dateJST)
      };
    }

    const reservationId = `reservation:${body.operationId}`;
    const dueIndexKey = buildCreditReservationDueKey(nowMs + REQUEST_EXECUTION_PENDING_TTL_MS, body.operationId);
    const reservation: CreditReservationRecord = {
      reservationId,
      operationId: body.operationId,
      requestHash: body.requestHash,
      route: body.route,
      mode: body.reservation.mode,
      credits,
      legacyChatSlots,
      allocations,
      referenceType: body.reservation.mode === "credits" ? body.reservation.referenceType : undefined,
      referenceId: body.reservation.mode === "credits" ? body.reservation.referenceId : undefined,
      monthlyGrant,
      status: "reserved",
      createdAt,
      expiresAt,
      dueIndexKey
    };
    record.reservationId = reservationId;
    await storage.put(buildCreditReservationKey(body.operationId), reservation);
    await storage.put(dueIndexKey, reservationId);
    await this.saveRequestExecution(record, storage);
    await this.scheduleReservationAlarm(storage, nowMs + REQUEST_EXECUTION_PENDING_TTL_MS);
    this.logReservationEvent("credit_reservation_created", reservation);
    return {
      status: 200,
      payload: {
        outcome: "leader",
        executionPolicyVersion: record.executionPolicyVersion,
        createdAt: record.createdAt,
        reservationId,
        reservationMode: reservation.mode,
        reservationExpiresAt: reservation.expiresAt,
        creditsReserved: reservation.credits,
        monthlyGrant
      }
    };
  }

  private async completedExecutionPayload(
    execution: RequestExecutionRecord,
    storage: RequestExecutionStorage,
    didMutate: boolean
  ): Promise<RequestExecutionMutationResult> {
    const reservation = execution.reservationId
      ? await this.loadCreditReservation(execution.operationId, storage)
      : undefined;
    const creditOperation = reservation?.status === "committed" && reservation.mode === "credits"
      ? await this.loadCreditOperation(execution.operationId, storage)
      : undefined;
    return {
      status: 200,
      payload: {
        outcome: "completed",
        didMutate,
        reservationStatus: reservation?.status ?? "none",
        creditsCharged: reservation?.status === "committed" ? reservation.credits : 0,
        completedAt: execution.completedAt,
        resultExpiresAt: execution.resultExpiresAt,
        creditOperation,
        monthlyGrant: reservation?.monthlyGrant
      }
    };
  }

  private async withStorageTransaction<T>(
    callback: (storage: RequestExecutionStorage) => Promise<T>
  ): Promise<T> {
    const storage = this.state.storage as DurableObjectStorage;
    if (typeof storage.transaction === "function") {
      return storage.transaction((transaction) => callback(transaction));
    }
    return callback(storage);
  }

  private async expireDueReservations(
    storage: RequestExecutionStorage,
    nowMs: number,
    source: "alarm" | "lazy"
  ): Promise<void> {
    const dueEntries = await storage.list<string>({ prefix: CREDIT_RESERVATION_DUE_PREFIX });
    for (const [dueIndexKey] of dueEntries) {
      const expiresAtMs = parseCreditReservationDueKey(dueIndexKey);
      if (!Number.isFinite(expiresAtMs)) {
        await storage.delete(dueIndexKey);
        continue;
      }
      if (expiresAtMs > nowMs) {
        break;
      }
      const operationId = operationIdFromCreditReservationDueKey(dueIndexKey);
      const reservation = operationId
        ? await this.loadCreditReservation(operationId, storage)
        : undefined;
      if (!reservation || reservation.status !== "reserved") {
        await storage.delete(dueIndexKey);
        continue;
      }
      await this.expireReservation(reservation, storage, nowMs, source);
    }
    await this.rescheduleReservationAlarm(storage);
  }

  private async expireReservation(
    reservation: CreditReservationRecord,
    storage: RequestExecutionStorage,
    nowMs: number,
    source: "alarm" | "lazy" | "migration"
  ): Promise<void> {
    if (reservation.status !== "reserved") {
      return;
    }
    await this.restoreReservationAllocations(reservation, storage, nowMs);
    const expiredAt = new Date(nowMs).toISOString();
    reservation.status = "expired";
    reservation.expiredAt = expiredAt;
    reservation.releaseReason = `ttl_${source}`;
    await storage.put(buildCreditReservationKey(reservation.operationId), reservation);
    await storage.delete(reservation.dueIndexKey);

    const execution = await this.loadRequestExecution(reservation.operationId, storage);
    if (execution?.status === "pending" && execution.requestHash === reservation.requestHash) {
      execution.status = "failed";
      execution.failedAt = expiredAt;
      execution.failureCode = source === "migration" ? "principal_migration_locked" : "credit_reservation_expired";
      execution.failureStatus = source === "migration" ? 409 : 504;
      execution.failureDetails = source === "migration"
        ? { migrationLockedAt: expiredAt }
        : { reservationExpiredAt: expiredAt };
      await this.saveRequestExecution(execution, storage);
    }
    this.logReservationEvent("credit_reservation_expired", reservation);
  }

  private async restoreReservationAllocations(
    reservation: CreditReservationRecord,
    storage: RequestExecutionStorage,
    nowMs: number
  ): Promise<void> {
    if (reservation.mode === "credits") {
      const creditState = await storage.get<CreditStateRecord>(CREDIT_STATE_KEY);
      if (!creditState) {
        throw new Error("credit_state_missing_for_reservation_release");
      }
      const nowIso = new Date(nowMs).toISOString();
      normalizeRewardedAdLots(creditState, nowIso);
      const monthly = reservation.allocations.monthly;
      if (
        monthly &&
        creditState.periodStart === monthly.periodStart &&
        creditState.periodEnd === monthly.periodEnd &&
        Date.parse(monthly.periodEnd) > nowMs
      ) {
        const nextMonthly = creditState.monthlyRemaining + monthly.credits;
        if (nextMonthly > creditState.monthlyLimit) {
          throw new Error("credit_reservation_monthly_restore_overflow");
        }
        creditState.monthlyRemaining = nextMonthly;
      }
      for (const allocation of reservation.allocations.rewardedAd) {
        const expiryMs = allocation.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(allocation.expiresAt);
        if (!Number.isFinite(expiryMs) && allocation.expiresAt !== null) {
          continue;
        }
        if (expiryMs <= nowMs) {
          continue;
        }
        restoreRewardedAdLot(creditState, allocation);
      }
      creditState.purchasedRemaining += reservation.allocations.purchased?.credits ?? 0;
      creditState.welcomeRemaining = (creditState.welcomeRemaining ?? 0) + (reservation.allocations.welcome?.credits ?? 0);
      creditState.updatedAt = nowIso;
      syncRewardedAdAggregate(creditState);
      await storage.put(CREDIT_STATE_KEY, creditState);
      return;
    }

    if (reservation.mode === "legacy_chat" && reservation.allocations.legacyChat) {
      const allocation = reservation.allocations.legacyChat;
      const dailyRecord = await storage.get<QuotaRecord>(allocation.dailyKey);
      if (!dailyRecord || dailyRecord.dateJST !== allocation.dateJST || dailyRecord.chatsUsed < allocation.slots) {
        throw new Error("legacy_chat_reservation_restore_invariant_failed");
      }
      dailyRecord.chatsUsed -= allocation.slots;
      dailyRecord.updatedAt = new Date(nowMs).toISOString();
      await storage.put(allocation.dailyKey, dailyRecord);
    }
  }

  private async scheduleReservationAlarm(storage: RequestExecutionStorage, expiresAtMs: number): Promise<void> {
    const currentAlarm = await storage.getAlarm();
    if (currentAlarm === null || expiresAtMs < currentAlarm) {
      await storage.setAlarm(expiresAtMs);
    }
  }

  private async rescheduleReservationAlarm(storage: RequestExecutionStorage): Promise<void> {
    const dueEntries = await storage.list<string>({ prefix: CREDIT_RESERVATION_DUE_PREFIX });
    for (const dueIndexKey of dueEntries.keys()) {
      const nextAlarmMs = parseCreditReservationDueKey(dueIndexKey);
      if (Number.isFinite(nextAlarmMs)) {
        await storage.setAlarm(nextAlarmMs);
        return;
      }
      await storage.delete(dueIndexKey);
    }
    await storage.deleteAlarm();
  }

  private logReservationEvent(event: string, reservation: CreditReservationRecord): void {
    logEvent(event, {
      quotaSubjectHash: hashForLog(this.state.id?.name),
      operationIdSuffix: suffixForLog(reservation.operationId),
      reservationIdSuffix: suffixForLog(reservation.reservationId),
      route: reservation.route,
      mode: reservation.mode,
      credits: reservation.credits,
      status: reservation.status
    });
  }

  private failedExecutionPayload(record: RequestExecutionRecord, didMutate: boolean): Record<string, unknown> {
    return {
      outcome: "failed",
      failureCode: record.failureCode ?? "operation_execution_failed",
      failureStatus: record.failureStatus ?? 409,
      failureDetails: record.failureDetails,
      didMutate
    };
  }

  private async loadDailyRecord(
    dateJST: string,
    plan: AccessPlan,
    chatLimit: number,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<QuotaRecord> {
    const current =
      ((await storage.get<QuotaRecord>(buildDailyKey(dateJST))) as QuotaRecord | undefined) ?? {
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
      welcomeEligible?: boolean;
    } = {},
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<{ creditState: CreditStateRecord; monthlyGrant?: MonthlyGrantRecord; monthlyAdjustment?: CreditOperationRecord }> {
    const period = buildCreditPeriod(dateJST, options);
    const now = new Date().toISOString();
    const existing = (await storage.get<CreditStateRecord>(CREDIT_STATE_KEY)) as
      | CreditStateRecord
      | undefined;

    if (!existing || existing.periodStart !== period.periodStart || existing.periodEnd !== period.periodEnd) {
      if (existing) {
        normalizeRewardedAdLots(existing, now);
        migrateOrGrantWelcomeCredits(existing, plan, options.welcomeEligible === true, now);
      }
      const creditState: CreditStateRecord = {
        plan,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        monthlyRemaining: monthlyCreditLimit,
        monthlyLimit: monthlyCreditLimit,
        rewardedAdRemaining: nonExpiredRewardedAdRemaining(existing, now),
        rewardedAdExpiresAt: nonExpiredRewardedAdExpiresAt(existing, now),
        rewardedAdLots: existing?.rewardedAdLots ? structuredClone(existing.rewardedAdLots) : [],
        welcomeRemaining: existing?.welcomeRemaining ?? (options.welcomeEligible ? WELCOME_CREDIT_AMOUNT : 0),
        welcomeGrantedAt: existing?.welcomeGrantedAt ?? (options.welcomeEligible ? now : undefined),
        welcomeGrantOperationId: existing?.welcomeGrantOperationId ?? (options.welcomeEligible ? "welcome-grant:v1" : undefined),
        welcomeMigrationVersion: existing?.welcomeMigrationVersion ?? 1,
        purchasedRemaining: existing?.purchasedRemaining ?? 0,
        purchasedRefundDebt: existing?.purchasedRefundDebt ?? 0,
        updatedAt: now
      };
      return {
        creditState,
        monthlyGrant: await this.buildMonthlyGrantIfNeeded(
          creditState,
          monthlyCreditLimit,
          now,
          options.monthlyGrantOperationId,
          storage
        )
      };
    }

    normalizeRewardedAdLots(existing, now);
    migrateOrGrantWelcomeCredits(existing, plan, options.welcomeEligible === true, now);
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
      options.monthlyGrantOperationId,
      storage
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
          ? await this.buildMonthlyGrantIfNeeded(existing, limitDelta, now, options.monthlyGrantOperationId, storage)
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

    const allocations = allocateCreditReservation(creditState, creditsRequired);
    const consumedMonthly = allocations.monthly?.credits ?? 0;
    const consumedRewardedAd = allocations.rewardedAd.reduce((sum, allocation) => sum + allocation.credits, 0);
    const consumedWelcome = allocations.welcome?.credits ?? 0;
    const consumedPurchased = allocations.purchased?.credits ?? 0;
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
      consumedWelcome,
      consumedPurchased,
      consumedMonthlyPeriodStart: allocations.monthly?.periodStart,
      consumedMonthlyPeriodEnd: allocations.monthly?.periodEnd,
      consumedRewardedAdLots: allocations.rewardedAd,
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
    let remainingRefund = refundable;
    const requestedMonthlyRefund = Math.min(original.consumedMonthly ?? 0, remainingRefund);
    remainingRefund -= requestedMonthlyRefund;
    const requestedRewardedAdRefund = Math.min(original.consumedRewardedAd ?? 0, remainingRefund);
    remainingRefund -= requestedRewardedAdRefund;
    const welcomeRefund = Math.min(original.consumedWelcome ?? 0, remainingRefund);
    remainingRefund -= welcomeRefund;
    const purchasedRefund = Math.min(original.consumedPurchased ?? 0, remainingRefund);
    const nowMs = Date.now();
    const monthlyPeriodStillActive =
      (!original.consumedMonthlyPeriodStart || original.consumedMonthlyPeriodStart === creditState.periodStart) &&
      (!original.consumedMonthlyPeriodEnd ||
        original.consumedMonthlyPeriodEnd === creditState.periodEnd);
    const monthlyRefund = monthlyPeriodStillActive ? requestedMonthlyRefund : 0;
    if (creditState.monthlyRemaining + monthlyRefund > creditState.monthlyLimit) {
      throw new Error("credit_refund_monthly_restore_overflow");
    }
    creditState.monthlyRemaining += monthlyRefund;
    normalizeRewardedAdLots(creditState, now);
    let rewardedAdRefund = 0;
    const rewardedAllocations = original.consumedRewardedAdLots ?? (
      requestedRewardedAdRefund > 0
        ? [{
            lotId: buildRewardedAdLotId(original.rewardedAdExpiresAt ?? null),
            credits: requestedRewardedAdRefund,
            expiresAt: original.rewardedAdExpiresAt ?? null
          }]
        : []
    );
    let rewardedRemaining = requestedRewardedAdRefund;
    for (const allocation of rewardedAllocations) {
      if (rewardedRemaining <= 0) {
        break;
      }
      const amount = Math.min(allocation.credits, rewardedRemaining);
      rewardedRemaining -= amount;
      const expiresMs = allocation.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(allocation.expiresAt);
      if (expiresMs <= nowMs || (!Number.isFinite(expiresMs) && allocation.expiresAt !== null)) {
        continue;
      }
      restoreRewardedAdLot(creditState, { ...allocation, credits: amount });
      rewardedAdRefund += amount;
    }
    syncRewardedAdAggregate(creditState);
    creditState.welcomeRemaining = (creditState.welcomeRemaining ?? 0) + welcomeRefund;
    creditState.purchasedRemaining += purchasedRefund;
    creditState.updatedAt = now;
    original.refundedBy = refundOperationId;
    original.refundedAt = now;
    const operation = buildCreditOperation({
      operationId: refundOperationId,
      type: "refund",
      status: "applied",
      delta: monthlyRefund + rewardedAdRefund + welcomeRefund + purchasedRefund,
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
    const result = await this.withStorageTransaction(async (storage) => {
      const existing = await this.loadPurchaseGrant(transactionId, storage);
      if (existing) {
        if (existing.productId !== productId || existing.creditsGranted !== purchaseCredits) {
          throw new AppError(409, "Purchase transaction authority mismatch");
        }
        if (existing.refund?.state === "refunded") {
          throw new AppError(409, "Purchase transaction has been refunded");
        }
        return { didMutate: false, operation: existing.operation, creditState: null };
      }

      const nextCreditState = structuredClone(creditState);
      const invariantError = await this.purchaseRefundInvariantError(nextCreditState, storage);
      if (invariantError) {
        throw new AppError(409, invariantError);
      }

      const now = new Date().toISOString();
      const debtBefore = nextCreditState.purchasedRefundDebt ?? 0;
      const debtOffset = Math.min(debtBefore, purchaseCredits);
      if (debtOffset > 0) {
        await this.applyPurchaseDebtOffset(storage, debtOffset);
      }
      nextCreditState.purchasedRefundDebt = debtBefore - debtOffset;
      const availableGrant = purchaseCredits - debtOffset;
      nextCreditState.purchasedRemaining += availableGrant;
      nextCreditState.updatedAt = now;
      const operation = buildCreditOperation({
        operationId,
        type: "purchase_grant",
        status: "applied",
        delta: availableGrant,
        creditState: nextCreditState,
        purchaseDebtOffset: debtOffset,
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
        storage.put(CREDIT_STATE_KEY, nextCreditState),
        this.saveCreditOperation(operation, storage),
        this.savePurchaseGrant(grant, storage)
      ]);
      return { didMutate: true, operation, creditState: nextCreditState };
    });
    if (result.creditState) {
      Object.assign(creditState, result.creditState);
    }
    const now = new Date().toISOString();
    await this.pruneOldCreditOperations(now);
    return { didMutate: result.didMutate, operation: result.operation };
  }

  private async refundPurchasedCredit({
    storage,
    creditState,
    grant,
    notificationId
  }: {
    storage: RequestExecutionStorage;
    creditState: CreditStateRecord;
    grant: PurchaseGrantRecord;
    notificationId: string;
  }): Promise<PurchaseCreditAdjustmentResult> {
    if (grant.refund?.state === "refunded") {
      return {
        outcome: "refunded",
        didMutate: false,
        purchaseState: "refunded",
        operation: grant.refund.operation
      };
    }
    if (grant.refund?.state === "reinstated") {
      return {
        outcome: "already_reinstated",
        didMutate: false,
        purchaseState: "reinstated",
        operation: grant.refund.reversalOperation
      };
    }

    const now = new Date().toISOString();
    const availableRemoved = Math.min(creditState.purchasedRemaining, grant.creditsGranted);
    const debtCreated = grant.creditsGranted - availableRemoved;
    creditState.purchasedRemaining -= availableRemoved;
    creditState.purchasedRefundDebt = (creditState.purchasedRefundDebt ?? 0) + debtCreated;
    creditState.updatedAt = now;
    const operation = buildCreditOperation({
      operationId: buildPurchaseRefundOperationId(grant.transactionId),
      type: "purchase_refund",
      status: "applied",
      delta: -availableRemoved,
      creditState,
      refundAvailableRemoved: availableRemoved,
      refundDebtCreated: debtCreated,
      referenceType: "purchase_refund",
      referenceId: grant.transactionId,
      createdAt: now
    });
    grant.refund = {
      state: "refunded",
      availableRemoved,
      debtCreated,
      debtOutstanding: debtCreated,
      notificationId,
      refundedAt: now,
      operation
    };
    await Promise.all([
      storage.put(CREDIT_STATE_KEY, creditState),
      this.saveCreditOperation(operation, storage),
      this.savePurchaseGrant(grant, storage)
    ]);
    return { outcome: "refunded", didMutate: true, purchaseState: "refunded", operation };
  }

  private async reversePurchasedCreditRefund({
    storage,
    creditState,
    grant,
    notificationId
  }: {
    storage: RequestExecutionStorage;
    creditState: CreditStateRecord;
    grant: PurchaseGrantRecord;
    notificationId: string;
  }): Promise<PurchaseCreditAdjustmentResult> {
    if (!grant.refund) {
      return {
        outcome: "not_refunded",
        didMutate: false,
        purchaseState: "granted"
      };
    }
    if (grant.refund.state === "reinstated") {
      return {
        outcome: "reinstated",
        didMutate: false,
        purchaseState: "reinstated",
        operation: grant.refund.reversalOperation
      };
    }

    const now = new Date().toISOString();
    const debtReleased = grant.refund.debtOutstanding;
    const debtSettledRestored = grant.refund.debtCreated - grant.refund.debtOutstanding;
    const creditsRestored = grant.refund.availableRemoved + debtSettledRestored;
    const aggregateDebt = creditState.purchasedRefundDebt ?? 0;
    if (debtReleased > aggregateDebt) {
      throw new AppError(409, "purchase_refund_debt_invariant_failed");
    }
    creditState.purchasedRefundDebt = aggregateDebt - debtReleased;
    // Reversal reinstates the unspent A credits removed by the refund and any
    // later purchase value already consumed while settling A's refund debt.
    // The originally spent portion of A remains spent.
    creditState.purchasedRemaining += creditsRestored;
    creditState.updatedAt = now;
    const operation = buildCreditOperation({
      operationId: buildPurchaseRefundReversalOperationId(grant.transactionId),
      type: "purchase_refund_reversal",
      status: "applied",
      delta: creditsRestored,
      creditState,
      refundAvailableRemoved: grant.refund.availableRemoved,
      refundDebtCreated: grant.refund.debtCreated,
      refundDebtReleased: debtReleased,
      refundDebtSettledRestored: debtSettledRestored,
      refundCreditsRestored: creditsRestored,
      referenceType: "purchase_refund_reversal",
      referenceId: grant.transactionId,
      createdAt: now
    });
    grant.refund.state = "reinstated";
    grant.refund.debtOutstanding = 0;
    grant.refund.reversedAt = now;
    grant.refund.reversalNotificationId = notificationId;
    grant.refund.reversalOperation = operation;
    await Promise.all([
      storage.put(CREDIT_STATE_KEY, creditState),
      this.saveCreditOperation(operation, storage),
      this.savePurchaseGrant(grant, storage)
    ]);
    return { outcome: "reinstated", didMutate: true, purchaseState: "reinstated", operation };
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

    normalizeRewardedAdLots(creditState, now);
    restoreRewardedAdLot(creditState, {
      lotId: buildRewardedAdLotId(promoExpiresAt),
      credits,
      expiresAt: promoExpiresAt
    });
    syncRewardedAdAggregate(creditState);
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

  private async loadCreditOperation(
    operationId: string,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<CreditOperationRecord | undefined> {
    return (await storage.get<CreditOperationRecord>(buildCreditOperationKey(operationId))) as
      | CreditOperationRecord
      | undefined;
  }

  private async saveCreditOperation(
    operation: CreditOperationRecord,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<void> {
    await storage.put(buildCreditOperationKey(operation.operationId), operation);
  }

  private async loadRequestExecution(
    operationId: string,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<RequestExecutionRecord | undefined> {
    return (await storage.get<RequestExecutionRecord>(buildRequestExecutionKey(operationId))) as
      | RequestExecutionRecord
      | undefined;
  }

  private async saveRequestExecution(
    record: RequestExecutionRecord,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<void> {
    await storage.put(buildRequestExecutionKey(record.operationId), record);
  }

  private async loadCreditReservation(
    operationId: string,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<CreditReservationRecord | undefined> {
    return (await storage.get<CreditReservationRecord>(buildCreditReservationKey(operationId))) as
      | CreditReservationRecord
      | undefined;
  }

  private async loadPurchaseGrant(
    transactionId: string,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<PurchaseGrantRecord | undefined> {
    return (await storage.get<PurchaseGrantRecord>(buildPurchaseTransactionKey(transactionId))) as
      | PurchaseGrantRecord
      | undefined;
  }

  private async savePurchaseGrant(
    grant: PurchaseGrantRecord,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<void> {
    await storage.put(buildPurchaseTransactionKey(grant.transactionId), grant);
  }

  private async purchaseRefundInvariantError(
    creditState: CreditStateRecord,
    storage: RequestExecutionStorage
  ): Promise<string | null> {
    if (
      !Number.isSafeInteger(creditState.purchasedRemaining) ||
      creditState.purchasedRemaining < 0 ||
      !Number.isSafeInteger(creditState.purchasedRefundDebt ?? 0) ||
      (creditState.purchasedRefundDebt ?? 0) < 0
    ) {
      return "purchase_credit_balance_invariant_failed";
    }
    const grants = await storage.list<PurchaseGrantRecord>({ prefix: PURCHASE_TRANSACTION_PREFIX });
    let outstandingDebt = 0;
    for (const grant of grants.values()) {
      if (!grant.refund || grant.refund.state !== "refunded") continue;
      if (
        !Number.isSafeInteger(grant.refund.debtOutstanding) ||
        grant.refund.debtOutstanding < 0 ||
        grant.refund.debtOutstanding > grant.refund.debtCreated
      ) {
        return "purchase_refund_record_invariant_failed";
      }
      outstandingDebt += grant.refund.debtOutstanding;
    }
    return outstandingDebt === (creditState.purchasedRefundDebt ?? 0)
      ? null
      : "purchase_refund_debt_invariant_failed";
  }

  private async applyPurchaseDebtOffset(
    storage: RequestExecutionStorage,
    debtOffset: number
  ): Promise<void> {
    const grants = await storage.list<PurchaseGrantRecord>({ prefix: PURCHASE_TRANSACTION_PREFIX });
    const refundable = [...grants.values()]
      .filter((grant) => grant.refund?.state === "refunded" && grant.refund.debtOutstanding > 0)
      .sort((left, right) => {
        const dateOrder = (left.refund?.refundedAt ?? "").localeCompare(right.refund?.refundedAt ?? "");
        return dateOrder !== 0 ? dateOrder : left.transactionId.localeCompare(right.transactionId);
      });
    let remaining = debtOffset;
    for (const storedGrant of refundable) {
      if (remaining <= 0) break;
      const grant = structuredClone(storedGrant);
      if (!grant.refund || grant.refund.state !== "refunded") continue;
      const applied = Math.min(grant.refund.debtOutstanding, remaining);
      grant.refund.debtOutstanding -= applied;
      remaining -= applied;
      await this.savePurchaseGrant(grant, storage);
    }
    if (remaining !== 0) {
      throw new AppError(409, "purchase_refund_debt_invariant_failed");
    }
  }

  private async buildMonthlyGrantIfNeeded(
    creditState: CreditStateRecord,
    creditsGranted: number,
    createdAt: string,
    operationIdOverride?: string,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<MonthlyGrantRecord | undefined> {
    if (creditsGranted <= 0) {
      return undefined;
    }

    const operationId =
      operationIdOverride ?? buildMonthlyGrantOperationId(creditState.plan, creditState.periodStart, creditState.periodEnd);
    const existing = (await storage.get<MonthlyGrantRecord>(buildMonthlyGrantKey(operationId))) as
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

  private async saveMonthlyGrant(
    grant: MonthlyGrantRecord,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<void> {
    await storage.put(buildMonthlyGrantKey(grant.operationId), grant);
  }

  private async buildMonthlyNoClawbackOperationIfNeeded(
    creditState: CreditStateRecord,
    previousMonthlyLimit: number,
    requestedMonthlyLimit: number,
    createdAt: string,
    _operationIdOverride?: string,
    storage: RequestExecutionStorage = this.state.storage
  ): Promise<CreditOperationRecord | undefined> {
    const operationId = buildMonthlyDowngradeNoClawbackOperationId(
      creditState.plan,
      previousMonthlyLimit,
      requestedMonthlyLimit,
      creditState.periodStart,
      creditState.periodEnd
    );
    const existing = await this.loadCreditOperation(operationId, storage);
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
    await storage.put(buildCreditOperationKey(operation.operationId), operation);
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

    // The keys are operation ids, not timestamps, so one lexicographic page is
    // the alphabetically first 500 records — not the oldest 500. Past a single
    // page the tail was never examined and expired operations accumulated for
    // good. Walk pages with startAfter, bounded, so every record is reachable.
    let startAfter: string | undefined;
    for (let page = 0; page < CREDIT_OPERATION_PRUNE_MAX_PAGES; page += 1) {
      const entries = await this.state.storage.list<CreditOperationRecord>({
        prefix: CREDIT_OPERATION_PREFIX,
        limit: CREDIT_OPERATION_PRUNE_PAGE_SIZE,
        ...(startAfter === undefined ? {} : { startAfter })
      });
      if (entries.size === 0) {
        return;
      }

      let lastKey: string | undefined;
      for (const [key, operation] of entries) {
        lastKey = key;
        const createdAtMs = Date.parse(operation?.createdAt ?? "");
        if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
          await this.state.storage.delete(key);
        }
      }

      if (entries.size < CREDIT_OPERATION_PRUNE_PAGE_SIZE || lastKey === undefined) {
        return;
      }
      startAfter = lastKey;
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

  private reply(payload: unknown, status: number, extraHeaders: HeadersInit = {}): Response {
    const headers = new Headers(extraHeaders);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");
    return new Response(JSON.stringify(payload), {
      status,
      headers
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
    welcomeRemaining: creditState.welcomeRemaining ?? 0,
    purchasedRemaining: creditState.purchasedRemaining,
    purchasedRefundDebt: creditState.purchasedRefundDebt ?? 0,
    totalRemaining,
    resetsAt: creditState.periodEnd
  };
}

function totalCreditRemaining(creditState: CreditStateRecord): number {
  return creditState.monthlyRemaining + (creditState.rewardedAdRemaining ?? 0) +
    (creditState.welcomeRemaining ?? 0) + creditState.purchasedRemaining;
}

function allocateCreditReservation(
  creditState: CreditStateRecord,
  creditsRequired: number
): CreditReservationAllocations {
  normalizeRewardedAdLots(creditState, new Date().toISOString());
  let remaining = creditsRequired;
  let consumedMonthly = 0;
  const rewardedAd: CreditReservationAllocations["rewardedAd"] = [];
  const expiringBuckets: Array<
    | { kind: "monthly"; expiresAt: string }
    | { kind: "rewarded"; expiresAt: string | null; lot: RewardedAdCreditLot }
  > = [
    ...(creditState.monthlyRemaining > 0 ? [{ kind: "monthly" as const, expiresAt: creditState.periodEnd }] : []),
    ...(creditState.rewardedAdLots ?? []).map((lot) => ({ kind: "rewarded" as const, expiresAt: lot.expiresAt, lot }))
  ].sort((left, right) => (left.expiresAt ?? "9999").localeCompare(right.expiresAt ?? "9999"));
  for (const bucket of expiringBuckets) {
    if (remaining <= 0) {
      break;
    }
    if (bucket.kind === "monthly") {
      const consumed = Math.min(creditState.monthlyRemaining, remaining);
      creditState.monthlyRemaining -= consumed;
      consumedMonthly += consumed;
      remaining -= consumed;
      continue;
    }
    const consumed = Math.min(bucket.lot.remaining, remaining);
    if (consumed <= 0) {
      continue;
    }
    bucket.lot.remaining -= consumed;
    remaining -= consumed;
    rewardedAd.push({ lotId: bucket.lot.lotId, credits: consumed, expiresAt: bucket.lot.expiresAt });
  }
  creditState.rewardedAdLots = (creditState.rewardedAdLots ?? []).filter((lot) => lot.remaining > 0);
  syncRewardedAdAggregate(creditState);

  const consumedWelcome = Math.min(creditState.welcomeRemaining ?? 0, remaining);
  creditState.welcomeRemaining = (creditState.welcomeRemaining ?? 0) - consumedWelcome;
  remaining -= consumedWelcome;

  const consumedPurchased = Math.min(creditState.purchasedRemaining, remaining);
  creditState.purchasedRemaining -= consumedPurchased;
  remaining -= consumedPurchased;
  if (remaining !== 0) {
    throw new Error("credit_reservation_allocation_invariant_failed");
  }

  return {
    monthly: consumedMonthly > 0
      ? {
          credits: consumedMonthly,
          periodStart: creditState.periodStart,
          periodEnd: creditState.periodEnd
        }
      : undefined,
    rewardedAd,
    welcome: consumedWelcome > 0 ? { credits: consumedWelcome } : undefined,
    purchased: consumedPurchased > 0 ? { credits: consumedPurchased } : undefined
  };
}

function migrateOrGrantWelcomeCredits(
  state: CreditStateRecord,
  plan: AccessPlan,
  welcomeEligible: boolean,
  now: string
): void {
  if (state.welcomeMigrationVersion !== 1) {
    if (plan === "free" && state.monthlyLimit > 0) {
      state.welcomeRemaining = Math.max(state.welcomeRemaining ?? 0, state.monthlyRemaining);
      state.welcomeGrantedAt ??= now;
      state.welcomeGrantOperationId ??= "welcome-migration:v1";
      state.monthlyRemaining = 0;
      state.monthlyLimit = 0;
    }
    state.welcomeMigrationVersion = 1;
  }
  if (welcomeEligible && !state.welcomeGrantOperationId) {
    state.welcomeRemaining = WELCOME_CREDIT_AMOUNT;
    state.welcomeGrantedAt = now;
    state.welcomeGrantOperationId = "welcome-grant:v1";
  }
}

function normalizeRewardedAdLots(creditState: CreditStateRecord, nowIso: string): void {
  if (!creditState.rewardedAdLots) {
    const existingRemaining = Math.max(0, creditState.rewardedAdRemaining ?? 0);
    creditState.rewardedAdLots = existingRemaining > 0
      ? [{
          lotId: buildRewardedAdLotId(creditState.rewardedAdExpiresAt ?? null),
          remaining: existingRemaining,
          expiresAt: creditState.rewardedAdExpiresAt ?? null
        }]
      : [];
  }

  const nowMs = Date.parse(nowIso);
  const merged = new Map<string, RewardedAdCreditLot>();
  for (const lot of creditState.rewardedAdLots) {
    if (!Number.isFinite(lot.remaining) || lot.remaining <= 0) {
      continue;
    }
    const expiresMs = lot.expiresAt === null ? Number.POSITIVE_INFINITY : Date.parse(lot.expiresAt);
    if ((lot.expiresAt !== null && !Number.isFinite(expiresMs)) || expiresMs <= nowMs) {
      continue;
    }
    const existing = merged.get(lot.lotId);
    if (existing && existing.expiresAt !== lot.expiresAt) {
      throw new Error("rewarded_ad_lot_expiry_mismatch");
    }
    if (existing) {
      existing.remaining += lot.remaining;
    } else {
      merged.set(lot.lotId, { ...lot });
    }
  }
  creditState.rewardedAdLots = [...merged.values()].sort(compareRewardedAdLots);
  syncRewardedAdAggregate(creditState);
}

function restoreRewardedAdLot(
  creditState: CreditStateRecord,
  allocation: { lotId: string; credits: number; expiresAt: string | null }
): void {
  const lots = creditState.rewardedAdLots ?? [];
  const existing = lots.find((lot) => lot.lotId === allocation.lotId);
  if (existing) {
    if (existing.expiresAt !== allocation.expiresAt) {
      throw new Error("rewarded_ad_lot_restore_expiry_mismatch");
    }
    existing.remaining += allocation.credits;
  } else {
    lots.push({
      lotId: allocation.lotId,
      remaining: allocation.credits,
      expiresAt: allocation.expiresAt
    });
  }
  creditState.rewardedAdLots = lots.sort(compareRewardedAdLots);
  syncRewardedAdAggregate(creditState);
}

function syncRewardedAdAggregate(creditState: CreditStateRecord): void {
  const lots = (creditState.rewardedAdLots ?? []).filter((lot) => lot.remaining > 0).sort(compareRewardedAdLots);
  creditState.rewardedAdLots = lots;
  creditState.rewardedAdRemaining = lots.reduce((sum, lot) => sum + lot.remaining, 0);
  creditState.rewardedAdExpiresAt = lots
    .map((lot) => lot.expiresAt)
    .filter((expiresAt): expiresAt is string => expiresAt !== null)
    .sort()[0];
}

function compareRewardedAdLots(left: RewardedAdCreditLot, right: RewardedAdCreditLot): number {
  if (left.expiresAt === right.expiresAt) {
    return left.lotId.localeCompare(right.lotId);
  }
  if (left.expiresAt === null) {
    return 1;
  }
  if (right.expiresAt === null) {
    return -1;
  }
  return left.expiresAt.localeCompare(right.expiresAt);
}

function buildRewardedAdLotId(expiresAt: string | null): string {
  return `rewarded-ad:${expiresAt ?? "legacy-undated"}`;
}

function expireRewardedAdCreditsIfNeeded(creditState: CreditStateRecord, nowIso: string): void {
  normalizeRewardedAdLots(creditState, nowIso);
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

function buildRequestExecutionKey(operationId: string): string {
  return `${REQUEST_EXECUTION_PREFIX}${operationId}`;
}

function buildCreditReservationKey(operationId: string): string {
  return `${CREDIT_RESERVATION_PREFIX}${operationId}`;
}

function buildCreditReservationDueKey(expiresAtMs: number, operationId: string): string {
  return `${CREDIT_RESERVATION_DUE_PREFIX}${Math.floor(expiresAtMs).toString().padStart(13, "0")}:${operationId}`;
}

function parseCreditReservationDueKey(key: string): number {
  if (!key.startsWith(CREDIT_RESERVATION_DUE_PREFIX)) {
    return Number.NaN;
  }
  const start = CREDIT_RESERVATION_DUE_PREFIX.length;
  return Number.parseInt(key.slice(start, start + 13), 10);
}

function operationIdFromCreditReservationDueKey(key: string): string | null {
  const start = CREDIT_RESERVATION_DUE_PREFIX.length + 14;
  return key.length > start ? key.slice(start) : null;
}

function buildMonthlyGrantKey(operationId: string): string {
  return `${MONTHLY_GRANT_PREFIX}${operationId}`;
}

function buildPurchaseTransactionKey(transactionId: string): string {
  return `${PURCHASE_TRANSACTION_PREFIX}${transactionId}`;
}

function buildPurchaseRefundOperationId(transactionId: string): string {
  return `purchase-refund:${transactionId}`;
}

function buildPurchaseRefundReversalOperationId(transactionId: string): string {
  return `purchase-refund-reversal:${transactionId}`;
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
  consumedWelcome,
  consumedPurchased,
  consumedMonthlyPeriodStart,
  consumedMonthlyPeriodEnd,
  consumedRewardedAdLots,
  originalOperationId,
  purchaseDebtOffset,
  refundAvailableRemoved,
  refundDebtCreated,
  refundDebtReleased,
  refundDebtSettledRestored,
  refundCreditsRestored,
  referenceType,
  referenceId,
  createdAt
}: {
  operationId: string;
  type: CreditOperationRecord["type"];
  status: "applied" | "insufficient" | "noop";
  delta: number;
  creditState: CreditStateRecord;
  creditsRequired?: number;
  consumedMonthly?: number;
  consumedRewardedAd?: number;
  consumedWelcome?: number;
  consumedPurchased?: number;
  consumedMonthlyPeriodStart?: string;
  consumedMonthlyPeriodEnd?: string;
  consumedRewardedAdLots?: Array<{
    lotId: string;
    credits: number;
    expiresAt: string | null;
  }>;
  originalOperationId?: string;
  purchaseDebtOffset?: number;
  refundAvailableRemoved?: number;
  refundDebtCreated?: number;
  refundDebtReleased?: number;
  refundDebtSettledRestored?: number;
  refundCreditsRestored?: number;
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
    consumedWelcome,
    consumedPurchased,
    consumedMonthlyPeriodStart,
    consumedMonthlyPeriodEnd,
    consumedRewardedAdLots,
    originalOperationId,
    purchaseRefundDebtAfter: creditState.purchasedRefundDebt ?? 0,
    purchaseDebtOffset,
    refundAvailableRemoved,
    refundDebtCreated,
    refundDebtReleased,
    refundDebtSettledRestored,
    refundCreditsRestored,
    referenceType,
    referenceId,
    createdAt
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isPrincipalMigrationSnapshot(value: unknown): value is PrincipalMigrationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<PrincipalMigrationSnapshot>;
  if (snapshot.version !== 1 || typeof snapshot.exportedAt !== "string" || snapshot.exportedAt.length > 128) return false;
  if (snapshot.creditState !== null && (typeof snapshot.creditState !== "object" || Array.isArray(snapshot.creditState))) return false;
  return isMigrationRecordEntries(snapshot.purchaseRecords, PURCHASE_TRANSACTION_PREFIX) &&
    isMigrationRecordEntries(snapshot.monthlyGrantRecords, MONTHLY_GRANT_PREFIX) &&
    isMigrationRecordEntries(snapshot.creditOperationRecords, CREDIT_OPERATION_PREFIX) &&
    isMigrationRecordEntries(snapshot.requestExecutionRecords ?? [], REQUEST_EXECUTION_PREFIX) &&
    isMigrationRecordEntries(snapshot.creditReservationRecords ?? [], CREDIT_RESERVATION_PREFIX);
}

function isMigrationRecordEntries(value: unknown, prefix: string): value is Array<[string, unknown]> {
  if (!Array.isArray(value) || value.length > 2_000) return false;
  const keys = new Set<string>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" ||
        !entry[0].startsWith(prefix) || entry[0].length > 512 || keys.has(entry[0])) {
      return false;
    }
    keys.add(entry[0]);
  }
  return true;
}

function principalMigrationSnapshotEntries(snapshot: PrincipalMigrationSnapshot): Array<[string, unknown]> {
  return [
    ...snapshot.purchaseRecords,
    ...snapshot.monthlyGrantRecords,
    ...snapshot.creditOperationRecords,
    ...(snapshot.requestExecutionRecords ?? []),
    ...(snapshot.creditReservationRecords ?? [])
  ];
}

function canonicalJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
