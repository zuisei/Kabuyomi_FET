import { PrincipalMigrationAdminRequestSchema } from "../lib/contracts";
import { deriveStableSubscriptionPrincipal } from "../lib/subscription-principal";
import { AppError } from "../lib/errors";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import { hashForLog, logEvent } from "../lib/logging";
import type { RouteHandler } from "./types";

export const handleInternalSubscriptionPrincipalMigrationRoute: RouteHandler = async ({ request, url, env }) => {
  if (!(request.method === "POST" && url.pathname === "/internal/subscription-principal-migration")) {
    return null;
  }
  const expected = env.BACKFILL_SHARED_SECRET?.trim();
  if (!expected || request.headers.get("x-kabuyomi-internal-token") !== expected) {
    throw new AppError(403, "Forbidden");
  }
  const body = await parseJsonBody(request, PrincipalMigrationAdminRequestSchema, {
    invalidMessage: "Invalid subscription migration payload",
    maxBytes: 16_384
  });
  const target = await deriveStableSubscriptionPrincipal(env, body.originalTransactionId, body.environment);
  if (target.quotaSubject === body.sourceQuotaSubject) {
    return json({ status: "not_required", sourceCount: 0, conflictCount: 0 });
  }

  const exported = await callMigration(env, body.sourceQuotaSubject, {
    action: "export",
    migrationId: body.migrationId
  });
  if (exported.status === "already_tombstoned") {
    const tombstone = exported.tombstone as { migrationId?: unknown; targetPrincipal?: unknown } | undefined;
    if (tombstone?.migrationId !== body.migrationId || tombstone.targetPrincipal !== target.quotaSubject) {
      throw new AppError(409, "Principal migration tombstone conflict");
    }
    await env.DB.prepare(
      `UPDATE subscription_principal_migrations
       SET status = 'applied', applied_at = COALESCE(applied_at, ?), reconciled_at = ?
       WHERE migration_id = ?`
    ).bind(new Date().toISOString(), new Date().toISOString(), body.migrationId).run();
    return json({ status: "already_applied", sourceCount: 1, conflictCount: 0 });
  }
  const snapshot = exported.snapshot as {
    creditState?: { monthlyRemaining?: number; purchasedRemaining?: number } | null;
    purchaseRecords?: unknown[];
  };
  const sourceSnapshotDigest = String(exported.sourceSnapshotDigest ?? "");
  if (!snapshot || !/^[a-f0-9]{64}$/u.test(sourceSnapshotDigest)) {
    throw new AppError(503, "Principal migration source snapshot is unavailable");
  }
  const monthlyRemaining = Number(snapshot.creditState?.monthlyRemaining ?? 0);
  const purchasedRemaining = Number(snapshot.creditState?.purchasedRemaining ?? 0);
  const purchaseRecordCount = Array.isArray(snapshot.purchaseRecords) ? snapshot.purchaseRecords.length : 0;
  const evidenceStatus = purchasedRemaining === 0 || purchaseRecordCount > 0 ? "complete" : "conflict";
  const conflictReason = evidenceStatus === "conflict" ? "purchased_balance_without_transaction_evidence" : null;
  const now = new Date().toISOString();
  const entitlementKey = `entitlement:v1:${await sha256Hex(`entitlement-index:${target.quotaSubject}`)}`;
  try {
    await env.DB.prepare(
      `INSERT INTO subscription_principal_migrations (
        migration_id, entitlement_key, target_principal, status, manifest_digest,
        expected_monthly_remaining, expected_purchased_remaining, source_count,
        conflict_reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(migration_id) DO UPDATE SET
        status = excluded.status,
        conflict_reason = excluded.conflict_reason,
        manifest_digest = excluded.manifest_digest`
    ).bind(
      body.migrationId, entitlementKey, target.quotaSubject,
      body.mode === "preview" ? "previewed" : evidenceStatus === "complete" ? "applying" : "conflict",
      sourceSnapshotDigest, monthlyRemaining, purchasedRemaining, conflictReason, now
    ).run();
    await env.DB.prepare(
      `INSERT INTO subscription_principal_migration_sources (
        migration_id, source_quota_subject, source_snapshot_digest, monthly_remaining,
        purchased_remaining, evidence_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(migration_id, source_quota_subject) DO UPDATE SET
        source_snapshot_digest = excluded.source_snapshot_digest,
        monthly_remaining = excluded.monthly_remaining,
        purchased_remaining = excluded.purchased_remaining,
        evidence_status = excluded.evidence_status`
    ).bind(
      body.migrationId,
      `legacy:v1:${await sha256Hex(`legacy-quota:${body.sourceQuotaSubject}`)}`,
      sourceSnapshotDigest,
      monthlyRemaining,
      purchasedRemaining,
      evidenceStatus,
      now
    ).run();
  } catch (error) {
    await unlockMigrationSafely(env, body.sourceQuotaSubject, body.migrationId, sourceSnapshotDigest);
    throw error;
  }

  if (body.mode === "preview") {
    await unlockMigration(env, body.sourceQuotaSubject, body.migrationId, sourceSnapshotDigest);
    return json({
      status: conflictReason ? "conflict" : "previewed",
      sourceCount: 1,
      conflictCount: conflictReason ? 1 : 0,
      expectedMonthlyRemaining: monthlyRemaining,
      expectedPurchasedRemaining: purchasedRemaining,
      purchaseEvidenceCount: purchaseRecordCount
    });
  }
  if (conflictReason) {
    await unlockMigration(env, body.sourceQuotaSubject, body.migrationId, sourceSnapshotDigest);
    return json({ status: "conflict", sourceCount: 1, conflictCount: 1 }, { status: 409 });
  }

  const sourceQuotaSubjectHash = await sha256Hex(`migration-source:${body.sourceQuotaSubject}`);
  let targetApplied = false;
  let applied: Record<string, unknown>;
  try {
    applied = await callMigration(env, target.quotaSubject, {
      action: "apply",
      migrationId: body.migrationId,
      sourceQuotaSubjectHash,
      sourceSnapshotDigest,
      snapshot: exported.snapshot
    });
    targetApplied = true;
    await callMigration(env, body.sourceQuotaSubject, {
      action: "tombstone",
      migrationId: body.migrationId,
      targetPrincipal: target.quotaSubject,
      sourceSnapshotDigest
    });
  } catch (error) {
    if (!targetApplied) {
      await unlockMigration(env, body.sourceQuotaSubject, body.migrationId, sourceSnapshotDigest);
    }
    throw error;
  }
  await env.DB.prepare(
    `UPDATE subscription_principal_migrations
     SET status = 'applied', applied_at = ?, reconciled_at = ?
     WHERE migration_id = ?`
  ).bind(new Date().toISOString(), new Date().toISOString(), body.migrationId).run();
  logEvent("subscription_principal_migration_completed", {
    migrationIdHash: hashForLog(body.migrationId),
    sourceQuotaSubjectHash,
    targetPrincipalHash: hashForLog(target.quotaSubject),
    monthlyRemaining,
    purchasedRemaining
  });
  return json({
    status: String(applied.status ?? "applied"),
    sourceCount: 1,
    conflictCount: 0,
    expectedMonthlyRemaining: monthlyRemaining,
    expectedPurchasedRemaining: purchasedRemaining
  });
};

async function callMigration(env: Parameters<RouteHandler>[0]["env"], quotaSubject: string, body: Record<string, unknown>) {
  const response = await env.USER_QUOTA.getByName(quotaSubject).fetch(
    new Request("https://quota.internal/principal-migration", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
  );
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new AppError(response.status, String(payload.error ?? "Principal migration failed"));
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
    // Leave the source locked when reconciliation cannot prove a safe unlock.
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
