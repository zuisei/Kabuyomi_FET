import { AppleAccountSessionRequestSchema, PaidCreditAccountMigrationRequestSchema } from "../lib/contracts";
import { createAccountSession, resolveAccountCredential } from "../lib/account-recovery";
import { AppError } from "../lib/errors";
import { resolveInstallationCredential, verifyAppAttestAssertionForRequest } from "../lib/installation-identity";
import { hashForLog, logEvent } from "../lib/logging";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import type { RouteHandler } from "./types";
import { resolveBillingRuntimeCapabilities } from "./usage";

interface PrincipalMigrationExport {
  version?: number;
  creditState?: Record<string, unknown> | null;
  purchaseRecords?: unknown[];
  monthlyGrantRecords?: unknown[];
  creditOperationRecords?: unknown[];
  requestExecutionRecords?: unknown[];
  creditReservationRecords?: unknown[];
  exportedAt?: string;
}

export function buildPaidCreditMigrationSnapshot(sourceSnapshot: PrincipalMigrationExport) {
  const purchasedRemaining = Number(sourceSnapshot.creditState?.purchasedRemaining ?? 0);
  const purchaseRecords = Array.isArray(sourceSnapshot.purchaseRecords) ? sourceSnapshot.purchaseRecords : [];
  const creditOperationRecords = Array.isArray(sourceSnapshot.creditOperationRecords)
    ? sourceSnapshot.creditOperationRecords
    : [];
  return {
    purchasedRemaining,
    purchaseEvidenceCount: purchaseRecords.length,
    snapshot: {
      version: 1,
      creditState: sourceSnapshot.creditState ? { ...sourceSnapshot.creditState, purchasedRemaining } : null,
      purchaseRecords,
      monthlyGrantRecords: Array.isArray(sourceSnapshot.monthlyGrantRecords)
        ? sourceSnapshot.monthlyGrantRecords
        : [],
      creditOperationRecords,
      requestExecutionRecords: Array.isArray(sourceSnapshot.requestExecutionRecords)
        ? sourceSnapshot.requestExecutionRecords
        : [],
      creditReservationRecords: Array.isArray(sourceSnapshot.creditReservationRecords)
        ? sourceSnapshot.creditReservationRecords
        : [],
      exportedAt: sourceSnapshot.exportedAt ?? new Date().toISOString()
    }
  };
}

