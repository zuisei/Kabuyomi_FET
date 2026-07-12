import type { JWSTransactionDecodedPayload, ResponseBodyV2DecodedPayload } from "@apple/app-store-server-library";
import {
  resolveCreditPackCredits,
  resolvePlanFromBilling,
  resolveSubscriptionMonthlyCredits
} from "../lib/billing-catalog";
import { verifyAppleNotificationSignedData, verifyAppleTransactionSignedData } from "../lib/apple-signed-data";
import { buildStableSubscriptionGrantOperationId, deriveStableSubscriptionPrincipal } from "../lib/subscription-principal";
import { AppError, isAppError } from "../lib/errors";
import { hashForLog, logEvent, logWarnEvent } from "../lib/logging";
import { json } from "../lib/response";
import {
  applyConsumablePurchaseNotification,
  loadUsage,
  type QuotaIdentity
} from "../lib/quota";
import { isEntitlementActiveAt, type ServerEntitlementState } from "../lib/entitlement-state";
import type { RouteHandler } from "./types";

const MAX_NOTIFICATION_BYTES = 64_000;

export const handleAppleNotificationsV2Route: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/apple/notifications/v2")) {
    return null;
  }

  try {
    const signedPayload = await readSignedPayload(request);
    const verifiedNotification = await verifyAppleNotificationSignedData(env, signedPayload);
    const notification = verifiedNotification.payload;
    const notificationUUID = requiredString(notification.notificationUUID, "Notification identity is missing");
    const notificationType = requiredString(notification.notificationType, "Notification type is missing");
    const signedDate = requiredNumber(notification.signedDate, "Notification signed date is missing");
    const version = requiredString(notification.version, "Notification version is missing");
    const transactionJws = requiredString(notification.data?.signedTransactionInfo, "Notification transaction is missing");

    const inserted = await beginNotification(env.DB, {
      notificationUUID,
      signedDate,
      version,
      notificationType,
      subtype: notification.subtype ?? null,
      environment: verifiedNotification.environment,
      payloadDigest: verifiedNotification.payloadDigest
    });
    if (!inserted) {
      logEvent("apple_notification_duplicate_ignored", {
        notificationIdHash: hashForLog(notificationUUID),
        notificationType
      });
      return json({ status: "duplicate_ignored" });
    }

    try {
      const verifiedTransaction = await verifyAppleTransactionSignedData(
        env,
        transactionJws,
        verifiedNotification.environment
      );
      const verifiedProductId = requiredString(
        verifiedTransaction.payload.productId,
        "Verified product is missing"
      );
      if (resolveCreditPackCredits(verifiedProductId) !== null) {
        const consumable = await handleConsumableNotification({
          env,
          notificationUUID,
          notificationType,
          transaction: verifiedTransaction.payload,
          productId: verifiedProductId
        });
        await finishNotification(env.DB, notificationUUID, null, "processed", null);
        return json(consumable);
      }
      const mutation = await buildNotificationMutation(env, notification, verifiedTransaction.payload, {
        environment: verifiedTransaction.environment,
        verificationVersion: verifiedTransaction.verificationVersion,
        payloadDigest: verifiedTransaction.payloadDigest
      });
      const entitlementResponse = await env.ENTITLEMENT.getByName(mutation.quotaSubject).fetch(
        new Request("https://entitlement.internal/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(mutation)
        })
      );
      const entitlement = await entitlementResponse.json() as ServerEntitlementState & { error?: string };
      if (!entitlementResponse.ok) {
        throw new AppError(entitlementResponse.status, String(entitlement.error ?? "Notification entitlement update failed"));
      }

      if (isEntitlementActiveAt(entitlement) && !config.emergencyPaidGrantsDisabled && config.creditBillingEnabled) {
        const identity: QuotaIdentity = {
          quotaSubject: entitlement.quotaSubject,
          plan: entitlement.plan,
          identityKind: "entitlement",
          activeSubscription: {
            originalTransactionId: entitlement.originalTransactionId,
            transactionId: entitlement.transactionId,
            productId: entitlement.productId,
            periodStart: entitlement.periodStart,
            periodEnd: entitlement.periodEnd,
            expiresAt: entitlement.expiresAt,
            monthlyCredits: entitlement.monthlyCredits,
            monthlyGrantOperationId: entitlement.monthlyGrantOperationId
          }
        };
        await loadUsage(identity, env, config);
      } else if (isEntitlementActiveAt(entitlement)) {
        logWarnEvent("apple_notification_credit_grant_disabled", {
          notificationIdHash: hashForLog(notificationUUID),
          principalHash: hashForLog(entitlement.quotaSubject),
          configVersion: config.configVersion
        });
      }

      await finishNotification(env.DB, notificationUUID, mutation.quotaSubject, "processed", null);
      logEvent("apple_notification_processed", {
        notificationIdHash: hashForLog(notificationUUID),
        principalHash: hashForLog(mutation.quotaSubject),
        notificationType,
        entitlementStatus: mutation.status,
        environment: mutation.verificationEnvironment
      });
      return json({ status: "processed" });
    } catch (error) {
      await finishNotification(env.DB, notificationUUID, null, "failed", classifyError(error));
      throw error;
    }
  } catch (error) {
    if (isAppError(error)) {
      logWarnEvent("apple_notification_rejected", {
        status: error.status,
        failureClass: error.internalMessage ?? error.name
      });
      return json({ error: error.publicMessage }, { status: error.status });
    }
    throw error;
  }
};

