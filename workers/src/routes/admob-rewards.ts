import type { Env, UsageState } from "../env";
import { verifyAdMobSsvCallback } from "../lib/admob-ssv";
import { enqueueCreditAuditRepair, type AdMobRewardTransactionRepairPayload } from "../lib/credit-audit-repair";
import { AdMobRewardIntentRequestSchema } from "../lib/contracts";
import { AppError } from "../lib/errors";
import { hashForLog, logEvent, logWarnEvent, suffixForLog } from "../lib/logging";
import {
  buildQuotaDateJST,
  grantRewardedAdCredits,
  loadUsage,
  readQuotaIdentity,
  type QuotaIdentity
} from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import type { RemoteConfig } from "../lib/remote-config";
import type { RouteHandler } from "./types";

const REWARD_CREDITS = 2;
const DAILY_REWARD_CAP = 3;
const INTENT_TTL_MS = 30 * 60 * 1000;
const PROMO_CREDIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_MAX_BYTES = 512;

interface RewardIntentRow {
  id: string;
  user_id: string;
  custom_data: string;
  reward_credits: number;
  status: "pending" | "granted" | "expired" | "rejected";
  daily_date_key: string;
  expires_at: string;
  created_at: string;
  granted_at: string | null;
  transaction_id: string | null;
  credits_remaining: number | null;
}

interface RewardTransactionRow {
  transaction_id: string;
  user_id: string;
  reward_intent_id: string;
  status: "granted" | "rejected";
  operation_id: string;
}