export const handleAccountRecoveryRoutes: RouteHandler = async ({ request, url, env, config }) => {
  const isAccountRecoveryRoute = request.method === "POST" && (
    url.pathname === "/v1/account/apple/session"
    || url.pathname === "/v1/account/paid-credit-migration"
  );
  if (isAccountRecoveryRoute && !resolveBillingRuntimeCapabilities(env, config).accountRecoveryReady) {
    return json({ error: "Account recovery is temporarily unavailable" }, { status: 503 });
  }

  if (request.method === "POST" && url.pathname === "/v1/account/apple/session") {
    const installation = await resolveInstallationCredential(request, env);
    if (!installation) throw new AppError(401, "Installation credential is required");
    await verifyAppAttestAssertionForRequest(request, env, installation);
    const body = await parseJsonBody(request, AppleAccountSessionRequestSchema, {
      invalidMessage: "Invalid Apple account session payload",
      maxBytes: 20_480
    });
    const credential = await createAccountSession(env, body.identityToken, installation);
    return json({ credential });
  }

  if (request.method === "POST" && url.pathname === "/v1/account/paid-credit-migration") {
    const installation = await resolveInstallationCredential(request, env);
    if (!installation) throw new AppError(401, "Installation credential is required");
    await verifyAppAttestAssertionForRequest(request, env, installation);
    const account = await resolveAccountCredential(request, env);
    const body = await parseJsonBody(request, PaidCreditAccountMigrationRequestSchema, {
      invalidMessage: "Invalid paid credit migration payload",
      maxBytes: 2_048
    });
    // PR-06 has already moved any raw legacy-device quota into this verified,
    // server-issued installation principal. Using the authenticated installation
    // as the source prevents a second copy from the old tombstoned device key.
    const sourceQuotaSubject = installation.principal;
    const legacyPrincipalDigest = await sha256Hex(`paid-credit-installation:${sourceQuotaSubject}`);

    const existingClaim = await env.DB.prepare(
      `SELECT migration_id, account_principal, status, expected_purchased_remaining, purchase_evidence_count
       FROM paid_credit_account_migrations WHERE legacy_principal_digest = ?`
    ).bind(legacyPrincipalDigest).first<{
      migration_id: string;
      account_principal: string;
      status: string;
      expected_purchased_remaining: number;
      purchase_evidence_count: number;
    }>();
    if (existingClaim && (existingClaim.migration_id !== body.migrationId || existingClaim.account_principal !== account.accountPrincipal)) {
      return json({ status: "conflict", conflictReason: "legacy_principal_already_claimed" }, { status: 409 });
    }
    if (existingClaim?.status === "applied") {
      return json({
        status: "already_applied",
        expectedPurchasedRemaining: existingClaim.expected_purchased_remaining,
        purchaseEvidenceCount: existingClaim.purchase_evidence_count
      });
    }

    const exported = await callMigration(env, sourceQuotaSubject, { action: "export", migrationId: body.migrationId });
    if (exported.status === "already_tombstoned") {
      const tombstone = exported.tombstone as { migrationId?: unknown; targetPrincipal?: unknown } | undefined;
      if (tombstone?.migrationId !== body.migrationId || tombstone.targetPrincipal !== account.accountPrincipal || !existingClaim) {
        throw new AppError(409, "Paid credit migration tombstone conflict");
      }
      await rebindPurchaseTransactionOwners(env, sourceQuotaSubject, account.accountPrincipal);
      await env.DB.prepare(
        "UPDATE paid_credit_account_migrations SET status = 'applied', applied_at = ? WHERE migration_id = ?"
      ).bind(new Date().toISOString(), body.migrationId).run();
      return json({
        status: "already_applied",
        expectedPurchasedRemaining: existingClaim.expected_purchased_remaining,
        purchaseEvidenceCount: existingClaim.purchase_evidence_count
      });
    }
    const sourceLockDigest = String(exported.sourceSnapshotDigest ?? "");
    if (!/^[a-f0-9]{64}$/u.test(sourceLockDigest)) {
      throw new AppError(503, "Paid credit migration source digest is unavailable");
    }
    const sourceSnapshot = exported.snapshot as PrincipalMigrationExport | undefined;
    if (!sourceSnapshot || typeof sourceSnapshot !== "object") {
      await unlockMigration(env, sourceQuotaSubject, body.migrationId, sourceLockDigest);
      throw new AppError(503, "Paid credit migration source snapshot is unavailable");
    }
    const paidMigration = buildPaidCreditMigrationSnapshot(sourceSnapshot);
    const { purchasedRemaining, purchaseEvidenceCount } = paidMigration;
    const paidOnlySnapshot = paidMigration.snapshot;
    const sourceSnapshotDigest = await sha256Hex(stableJson(paidOnlySnapshot));
    const conflictReason = purchasedRemaining > 0 && purchaseEvidenceCount === 0
      ? "purchased_balance_without_transaction_evidence"
      : null;
    const now = new Date().toISOString();
    try {
      await env.DB.prepare(
        `INSERT INTO paid_credit_account_migrations (
          migration_id, account_principal, legacy_principal_digest, source_snapshot_digest,
          status, conflict_reason, expected_purchased_remaining, purchase_evidence_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(migration_id) DO UPDATE SET
          status = CASE WHEN paid_credit_account_migrations.status = 'applied' THEN 'applied' ELSE excluded.status END,
          conflict_reason = excluded.conflict_reason`
      ).bind(
        body.migrationId, account.accountPrincipal, legacyPrincipalDigest, sourceSnapshotDigest,
        conflictReason ? "conflict" : body.mode === "preview" ? "previewed" : "applying",
        conflictReason, purchasedRemaining, purchaseEvidenceCount, now
      ).run();
    } catch (error) {
      await unlockMigrationSafely(env, sourceQuotaSubject, body.migrationId, sourceLockDigest);
      throw error;
    }
    if (conflictReason) {
      await unlockMigration(env, sourceQuotaSubject, body.migrationId, sourceLockDigest);
      return json({ status: "conflict", conflictReason }, { status: 409 });
    }
    if (body.mode === "preview") {
      await unlockMigration(env, sourceQuotaSubject, body.migrationId, sourceLockDigest);
      return json({ status: "previewed", expectedPurchasedRemaining: purchasedRemaining, purchaseEvidenceCount });
    }
    if (purchasedRemaining === 0 && purchaseEvidenceCount === 0) {
      await unlockMigration(env, sourceQuotaSubject, body.migrationId, sourceLockDigest);
      await env.DB.prepare(
        "UPDATE paid_credit_account_migrations SET status = 'applied', applied_at = ? WHERE migration_id = ?"
      ).bind(new Date().toISOString(), body.migrationId).run();
      return json({ status: "noop", expectedPurchasedRemaining: 0, purchaseEvidenceCount: 0 });
    }
    let targetApplied = false;
    let applied: Record<string, unknown>;
    try {
      applied = await callMigration(env, account.accountPrincipal, {
        action: "apply",
        migrationId: body.migrationId,
        sourceQuotaSubjectHash: legacyPrincipalDigest,
        sourceSnapshotDigest,
        snapshot: paidOnlySnapshot
      });
      targetApplied = true;
      await callMigration(env, sourceQuotaSubject, {
        action: "tombstone",
        migrationId: body.migrationId,
        targetPrincipal: account.accountPrincipal,
        sourceSnapshotDigest: sourceLockDigest
      });
      await rebindPurchaseTransactionOwners(env, sourceQuotaSubject, account.accountPrincipal);
    } catch (error) {
      if (!targetApplied) await unlockMigration(env, sourceQuotaSubject, body.migrationId, sourceLockDigest);
      throw error;
    }
    await env.DB.prepare(
      "UPDATE paid_credit_account_migrations SET status = 'applied', applied_at = ? WHERE migration_id = ?"
    ).bind(new Date().toISOString(), body.migrationId).run();
    logEvent("paid_credit_account_migration_completed", {
      migrationIdHash: hashForLog(body.migrationId),
      accountPrincipalHash: hashForLog(account.accountPrincipal),
      legacyPrincipalDigest,
      purchasedRemaining,
      purchaseEvidenceCount
    });
    return json({
      status: String(applied.status ?? "applied"),
      expectedPurchasedRemaining: purchasedRemaining,
      purchaseEvidenceCount
    });
  }

  return null;
};

