import type { Env, UsageState } from "../env";
import {
  resolveCreditPackCredits,
  resolveMonthlyCreditLimit,
  resolvePlanLimits,
  type AccessPlan
} from "./billing-catalog";
import { loadDetachedAccessFromRequest } from "./detached-access";
import { loadActiveEntitlementFromRequest } from "./entitlements";
import { AppError } from "./errors";
import { logEvent, logWarnEvent } from "./logging";
import type { RemoteConfig } from "./remote-config";

export interface QuotaIdentity {
  quotaSubject: string;
  plan: AccessPlan;
  identityKind: "device_key" | "ip_hash" | "local_device" | "entitlement" | "detached_device";
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
}

interface PurchaseTransactionRow {
  user_id: string;
  product_id: string;
  transaction_id: string;
  original_transaction_id: string | null;
  credits_granted: number;
  status: "pending" | "granted";
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
  creditsGranted: number;
  creditsRemaining: number;
  transactionStatus: "pending" | "granted";
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
  creditsGranted: number;
  creditsRemaining: number;
}

export class InsufficientCreditsError extends AppError {
  constructor(
    readonly creditsRequired: number,
    readonly creditsRemaining: number
  ) {
    super(402, "insufficient_credits", "Credit balance is insufficient");
  }
}

interface CreditOperationResult {
  operationId: string;
  type: "consume" | "refund" | "monthly_grant" | "purchase_grant" | "eval_grant" | "admob_rewarded_grant";
  status: "applied" | "insufficient" | "noop";
  delta: number;
  balanceAfter: number;
  monthlyBalanceAfter: number;
  rewardedAdBalanceAfter?: number;
  rewardedAdExpiresAt?: string;
  purchasedBalanceAfter: number;
  originalOperationId?: string;
  referenceType?: string;
  referenceId?: string;
  createdAt: string;
}

