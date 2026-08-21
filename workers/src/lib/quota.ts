import type { Env, UsageState } from "../env";
import type { VerifiedAppleEnvironment } from "./apple-signed-data";
import {
  resolveCreditPackCredits,
  resolveMonthlyCreditLimit,
  resolvePlanLimits,
  type AccessPlan
} from "./billing-catalog";
import { loadDetachedAccessFromRequest } from "./detached-access";
import { loadActiveEntitlementFromRequest } from "./entitlements";
import { enqueueCreditAuditRepair } from "./credit-audit-repair";
import { AppError } from "./errors";
import { hashForLog, logEvent, logWarnEvent, suffixForLog } from "./logging";
import type { RemoteConfig } from "./remote-config";
import { installationQuotaSubject, resolveInstallationCredential } from "./installation-identity";
import { resolveAccountCredential } from "./account-recovery";
import { loadTestAutomationAccessFromRequest } from "./test-automation-access";
import { isLegacyClientCompatibilityRequestAuthorized } from "./legacy-client-compatibility";

export interface QuotaIdentity {
  quotaSubject: string;
  plan: AccessPlan;
  identityKind: "installation" | "device_key" | "ip_hash" | "local_device" | "entitlement" | "detached_device" | "account";
  accessMode?: string;
  chatLimitOverride?: number;
  stockLimitOverride?: number;
  activeSubscription?: {
    originalTransactionId?: string;
    transactionId?: string | null;
    productId: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    expiresAt?: string | null;
    monthlyCredits?: number | null;
    monthlyGrantOperationId?: string | null;
  };
}

interface QuotaIdentityOptions {
  requireDeviceKey?: boolean;
}

interface UsageEnvelope {
  usage: UsageState;
  didMutate?: boolean;
  creditOperation?: CreditOperationResult;
  monthlyGrant?: MonthlyGrantResult;
  creditsRequired?: number;
  creditsRemaining?: number;
  dailyRewardsUsed?: number;
  dailyRewardsRemaining?: number;
}

/**
 * How a credit purchase grant was authorised.
 * - "production" / "sandbox": which Apple endpoint verified the transaction.
 *   APPLE_APP_STORE_SERVER_ENVIRONMENT is "auto" in production, so both are
 *   reachable there.
 * - "internal": /v1/internal/credits/purchase-grant, which grants without any
 *   Apple verification. Recording it as "production" would invent an audit fact.
 */
export type CreditGrantEnvironment = VerifiedAppleEnvironment | "internal";

