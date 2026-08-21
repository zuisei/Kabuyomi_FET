import { afterEach, describe, expect, it, vi } from "vitest";
import {
  enqueueCreditAuditRepair,
  processCreditAuditRepairQueue,
  type AdMobRewardTransactionRepairPayload
} from "../src/lib/credit-audit-repair";
import { grantEvalCredits, grantPurchasedCredits, loadUsage, type QuotaIdentity } from "../src/lib/quota";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

const identity: QuotaIdentity = {
  quotaSubject: "free:local:repair-device",
  plan: "free",
  identityKind: "local_device"
};

function usagePayload(totalRemaining = 30) {
  return {
    plan: "free",
    chatsUsed: 0,
    chatLimit: 10,
    stocksUsed: 0,
    stockLimit: 3,
    savedTickers: [],
    dateJST: "2026-05-10",
    credits: {
      monthlyRemaining: Math.min(50, totalRemaining),
      monthlyLimit: 50,
      rewardedAdRemaining: 0,
      purchasedRemaining: Math.max(0, totalRemaining - 50),
      totalRemaining,
      resetsAt: "2026-06-01T00:00:00+09:00"
    }
  };
}

class FakeAuditDb {
  creditLedger: Array<Record<string, unknown>> = [];
  monthlyGrants: Array<Record<string, unknown>> = [];
  repairQueue: Array<Record<string, any>> = [];
  purchaseTransactions: Array<Record<string, unknown>> = [];
  admobRewardTransactions: Array<Record<string, unknown>> = [];
  admobRewardIntents: Array<Record<string, unknown>> = [];
  failNextCreditLedgerInsert = false;
  failNextMonthlyGrantInsert = false;
  failNextPurchaseMark = false;

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        first: async <T>() => this.first<T>(sql, args),
        all: async <T>() => this.all<T>(sql, args),
        run: async () => this.run(sql, args)
      })
    };
  }

  private async first<T>(sql: string, args: unknown[]): Promise<T | null> {
    if (sql.includes("FROM purchase_transactions") && sql.includes("WHERE transaction_id = ?")) {
      return (this.purchaseTransactions.find((row) => row.transaction_id === args[0]) ?? null) as T | null;
    }
    return null;
  }

  private async all<T>(sql: string, args: unknown[]): Promise<{ results: T[] }> {
    if (sql.includes("FROM credit_audit_repair_queue")) {
      const limit = Number(args[0] ?? 25);
      return {
        results: this.repairQueue
          .filter((row) => row.status === "pending" || row.status === "failed")
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            kind: row.kind,
            operation_id: row.operation_id,
            attempt_count: row.attempt_count,
            payload_json: row.payload_json
          })) as T[]
      };
    }
    return { results: [] };
  }

  private async run(sql: string, args: unknown[]): Promise<Record<string, never>> {
    if (sql.includes("INSERT OR IGNORE INTO purchase_transactions")) {
      if (!this.purchaseTransactions.some((row) => row.transaction_id === args[3])) {
        this.purchaseTransactions.push({
          id: args[0],
          user_id: args[1],
          product_id: args[2],
          transaction_id: args[3],
          original_transaction_id: args[4],
          credits_granted: args[5],
          status: args[6],
          purchased_at: args[7],
          created_at: args[8],
          updated_at: args[9]
        });
      }
      return {};
    }

    if (sql.includes("UPDATE purchase_transactions")) {
      if (this.failNextPurchaseMark) {
        this.failNextPurchaseMark = false;
        throw new Error("purchase mark failed");
      }
      const row = this.purchaseTransactions.find((candidate) => candidate.transaction_id === args[3]);
      if (row) {
        row.status = args[0];
        row.debt_offset_applied = args[1];
        row.updated_at = args[2];
      }
      return {};
    }

    if (sql.includes("INSERT OR IGNORE INTO credit_ledger")) {
      if (this.failNextCreditLedgerInsert) {
        this.failNextCreditLedgerInsert = false;
        throw new Error("credit ledger failed");
      }
      if (!this.creditLedger.some((row) => row.operation_id === args[2])) {
        this.creditLedger.push({
          id: args[0],
          user_id: args[1],
          operation_id: args[2],
          type: args[3],
          delta: args[4],
          balance_after: args[5],
          monthly_balance_after: args[6],
          purchased_balance_after: args[7],
          reference_type: args[8],
          reference_id: args[9],
          metadata_json: args[10],
          created_at: args[11]
        });
      }
      return {};
    }

    if (sql.includes("INSERT INTO monthly_grants")) {
      if (this.failNextMonthlyGrantInsert) {
        this.failNextMonthlyGrantInsert = false;
        throw new Error("monthly grant failed");
      }
      if (!this.monthlyGrants.some((row) => row.operation_id === args[6])) {
        this.monthlyGrants.push({
          id: args[0],
          user_id: args[1],
          plan: args[2],
          period_start: args[3],
          period_end: args[4],
          credits_granted: args[5],
          operation_id: args[6],
          created_at: args[7]
        });
      }
      return {};
    }

    if (sql.includes("INSERT OR IGNORE INTO admob_reward_transactions")) {
      if (!this.admobRewardTransactions.some((row) => row.transaction_id === args[0])) {
        this.admobRewardTransactions.push({
          transaction_id: args[0],
          user_id: args[1],
          reward_intent_id: args[2],
          ad_unit: args[3],
          reward_credits: args[4],
          status: args[5],
          operation_id: args[6],
          created_at: args[7],
          granted_at: args[8]
        });
      }
      return {};
    }

    if (sql.includes("UPDATE admob_reward_intents")) {
      const row = this.admobRewardIntents.find((candidate) => candidate.id === args[3] && candidate.status === "pending");
      if (row) {
        row.status = "granted";
        row.granted_at = args[0];
        row.transaction_id = args[1];
        row.credits_remaining = args[2];
      }
      return {};
    }

    if (sql.includes("INSERT INTO credit_audit_repair_queue")) {
      const existing = this.repairQueue.find((row) => row.id === args[0]);
      if (existing) {
        existing.updated_at = args[2];
        existing.status = existing.status === "repaired" ? "repaired" : "pending";
        existing.source = args[9];
        existing.payload_json = args[12];
      } else {
        this.repairQueue.push({
          id: args[0],
          created_at: args[1],
          updated_at: args[2],
          status: args[3],
          kind: args[4],
          operation_id: args[5],
          quota_subject_hash: args[6],
          transaction_id_suffix: args[7],
          reward_intent_id_suffix: args[8],
          source: args[9],
          attempt_count: args[10],
          last_error: args[11],
          payload_json: args[12]
        });
      }
      return {};
    }

    if (sql.includes("UPDATE credit_audit_repair_queue")) {
      const row = this.repairQueue.find((candidate) => candidate.id === args[4]);
      if (row) {
        row.status = args[0];
        row.updated_at = args[1];
        row.attempt_count = args[2];
        row.last_error = args[3];
      }
      return {};
    }

    return {};
  }
}

