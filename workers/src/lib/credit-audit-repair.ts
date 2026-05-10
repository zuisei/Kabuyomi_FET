import type { Env } from "../env";
import { hashForLog, logEvent, logWarnEvent, suffixForLog } from "./logging";

export type CreditAuditRepairKind =
  | "credit_ledger"
  | "monthly_grant"
  | "admob_reward_transaction"
  | "purchase_transaction_mark";

interface CreditLedgerRepairPayload {
  userId: string;
  operation: {
    operationId: string;
    type: string;
    status: string;
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
  };
}

interface MonthlyGrantRepairPayload {
  userId: string;
  grant: {
    operationId: string;
    plan: string;
    periodStart: string;
    periodEnd: string;
    creditsGranted: number;
    createdAt: string;
  };
}

export interface AdMobRewardTransactionRepairPayload {
  transactionId: string;
  userId: string;
  rewardIntentId: string;
  adUnit: string;
  operationId: string;
  rewardCredits: number;
  creditsRemaining: number;
}

interface PurchaseTransactionMarkRepairPayload {
  transactionId: string;
}

type CreditAuditRepairPayload =
  | CreditLedgerRepairPayload
  | MonthlyGrantRepairPayload
  | AdMobRewardTransactionRepairPayload
  | PurchaseTransactionMarkRepairPayload;

export interface EnqueueCreditAuditRepairOptions {
  kind: CreditAuditRepairKind;
  operationId?: string;
  quotaSubject?: string;
  transactionId?: string;
  rewardIntentId?: string;
  source: string;
  payload: CreditAuditRepairPayload;
}

interface CreditAuditRepairQueueRow {
  id: string;
  kind: CreditAuditRepairKind;
  operation_id: string | null;
  attempt_count: number;
  payload_json: string;
}

export interface CreditAuditRepairResult {
  scanned: number;
  repaired: number;
  failed: number;
}

export async function enqueueCreditAuditRepair(env: Env, options: EnqueueCreditAuditRepairOptions): Promise<void> {
  try {
    const now = new Date().toISOString();
    const id = await buildRepairId(options);
    await env.DB.prepare(
      `INSERT INTO credit_audit_repair_queue (
        id,
        created_at,
        updated_at,
        status,
        kind,
        operation_id,
        quota_subject_hash,
        transaction_id_suffix,
        reward_intent_id_suffix,
        source,
        attempt_count,
        last_error,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        updated_at = excluded.updated_at,
        status = CASE
          WHEN credit_audit_repair_queue.status = 'repaired' THEN credit_audit_repair_queue.status
          ELSE 'pending'
        END,
        source = excluded.source,
        payload_json = excluded.payload_json`
    )
      .bind(
        id,
        now,
        now,
        "pending",
        options.kind,
        options.operationId ?? null,
        hashForLog(options.quotaSubject) ?? null,
        suffixForLog(options.transactionId),
        suffixForLog(options.rewardIntentId),
        options.source,
        0,
        null,
        JSON.stringify(options.payload)
      )
      .run();

    logWarnEvent("credit_audit_repair_queued", {
      auditKind: options.kind,
      repairStatus: "pending",
      operationIdSuffix: suffixForLog(options.operationId),
      quotaSubjectHash: hashForLog(options.quotaSubject),
      transactionIdSuffix: suffixForLog(options.transactionId),
      rewardIntentIdSuffix: suffixForLog(options.rewardIntentId),
      source: options.source
    });
  } catch (error) {
    logWarnEvent("credit_audit_repair_queue_failed", {
      auditKind: options.kind,
      operationIdSuffix: suffixForLog(options.operationId),
      quotaSubjectHash: hashForLog(options.quotaSubject),
      transactionIdSuffix: suffixForLog(options.transactionId),
      rewardIntentIdSuffix: suffixForLog(options.rewardIntentId),
      errorClass: error instanceof Error ? error.name : typeof error
    });
  }
}