async function handleConsumableNotification({
  env,
  notificationUUID,
  notificationType,
  transaction,
  productId
}: {
  env: Parameters<RouteHandler>[0]["env"];
  notificationUUID: string;
  notificationType: string;
  transaction: JWSTransactionDecodedPayload;
  productId: string;
}): Promise<Record<string, unknown>> {
  const transactionId = requiredString(transaction.transactionId, "Verified transaction is missing");
  if (notificationType === "REFUND" || notificationType === "REFUND_REVERSED") {
    const result = await applyConsumablePurchaseNotification(env, {
      action: notificationType === "REFUND" ? "refund" : "reverse_refund",
      notificationId: notificationUUID,
      transactionId,
      productId
    });
    logEvent("apple_consumable_notification_processed", {
      notificationIdHash: hashForLog(notificationUUID),
      principalHash: result.quotaSubject ? hashForLog(result.quotaSubject) : null,
      notificationType,
      productId,
      outcome: result.outcome,
      didMutate: result.didMutate,
      delta: result.operation?.delta ?? 0,
      refundDebtAfter: result.operation?.purchaseRefundDebtAfter ?? null
    });
    return {
      status: "processed",
      action: notificationType === "REFUND" ? "consumable_refund" : "consumable_refund_reversed",
      outcome: result.outcome
    };
  }

  if (notificationType === "CONSUMPTION_REQUEST") {
    // Acknowledge receipt without guessing any consumption or account data.
    // Sending Apple's separate consumption-information response remains an
    // explicit operational activation step with an approved data policy.
    logEvent("apple_consumption_request_acknowledged", {
      notificationIdHash: hashForLog(notificationUUID),
      productId,
      consumptionDataSent: false
    });
    return { status: "acknowledged", action: "consumption_request_no_data" };
  }

  if (notificationType === "ONE_TIME_CHARGE") {
    // Notifications never establish ownership or grant consumable credits.
    // The signed client completion flow remains the sole grant path.
    logEvent("apple_one_time_charge_acknowledged", {
      notificationIdHash: hashForLog(notificationUUID),
      productId,
      creditsGranted: false
    });
    return { status: "acknowledged", action: "one_time_charge_no_grant" };
  }

  logEvent("apple_consumable_notification_ignored", {
    notificationIdHash: hashForLog(notificationUUID),
    notificationType,
    productId
  });
  return { status: "ignored", action: "unsupported_consumable_notification" };
}

async function readSignedPayload(request: Request): Promise<string> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    throw new AppError(415, "Content-Type must be application/json");
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_NOTIFICATION_BYTES) {
    throw new AppError(413, "Notification payload is too large");
  }
  try {
    const body = JSON.parse(raw) as { signedPayload?: unknown };
    return requiredString(body.signedPayload, "Invalid notification payload");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "Invalid notification payload");
  }
}