interface PurchaseTransactionRow {
  user_id: string;
  /** null on rows written before 0019: unknown environment, not "production". */
  verification_environment: CreditGrantEnvironment | null;
  product_id: string;
  transaction_id: string;
  original_transaction_id: string | null;
  credits_granted: number;
  status: "pending" | "granted" | "refunded" | "refund_reversed";
  debt_offset_applied: number;
  refunded_at: string | null;
  refund_reversed_at: string | null;
  refund_available_removed: number;
  refund_debt_created: number;
  refund_debt_released: number;
  refund_debt_settled_restored: number;
  refund_credits_restored: number;
  refund_notification_uuid: string | null;
  refund_reversed_notification_uuid: string | null;
  purchased_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuotaMutationResult {
  usage: UsageState;
  didMutate: boolean;
}

interface QuotaMutationOptions {
  relatedTickers?: readonly string[];
  operationId?: string;
}

export interface CreditReference {
  type: string;
  id: string;
}

export type RequestExecutionReservationOptions =
  | {
      mode: "credits";
      creditsRequired: number;
      reference: CreditReference;
    }
  | { mode: "legacy_chat" }
  | { mode: "unmetered" };

export type RequestExecutionReservationIntent =
  | {
      mode: "credits";
      creditsRequired: number;
      referenceType: string;
      referenceId: string;
      quota: {
        plan: AccessPlan;
        accessMode?: string;
        dateJST: string;
        monthlyCreditLimit: number;
        monthlyCreditPeriodStart?: string;
        monthlyCreditPeriodEnd?: string;
        monthlyGrantOperationId?: string;
      };
    }
  | {
      mode: "legacy_chat";
      slots: 1;
      quota: {
        plan: AccessPlan;
        accessMode?: string;
        dateJST: string;
        chatLimit: number;
      };
    }
  | { mode: "unmetered" };

export interface CreditMutationResult {
  usage: UsageState;
  didMutate: boolean;
  operationId: string;
  creditsCharged?: number;
  creditsRefunded?: number;
  creditsRemaining: number;
}

export interface PurchaseCreditGrantResult {
  usage: UsageState;
  didMutate: boolean;
  transactionId: string;
  productId: string;
  creditsPurchased: number;
  creditsGranted: number;
  creditsAppliedToRefundDebt: number;
  creditsRemaining: number;
  transactionStatus: "pending" | "granted";
}

export interface ConsumablePurchaseNotificationResult {
  found: boolean;
  quotaSubject?: string;
  transactionId: string;
  productId: string;
  outcome: "unclaimed" | "refunded" | "reinstated" | "already_reinstated" | "not_refunded";
  purchaseState: "unclaimed" | "granted" | "refunded" | "reinstated";
  didMutate: boolean;
  operation?: CreditOperationResult;
}

export interface EvalCreditGrantResult {
  usage: UsageState;
  didMutate: boolean;
  operationId: string;
  referenceId: string;
  creditsGranted: number;
  creditsRemaining: number;
}

export interface RewardedAdCreditGrantResult {
  usage: UsageState;
  didMutate: boolean;
  operationId: string;
  rewardIntentId: string;
  transactionId: string;
  status: "granted" | "duplicate_ignored" | "cap_reached";
  creditsGranted: number;
  creditsRemaining: number;
  dailyRewardsUsed: number;
  dailyRewardsRemaining: number;
}

export class InsufficientCreditsError extends AppError {
  constructor(
    readonly creditsRequired: number,
    readonly creditsRemaining: number
  ) {
    super(402, "insufficient_credits", "Credit balance is insufficient");
  }
}

export interface CreditOperationResult {
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
  purchaseRefundDebtAfter?: number;
  purchaseDebtOffset?: number;
  refundAvailableRemoved?: number;
  refundDebtCreated?: number;
  refundDebtReleased?: number;
  refundDebtSettledRestored?: number;
  refundCreditsRestored?: number;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
}

export interface MonthlyGrantResult {
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

export function buildRequestExecutionReservationIntent(
  identity: QuotaIdentity,
  config: RemoteConfig,
  reservation: RequestExecutionReservationOptions
): RequestExecutionReservationIntent {
  if (reservation.mode === "unmetered") {
    return { mode: "unmetered" };
  }

  const dateJST = buildQuotaDateJST();
  const limits = resolveIdentityLimits(identity, config);
  if (reservation.mode === "legacy_chat") {
    return {
      mode: "legacy_chat",
      slots: 1,
      quota: {
        plan: identity.plan,
        accessMode: identity.accessMode,
        dateJST,
        chatLimit: limits.chatLimit
      }
    };
  }

  return {
    mode: "credits",
    creditsRequired: reservation.creditsRequired,
    referenceType: reservation.reference.type,
    referenceId: reservation.reference.id,
    quota: {
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      monthlyCreditLimit: limits.monthlyCreditLimit,
      monthlyCreditPeriodStart: limits.monthlyCreditPeriodStart,
      monthlyCreditPeriodEnd: limits.monthlyCreditPeriodEnd,
      monthlyGrantOperationId: limits.monthlyGrantOperationId
    }
  };
}

export async function persistRequestExecutionAccounting(
  identity: QuotaIdentity,
  env: Env,
  effects: {
    monthlyGrant?: MonthlyGrantResult;
    creditOperation?: CreditOperationResult;
  }
): Promise<void> {
  if (effects.monthlyGrant) {
    await persistMonthlyGrant(env, identity, effects.monthlyGrant);
  }
  if (effects.creditOperation && effects.creditOperation.delta !== 0) {
    await persistCreditLedgerEntry(env, identity, effects.creditOperation);
  }
}
export async function readQuotaIdentity(
  request: Request,
  env: Env,
  options: QuotaIdentityOptions = {}
): Promise<QuotaIdentity> {
  const testAutomationAccess = await loadTestAutomationAccessFromRequest(request, env);
  if (testAutomationAccess) {
    return {
      quotaSubject: testAutomationAccess.quotaSubject,
      plan: "pro",
      identityKind: "detached_device",
      accessMode: testAutomationAccess.accessMode,
      chatLimitOverride: testAutomationAccess.chatLimitOverride,
      stockLimitOverride: testAutomationAccess.stockLimitOverride
    };
  }

  const deviceKey = request.headers.get("x-device-key")?.trim();
  const installationCredential = await resolveInstallationCredential(request, env);

  if (options.requireDeviceKey && !deviceKey && !installationCredential) {
    throw new AppError(400, "Installation credential is required");
  }

  const detachedAccess = await loadDetachedAccessFromRequest(request, env);
  if (detachedAccess) {
    return {
      quotaSubject: detachedAccess.quotaSubject,
      plan: "pro",
      identityKind: "detached_device",
      accessMode: detachedAccess.accessMode,
      chatLimitOverride: detachedAccess.chatLimitOverride,
      stockLimitOverride: detachedAccess.stockLimitOverride
    };
  }

  const syncedEntitlement = await loadActiveEntitlementFromRequest(request, env);
  const hasAccountCredential = Boolean(
    request.headers.get("x-kabuyomi-account-token")?.trim()
    || request.headers.get("authorization")?.trim().startsWith("Account ")
  );
  const accountCredential = hasAccountCredential
    ? await resolveAccountCredential(request, env)
    : null;

  if (accountCredential) {
    return {
      quotaSubject: accountCredential.accountPrincipal,
      plan: syncedEntitlement?.plan ?? "free",
      identityKind: "account",
      accessMode: "verified_apple_account",
      activeSubscription: syncedEntitlement ? {
        originalTransactionId: syncedEntitlement.originalTransactionId,
        transactionId: syncedEntitlement.transactionId,
        productId: syncedEntitlement.productId,
        periodStart: syncedEntitlement.subscriptionPeriodStart,
        periodEnd: syncedEntitlement.subscriptionPeriodEnd,
        expiresAt: syncedEntitlement.subscriptionExpiresAt,
        monthlyCredits: syncedEntitlement.subscriptionMonthlyCredits,
        monthlyGrantOperationId: syncedEntitlement.monthlyGrantOperationId
      } : undefined
    };
  }

  if (syncedEntitlement) {
    return {
      quotaSubject: syncedEntitlement.quotaSubject,
      plan: syncedEntitlement.plan,
      identityKind: "entitlement",
      activeSubscription: {
        originalTransactionId: syncedEntitlement.originalTransactionId,
        transactionId: syncedEntitlement.transactionId,
        productId: syncedEntitlement.productId,
        periodStart: syncedEntitlement.subscriptionPeriodStart,
        periodEnd: syncedEntitlement.subscriptionPeriodEnd,
        expiresAt: syncedEntitlement.subscriptionExpiresAt,
        monthlyCredits: syncedEntitlement.subscriptionMonthlyCredits,
        monthlyGrantOperationId: syncedEntitlement.monthlyGrantOperationId
      }
    };
  }

  if (installationCredential) {
    return {
      quotaSubject: installationQuotaSubject(installationCredential),
      plan: "free",
      identityKind: "installation",
      accessMode: installationCredential.creditMode === "full" ? "verified_installation" : "restricted_installation"
    };
  }

  if (isLocalQuotaFallbackRequest(request) && deviceKey) {
    return {
      quotaSubject: `free:local:${deviceKey}`,
      plan: "free",
      identityKind: "local_device"
    };
  }

  if (deviceKey) {
    if (isLegacyClientCompatibilityRequestAuthorized(request)) {
      return {
        quotaSubject: `free:device:${await sha256Hex(`free-device:${deviceKey}`)}`,
        plan: "free",
        identityKind: "device_key",
        accessMode: "legacy_client_compatibility"
      };
    }
    if (env.INSTALLATION_TOKEN_HMAC_KEY_V1?.trim()) {
      throw new AppError(401, "Server-issued installation credential is required");
    }
    return {
      quotaSubject: `free:device:${await sha256Hex(`free-device:${deviceKey}`)}`,
      plan: "free",
      identityKind: "device_key"
    };
  }

  const connectingIp = normalizeConnectingIp(request.headers.get("cf-connecting-ip"));
  if (connectingIp) {
    if (env.INSTALLATION_TOKEN_HMAC_KEY_V1?.trim()) {
      throw new AppError(401, "Server-issued installation credential is required");
    }
    return {
      quotaSubject: `free:${await sha256Hex(`free-ip:${connectingIp}`)}`,
      plan: "free",
      identityKind: "ip_hash"
    };
  }

  throw new AppError(400, "Client identity is unavailable");
}

export async function ensureChatQuotaAvailable(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "checkChat")).usage;
}