export async function processCreditAuditRepairQueue(
  env: Env,
  options: { limit?: number } = {}
): Promise<CreditAuditRepairResult> {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 25)));
  const rows = await env.DB.prepare(
    `SELECT id, kind, operation_id, attempt_count, payload_json
    FROM credit_audit_repair_queue
    WHERE status IN ('pending', 'failed')
    ORDER BY created_at ASC
    LIMIT ?`
  )
    .bind(limit)
    .all<CreditAuditRepairQueueRow>();

  let repaired = 0;
  let failed = 0;
  const results = rows.results ?? [];
  for (const row of results) {
    try {
      await applyCreditAuditRepair(env, row);
      await markRepairRow(env, row.id, "repaired", row.attempt_count + 1);
      repaired += 1;
      logEvent("credit_audit_repair_applied", {
        auditKind: row.kind,
        repairStatus: "repaired",
        operationIdSuffix: suffixForLog(row.operation_id),
        attemptCount: row.attempt_count + 1
      });
    } catch (error) {
      failed += 1;
      await markRepairRow(env, row.id, "failed", row.attempt_count + 1, error);
      logWarnEvent("credit_audit_repair_failed", {
        auditKind: row.kind,
        repairStatus: "failed",
        operationIdSuffix: suffixForLog(row.operation_id),
        attemptCount: row.attempt_count + 1,
        errorClass: error instanceof Error ? error.name : typeof error
      });
    }
  }

  return {
    scanned: results.length,
    repaired,
    failed
  };
}

async function applyCreditAuditRepair(env: Env, row: CreditAuditRepairQueueRow): Promise<void> {
  const payload = JSON.parse(row.payload_json) as CreditAuditRepairPayload;
  if (row.kind === "credit_ledger") {
    await repairCreditLedger(env, payload as CreditLedgerRepairPayload);
    return;
  }
  if (row.kind === "monthly_grant") {
    await repairMonthlyGrant(env, payload as MonthlyGrantRepairPayload);
    return;
  }
  if (row.kind === "admob_reward_transaction") {
    await repairAdMobRewardTransaction(env, payload as AdMobRewardTransactionRepairPayload);
    return;
  }
  if (row.kind === "purchase_transaction_mark") {
    await repairPurchaseTransactionMark(env, payload as PurchaseTransactionMarkRepairPayload);
    return;
  }
}

async function repairCreditLedger(env: Env, payload: CreditLedgerRepairPayload): Promise<void> {
  const operation = payload.operation;
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
      payload.userId,
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
}

async function repairMonthlyGrant(env: Env, payload: MonthlyGrantRepairPayload): Promise<void> {
  const grant = payload.grant;
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
      payload.userId,
      grant.plan,
      grant.periodStart,
      grant.periodEnd,
      grant.creditsGranted,
      grant.operationId,
      grant.createdAt
    )
    .run();
}

async function repairAdMobRewardTransaction(env: Env, payload: AdMobRewardTransactionRepairPayload): Promise<void> {
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
      payload.transactionId,
      payload.userId,
      payload.rewardIntentId,
      payload.adUnit,
      payload.rewardCredits,
      "granted",
      payload.operationId,
      now,
      now
    )
    .run();

  await env.DB.prepare(
    `UPDATE admob_reward_intents
    SET status = 'granted', granted_at = ?, transaction_id = ?, credits_remaining = ?
    WHERE id = ? AND status = 'pending'`
  )
    .bind(now, payload.transactionId, payload.creditsRemaining, payload.rewardIntentId)
    .run();
}

async function repairPurchaseTransactionMark(env: Env, payload: PurchaseTransactionMarkRepairPayload): Promise<void> {
  await env.DB.prepare(
    `UPDATE purchase_transactions
    SET status = ?, updated_at = ?
    WHERE transaction_id = ?`
  )
    .bind("granted", new Date().toISOString(), payload.transactionId)
    .run();
}

async function markRepairRow(
  env: Env,
  id: string,
  status: "repaired" | "failed",
  attemptCount: number,
  error?: unknown
): Promise<void> {
  await env.DB.prepare(
    `UPDATE credit_audit_repair_queue
    SET status = ?, updated_at = ?, attempt_count = ?, last_error = ?
    WHERE id = ?`
  )
    .bind(
      status,
      new Date().toISOString(),
      attemptCount,
      error ? truncateError(error instanceof Error ? error.message : String(error)) : null,
      id
    )
    .run();
}

async function buildRepairId(options: EnqueueCreditAuditRepairOptions): Promise<string> {
  const key = [
    options.kind,
    options.operationId ?? "",
    options.transactionId ?? "",
    options.rewardIntentId ?? "",
    options.source
  ].join(":");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function truncateError(message: string): string {
  return message.length > 500 ? `${message.slice(0, 497)}...` : message;
}
