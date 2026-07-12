import { describe, expect, it } from "vitest";
import {
  buildStableSubscriptionGrantOperationId,
  deriveStableSubscriptionPrincipal
} from "../src/lib/subscription-principal";

describe("stable subscription principal", () => {
  const env = { SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1: "test-only-high-entropy-principal-key" };

  it("maps one original transaction to one opaque principal across devices", async () => {
    const deviceA = await deriveStableSubscriptionPrincipal(env, "orig-123", "sandbox");
    const deviceB = await deriveStableSubscriptionPrincipal(env, "orig-123", "sandbox");
    expect(deviceA).toEqual(deviceB);
    expect(deviceA.quotaSubject).toMatch(/^subscription:v1:[A-Za-z0-9_-]{43}$/);
    expect(deviceA.quotaSubject).not.toContain("orig-123");
  });

  it("domain-separates environment and transaction lineage", async () => {
    const sandbox = await deriveStableSubscriptionPrincipal(env, "orig-123", "sandbox");
    const production = await deriveStableSubscriptionPrincipal(env, "orig-123", "production");
    const other = await deriveStableSubscriptionPrincipal(env, "orig-456", "sandbox");
    expect(production.quotaSubject).not.toBe(sandbox.quotaSubject);
    expect(other.quotaSubject).not.toBe(sandbox.quotaSubject);
  });

  it("fails closed when the HMAC secret is unavailable", async () => {
    await expect(
      deriveStableSubscriptionPrincipal({}, "orig-123", "production")
    ).rejects.toMatchObject({ status: 503 });
  });

  it("builds one monthly grant identity for one principal/product/period", async () => {
    const input = {
      stablePrincipal: "subscription:v1:principal",
      productId: "kabuyomi.sub.pro.monthly",
      periodStart: "2026-07-01T00:00:00.000Z",
      periodEnd: "2026-08-01T00:00:00.000Z"
    };
    expect(await buildStableSubscriptionGrantOperationId(input)).toBe(
      await buildStableSubscriptionGrantOperationId({ ...input })
    );
    expect(
      await buildStableSubscriptionGrantOperationId({ ...input, periodEnd: "2026-09-01T00:00:00.000Z" })
    ).not.toBe(await buildStableSubscriptionGrantOperationId(input));
  });
});