export async function ensureStockQuotaAvailable(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: QuotaMutationOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "checkStock", ticker, options)).usage;
}

export async function consumeChatQuota(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "consumeChat")).usage;
}

export async function refundChatQuota(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: { operationId: string }
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "refundChat", undefined, options)).usage;
}

export async function ensureMonthlyCreditGrant(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "ensureMonthlyCreditGrant")).usage;
}

export async function consumeCredit(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    operationId: string;
    creditsRequired: number;
    reference: CreditReference;
  }
): Promise<CreditMutationResult> {
  const result = await mutateCreditUsage(identity, env, config, "consumeCredit", {
    operationId: options.operationId,
    creditsRequired: options.creditsRequired,
    reference: options.reference
  });
  if (result.error === "insufficient_credits") {
    throw new InsufficientCreditsError(options.creditsRequired, result.creditsRemaining);
  }
  return {
    usage: result.usage,
    didMutate: result.didMutate,
    operationId: options.operationId,
    creditsCharged: result.creditOperation?.delta && result.creditOperation.delta < 0 ? -result.creditOperation.delta : 0,
    creditsRemaining: result.creditsRemaining
  };
}

export async function refundCredit(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    originalOperationId: string;
    refundOperationId: string;
    credits: number;
    reference: CreditReference;
  }
): Promise<CreditMutationResult> {
  const result = await mutateCreditUsage(identity, env, config, "refundCredit", {
    operationId: options.refundOperationId,
    originalOperationId: options.originalOperationId,
    credits: options.credits,
    reference: options.reference
  });
  return {
    usage: result.usage,
    didMutate: result.didMutate,
    operationId: options.refundOperationId,
    creditsRefunded: result.creditOperation?.delta && result.creditOperation.delta > 0 ? result.creditOperation.delta : 0,
    creditsRemaining: result.creditsRemaining
  };
}

export async function grantPurchasedCredits(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    productId: string;
    transactionId: string;
    originalTransactionId?: string;
    purchasedAt?: string;
    verificationEnvironment: CreditGrantEnvironment;
  }
): Promise<PurchaseCreditGrantResult> {
  assertPurchasedCreditGrantsEnabled(config);
  const creditsGranted = resolveCreditPackCredits(options.productId);
  if (!creditsGranted) {
    throw new AppError(400, "Unsupported credit product");
  }

  const transaction = await ensurePurchaseTransactionRow(identity, env, {
    productId: options.productId,
    transactionId: options.transactionId,
    originalTransactionId: options.originalTransactionId,
    creditsGranted,
    purchasedAt: options.purchasedAt,
    verificationEnvironment: options.verificationEnvironment
  });

  if (transaction.user_id !== identity.quotaSubject) {
    throw new AppError(409, "Purchase transaction already belongs to another user");
  }
  if (transaction.product_id !== options.productId || transaction.credits_granted !== creditsGranted) {
    throw new AppError(409, "Purchase transaction product mismatch");
  }
  if (transaction.status !== "pending" && transaction.status !== "granted") {
    throw new AppError(409, "Purchase transaction is in an unsupported state");
  }

  // APPLE_APP_STORE_SERVER_ENVIRONMENT is "auto" in production, so a transaction
  // Apple's production endpoint does not know is retried against sandbox and
  // still verifies. TestFlight Release builds talk to the production API while
  // StoreKit hands them sandbox transactions, so this is reachable without any
  // tampering. Recorded and logged here; whether such a grant should be blocked
  // is still an open product decision.
  const environmentLog = {
    quotaSubjectHash: hashForLog(identity.quotaSubject),
    transactionIdSuffix: suffixForLog(options.transactionId),
    productId: options.productId,
    verificationEnvironment: options.verificationEnvironment,
    recordedEnvironment: transaction.verification_environment,
    transactionStatus: transaction.status,
    creditsGranted
  };
  if (options.verificationEnvironment === "production") {
    logEvent("credit_purchase_grant_environment", environmentLog);
  } else {
    logWarnEvent("credit_purchase_grant_non_production_environment", environmentLog);
  }

  if (transaction.status === "granted") {
    const usage = await loadUsage(identity, env, config);
    const creditsAppliedToRefundDebt = transaction.debt_offset_applied ?? 0;
    return {
      usage,
      didMutate: false,
      transactionId: options.transactionId,
      productId: transaction.product_id,
      creditsPurchased: transaction.credits_granted,
      creditsGranted: transaction.credits_granted - creditsAppliedToRefundDebt,
      creditsAppliedToRefundDebt,
      creditsRemaining: usage.credits?.totalRemaining ?? 0,
      transactionStatus: "granted"
    };
  }

  const result = await mutatePurchaseCreditGrant(identity, env, config, {
    operationId: buildPurchaseOperationId(options.transactionId),
    transactionId: options.transactionId,
    productId: options.productId,
    originalTransactionId: options.originalTransactionId,
    purchasedAt: options.purchasedAt,
    purchaseCredits: creditsGranted
  });
  const creditsAppliedToRefundDebt = result.creditOperation?.purchaseDebtOffset ?? 0;
  try {
    await markPurchaseTransactionGranted(env, options.transactionId, creditsAppliedToRefundDebt);
  } catch (error) {
    await enqueueCreditAuditRepair(env, {
      kind: "purchase_transaction_mark",
      operationId: buildPurchaseOperationId(options.transactionId),
      quotaSubject: identity.quotaSubject,
      transactionId: options.transactionId,
      source: "grantPurchasedCredits.markPurchaseTransactionGranted",
      payload: {
        transactionId: options.transactionId,
        debtOffsetApplied: creditsAppliedToRefundDebt
      }
    });
    logWarnEvent("purchase_transaction_mark_granted_failed", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      operationIdSuffix: suffixForLog(buildPurchaseOperationId(options.transactionId)),
      transactionIdSuffix: suffixForLog(options.transactionId),
      errorClass: error instanceof Error ? error.name : typeof error
    });
    throw error;
  }

  return {
    usage: result.usage,
    didMutate: result.didMutate,
    transactionId: options.transactionId,
    productId: options.productId,
    creditsPurchased: creditsGranted,
    creditsGranted: creditsGranted - creditsAppliedToRefundDebt,
    creditsAppliedToRefundDebt,
    creditsRemaining: result.creditsRemaining,
    transactionStatus: "granted"
  };
}

