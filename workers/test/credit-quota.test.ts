import { describe, expect, it, vi } from "vitest";
import { consumeCredit, InsufficientCreditsError, refundCredit, type QuotaIdentity } from "../src/lib/quota";
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

describe("credit quota bridge", () => {
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
