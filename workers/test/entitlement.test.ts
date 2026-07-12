import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EntitlementDO } from "../src/durable/entitlement";

const PRINCIPAL = "subscription:v1:test-principal";
const BINDING = "a".repeat(64);
const NOW = new Date("2026-07-11T00:00:00.000Z");

function createState() {
  const storage = new Map<string, unknown>();
  return {
    id: { name: PRINCIPAL },
    storage: {
      async get<T>(key: string) { return storage.get(key) as T | undefined; },
      async put(key: string, value: unknown) { storage.set(key, structuredClone(value)); }
    },
    async blockConcurrencyWhile<T>(callback: () => Promise<T>) { return callback(); },
    stored: storage
  };
}

function mutation(overrides: Record<string, unknown> = {}) {
  return {
    action: "apply_verified",
    quotaSubject: PRINCIPAL,
    principalKeyVersion: "v1",
    originalTransactionId: "original-123",
    transactionId: "transaction-123",
    productId: "kabuyomi.sub.pro.monthly",
    plan: "pro",
    status: "active",
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-08-01T00:00:00.000Z",
    revokedAt: null,
    monthlyCredits: 300,
    monthlyGrantOperationId: "sub-grant:v1:test",
    lastVerifiedAt: "2026-07-11T00:00:00.000Z",
    verificationEnvironment: "production",
    verificationVersion: "app-store-server-library-node@3.1.0",
    verificationPayloadDigest: "b".repeat(64),
    signedDate: "2026-07-11T00:00:00.000Z",
    bindingHash: BINDING,
    bindingMethod: "verified_sync",
    ...overrides
  };
}

async function post(entitlement: EntitlementDO, body: unknown) {
  return entitlement.fetch(new Request("https://do/entitlement", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body)
  }));
}

describe("EntitlementDO", () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW }));
  afterEach(() => vi.useRealTimers());

  it("rejects an unverified client entitlement claim", async () => {
    const response = await post(new EntitlementDO(createState() as never), {
      originalTransactionId: "original-123",
      active: true,
      productId: "kabuyomi.sub.pro.monthly"
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Invalid verified entitlement payload" });
  });

  it("stores and returns a server-verified entitlement for the matching binding", async () => {
    const entitlement = new EntitlementDO(createState() as never);
    const applied = await post(entitlement, mutation());
    expect(applied.status).toBe(200);
    await expect(applied.json()).resolves.toMatchObject({
      plan: "pro",
      quotaSubject: PRINCIPAL,
      status: "active",
      bindings: [{ bindingHash: BINDING, status: "active" }]
    });

    const read = await entitlement.fetch(new Request("https://do/entitlement", {
      headers: { "x-kabuyomi-device-binding": BINDING }
    }));
    expect(read.status).toBe(200);
  });

  it("expires access on every read even without a notification", async () => {
    const state = createState();
    const entitlement = new EntitlementDO(state as never);
    await post(entitlement, mutation({ expiresAt: "2026-07-11T00:01:00.000Z" }));
    vi.setSystemTime(new Date("2026-07-11T00:02:00.000Z"));
    const read = await entitlement.fetch(new Request("https://do/entitlement", {
      headers: { "x-kabuyomi-device-binding": BINDING }
    }));
    expect(read.status).toBe(404);
    expect((state.stored.get("current:v2") as { status: string }).status).toBe("expired");
  });

  it("rejects a mismatched binding", async () => {
    const entitlement = new EntitlementDO(createState() as never);
    await post(entitlement, mutation());
    const response = await entitlement.fetch(new Request("https://do/entitlement", {
      headers: { "x-kabuyomi-device-binding": "c".repeat(64) }
    }));
    expect(response.status).toBe(403);
  });

  it("allows five verified bindings and rejects a silent sixth binding", async () => {
    const entitlement = new EntitlementDO(createState() as never);
    for (let index = 0; index < 5; index += 1) {
      const response = await post(entitlement, mutation({ bindingHash: String(index).repeat(64) }));
      expect(response.status).toBe(200);
    }
    const sixth = await post(entitlement, mutation({ bindingHash: "f".repeat(64) }));
    expect(sixth.status).toBe(409);
  });

  it("keeps revocation terminal and ignores stale state updates", async () => {
    const entitlement = new EntitlementDO(createState() as never);
    await post(entitlement, mutation());
    const revoked = await post(entitlement, mutation({
      status: "revoked",
      revokedAt: "2026-07-11T00:10:00.000Z",
      signedDate: "2026-07-11T00:10:00.000Z",
      lastVerifiedAt: "2026-07-11T00:10:00.000Z"
    }));
    expect(revoked.status).toBe(200);
    const reactivation = await post(entitlement, mutation({
      signedDate: "2026-07-11T00:05:00.000Z",
      lastVerifiedAt: "2026-07-11T00:05:00.000Z"
    }));
    expect(reactivation.status).toBe(409);
  });

  it("is idempotent for duplicate verified state", async () => {
    const entitlement = new EntitlementDO(createState() as never);
    expect((await post(entitlement, mutation())).status).toBe(200);
    const duplicate = await post(entitlement, mutation());
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as { bindings: unknown[] }).bindings).toHaveLength(1);
  });

  it("returns 400 for invalid JSON or missing required verified fields", async () => {
    const entitlement = new EntitlementDO(createState() as never);
    expect((await post(entitlement, "{")).status).toBe(400);
    expect((await post(entitlement, { action: "apply_verified", productId: "kabuyomi.sub.pro.monthly" })).status).toBe(400);
  });
});