export async function applyConsumablePurchaseNotification(
  env: Env,
  options: {
    action: "refund" | "reverse_refund";
    notificationId: string;
    transactionId: string;
    productId: string;
  }
): Promise<ConsumablePurchaseNotificationResult> {
  const catalogCredits = resolveCreditPackCredits(options.productId);
  if (!catalogCredits) {
    throw new AppError(400, "Unsupported credit product");
  }
  const transaction = await loadPurchaseTransactionRow(env, options.transactionId);
  if (!transaction) {
    return {
      found: false,
      transactionId: options.transactionId,
      productId: options.productId,
      outcome: "unclaimed",
      purchaseState: "unclaimed",
      didMutate: false
    };
  }
  if (transaction.product_id !== options.productId || transaction.credits_granted !== catalogCredits) {
    throw new AppError(409, "Purchase transaction authority mismatch");
  }

  const identity: QuotaIdentity = {
    quotaSubject: transaction.user_id,
    plan: "free",
    identityKind: "account"
  };
  const response = await env.USER_QUOTA.getByName(transaction.user_id).fetch(
    "https://do/purchase-adjustment",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: options.action,
        quotaSubject: transaction.user_id,
        transactionId: transaction.transaction_id,
        productId: transaction.product_id,
        creditsGranted: transaction.credits_granted,
        notificationId: options.notificationId
      })
    }
  );
  const payload = await response.json() as Omit<ConsumablePurchaseNotificationResult, "found" | "quotaSubject" | "transactionId" | "productId"> & {
    error?: string;
  };
  if (!response.ok) {
    throw new AppError(response.status, payload.error ?? "Purchase credit adjustment failed");
  }
  if (
    !payload.outcome ||
    !payload.purchaseState ||
    typeof payload.didMutate !== "boolean"
  ) {
    throw new AppError(502, "Purchase credit adjustment returned an invalid response");
  }
  if (payload.purchaseState === "unclaimed" && transaction.status === "granted") {
    throw new AppError(409, "Granted purchase is missing durable credit authority");
  }

  if (options.action === "refund") {
    if (payload.purchaseState === "refunded" || payload.purchaseState === "unclaimed") {
      await markPurchaseTransactionRefunded(env, transaction, options.notificationId, payload.operation);
    }
  } else if (payload.purchaseState === "reinstated") {
    await markPurchaseTransactionRefundReversed(env, transaction, options.notificationId, payload.operation);
  } else if (payload.purchaseState === "unclaimed") {
    await markUnclaimedPurchaseRefundReversed(env, transaction, options.notificationId);
  }

  if (payload.operation) {
    await writeCreditLedgerEntry(env, identity, payload.operation);
  }
  logEvent("credit_purchase_notification_adjustment", {
    quotaSubjectHash: hashForLog(transaction.user_id),
    transactionIdSuffix: suffixForLog(transaction.transaction_id),
    notificationIdSuffix: suffixForLog(options.notificationId),
    action: options.action,
    outcome: payload.outcome,
    didMutate: payload.didMutate,
    delta: payload.operation?.delta ?? 0,
    refundDebtAfter: payload.operation?.purchaseRefundDebtAfter ?? null
  });
  return {
    found: true,
    quotaSubject: transaction.user_id,
    transactionId: transaction.transaction_id,
    productId: transaction.product_id,
    outcome: payload.outcome,
    purchaseState: payload.purchaseState,
    didMutate: payload.didMutate,
    operation: payload.operation
  };
}

export function assertPurchasedCreditGrantsEnabled(
  config: Pick<RemoteConfig, "creditBillingEnabled" | "consumablePurchasesEnabled" | "emergencyPaidGrantsDisabled">
): void {
  if (!config.creditBillingEnabled || !config.consumablePurchasesEnabled || config.emergencyPaidGrantsDisabled) {
    throw new AppError(503, "Credit purchases are temporarily unavailable");
  }
}

export async function grantEvalCredits(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    deviceKey: string;
    credits: number;
    referenceId: string;
  }
): Promise<EvalCreditGrantResult> {
  const operationId = buildEvalGrantOperationId(options.referenceId, options.deviceKey);
  const result = await mutateEvalCreditGrant(identity, env, config, {
    operationId,
    credits: options.credits,
    referenceId: options.referenceId
  });

  return {
    usage: result.usage,
    didMutate: result.didMutate,
    operationId,
    referenceId: options.referenceId,
    creditsGranted: options.credits,
    creditsRemaining: result.creditsRemaining
  };
}

export async function grantRewardedAdCredits(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    rewardIntentId: string;
    transactionId: string;
    credits: number;
    expiresAt: string;
    dailyDateKey: string;
    dailyCap: number;
  }
): Promise<RewardedAdCreditGrantResult> {
  const operationId = buildRewardedAdOperationId(options.transactionId);
  const result = await mutateRewardedAdCreditGrant(identity, env, config, {
    operationId,
    credits: options.credits,
    rewardIntentId: options.rewardIntentId,
    transactionId: options.transactionId,
    expiresAt: options.expiresAt,
    dailyDateKey: options.dailyDateKey,
    dailyCap: options.dailyCap
  });

  const status =
    result.error === "daily_cap_reached"
      ? "cap_reached"
      : result.didMutate
        ? "granted"
        : "duplicate_ignored";

  return {
    usage: result.usage,
    didMutate: result.didMutate,
    operationId,
    rewardIntentId: result.creditOperation?.referenceId ?? options.rewardIntentId,
    transactionId: options.transactionId,
    status,
    creditsGranted: status === "granted" ? options.credits : 0,
    creditsRemaining: result.creditsRemaining,
    dailyRewardsUsed: result.dailyRewardsUsed,
    dailyRewardsRemaining: result.dailyRewardsRemaining
  };
}

export async function consumeStockQuota(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: QuotaMutationOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "consumeStock", ticker, options)).usage;
}

export async function consumeStockQuotaWithMutation(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: QuotaMutationOptions = {}
): Promise<QuotaMutationResult> {
  return mutateUsage(identity, env, config, "consumeStock", ticker, options);
}

export async function refundStockQuota(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: QuotaMutationOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "refundStock", ticker, options)).usage;
}

export async function promoteSavedTickerAlias(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: QuotaMutationOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "promoteTicker", ticker, options)).usage;
}

export async function removeTickerFromSavedQuota(
  identity: QuotaIdentity,
  ticker: string,
  env: Env,
  config: RemoteConfig,
  options: QuotaMutationOptions = {}
): Promise<UsageState> {
  return (await mutateUsage(identity, env, config, "removeTicker", ticker, options)).usage;
}