async function buildNotificationMutation(
  env: Parameters<RouteHandler>[0]["env"],
  notification: ResponseBodyV2DecodedPayload,
  transaction: JWSTransactionDecodedPayload,
  verification: { environment: "production" | "sandbox"; verificationVersion: string; payloadDigest: string }
) {
  const originalTransactionId = requiredString(transaction.originalTransactionId, "Verified original transaction is missing");
  const transactionId = requiredString(transaction.transactionId, "Verified transaction is missing");
  const productId = requiredString(transaction.productId, "Verified product is missing");
  const plan = resolvePlanFromBilling(productId, true);
  const monthlyCredits = resolveSubscriptionMonthlyCredits(productId);
  if (plan === "free" || monthlyCredits === null) {
    throw new AppError(400, "Unsupported subscription product");
  }
  const periodStart = appleDate(transaction.purchaseDate);
  const expiresAt = appleDate(transaction.expiresDate);
  const revokedAt = appleDate(transaction.revocationDate);
  const status = revokedAt ? "revoked" : expiresAt && Date.parse(expiresAt) > Date.now() ? "active" : "expired";
  const principal = await deriveStableSubscriptionPrincipal(env, originalTransactionId, verification.environment);
  const monthlyGrantOperationId = status === "active" && periodStart && expiresAt
    ? await buildStableSubscriptionGrantOperationId({
        stablePrincipal: principal.quotaSubject,
        productId,
        periodStart,
        periodEnd: expiresAt
      })
    : null;
  return {
    action: "apply_verified_notification" as const,
    quotaSubject: principal.quotaSubject,
    principalKeyVersion: principal.keyVersion,
    originalTransactionId,
    transactionId,
    productId,
    plan,
    status,
    periodStart,
    periodEnd: expiresAt,
    expiresAt,
    revokedAt,
    monthlyCredits,
    monthlyGrantOperationId,
    lastVerifiedAt: new Date().toISOString(),
    verificationEnvironment: verification.environment,
    verificationVersion: verification.verificationVersion,
    verificationPayloadDigest: verification.payloadDigest,
    signedDate: appleDate(notification.signedDate) ?? appleDate(transaction.signedDate)
  };
}

async function beginNotification(db: D1Database, input: {
  notificationUUID: string; signedDate: number; version: string; notificationType: string;
  subtype: string | null; environment: string; payloadDigest: string;
}): Promise<boolean> {
  const now = new Date().toISOString();
  const existing = await db.prepare(
    `SELECT payload_digest, status, processing_started_at
     FROM app_store_notifications WHERE notification_uuid = ?`
  ).bind(input.notificationUUID).first<{
    payload_digest: string;
    status: string;
    processing_started_at: string | null;
  }>();
  if (existing) {
    if (existing.payload_digest !== input.payloadDigest) {
      throw new AppError(409, "Notification identity payload mismatch");
    }
    if (existing.status === "processed") return false;

    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    const reclaimed = await db.prepare(
      `UPDATE app_store_notifications
       SET status = 'processing', processing_started_at = ?, processed_at = NULL, error_code = NULL
       WHERE notification_uuid = ? AND payload_digest = ?
         AND (status = 'failed' OR (status = 'processing' AND (processing_started_at IS NULL OR processing_started_at <= ?)))`
    ).bind(now, input.notificationUUID, input.payloadDigest, staleBefore).run();
    return Number(reclaimed.meta?.changes ?? 0) > 0;
  }

  const result = await db.prepare(
    `INSERT OR IGNORE INTO app_store_notifications (
      notification_uuid, signed_date, version, notification_type, subtype, environment,
      payload_digest, status, received_at, processing_started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)`
  ).bind(
    input.notificationUUID, input.signedDate, input.version, input.notificationType,
    input.subtype, input.environment, input.payloadDigest, now, now
  ).run();
  if (Number(result.meta?.changes ?? 0) > 0) return true;

  // A concurrent delivery may have inserted the row after our first read.
  // Treat it as duplicate only when the immutable digest matches.
  const raced = await db.prepare(
    "SELECT payload_digest FROM app_store_notifications WHERE notification_uuid = ?"
  ).bind(input.notificationUUID).first<{ payload_digest: string }>();
  if (raced && raced.payload_digest !== input.payloadDigest) {
    throw new AppError(409, "Notification identity payload mismatch");
  }
  return false;
}

async function finishNotification(
  db: D1Database,
  notificationUUID: string,
  quotaSubject: string | null,
  status: "processed" | "failed",
  errorCode: string | null
): Promise<void> {
  const entitlementKey = quotaSubject ? `entitlement:v1:${await sha256Hex(`entitlement-index:${quotaSubject}`)}` : null;
  await db.prepare(
    `UPDATE app_store_notifications
     SET entitlement_key = COALESCE(?, entitlement_key), status = ?, processed_at = ?, error_code = ?
     WHERE notification_uuid = ?`
  ).bind(entitlementKey, status, new Date().toISOString(), errorCode, notificationUUID).run();
}

function appleDate(value: number | string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const numeric = typeof value === "number" ? value : /^\d+$/u.test(value) ? Number(value) : NaN;
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AppError(400, message);
  return value.trim();
}

function requiredNumber(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AppError(400, message);
  return value;
}

function classifyError(error: unknown): string {
  return error instanceof AppError ? `app_error_${error.status}` : error instanceof Error ? error.name : "unknown";
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
