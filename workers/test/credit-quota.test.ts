import { describe, expect, it, vi } from "vitest";
import {
  consumeCredit,
  grantEvalCredits,
  grantPurchasedCredits,
  InsufficientCreditsError,
  loadUsage,
  refundCredit,
  type QuotaIdentity
} from "../src/lib/quota";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

const identity: QuotaIdentity = {
  quotaSubject: "free:local:device-123",
  plan: "free",
  identityKind: "local_device"
};

function createDb() {
  const run = vi.fn().mockResolvedValue({});
  const bind = vi.fn().mockReturnValue({ run });
  return {
    run,
    bind,
    db: {
      prepare: vi.fn().mockReturnValue({ bind })
    }
  };
}

function usagePayload(purchasedRemaining = 0) {
  return {
    plan: "free",
    chatsUsed: 0,
    chatLimit: 10,
    stocksUsed: 0,
    stockLimit: 3,
    savedTickers: [],
    dateJST: "2026-04-25",
    credits: {
      monthlyRemaining: 30,
      monthlyLimit: 30,
      purchasedRemaining,
      totalRemaining: 30 + purchasedRemaining,
      resetsAt: "2026-05-01T00:00:00+09:00"
    }
  };
}

function createPurchaseDb(row: Record<string, unknown>) {
  const run = vi.fn().mockResolvedValue({});
  const first = vi.fn().mockResolvedValue(row);
  const bind = vi.fn().mockReturnValue({ run, first });
  return {
    run,
    first,
    bind,
    db: {
      prepare: vi.fn().mockReturnValue({ bind })
    }
  };
}