export async function ensureCompanyAccessAllowed(
  identity: QuotaIdentity,
  ticker: string,
  previewTickers: readonly string[],
  env: Env,
  config: RemoteConfig,
  options: QuotaMutationOptions = {}
): Promise<void> {
  if (identity.plan === "pro") {
    return;
  }

  const limits = resolveIdentityLimits(identity, config);

  const dateJST = buildQuotaDateJST();
  const response = await env.USER_QUOTA.getByName(identity.quotaSubject).fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "checkCompanyAccess",
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      ticker,
      chatLimit: limits.chatLimit,
      stockLimit: limits.stockLimit,
      monthlyCreditLimit: limits.monthlyCreditLimit,
      monthlyCreditPeriodStart: limits.monthlyCreditPeriodStart,
      monthlyCreditPeriodEnd: limits.monthlyCreditPeriodEnd,
      monthlyGrantOperationId: limits.monthlyGrantOperationId,
      previewTickers: normalizePreviewTickers(previewTickers),
      relatedTickers: normalizePreviewTickers(options.relatedTickers ?? [])
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!response.ok || !payload.usage) {
    logEvent("quota_denial", {
      action: "checkCompanyAccess",
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      plan: identity.plan,
      ticker: ticker.trim().toUpperCase(),
      reason: payload.error ?? "Quota request failed"
    });
    throw new AppError(response.status, payload.error ?? "Quota request failed");
  }
}

export async function loadUsage(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig
): Promise<UsageState> {
  return ensureMonthlyCreditGrant(identity, env, config);
}

function normalizeConnectingIp(rawValue: string | null): string | null {
  const candidate = rawValue?.split(",")[0]?.trim().toLowerCase();
  return candidate ? candidate : null;
}

function isLocalQuotaFallbackRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname.toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname.endsWith(".test");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mutateUsage(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  action:
    | "state"
    | "checkChat"
    | "checkStock"
    | "consumeChat"
    | "refundChat"
    | "consumeStock"
    | "refundStock"
    | "removeTicker"
    | "promoteTicker"
    | "ensureMonthlyCreditGrant",
  ticker?: string,
  options: QuotaMutationOptions = {}
): Promise<QuotaMutationResult> {
  const stub = env.USER_QUOTA.getByName(identity.quotaSubject);
  const dateJST = buildQuotaDateJST();
  const limits = resolveIdentityLimits(identity, config);

  const response = await stub.fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      ticker,
      relatedTickers: normalizePreviewTickers(options.relatedTickers ?? []),
      chatLimit: limits.chatLimit,
      stockLimit: limits.stockLimit,
      monthlyCreditLimit: limits.monthlyCreditLimit,
      monthlyCreditPeriodStart: limits.monthlyCreditPeriodStart,
      monthlyCreditPeriodEnd: limits.monthlyCreditPeriodEnd,
      monthlyGrantOperationId: limits.monthlyGrantOperationId,
      operationId: options.operationId
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!response.ok || !payload.usage) {
    logEvent("quota_denial", {
      action,
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      plan: identity.plan,
      reason: payload.error ?? "Quota request failed"
    });
    throw new AppError(response.status, payload.error ?? "Quota request failed");
  }

  if (payload.monthlyGrant) {
    await persistMonthlyGrant(env, identity, payload.monthlyGrant);
  }
  if (payload.creditOperation) {
    await persistCreditLedgerEntry(env, identity, payload.creditOperation);
    if (payload.creditOperation.referenceType === "subscription_downgrade_no_clawback") {
      logEvent("subscription_downgrade_no_clawback", {
        quotaSubjectHash: hashForLog(identity.quotaSubject),
        operationIdSuffix: suffixForLog(payload.creditOperation.operationId),
        plan: identity.plan,
        creditDelta: payload.creditOperation.delta,
        monthlyBalanceAfter: payload.creditOperation.monthlyBalanceAfter,
        purchasedBalanceAfter: payload.creditOperation.purchasedBalanceAfter,
        creditsRemaining: payload.creditOperation.balanceAfter
      });
    }
  }

  return {
    usage: payload.usage,
    didMutate: payload.didMutate === true
  };
}

function resolveIdentityLimits(identity: QuotaIdentity, config: RemoteConfig) {
  const planLimits = resolvePlanLimits(identity.plan, config);
  const subscriptionCredits = identity.activeSubscription?.monthlyCredits;
  return {
    chatLimit: identity.chatLimitOverride ?? planLimits.chatLimit,
    stockLimit: identity.stockLimitOverride ?? planLimits.stockLimit,
    monthlyCreditLimit:
      typeof subscriptionCredits === "number" && subscriptionCredits >= 0
        ? subscriptionCredits
        : resolveMonthlyCreditLimit(identity.plan, config),
    monthlyCreditPeriodStart: identity.activeSubscription?.periodStart ?? undefined,
    monthlyCreditPeriodEnd: identity.activeSubscription?.periodEnd ?? undefined,
    monthlyGrantOperationId: identity.activeSubscription?.monthlyGrantOperationId ?? undefined
  };
}

async function mutateCreditUsage(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  action: "consumeCredit" | "refundCredit",
  options: {
    operationId: string;
    originalOperationId?: string;
    creditsRequired?: number;
    credits?: number;
    reference: CreditReference;
  }
): Promise<
  QuotaMutationResult & {
    creditOperation?: CreditOperationResult;
    creditsRemaining: number;
    error?: string;
  }
> {
  const stub = env.USER_QUOTA.getByName(identity.quotaSubject);
  const dateJST = buildQuotaDateJST();
  const limits = resolveIdentityLimits(identity, config);
  const response = await stub.fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      chatLimit: limits.chatLimit,
      stockLimit: limits.stockLimit,
      monthlyCreditLimit: limits.monthlyCreditLimit,
      monthlyCreditPeriodStart: limits.monthlyCreditPeriodStart,
      monthlyCreditPeriodEnd: limits.monthlyCreditPeriodEnd,
      monthlyGrantOperationId: limits.monthlyGrantOperationId,
      operationId: options.operationId,
      originalOperationId: options.originalOperationId,
      creditsRequired: options.creditsRequired,
      credits: options.credits,
      referenceType: options.reference.type,
      referenceId: options.reference.id
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!payload.usage) {
    logEvent("quota_denial", {
      action,
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      plan: identity.plan,
      reason: payload.error ?? "Credit request failed"
    });
    throw new AppError(response.status, payload.error ?? "Credit request failed");
  }

  if (payload.monthlyGrant) {
    await persistMonthlyGrant(env, identity, payload.monthlyGrant);
  }
  if (payload.creditOperation) {
    await persistCreditLedgerEntry(env, identity, payload.creditOperation);
  }

  const creditsRemaining = payload.creditsRemaining ?? payload.usage.credits?.totalRemaining ?? 0;
  if (payload.error === "insufficient_credits") {
    logEvent("credit_consume", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      operationIdSuffix: suffixForLog(options.operationId),
      status: "insufficient",
      creditsRequired: options.creditsRequired ?? null,
      creditsRemaining
    });
  } else {
    logEvent(action === "consumeCredit" ? "credit_consume" : "credit_refund", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      operationIdSuffix: suffixForLog(options.operationId),
      status: payload.creditOperation?.status ?? "unknown",
      delta: payload.creditOperation?.delta ?? 0,
      creditsRemaining
    });
  }

  return {
    usage: payload.usage,
    didMutate: payload.didMutate === true,
    creditOperation: payload.creditOperation,
    creditsRemaining,
    error: payload.error
  };
}