describe("credit audit repair", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queues and repairs a failed credit ledger write after a DO grant without mutating balance again", async () => {
    const db = new FakeAuditDb();
    db.failNextCreditLedgerInsert = true;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: usagePayload(550),
          didMutate: true,
          creditsRemaining: 550,
          creditOperation: {
            operationId: "eval-grant:repair:evaluation-device",
            type: "eval_grant",
            status: "applied",
            delta: 500,
            balanceAfter: 550,
            monthlyBalanceAfter: 50,
            purchasedBalanceAfter: 500,
            referenceType: "eval_grant",
            referenceId: "repair",
            createdAt: "2026-05-10T00:00:00.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await grantEvalCredits(
      identity,
      {
        DB: db,
        USER_QUOTA: { getByName: vi.fn().mockReturnValue({ fetch }) }
      } as never,
      DEFAULT_REMOTE_CONFIG,
      {
        deviceKey: "evaluation-device",
        credits: 500,
        referenceId: "repair"
      }
    );

    expect(result.creditsRemaining).toBe(550);
    expect(fetch).toHaveBeenCalledOnce();
    expect(db.creditLedger).toHaveLength(0);
    expect(db.repairQueue).toHaveLength(1);
    expect(db.repairQueue[0]).toMatchObject({
      status: "pending",
      kind: "credit_ledger"
    });

    await expect(processCreditAuditRepairQueue({ DB: db } as never)).resolves.toEqual({
      scanned: 1,
      repaired: 1,
      failed: 0
    });
    await expect(processCreditAuditRepairQueue({ DB: db } as never)).resolves.toEqual({
      scanned: 0,
      repaired: 0,
      failed: 0
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(db.creditLedger).toHaveLength(1);
    expect(db.creditLedger[0]).toMatchObject({
      operation_id: "eval-grant:repair:evaluation-device",
      delta: 500
    });
    const joinedWarnings = warnSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(joinedWarnings).toContain("credit_audit_repair_queued");
    expect(joinedWarnings).toContain("operationIdSuffix");
    expect(joinedWarnings).not.toContain("eval-grant:repair:evaluation-device");
    expect(joinedWarnings).not.toContain("free:local:repair-device");
  });

  it("queues and repairs a failed monthly grant audit write idempotently", async () => {
    const db = new FakeAuditDb();
    db.failNextMonthlyGrantInsert = true;
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: usagePayload(50),
          didMutate: true,
          monthlyGrant: {
            operationId: "monthly-grant:free:2026-05",
            plan: "free",
            periodStart: "2026-05-01T00:00:00+09:00",
            periodEnd: "2026-06-01T00:00:00+09:00",
            creditsGranted: 50,
            balanceAfter: 50,
            monthlyBalanceAfter: 50,
            purchasedBalanceAfter: 0,
            createdAt: "2026-05-10T00:00:00.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await loadUsage(
      identity,
      {
        DB: db,
        USER_QUOTA: { getByName: vi.fn().mockReturnValue({ fetch }) }
      } as never,
      DEFAULT_REMOTE_CONFIG
    );

    expect(result.credits?.totalRemaining).toBe(50);
    expect(db.monthlyGrants).toHaveLength(0);
    expect(db.creditLedger).toHaveLength(1);
    expect(db.repairQueue).toHaveLength(1);
    expect(db.repairQueue[0]).toMatchObject({
      status: "pending",
      kind: "monthly_grant"
    });

    await processCreditAuditRepairQueue({ DB: db } as never);
    await processCreditAuditRepairQueue({ DB: db } as never);

    expect(fetch).toHaveBeenCalledOnce();
    expect(db.monthlyGrants).toHaveLength(1);
    expect(db.monthlyGrants[0]).toMatchObject({
      operation_id: "monthly-grant:free:2026-05"
    });
  });

  it("queues purchase transaction mark-granted failures after DO grant for retry-safe repair", async () => {
    const db = new FakeAuditDb();
    db.failNextPurchaseMark = true;
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: usagePayload(150),
          didMutate: true,
          creditsRemaining: 150,
          creditOperation: {
            operationId: "purchase:tx-repair",
            type: "purchase_grant",
            status: "applied",
            delta: 100,
            balanceAfter: 150,
            monthlyBalanceAfter: 50,
            purchasedBalanceAfter: 100,
            referenceType: "purchase",
            referenceId: "tx-repair",
            createdAt: "2026-05-10T00:00:00.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(
      grantPurchasedCredits(
        identity,
        {
          DB: db,
          USER_QUOTA: { getByName: vi.fn().mockReturnValue({ fetch }) }
        } as never,
        DEFAULT_REMOTE_CONFIG,
        {
          productId: "kabuyomi.credits.100",
          transactionId: "tx-repair",
          verificationEnvironment: "production"
        }
      )
    ).rejects.toThrow("purchase mark failed");

    expect(fetch).toHaveBeenCalledOnce();
    expect(db.purchaseTransactions[0]).toMatchObject({ status: "pending" });
    expect(db.repairQueue.some((row) => row.kind === "purchase_transaction_mark")).toBe(true);

    await processCreditAuditRepairQueue({ DB: db } as never);

    expect(db.purchaseTransactions[0]).toMatchObject({ status: "granted" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("repairs missing AdMob transaction audit rows without granting or incrementing caps again", async () => {
    const db = new FakeAuditDb();
    db.admobRewardIntents.push({
      id: "intent-admob-repair",
      user_id: "free:local:repair-device",
      status: "pending",
      granted_at: null,
      transaction_id: null,
      credits_remaining: null
    });
    const payload: AdMobRewardTransactionRepairPayload = {
      transactionId: "tx-admob-repair",
      userId: "free:local:repair-device",
      rewardIntentId: "intent-admob-repair",
      adUnit: "ca-app-pub-3940256099942544/1712485313",
      operationId: "admob-reward:tx-admob-repair",
      rewardCredits: 2,
      creditsRemaining: 52
    };

    await enqueueCreditAuditRepair(
      { DB: db } as never,
      {
        kind: "admob_reward_transaction",
        operationId: payload.operationId,
        quotaSubject: payload.userId,
        transactionId: payload.transactionId,
        rewardIntentId: payload.rewardIntentId,
        source: "test.admob",
        payload
      }
    );

    await expect(processCreditAuditRepairQueue({ DB: db } as never)).resolves.toEqual({
      scanned: 1,
      repaired: 1,
      failed: 0
    });
    await expect(processCreditAuditRepairQueue({ DB: db } as never)).resolves.toEqual({
      scanned: 0,
      repaired: 0,
      failed: 0
    });

    expect(db.admobRewardTransactions).toHaveLength(1);
    expect(db.admobRewardTransactions[0]).toMatchObject({
      transaction_id: "tx-admob-repair",
      reward_intent_id: "intent-admob-repair",
      reward_credits: 2,
      status: "granted",
      operation_id: "admob-reward:tx-admob-repair"
    });
    expect(db.admobRewardIntents[0]).toMatchObject({
      status: "granted",
      transaction_id: "tx-admob-repair",
      credits_remaining: 52
    });
  });
});
