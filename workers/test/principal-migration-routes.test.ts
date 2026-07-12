import { describe, expect, it } from "vitest";
import { handleInternalSubscriptionPrincipalMigrationRoute } from "../src/routes/internal-subscription-principal-migration";

const SOURCE = "legacy:quota:source";
const DIGEST = "a".repeat(64);

function request(mode: "preview" | "apply") {
  return new Request("https://api.test/internal/subscription-principal-migration", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kabuyomi-internal-token": "migration-secret"
    },
    body: JSON.stringify({
      mode,
      migrationId: "migration-route-safety-1",
      sourceQuotaSubject: SOURCE,
      originalTransactionId: "original-transaction-1",
      environment: "sandbox"
    })
  });
}

function createEnv(options: {
  failApply?: boolean;
  failTombstone?: boolean;
  failAuditWrite?: boolean;
} = {}) {
  const calls: Array<{ quotaSubject: string; action: string }> = [];
  let auditWrites = 0;
  const env = {
    BACKFILL_SHARED_SECRET: "migration-secret",
    SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1: "subscription-principal-test-key",
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                auditWrites += 1;
                if (options.failAuditWrite && auditWrites === 1) throw new Error("audit unavailable");
                return { meta: { changes: 1 } };
              }
            };
          }
        };
      }
    },
    USER_QUOTA: {
      getByName(quotaSubject: string) {
        return {
          async fetch(internalRequest: Request) {
            const body = await internalRequest.json() as Record<string, unknown>;
            const action = String(body.action);
            calls.push({ quotaSubject, action });
            if (action === "export") {
              return Response.json({
                status: "locked",
                sourceSnapshotDigest: DIGEST,
                snapshot: {
                  version: 1,
                  creditState: {
                    monthlyRemaining: 10,
                    purchasedRemaining: 20
                  },
                  purchaseRecords: [["purchase_transaction:tx-1", { transactionId: "tx-1" }]],
                  monthlyGrantRecords: [],
                  creditOperationRecords: [],
                  requestExecutionRecords: [],
                  creditReservationRecords: [],
                  exportedAt: "2026-07-11T00:00:00.000Z"
                }
              });
            }
            if (action === "apply" && options.failApply) {
              return Response.json({ error: "target conflict" }, { status: 409 });
            }
            if (action === "tombstone" && options.failTombstone) {
              return Response.json({ error: "source unavailable" }, { status: 503 });
            }
            return Response.json({ status: action === "apply" ? "applied" : action === "unlock" ? "unlocked" : "tombstoned" });
          }
        };
      }
    }
  } as never;
  return { env, calls };
}

async function invoke(env: never, mode: "preview" | "apply") {
  const incoming = request(mode);
  return handleInternalSubscriptionPrincipalMigrationRoute({
    request: incoming,
    url: new URL(incoming.url),
    env,
    config: {} as never,
    ctx: {} as never
  });
}

describe("principal migration route orchestration", () => {
  it("unlocks a preview source without applying or tombstoning", async () => {
    const test = createEnv();
    const response = await invoke(test.env, "preview");
    expect(response?.status).toBe(200);
    expect(test.calls.map(({ action }) => action)).toEqual(["export", "unlock"]);
  });

  it("unlocks the source when target apply fails", async () => {
    const test = createEnv({ failApply: true });
    await expect(invoke(test.env, "apply")).rejects.toMatchObject({ status: 409 });
    expect(test.calls.map(({ action }) => action)).toEqual(["export", "apply", "unlock"]);
  });

  it("keeps the source locked when apply succeeded but tombstoning is interrupted", async () => {
    const test = createEnv({ failTombstone: true });
    await expect(invoke(test.env, "apply")).rejects.toMatchObject({ status: 503 });
    expect(test.calls.map(({ action }) => action)).toEqual(["export", "apply", "tombstone"]);
  });

  it("unlocks the source when audit persistence fails before target apply", async () => {
    const test = createEnv({ failAuditWrite: true });
    await expect(invoke(test.env, "apply")).rejects.toThrow("audit unavailable");
    expect(test.calls.map(({ action }) => action)).toEqual(["export", "unlock"]);
  });
});