async function mutatePurchaseCreditGrant(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    operationId: string;
    transactionId: string;
    productId: string;
    originalTransactionId?: string;
    purchasedAt?: string;
    purchaseCredits: number;
  }
): Promise<
  QuotaMutationResult & {
    creditOperation?: CreditOperationResult;
    creditsRemaining: number;
  }
> {
  const stub = env.USER_QUOTA.getByName(identity.quotaSubject);
  const dateJST = buildQuotaDateJST();
  const limits = resolveIdentityLimits(identity, config);
  const response = await stub.fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "grantPurchasedCredit",
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      chatLimit: limits.chatLimit,
      stockLimit: limits.stockLimit,
      monthlyCreditLimit: limits.monthlyCreditLimit,
      monthlyCreditPeriodStart: limits.monthlyCreditPeriodStart,
      monthlyCreditPeriodEnd: limits.monthlyCreditPeriodEnd,
      monthlyGrantOperationId: limits.monthlyGrantOperationId,
      operationId: options.operationId,
      transactionId: options.transactionId,
      productId: options.productId,
      originalTransactionId: options.originalTransactionId,
      purchasedAt: options.purchasedAt,
      purchaseCredits: options.purchaseCredits
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!response.ok || !payload.usage) {
    logEvent("quota_denial", {
      action: "grantPurchasedCredit",
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      plan: identity.plan,
      reason: payload.error ?? "Purchase credit grant failed"
    });
    throw new AppError(response.status, payload.error ?? "Purchase credit grant failed");
  }

  if (payload.monthlyGrant) {
    await persistMonthlyGrant(env, identity, payload.monthlyGrant);
  }
  if (payload.creditOperation) {
    await persistCreditLedgerEntry(env, identity, payload.creditOperation);
  }

  const creditsRemaining = payload.creditsRemaining ?? payload.usage.credits?.totalRemaining ?? 0;
  logEvent("credit_purchase_grant", {
    quotaSubjectHash: hashForLog(identity.quotaSubject),
    operationIdSuffix: suffixForLog(options.operationId),
    transactionIdSuffix: suffixForLog(options.transactionId),
    productId: options.productId,
    status: payload.creditOperation?.status ?? "unknown",
    delta: payload.creditOperation?.delta ?? 0,
    creditsRemaining
  });

  return {
    usage: payload.usage,
    didMutate: payload.didMutate === true,
    creditOperation: payload.creditOperation,
    creditsRemaining
  };
}

async function mutateEvalCreditGrant(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    operationId: string;
    credits: number;
    referenceId: string;
  }
): Promise<
  QuotaMutationResult & {
    creditOperation?: CreditOperationResult;
    creditsRemaining: number;
  }
> {
  const stub = env.USER_QUOTA.getByName(identity.quotaSubject);
  const dateJST = buildQuotaDateJST();
  const limits = resolveIdentityLimits(identity, config);
  const response = await stub.fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "grantEvalCredit",
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      chatLimit: limits.chatLimit,
      stockLimit: limits.stockLimit,
      monthlyCreditLimit: limits.monthlyCreditLimit,
      monthlyCreditPeriodStart: limits.monthlyCreditPeriodStart,
      monthlyCreditPeriodEnd: limits.monthlyCreditPeriodEnd,
      monthlyGrantOperationId: limits.monthlyGrantOperationId,
      operationId: options.operationId,
      credits: options.credits,
      referenceType: "eval_grant",
      referenceId: options.referenceId
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!response.ok || !payload.usage) {
    logEvent("quota_denial", {
      action: "grantEvalCredit",
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      plan: identity.plan,
      reason: payload.error ?? "Eval credit grant failed"
    });
    throw new AppError(response.status, payload.error ?? "Eval credit grant failed");
  }

  if (payload.monthlyGrant) {
    await persistMonthlyGrant(env, identity, payload.monthlyGrant);
  }
  if (payload.creditOperation && payload.creditOperation.delta !== 0) {
    await persistCreditLedgerEntry(env, identity, payload.creditOperation);
  }

  const creditsRemaining = payload.creditsRemaining ?? payload.usage.credits?.totalRemaining ?? 0;
  logEvent("credit_eval_grant", {
    quotaSubjectHash: hashForLog(identity.quotaSubject),
    operationIdSuffix: suffixForLog(options.operationId),
    referenceId: options.referenceId,
    status: payload.creditOperation?.status ?? "unknown",
    delta: payload.creditOperation?.delta ?? 0,
    creditsRemaining
  });

  return {
    usage: payload.usage,
    didMutate: payload.didMutate === true,
    creditOperation: payload.creditOperation,
    creditsRemaining
  };
}

async function mutateRewardedAdCreditGrant(
  identity: QuotaIdentity,
  env: Env,
  config: RemoteConfig,
  options: {
    operationId: string;
    credits: number;
    rewardIntentId: string;
    transactionId: string;
    expiresAt: string;
    dailyDateKey: string;
    dailyCap: number;
  }
): Promise<
  QuotaMutationResult & {
    creditOperation?: CreditOperationResult;
    creditsRemaining: number;
    dailyRewardsUsed: number;
    dailyRewardsRemaining: number;
    error?: string;
  }