export const handleAdMobRewardRoutes: RouteHandler = async ({ request, url, env, config }) => {
  if (request.method === "POST" && url.pathname === "/v1/admob/reward-intents") {
    await parseJsonBody(request, AdMobRewardIntentRequestSchema, {
      invalidMessage: "Invalid rewarded ad intent payload",
      maxBytes: REQUEST_MAX_BYTES,
      allowEmptyObject: true
    });
    const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
    const capability = await buildRewardedCreditCapability(env, config, identity);
    const requestedAdUnit = request.headers.get("x-kabuyomi-ad-unit-id")?.trim();
    const requestedEnvironment = request.headers.get("x-kabuyomi-ad-environment")?.trim().toLowerCase();
    if (!capability.enabled || requestedAdUnit !== env.ADMOB_REWARDED_AD_UNIT_ID?.trim() ||
        requestedEnvironment !== capability.environment) {
      throw new AppError(503, "Rewarded credits are unavailable");
    }
    const dateKey = buildQuotaDateJST();
    const grantedToday = await countGrantedRewards(env, identity.quotaSubject, dateKey);
    if (grantedToday >= DAILY_REWARD_CAP) {
      return json(
        {
          error: "daily_cap_reached",
          rewardCredits: REWARD_CREDITS,
          dailyRemaining: 0
        },
        { status: 429 }
      );
    }

    const now = new Date();
    const rewardIntentId = crypto.randomUUID();
    const customData = `${rewardIntentId}.${crypto.randomUUID()}`;
    const expiresAt = new Date(now.getTime() + INTENT_TTL_MS).toISOString();
    await env.DB.prepare(
      `INSERT INTO admob_reward_intents (
        id,
        user_id,
        custom_data,
        reward_credits,
        status,
        daily_date_key,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        rewardIntentId,
        identity.quotaSubject,
        customData,
        REWARD_CREDITS,
        "pending",
        dateKey,
        expiresAt,
        now.toISOString()
      )
      .run();

    logEvent("rewarded_ad_intent_created", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      rewardIntentIdSuffix: suffixForLog(rewardIntentId),
      dailyRemaining: DAILY_REWARD_CAP - grantedToday
    });

    return json({
      rewardIntentId,
      customData,
      rewardCredits: REWARD_CREDITS,
      dailyRemaining: DAILY_REWARD_CAP - grantedToday
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/admob/reward-status") {
    const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
    const rewardIntentId = url.searchParams.get("id")?.trim();
    if (!rewardIntentId) {
      throw new AppError(400, "Reward intent id is required");
    }
    const intent = await loadRewardIntentById(env, rewardIntentId);
    if (!intent || intent.user_id !== identity.quotaSubject) {
      throw new AppError(404, "Reward intent not found");
    }
    const usage = await loadUsage(identity, env, config);
    return json({
      rewardIntentId: intent.id,
      status: effectiveIntentStatus(intent),
      rewardCredits: intent.reward_credits,
      creditsRemaining: intent.credits_remaining ?? usage.credits?.totalRemaining ?? 0,
      dailyRemaining:
        intent.status === "rejected"
          ? 0
          : Math.max(0, DAILY_REWARD_CAP - (await countGrantedRewards(env, identity.quotaSubject, intent.daily_date_key))),
      usage
    });
  }

  if (request.method === "GET" && url.pathname === "/v1/admob/ssv") {
    const verified = await safeVerifySsv(url, env);
    if (!verified) {
      logWarnEvent("rewarded_ad_ssv_invalid_signature", {
        reason: "verify_failed",
        signaturePresent: url.searchParams.has("signature")
      });
      return json({ error: "invalid_signature" }, { status: 401 });
    }

    const result = await processSsvGrant(url, env, config);
    return json(result);
  }

  return null;
};

export async function buildRewardedCreditCapability(
  env: Env,
  config: RemoteConfig,
  identity: QuotaIdentity
) {
  const environment = (env.KABUYOMI_ENV ?? env.ENVIRONMENT ?? "unknown").trim().toLowerCase();
  // The verifier has Google's documented public-key URL as a built-in
  // default. Requiring an override URL here would incorrectly hide the
  // already-shipping rewarded flow in production.
  const ssvConfigured = Boolean(env.ADMOB_REWARDED_AD_UNIT_ID?.trim());
  const emergencyDisabled = truthy(env.EMERGENCY_DISABLE_ADS) || truthy(env.EMERGENCY_DISABLE_REWARDS);
  const enabled = config.adsEnabled && config.rewardedCreditEnabled && config.rewardedSsvReady && ssvConfigured && !emergencyDisabled;
  const grantedToday = await countGrantedRewards(env, identity.quotaSubject, buildQuotaDateJST()).catch(() => DAILY_REWARD_CAP);
  const reasonCode = enabled
    ? undefined
    : emergencyDisabled
      ? "emergency_disabled"
      : !config.adsEnabled
        ? "ads_disabled"
        : !config.rewardedCreditEnabled
          ? "rewarded_credit_disabled"
          : !config.rewardedSsvReady || !ssvConfigured
            ? "ssv_not_ready"
            : "environment_unavailable";
  return {
    enabled,
    rewardedCreditEnabled: config.rewardedCreditEnabled,
    ssvReady: config.rewardedSsvReady && ssvConfigured,
    environment,
    dailyCap: DAILY_REWARD_CAP,
    dailyRemaining: Math.max(0, DAILY_REWARD_CAP - grantedToday),
    rewardCredits: REWARD_CREDITS,
    expiryDays: 30,
    reasonCode,
    configVersion: config.configVersion,
    emergencyDisabled
  };
}

async function processSsvGrant(url: URL, env: Env, config: RemoteConfig) {
  if (!(config.adsEnabled && config.rewardedCreditEnabled && config.rewardedSsvReady) || truthy(env.EMERGENCY_DISABLE_REWARDS)) {
    throw new AppError(503, "Rewarded credits are unavailable");
  }
  const customData = requiredAnyParam(url, ["custom_data", "customData"], "rewarded_ad_ssv_missing_custom_data");
  const expectedAdUnit = env.ADMOB_REWARDED_AD_UNIT_ID?.trim();
  if (!expectedAdUnit) {
    logWarnEvent("rewarded_ad_ssv_not_configured", {
      customDataPresent: true
    });
    throw new AppError(503, "Rewarded ads are not configured");
  }

  const intent = await loadRewardIntentByCustomData(env, customData);
  if (!intent) {
    logWarnEvent("rewarded_ad_ssv_unknown_custom_data", {
      customDataPresent: true,
      customDataSuffix: suffixForLog(customData)
    });
    throw new AppError(400, "Invalid rewarded ad custom data");
  }
  if (effectiveIntentStatus(intent) !== "pending" && intent.status !== "granted") {
    logWarnEvent("rewarded_ad_ssv_intent_not_grantable", {
      rewardIntentIdSuffix: suffixForLog(intent.id),
      status: intent.status,
      effectiveStatus: effectiveIntentStatus(intent),
      expiresAt: intent.expires_at
    });
    throw new AppError(400, "Reward intent is not grantable");
  }

  const transactionId = optionalParam(url, "transaction_id");
  const adUnit = optionalParam(url, "ad_unit");
  if (adUnit && !isAllowedRewardedAdUnit(adUnit, expectedAdUnit)) {
    if (isAdMobConsoleVerificationCallback(url)) {
      logEvent("rewarded_ad_ssv_console_verify_no_grant", {
        rewardIntentIdSuffix: suffixForLog(intent.id),
        transactionIdSuffix: suffixForLog(transactionId),
        adUnitSuffix: suffixForLog(adUnit),
        queryKeys: collectQueryKeys(url.searchParams)
      });
      return {
        status: "verified_no_grant",
        rewardIntentId: intent.id,
        creditsGranted: 0
      };
    }
    logWarnEvent("rewarded_ad_ssv_invalid_ad_unit", {
      transactionIdSuffix: suffixForLog(transactionId),
      adUnitSuffix: suffixForLog(adUnit),
      expectedAdUnitSuffix: suffixForLog(expectedAdUnit)
    });
    throw new AppError(400, "Invalid rewarded ad unit");
  }
  if (!transactionId || !adUnit) {
    logEvent("rewarded_ad_ssv_verified_no_grant", {
      rewardIntentIdSuffix: suffixForLog(intent.id),
      missingTransactionId: !transactionId,
      missingAdUnit: !adUnit,
      adUnitSuffix: suffixForLog(adUnit)
    });
    return {
      status: "verified_no_grant",
      rewardIntentId: intent.id,
      creditsGranted: 0
    };
  }
  validateRewardPayload(url, {
    transactionId,
    rewardIntentId: intent.id
  });

  logEvent("rewarded_ad_ssv_received", {
    transactionIdSuffix: suffixForLog(transactionId),
    adUnitSuffix: suffixForLog(adUnit),
    customDataPresent: true,
    expectedAdUnitSuffix: suffixForLog(expectedAdUnit)
  });

  const existingTransaction = await loadRewardTransaction(env, transactionId);
  if (existingTransaction?.status === "granted") {
    const usage = await loadUsage(identityFromQuotaSubject(existingTransaction.user_id), env, config);
    logEvent("rewarded_ad_duplicate_ignored", {
      quotaSubjectHash: hashForLog(existingTransaction.user_id),
      transactionIdSuffix: suffixForLog(transactionId),
      rewardIntentIdSuffix: suffixForLog(existingTransaction.reward_intent_id)
    });
    return {
      status: "duplicate_ignored",
      rewardIntentId: existingTransaction.reward_intent_id,
      creditsGranted: 0,
      creditsRemaining: usage.credits?.totalRemaining ?? 0,
      usage
    };
  }

  if (intent.status === "granted") {
    const usage = await loadUsage(identityFromQuotaSubject(intent.user_id), env, config);
    return {
      status: "already_granted",
      rewardIntentId: intent.id,
      creditsGranted: 0,
      creditsRemaining: usage.credits?.totalRemaining ?? 0,
      usage
    };
  }
  if (effectiveIntentStatus(intent) !== "pending") {
    logWarnEvent("rewarded_ad_ssv_intent_not_grantable", {
      transactionIdSuffix: suffixForLog(transactionId),
      rewardIntentIdSuffix: suffixForLog(intent.id),
      status: intent.status,
      effectiveStatus: effectiveIntentStatus(intent),
      expiresAt: intent.expires_at
    });
    throw new AppError(400, "Reward intent is not grantable");
  }

  const identity = identityFromQuotaSubject(intent.user_id);
  const expiresAt = new Date(Date.now() + PROMO_CREDIT_TTL_MS).toISOString();
  const grant = await grantRewardedAdCredits(identity, env, config, {
    rewardIntentId: intent.id,
    transactionId,
    credits: REWARD_CREDITS,
    expiresAt,
    dailyDateKey: intent.daily_date_key,
    dailyCap: DAILY_REWARD_CAP
  });

  if (grant.status === "cap_reached") {
    await markRewardIntentRejected(env, intent.id, transactionId);
    logWarnEvent("rewarded_ad_ssv_daily_cap_reached", {
      quotaSubjectHash: hashForLog(intent.user_id),
      transactionIdSuffix: suffixForLog(transactionId),
      rewardIntentIdSuffix: suffixForLog(intent.id),
      dailyRewardsUsed: grant.dailyRewardsUsed,
      dailyRewardsRemaining: grant.dailyRewardsRemaining,
      dailyCap: DAILY_REWARD_CAP
    });
    throw new AppError(429, "Rewarded ad daily cap reached");
  }

  if (grant.status === "duplicate_ignored") {
    if (grant.rewardIntentId === intent.id) {
      try {
        await recordRewardTransaction(env, {
          transactionId,
          userId: intent.user_id,
          rewardIntentId: intent.id,
          adUnit,
          operationId: grant.operationId,
          creditsRemaining: grant.creditsRemaining
        });
      } catch (error) {
        await enqueueAdMobRewardTransactionRepair(env, {
          transactionId,
          userId: intent.user_id,
          rewardIntentId: intent.id,
          adUnit,
          operationId: grant.operationId,
          rewardCredits: REWARD_CREDITS,
          creditsRemaining: grant.creditsRemaining
        });
        logWarnEvent("rewarded_ad_transaction_audit_write_failed", {
          quotaSubjectHash: hashForLog(intent.user_id),
          transactionIdSuffix: suffixForLog(transactionId),
          rewardIntentIdSuffix: suffixForLog(intent.id),
          reason: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
    logEvent("rewarded_ad_duplicate_ignored", {
      quotaSubjectHash: hashForLog(intent.user_id),
      transactionIdSuffix: suffixForLog(transactionId),
      rewardIntentIdSuffix: suffixForLog(grant.rewardIntentId),
      dailyRewardsUsed: grant.dailyRewardsUsed,
      dailyRewardsRemaining: grant.dailyRewardsRemaining
    });
    return {
      status: "duplicate_ignored",
      rewardIntentId: intent.id,
      creditsGranted: 0,
      creditsRemaining: grant.creditsRemaining,
      dailyRewardsUsed: grant.dailyRewardsUsed,
      dailyRewardsRemaining: grant.dailyRewardsRemaining,
      usage: grant.usage
    };
  }

  try {
    await recordRewardTransaction(env, {
      transactionId,
      userId: intent.user_id,
      rewardIntentId: intent.id,
      adUnit,
      operationId: grant.operationId,
      creditsRemaining: grant.creditsRemaining
    });
  } catch (error) {
    await enqueueAdMobRewardTransactionRepair(env, {
      transactionId,
      userId: intent.user_id,
      rewardIntentId: intent.id,
      adUnit,
      operationId: grant.operationId,
      rewardCredits: REWARD_CREDITS,
      creditsRemaining: grant.creditsRemaining
    });
    logWarnEvent("rewarded_ad_transaction_audit_write_failed", {
      quotaSubjectHash: hashForLog(intent.user_id),
      transactionIdSuffix: suffixForLog(transactionId),
      rewardIntentIdSuffix: suffixForLog(intent.id),
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  logEvent("rewarded_ad_credit_granted", {
    quotaSubjectHash: hashForLog(intent.user_id),
    rewardIntentIdSuffix: suffixForLog(intent.id),
    transactionIdSuffix: suffixForLog(transactionId),
    status: grant.status,
    creditsGranted: grant.creditsGranted,
    creditsRemaining: grant.creditsRemaining,
    dailyRewardsUsed: grant.dailyRewardsUsed,
    dailyRewardsRemaining: grant.dailyRewardsRemaining
  });

  return {
    status: "granted",
    rewardIntentId: intent.id,
    creditsGranted: grant.creditsGranted,
    creditsRemaining: grant.creditsRemaining,
    dailyRewardsUsed: grant.dailyRewardsUsed,
    dailyRewardsRemaining: grant.dailyRewardsRemaining,
    usage: grant.usage
  };
}

async function enqueueAdMobRewardTransactionRepair(
  env: Env,
  payload: AdMobRewardTransactionRepairPayload
): Promise<void> {
  await enqueueCreditAuditRepair(env, {
    kind: "admob_reward_transaction",
    operationId: payload.operationId,
    quotaSubject: payload.userId,
    transactionId: payload.transactionId,
    rewardIntentId: payload.rewardIntentId,
    source: "processSsvGrant.recordRewardTransaction",
    payload
  });
}

async function safeVerifySsv(url: URL, env: Env): Promise<boolean> {
  try {
    return await verifyAdMobSsvCallback(url, env);
  } catch (error) {
    logWarnEvent("rewarded_ad_ssv_verify_failed", {
      reason: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

function requiredParam(url: URL, name: string, event: string): string {
  const value = url.searchParams.get(name)?.trim();
  if (!value) {
    logWarnEvent(event, {
      queryKeys: collectQueryKeys(url.searchParams)
    });
    throw new AppError(400, `Missing ${name}`);
  }
  return value;
}

function requiredAnyParam(url: URL, names: string[], event: string): string {
  for (const name of names) {
    const value = url.searchParams.get(name)?.trim();
    if (value) {
      return value;
    }
  }
  logWarnEvent(event, {
    acceptedNames: names,
    queryKeys: collectQueryKeys(url.searchParams)
  });
  throw new AppError(400, `Missing ${names[0]}`);
}

function optionalParam(url: URL, name: string): string | null {
  return url.searchParams.get(name)?.trim() || null;
}

function collectQueryKeys(params: URLSearchParams): string[] {
  const keys: string[] = [];
  params.forEach((_, key) => keys.push(key));
  return keys.sort();
}

function isAllowedRewardedAdUnit(actualAdUnit: string, configuredAdUnit: string): boolean {
  const allowed = new Set([configuredAdUnit]);
  const numericSuffix = configuredAdUnit.split("/").pop()?.trim();
  if (numericSuffix) {
    allowed.add(numericSuffix);
  }
  const withoutPrefix = configuredAdUnit.replace(/^ca-app-pub-/, "").trim();
  if (withoutPrefix && withoutPrefix !== configuredAdUnit) {
    allowed.add(withoutPrefix);
  }
  return allowed.has(actualAdUnit);
}

function isAdMobConsoleVerificationCallback(url: URL): boolean {
  return (
    url.searchParams.get("transaction_id") === "123456789" &&
    url.searchParams.get("ad_unit") === "1234567890" &&
    url.searchParams.get("reward_amount") === String(REWARD_CREDITS) &&
    url.searchParams.get("reward_item") === "credits"
  );
}

function validateRewardPayload(
  url: URL,
  options: {
    transactionId: string;
    rewardIntentId: string;
  }
): void {
  const rewardAmount = optionalParam(url, "reward_amount");
  if (rewardAmount !== null && rewardAmount !== String(REWARD_CREDITS)) {
    logWarnEvent("rewarded_ad_ssv_invalid_reward_amount", {
      transactionIdSuffix: suffixForLog(options.transactionId),
      rewardIntentIdSuffix: suffixForLog(options.rewardIntentId),
      rewardAmount
    });
    throw new AppError(400, "Invalid rewarded ad amount");
  }

  const rewardItem = optionalParam(url, "reward_item");
  if (rewardItem !== null && rewardItem !== "credits") {
    logWarnEvent("rewarded_ad_ssv_invalid_reward_item", {
      transactionIdSuffix: suffixForLog(options.transactionId),
      rewardIntentIdSuffix: suffixForLog(options.rewardIntentId),
      rewardItem
    });
    throw new AppError(400, "Invalid rewarded ad item");
  }
}

function effectiveIntentStatus(intent: RewardIntentRow): RewardIntentRow["status"] {
  if (intent.status === "pending" && Date.parse(intent.expires_at) <= Date.now()) {
    return "expired";
  }
  return intent.status;
}

export async function countGrantedRewards(env: Env, userId: string, dateKey: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count
    FROM admob_reward_intents
    WHERE user_id = ? AND daily_date_key = ? AND status = 'granted'`
  )
    .bind(userId, dateKey)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function loadRewardIntentById(env: Env, id: string): Promise<RewardIntentRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, custom_data, reward_credits, status, daily_date_key, expires_at, created_at, granted_at, transaction_id, credits_remaining
    FROM admob_reward_intents
    WHERE id = ?`
  )
    .bind(id)
    .first<RewardIntentRow>();
}

async function loadRewardIntentByCustomData(env: Env, customData: string): Promise<RewardIntentRow | null> {
  return env.DB.prepare(
    `SELECT id, user_id, custom_data, reward_credits, status, daily_date_key, expires_at, created_at, granted_at, transaction_id, credits_remaining
    FROM admob_reward_intents
    WHERE custom_data = ?`
  )
    .bind(customData)
    .first<RewardIntentRow>();
}

async function loadRewardTransaction(env: Env, transactionId: string): Promise<RewardTransactionRow | null> {
  return env.DB.prepare(
    `SELECT transaction_id, user_id, reward_intent_id, status, operation_id
    FROM admob_reward_transactions
    WHERE transaction_id = ?`
  )
    .bind(transactionId)
    .first<RewardTransactionRow>();
}

async function recordRewardTransaction(
  env: Env,
  options: {
    transactionId: string;
    userId: string;
    rewardIntentId: string;
    adUnit: string;
    operationId: string;
    creditsRemaining: number;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO admob_reward_transactions (
      transaction_id,
      user_id,
      reward_intent_id,
      ad_unit,
      reward_credits,
      status,
      operation_id,
      created_at,
      granted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      options.transactionId,
      options.userId,
      options.rewardIntentId,
      options.adUnit,
      REWARD_CREDITS,
      "granted",
      options.operationId,
      now,
      now
    )
    .run();

  await env.DB.prepare(
    `UPDATE admob_reward_intents
    SET status = 'granted', granted_at = ?, transaction_id = ?, credits_remaining = ?
    WHERE id = ? AND status = 'pending'`
  )
    .bind(now, options.transactionId, options.creditsRemaining, options.rewardIntentId)
    .run();
}

async function markRewardIntentRejected(env: Env, rewardIntentId: string, transactionId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE admob_reward_intents
    SET status = 'rejected', transaction_id = ?
    WHERE id = ? AND status = 'pending'`
  )
    .bind(transactionId, rewardIntentId)
    .run();
}

function identityFromQuotaSubject(quotaSubject: string): QuotaIdentity {
  const plan = quotaSubject.startsWith("pro_max:")
    ? "pro_max"
    : quotaSubject.startsWith("pro:")
      ? "pro"
      : quotaSubject.startsWith("lite:")
        ? "lite"
        : "free";
  return {
    quotaSubject,
    plan,
    identityKind: "device_key"
  };
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/iu.test(value?.trim() ?? "");
}