describe("credit quota bridge", () => {
  it("records and grants purchased credits once for a consumable transaction", async () => {
    const db = createPurchaseDb({
      user_id: identity.quotaSubject,
      product_id: "credit_pack_100",
      transaction_id: "tx-100",
      original_transaction_id: "orig-tx-100",
      credits_granted: 100,
      status: "pending",
      purchased_at: "2026-04-25T00:00:00.000Z",
      created_at: "2026-04-25T00:00:00.000Z",
      updated_at: "2026-04-25T00:00:00.000Z"
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: usagePayload(100),
          didMutate: true,
          creditsRemaining: 130,
          creditOperation: {
            operationId: "purchase:tx-100",
            type: "purchase_grant",
            status: "applied",
            delta: 100,
            balanceAfter: 130,
            monthlyBalanceAfter: 30,
            purchasedBalanceAfter: 100,
            referenceType: "purchase",
            referenceId: "tx-100",
            createdAt: "2026-04-25T00:00:01.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await grantPurchasedCredits(
      identity,
      {
        DB: db.db,
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({ fetch })
        }
      } as never,
      DEFAULT_REMOTE_CONFIG,
      {
        productId: "credit_pack_100",
        transactionId: "tx-100",
        originalTransactionId: "orig-tx-100",
        purchasedAt: "2026-04-25T00:00:00.000Z"
      }
    );

    expect(result.didMutate).toBe(true);
    expect(result.creditsGranted).toBe(100);
    expect(result.creditsRemaining).toBe(130);
    expect(db.db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO purchase_transactions"));
    expect(db.db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE purchase_transactions"));
    expect(db.db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO credit_ledger"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(db.bind).toHaveBeenCalledWith(
      expect.any(String),
      identity.quotaSubject,
      "credit_pack_100",
      "tx-100",
      "orig-tx-100",
      100,
      "pending",
      "2026-04-25T00:00:00.000Z",
      expect.any(String),
      expect.any(String)
    );
    expect(db.bind).toHaveBeenCalledWith(
      expect.any(String),
      identity.quotaSubject,
      "purchase:tx-100",
      "purchase_grant",
      100,
      130,
      30,
      100,
      "purchase",
      "tx-100",
      expect.stringContaining('"status":"applied"'),
      "2026-04-25T00:00:01.000Z"
    );
  });

  it("records eval credit grants in the ledger without purchase transactions", async () => {
    const db = createDb();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: usagePayload(500),
          didMutate: true,
          creditsRemaining: 530,
          creditOperation: {
            operationId: "eval-grant:chat-quality-v1-20260426:eval-chat-quality-v1",
            type: "eval_grant",
            status: "applied",
            delta: 500,
            balanceAfter: 530,
            monthlyBalanceAfter: 30,
            purchasedBalanceAfter: 500,
            referenceType: "eval_grant",
            referenceId: "chat-quality-v1-20260426",
            createdAt: "2026-04-26T00:00:01.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await grantEvalCredits(
      identity,
      {
        DB: db.db,
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({ fetch })
        }
      } as never,
      DEFAULT_REMOTE_CONFIG,
      {
        deviceKey: "eval-chat-quality-v1",
        credits: 500,
        referenceId: "chat-quality-v1-20260426"
      }
    );

    expect(result.didMutate).toBe(true);
    expect(result.operationId).toBe("eval-grant:chat-quality-v1-20260426:eval-chat-quality-v1");
    expect(result.creditsGranted).toBe(500);
    expect(result.creditsRemaining).toBe(530);
    expect(db.db.prepare).not.toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO purchase_transactions"));
    expect(db.db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO credit_ledger"));
    expect(fetch).toHaveBeenCalledOnce();
    expect(db.bind).toHaveBeenCalledWith(
      expect.any(String),
      identity.quotaSubject,
      "eval-grant:chat-quality-v1-20260426:eval-chat-quality-v1",
      "eval_grant",
      500,
      530,
      30,
      500,
      "eval_grant",
      "chat-quality-v1-20260426",
      expect.stringContaining('"status":"applied"'),
      "2026-04-26T00:00:01.000Z"
    );
  });

  it("does not grant credits again when the transaction is already granted", async () => {
    const db = createPurchaseDb({
      user_id: identity.quotaSubject,
      product_id: "credit_pack_300",
      transaction_id: "tx-300",
      original_transaction_id: null,
      credits_granted: 300,
      status: "granted",
      purchased_at: null,
      created_at: "2026-04-25T00:00:00.000Z",
      updated_at: "2026-04-25T00:00:01.000Z"
    });
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ usage: usagePayload(300), didMutate: false }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const result = await grantPurchasedCredits(
      identity,
      {
        DB: db.db,
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({ fetch })
        }
      } as never,
      DEFAULT_REMOTE_CONFIG,
      {
        productId: "credit_pack_300",
        transactionId: "tx-300"
      }
    );

    expect(result.didMutate).toBe(false);
    expect(result.creditsGranted).toBe(300);
    expect(result.creditsRemaining).toBe(330);
    expect(fetch).toHaveBeenCalledOnce();
    expect(db.db.prepare).not.toHaveBeenCalledWith(expect.stringContaining("UPDATE purchase_transactions"));
    expect(db.db.prepare).not.toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO credit_ledger"));
  });

  it("rejects unknown credit pack products before writing a transaction", async () => {
    const db = createDb();

    await expect(
      grantPurchasedCredits(
        identity,
        {
          DB: db.db,
          USER_QUOTA: {
            getByName: vi.fn()
          }
        } as never,
        DEFAULT_REMOTE_CONFIG,
        {
          productId: "unknown_pack",
          transactionId: "tx-unknown"
        }
      )
    ).rejects.toMatchObject({
      status: 400,
      publicMessage: "Unsupported credit product"
    });
    expect(db.db.prepare).not.toHaveBeenCalled();
  });

  it("rejects a reused transaction id with a different credit pack", async () => {
    const db = createPurchaseDb({
      user_id: identity.quotaSubject,
      product_id: "credit_pack_100",
      transaction_id: "tx-reused",
      original_transaction_id: null,
      credits_granted: 100,
      status: "pending",
      purchased_at: null,
      created_at: "2026-04-25T00:00:00.000Z",
      updated_at: "2026-04-25T00:00:00.000Z"
    });

    await expect(
      grantPurchasedCredits(
        identity,
        {
          DB: db.db,
          USER_QUOTA: {
            getByName: vi.fn()
          }
        } as never,
        DEFAULT_REMOTE_CONFIG,
        {
          productId: "credit_pack_700",
          transactionId: "tx-reused"
        }
      )
    ).rejects.toMatchObject({
      status: 409,
      publicMessage: "Purchase transaction product mismatch"
    });
  });

  it("persists a monthly grant row and ledger row when usage ensures the monthly grant", async () => {
    const db = createDb();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            plan: "free",
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 0,
            stockLimit: 3,
            savedTickers: [],
            dateJST: "2026-04-25",
            credits: {
              monthlyRemaining: 30,
              monthlyLimit: 30,
              purchasedRemaining: 0,
              totalRemaining: 30,
              resetsAt: "2026-05-01T00:00:00+09:00"
            }
          },
          didMutate: true,
          monthlyGrant: {
            operationId: "monthly-grant:free:2026-04-01T00:00:00+09:00:2026-05-01T00:00:00+09:00",
            plan: "free",
            periodStart: "2026-04-01T00:00:00+09:00",
            periodEnd: "2026-05-01T00:00:00+09:00",
            creditsGranted: 30,
            balanceAfter: 30,
            monthlyBalanceAfter: 30,
            purchasedBalanceAfter: 0,
            createdAt: "2026-04-25T00:00:00.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const usage = await loadUsage(
      identity,
      {
        DB: db.db,
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({ fetch })
        }
      } as never,
      DEFAULT_REMOTE_CONFIG
    );

    expect(usage.credits?.totalRemaining).toBe(30);
    expect(db.db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO monthly_grants"));
    expect(db.db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO credit_ledger"));
    expect(db.bind).toHaveBeenCalledWith(
      expect.any(String),
      identity.quotaSubject,
      "free",
      "2026-04-01T00:00:00+09:00",
      "2026-05-01T00:00:00+09:00",
      30,
      "monthly-grant:free:2026-04-01T00:00:00+09:00:2026-05-01T00:00:00+09:00",
      "2026-04-25T00:00:00.000Z"
    );
    expect(db.bind).toHaveBeenCalledWith(
      expect.any(String),
      identity.quotaSubject,
      "monthly-grant:free:2026-04-01T00:00:00+09:00:2026-05-01T00:00:00+09:00",
      "monthly_grant",
      30,
      30,
      30,
      0,
      "monthly_grant",
      "free:2026-04-01T00:00:00+09:00:2026-05-01T00:00:00+09:00",
      expect.stringContaining('"status":"applied"'),
      "2026-04-25T00:00:00.000Z"
    );
  });

  it("persists a negative ledger row after a successful credit consume", async () => {
    const db = createDb();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            plan: "free",
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 0,
            stockLimit: 3,
            savedTickers: [],
            dateJST: "2026-04-25",
            credits: {
              monthlyRemaining: 29,
              monthlyLimit: 30,
              purchasedRemaining: 0,
              totalRemaining: 29,
              resetsAt: "2026-05-01T00:00:00+09:00"
            }
          },
          didMutate: true,
          creditsRemaining: 29,
          creditOperation: {
            operationId: "chat-op-1",
            type: "consume",
            status: "applied",
            delta: -1,
            balanceAfter: 29,
            monthlyBalanceAfter: 29,
            purchasedBalanceAfter: 0,
            referenceType: "chat",
            referenceId: "filing-1",
            createdAt: "2026-04-25T00:00:00.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await consumeCredit(
      identity,
      {
        DB: db.db,
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({ fetch })
        }
      } as never,
      DEFAULT_REMOTE_CONFIG,
      {
        operationId: "chat-op-1",
        creditsRequired: 1,
        reference: {
          type: "chat",
          id: "filing-1"
        }
      }
    );

    expect(result.creditsCharged).toBe(1);
    expect(result.creditsRemaining).toBe(29);
    expect(db.db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT OR IGNORE INTO credit_ledger"));
    expect(db.bind).toHaveBeenCalledWith(
      expect.any(String),
      identity.quotaSubject,
      "chat-op-1",
      "consume",
      -1,
      29,
      29,
      0,
      "chat",
      "filing-1",
      expect.stringContaining('"status":"applied"'),
      "2026-04-25T00:00:00.000Z"
    );
  });

  it("throws insufficient credits without writing a ledger row", async () => {
    const db = createDb();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            plan: "free",
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 0,
            stockLimit: 3,
            savedTickers: [],
            dateJST: "2026-04-25",
            credits: {
              monthlyRemaining: 0,
              monthlyLimit: 0,
              purchasedRemaining: 0,
              totalRemaining: 0,
              resetsAt: "2026-05-01T00:00:00+09:00"
            }
          },
          didMutate: false,
          error: "insufficient_credits",
          creditsRemaining: 0
        }),
        { status: 402, headers: { "content-type": "application/json" } }
      )
    );

    await expect(
      consumeCredit(
        identity,
        {
          DB: db.db,
          USER_QUOTA: {
            getByName: vi.fn().mockReturnValue({ fetch })
          }
        } as never,
        DEFAULT_REMOTE_CONFIG,
        {
          operationId: "chat-op-empty",
          creditsRequired: 1,
          reference: {
            type: "chat",
            id: "filing-1"
          }
        }
      )
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(db.db.prepare).not.toHaveBeenCalled();
  });

  it("persists a positive ledger row after a credit refund", async () => {
    const db = createDb();
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            plan: "free",
            chatsUsed: 0,
            chatLimit: 10,
            stocksUsed: 0,
            stockLimit: 3,
            savedTickers: [],
            dateJST: "2026-04-25",
            credits: {
              monthlyRemaining: 30,
              monthlyLimit: 30,
              purchasedRemaining: 0,
              totalRemaining: 30,
              resetsAt: "2026-05-01T00:00:00+09:00"
            }
          },
          didMutate: true,
          creditsRemaining: 30,
          creditOperation: {
            operationId: "refund:chat-op-1",
            type: "refund",
            status: "applied",
            delta: 1,
            balanceAfter: 30,
            monthlyBalanceAfter: 30,
            purchasedBalanceAfter: 0,
            originalOperationId: "chat-op-1",
            referenceType: "chat",
            referenceId: "filing-1",
            createdAt: "2026-04-25T00:00:01.000Z"
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await refundCredit(
      identity,
      {
        DB: db.db,
        USER_QUOTA: {
          getByName: vi.fn().mockReturnValue({ fetch })
        }
      } as never,
      DEFAULT_REMOTE_CONFIG,
      {
        originalOperationId: "chat-op-1",
        refundOperationId: "refund:chat-op-1",
        credits: 1,
        reference: {
          type: "chat",
          id: "filing-1"
        }
      }
    );

    expect(result.creditsRefunded).toBe(1);
    expect(db.bind).toHaveBeenCalledWith(
      expect.any(String),
      identity.quotaSubject,
      "refund:chat-op-1",
      "refund",
      1,
      30,
      30,
      0,
      "chat",
      "filing-1",
      expect.stringContaining('"originalOperationId":"chat-op-1"'),
      "2026-04-25T00:00:01.000Z"
    );
  });
});