> {
  const stub = env.USER_QUOTA.getByName(identity.quotaSubject);
  const dateJST = buildQuotaDateJST();
  const limits = resolveIdentityLimits(identity, config);
  const response = await stub.fetch("https://do/quota", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "grantRewardedAdCredit",
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      accessMode: identity.accessMode,
      dateJST,
      chatLimit: limits.chatLimit,
      stockLimit: limits.stockLimit,
      monthlyCreditLimit: limits.monthlyCreditLimit,
      monthlyCreditPeriodStart: limits.monthlyCreditPeriodStart,
      monthlyCreditPeriodEnd: limits.monthlyCreditPeriodEnd,
      monthlyGrantOperationId: limits.monthlyGrantOperationId,
      operationId: options.operationId,
      credits: options.credits,
      promoExpiresAt: options.expiresAt,
      dailyRewardDateKey: options.dailyDateKey,
      dailyRewardCap: options.dailyCap,
      referenceType: "admob_rewarded",
      referenceId: options.rewardIntentId,
      transactionId: options.transactionId
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if ((!response.ok && payload.error !== "daily_cap_reached") || !payload.usage) {
    logEvent("quota_denial", {
      action: "grantRewardedAdCredit",
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      plan: identity.plan,
      reason: payload.error ?? "Rewarded ad credit grant failed"
    });
    throw new AppError(response.status, payload.error ?? "Rewarded ad credit grant failed");
  }

  if (payload.monthlyGrant) {
    await persistMonthlyGrant(env, identity, payload.monthlyGrant);
  }
  if (payload.creditOperation && payload.creditOperation.delta !== 0) {
    await persistCreditLedgerEntry(env, identity, payload.creditOperation);
  }

  const creditsRemaining = payload.creditsRemaining ?? payload.usage.credits?.totalRemaining ?? 0;
  logEvent("rewarded_ad_credit_granted", {
    quotaSubjectHash: hashForLog(identity.quotaSubject),
    operationIdSuffix: suffixForLog(options.operationId),
    rewardIntentIdSuffix: suffixForLog(options.rewardIntentId),
    transactionIdSuffix: suffixForLog(options.transactionId),
    status: payload.creditOperation?.status ?? "unknown",
    delta: payload.creditOperation?.delta ?? 0,
    creditsRemaining,
    dailyRewardsUsed: payload.dailyRewardsUsed ?? null,
    dailyRewardsRemaining: payload.dailyRewardsRemaining ?? null
  });

  return {
    usage: payload.usage,
    didMutate: payload.didMutate === true,
    creditOperation: payload.creditOperation,
    creditsRemaining,
    dailyRewardsUsed: payload.dailyRewardsUsed ?? 0,
    dailyRewardsRemaining: payload.dailyRewardsRemaining ?? 0,
    error: payload.error
  };
}

function buildRewardedAdOperationId(transactionId: string): string {
  return `admob-reward:${transactionId}`;
}

async function ensurePurchaseTransactionRow(
  identity: QuotaIdentity,
  env: Env,
  options: {
    productId: string;
    transactionId: string;
    originalTransactionId?: string;
    creditsGranted: number;
    purchasedAt?: string;
    verificationEnvironment: CreditGrantEnvironment;
  }
): Promise<PurchaseTransactionRow> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO purchase_transactions (
      id,
      user_id,
      product_id,
      transaction_id,
      original_transaction_id,
      credits_granted,
      status,
      verification_environment,
      purchased_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      identity.quotaSubject,
      options.productId,
      options.transactionId,
      options.originalTransactionId ?? null,
      options.creditsGranted,
      "pending",
      options.verificationEnvironment,
      options.purchasedAt ?? null,
      now,
      now
    )
    .run();

  const row = await loadPurchaseTransactionRow(env, options.transactionId);
  if (!row) {
    throw new AppError(500, "Purchase transaction could not be recorded");
  }
  return row;
}

async function loadPurchaseTransactionRow(
  env: Env,
  transactionId: string
): Promise<PurchaseTransactionRow | null> {
  return env.DB.prepare(
    `SELECT
      user_id,
      product_id,
      transaction_id,
      original_transaction_id,
      credits_granted,
      status,
      verification_environment,
      debt_offset_applied,
      refunded_at,
      refund_reversed_at,
      refund_available_removed,
      refund_debt_created,
      refund_debt_released,
      refund_debt_settled_restored,
      refund_credits_restored,
      refund_notification_uuid,
      refund_reversed_notification_uuid,
      purchased_at,
      created_at,
      updated_at
    FROM purchase_transactions
    WHERE transaction_id = ?`
  )
    .bind(transactionId)
    .first<PurchaseTransactionRow>();
}

async function markPurchaseTransactionGranted(
  env: Env,
  transactionId: string,
  debtOffsetApplied: number
): Promise<void> {
  await env.DB.prepare(
    `UPDATE purchase_transactions
    SET status = ?, debt_offset_applied = ?, updated_at = ?
    WHERE transaction_id = ? AND status = 'pending'`
  )
    .bind("granted", debtOffsetApplied, new Date().toISOString(), transactionId)
    .run();
}

async function markPurchaseTransactionRefunded(
  env: Env,
  transaction: PurchaseTransactionRow,
  notificationId: string,
  operation?: CreditOperationResult
): Promise<void> {
  const now = operation?.createdAt ?? new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE purchase_transactions
     SET status = 'refunded',
         refunded_at = ?,
         refund_available_removed = ?,
         refund_debt_created = ?,
         refund_notification_uuid = COALESCE(refund_notification_uuid, ?),
         updated_at = ?
     WHERE transaction_id = ? AND user_id = ? AND product_id = ? AND credits_granted = ?`
  ).bind(
    now,
    operation?.refundAvailableRemoved ?? 0,
    operation?.refundDebtCreated ?? 0,
    notificationId,
    new Date().toISOString(),
    transaction.transaction_id,
    transaction.user_id,
    transaction.product_id,
    transaction.credits_granted
  ).run();
  assertPurchaseProjectionUpdated(result);
}

async function markPurchaseTransactionRefundReversed(
  env: Env,
  transaction: PurchaseTransactionRow,
  notificationId: string,
  operation?: CreditOperationResult
): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE purchase_transactions
     SET status = 'refund_reversed',
         refund_reversed_at = ?,
         refund_debt_released = ?,
         refund_debt_settled_restored = ?,
         refund_credits_restored = ?,
         refund_reversed_notification_uuid = COALESCE(refund_reversed_notification_uuid, ?),
         updated_at = ?
     WHERE transaction_id = ? AND user_id = ? AND product_id = ? AND credits_granted = ?`
  ).bind(
    operation?.createdAt ?? new Date().toISOString(),
    operation?.refundDebtReleased ?? 0,
    operation?.refundDebtSettledRestored ?? 0,
    operation?.refundCreditsRestored ?? 0,
    notificationId,
    new Date().toISOString(),
    transaction.transaction_id,
    transaction.user_id,
    transaction.product_id,
    transaction.credits_granted
  ).run();
  assertPurchaseProjectionUpdated(result);
}