async function rebindPurchaseTransactionOwners(
  env: Parameters<RouteHandler>[0]["env"],
  sourceQuotaSubject: string,
  targetQuotaSubject: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE purchase_transactions
     SET user_id = ?, updated_at = ?
     WHERE user_id = ?`
  ).bind(targetQuotaSubject, new Date().toISOString(), sourceQuotaSubject).run();
}

async function callMigration(env: Parameters<RouteHandler>[0]["env"], quotaSubject: string, body: Record<string, unknown>) {
  const response = await env.USER_QUOTA.getByName(quotaSubject).fetch(new Request("https://quota.internal/principal-migration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }));
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new AppError(response.status, String(payload.error ?? "Paid credit migration failed"));
  return payload;
}

async function unlockMigration(
  env: Parameters<RouteHandler>[0]["env"],
  quotaSubject: string,
  migrationId: string,
  sourceSnapshotDigest: string
) {
  await callMigration(env, quotaSubject, { action: "unlock", migrationId, sourceSnapshotDigest });
}

async function unlockMigrationSafely(
  env: Parameters<RouteHandler>[0]["env"],
  quotaSubject: string,
  migrationId: string,
  sourceSnapshotDigest: string
) {
  try {
    await unlockMigration(env, quotaSubject, migrationId, sourceSnapshotDigest);
  } catch {
    // A failed unlock intentionally leaves the source fail-closed for operator reconciliation.
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