interface MonthlyGrantResult {
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
export async function readQuotaIdentity(
  request: Request,
  env: Env,
  options: QuotaIdentityOptions = {}
): Promise<QuotaIdentity> {
  const deviceKey = request.headers.get("x-device-key")?.trim();

  if (options.requireDeviceKey && !deviceKey) {
    throw new AppError(400, "Device key is required");
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

  if (isLocalQuotaFallbackRequest(request) && deviceKey) {
    return {
      quotaSubject: `free:local:${deviceKey}`,
      plan: "free",
      identityKind: "local_device"
    };
  }

  if (deviceKey) {
    return {
      quotaSubject: `free:device:${await sha256Hex(`free-device:${deviceKey}`)}`,
      plan: "free",
      identityKind: "device_key"
    };
  }

  const connectingIp = normalizeConnectingIp(request.headers.get("cf-connecting-ip"));
  if (connectingIp) {
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
  }
): Promise<PurchaseCreditGrantResult> {
  const creditsGranted = resolveCreditPackCredits(options.productId);
  if (!creditsGranted) {
    throw new AppError(400, "Unsupported credit product");
  }

  const transaction = await ensurePurchaseTransactionRow(identity, env, {
    productId: options.productId,
    transactionId: options.transactionId,
    originalTransactionId: options.originalTransactionId,
    creditsGranted,
    purchasedAt: options.purchasedAt
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

  if (transaction.status === "granted") {
    const usage = await loadUsage(identity, env, config);
    return {
      usage,
      didMutate: false,
      transactionId: options.transactionId,
      productId: transaction.product_id,
      creditsGranted: transaction.credits_granted,
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
  await markPurchaseTransactionGranted(env, options.transactionId);

  return {
    usage: result.usage,
    didMutate: result.didMutate,
    transactionId: options.transactionId,
    productId: options.productId,
    creditsGranted,
    creditsRemaining: result.creditsRemaining,
    transactionStatus: "granted"
  };
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
  }
): Promise<RewardedAdCreditGrantResult> {
  const operationId = buildRewardedAdOperationId(options.transactionId);
  const result = await mutateRewardedAdCreditGrant(identity, env, config, {
    operationId,
    credits: options.credits,
    rewardIntentId: options.rewardIntentId,
    transactionId: options.transactionId,
    expiresAt: options.expiresAt
  });

  return {
    usage: result.usage,
    didMutate: result.didMutate,
    operationId,
    rewardIntentId: options.rewardIntentId,
    transactionId: options.transactionId,
    creditsGranted: options.credits,
    creditsRemaining: result.creditsRemaining
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
      quotaSubject: identity.quotaSubject,
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
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      reason: payload.error ?? "Quota request failed"
    });
    throw new AppError(response.status, payload.error ?? "Quota request failed");
  }

  if (payload.monthlyGrant) {
    await persistMonthlyGrant(env, identity, payload.monthlyGrant);
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
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      reason: payload.error ?? "Credit request failed"
    });
    throw new AppError(response.status, payload.error ?? "Credit request failed");
  }

  if (payload.monthlyGrant) {
    await persistMonthlyGrant(env, identity, payload.monthlyGrant);
  }
  if (payload.creditOperation && payload.creditOperation.delta !== 0) {
    await persistCreditLedgerEntry(env, identity, payload.creditOperation);
  }

  const creditsRemaining = payload.creditsRemaining ?? payload.usage.credits?.totalRemaining ?? 0;
  if (payload.error === "insufficient_credits") {
    logEvent("credit_consume", {
      userId: identity.quotaSubject,
      operationId: options.operationId,
      status: "insufficient",
      creditsRequired: options.creditsRequired ?? null,
      creditsRemaining
    });
  } else {
    logEvent(action === "consumeCredit" ? "credit_consume" : "credit_refund", {
      userId: identity.quotaSubject,
      operationId: options.operationId,
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
      quotaSubject: identity.quotaSubject,
      plan: identity.plan,
      reason: payload.error ?? "Purchase credit grant failed"
    });
    throw new AppError(response.status, payload.error ?? "Purchase credit grant failed");
  }

  if (payload.monthlyGrant) {
    await persistMonthlyGrant(env, identity, payload.monthlyGrant);
  }
  if (payload.creditOperation && payload.creditOperation.delta !== 0) {
    await persistCreditLedgerEntry(env, identity, payload.creditOperation);
  }

  const creditsRemaining = payload.creditsRemaining ?? payload.usage.credits?.totalRemaining ?? 0;
  logEvent("credit_purchase_grant", {
    userId: identity.quotaSubject,
    operationId: options.operationId,
    transactionId: options.transactionId,
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
      quotaSubject: identity.quotaSubject,
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
    userId: identity.quotaSubject,
    operationId: options.operationId,
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
      referenceType: "admob_rewarded",
      referenceId: options.rewardIntentId,
      transactionId: options.transactionId
    })
  });

  const payload = (await response.json()) as UsageEnvelope & { error?: string };
  if (!response.ok || !payload.usage) {
    logEvent("quota_denial", {
      action: "grantRewardedAdCredit",
      quotaSubject: identity.quotaSubject,
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
    userId: identity.quotaSubject,
    operationId: options.operationId,
    rewardIntentId: options.rewardIntentId,
    transactionId: options.transactionId,
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
      purchased_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      identity.quotaSubject,
      options.productId,
      options.transactionId,
      options.originalTransactionId ?? null,
      options.creditsGranted,
      "pending",
      options.purchasedAt ?? null,
      now,
      now
    )
    .run();

  const row = await env.DB.prepare(
    `SELECT
      user_id,
      product_id,
      transaction_id,
      original_transaction_id,
      credits_granted,
      status,
      purchased_at,
      created_at,
      updated_at
    FROM purchase_transactions
    WHERE transaction_id = ?`
  )
    .bind(options.transactionId)
    .first<PurchaseTransactionRow>();
  if (!row) {
    throw new AppError(500, "Purchase transaction could not be recorded");
  }
  return row;
}

async function markPurchaseTransactionGranted(env: Env, transactionId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE purchase_transactions
    SET status = ?, updated_at = ?
    WHERE transaction_id = ?`
  )
    .bind("granted", new Date().toISOString(), transactionId)
    .run();
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
    logWarnEvent("monthly_grant_write_failed", {
      userId: identity.quotaSubject,
      operationId: grant.operationId,
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
    userId: identity.quotaSubject,
    operationId: grant.operationId,
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
          creditSource: operation.type === "admob_rewarded_grant" ? "admob_rewarded" : null
        }),
        operation.createdAt
      )
      .run();
  } catch (error) {
    logWarnEvent("credit_ledger_write_failed", {
      userId: identity.quotaSubject,
      operationId: operation.operationId,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
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