async function markUnclaimedPurchaseRefundReversed(
  env: Env,
  transaction: PurchaseTransactionRow,
  notificationId: string
): Promise<void> {
  const result = await env.DB.prepare(
    `UPDATE purchase_transactions
     SET status = 'pending',
         refund_reversed_at = ?,
         refund_reversed_notification_uuid = COALESCE(refund_reversed_notification_uuid, ?),
         updated_at = ?
     WHERE transaction_id = ? AND user_id = ? AND product_id = ? AND credits_granted = ?`
  ).bind(
    new Date().toISOString(),
    notificationId,
    new Date().toISOString(),
    transaction.transaction_id,
    transaction.user_id,
    transaction.product_id,
    transaction.credits_granted
  ).run();
  assertPurchaseProjectionUpdated(result);
}

function assertPurchaseProjectionUpdated(result: D1Result<unknown>): void {
  const changes = Number(result.meta?.changes);
  if (Number.isFinite(changes) && changes < 1) {
    throw new AppError(409, "Purchase transaction authority changed during notification processing");
  }
}

async function persistMonthlyGrant(env: Env, identity: QuotaIdentity, grant: MonthlyGrantResult): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO monthly_grants (
        id,
        user_id,
        plan,
        period_start,
        period_end,
        credits_granted,
        operation_id,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(operation_id) DO NOTHING`
    )
      .bind(
        crypto.randomUUID(),
        identity.quotaSubject,
        grant.plan,
        grant.periodStart,
        grant.periodEnd,
        grant.creditsGranted,
        grant.operationId,
        grant.createdAt
      )
      .run();
  } catch (error) {
    await enqueueCreditAuditRepair(env, {
      kind: "monthly_grant",
      operationId: grant.operationId,
      quotaSubject: identity.quotaSubject,
      source: "persistMonthlyGrant.monthly_grants",
      payload: {
        userId: identity.quotaSubject,
        grant: {
          operationId: grant.operationId,
          plan: grant.plan,
          periodStart: grant.periodStart,
          periodEnd: grant.periodEnd,
          creditsGranted: grant.creditsGranted,
          createdAt: grant.createdAt
        }
      }
    });
    logWarnEvent("monthly_grant_write_failed", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      operationIdSuffix: suffixForLog(grant.operationId),
      reason: error instanceof Error ? error.message : String(error)
    });
  }

  await persistCreditLedgerEntry(env, identity, {
    operationId: grant.operationId,
    type: "monthly_grant",
    status: "applied",
    delta: grant.creditsGranted,
    balanceAfter: grant.balanceAfter,
    monthlyBalanceAfter: grant.monthlyBalanceAfter,
    purchasedBalanceAfter: grant.purchasedBalanceAfter,
    referenceType: "monthly_grant",
    referenceId: `${grant.plan}:${grant.periodStart}:${grant.periodEnd}`,
    createdAt: grant.createdAt
  });

  logEvent("credit_monthly_grant", {
    quotaSubjectHash: hashForLog(identity.quotaSubject),
    operationIdSuffix: suffixForLog(grant.operationId),
    plan: grant.plan,
    creditsGranted: grant.creditsGranted,
    creditsRemaining: grant.balanceAfter
  });
}

async function persistCreditLedgerEntry(
  env: Env,
  identity: QuotaIdentity,
  operation: CreditOperationResult
): Promise<void> {
  try {
    await writeCreditLedgerEntry(env, identity, operation);
  } catch (error) {
    await enqueueCreditAuditRepair(env, {
      kind: "credit_ledger",
      operationId: operation.operationId,
      quotaSubject: identity.quotaSubject,
      source: "persistCreditLedgerEntry.credit_ledger",
      payload: {
        userId: identity.quotaSubject,
        operation
      }
    });
    logWarnEvent("credit_ledger_write_failed", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      operationIdSuffix: suffixForLog(operation.operationId),
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

async function writeCreditLedgerEntry(
  env: Env,
  identity: QuotaIdentity,
  operation: CreditOperationResult
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO credit_ledger (
      id,
      user_id,
      operation_id,
      type,
      delta,
      balance_after,
      monthly_balance_after,
      purchased_balance_after,
      reference_type,
      reference_id,
      metadata_json,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      identity.quotaSubject,
      operation.operationId,
      operation.type,
      operation.delta,
      operation.balanceAfter,
      operation.monthlyBalanceAfter,
      operation.purchasedBalanceAfter,
      operation.referenceType ?? null,
      operation.referenceId ?? null,
      JSON.stringify({
        status: operation.status,
        originalOperationId: operation.originalOperationId ?? null,
        rewardedAdBalanceAfter: operation.rewardedAdBalanceAfter ?? null,
        rewardedAdExpiresAt: operation.rewardedAdExpiresAt ?? null,
        creditsRequired: operation.creditsRequired ?? null,
        consumedMonthly: operation.consumedMonthly ?? null,
        consumedRewardedAd: operation.consumedRewardedAd ?? null,
        consumedWelcome: operation.consumedWelcome ?? null,
        consumedPurchased: operation.consumedPurchased ?? null,
        consumedMonthlyPeriodStart: operation.consumedMonthlyPeriodStart ?? null,
        consumedMonthlyPeriodEnd: operation.consumedMonthlyPeriodEnd ?? null,
        consumedRewardedAdLots: operation.consumedRewardedAdLots ?? [],
        purchaseRefundDebtAfter: operation.purchaseRefundDebtAfter ?? null,
        purchaseDebtOffset: operation.purchaseDebtOffset ?? null,
        refundAvailableRemoved: operation.refundAvailableRemoved ?? null,
        refundDebtCreated: operation.refundDebtCreated ?? null,
        refundDebtReleased: operation.refundDebtReleased ?? null,
        refundDebtSettledRestored: operation.refundDebtSettledRestored ?? null,
        refundCreditsRestored: operation.refundCreditsRestored ?? null,
        creditSource: operation.type === "admob_rewarded_grant" ? "admob_rewarded" : null
      }),
      operation.createdAt
    )
    .run();
}

export function buildQuotaDateJST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function buildPurchaseOperationId(transactionId: string): string {
  return `purchase:${transactionId}`;
}

function buildEvalGrantOperationId(referenceId: string, deviceKey: string): string {
  return `eval-grant:${referenceId}:${deviceKey}`;
}

function normalizePreviewTickers(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const ticker = value.trim().toUpperCase();
    if (!ticker || seen.has(ticker)) {
      continue;
    }
    seen.add(ticker);
    normalized.push(ticker);
  }

  return normalized;
}
