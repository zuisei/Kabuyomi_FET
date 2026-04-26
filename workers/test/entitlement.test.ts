import { describe, expect, it } from "vitest";
import { EntitlementDO } from "../src/durable/entitlement";

function createState() {
  const storage = new Map<string, unknown>();

  return {
    storage: {
      async get<T>(key: string) {
        return storage.get(key) as T | undefined;
      },
      async put(key: string, value: unknown) {
        storage.set(key, value);
      }
    }
  };
}

describe("EntitlementDO", () => {
  it("does not mint a pro entitlement from an unverified active client claim", async () => {
    const entitlement = new EntitlementDO(createState() as never);

    const response = await entitlement.fetch(
      new Request("https://do/entitlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalTransactionId: "tx-123",
          active: true,
          productId: "app.kabuyomi.pro.monthly"
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: "free",
      quotaSubject: expect.stringMatching(/^free:[a-f0-9]{64}$/),
      productId: null
    });
  });

  it("stores a pro entitlement only for an internally server-verified mutation", async () => {
    const entitlement = new EntitlementDO(createState() as never);

    const response = await entitlement.fetch(
      new Request("https://do/entitlement", {
        method: "POST",
        headers: { "content-type": "application/json", "x-kabuyomi-device-binding": "device-hash-1" },
        body: JSON.stringify({
          originalTransactionId: "tx-123",
          active: true,
          productId: "app.kabuyomi.pro.monthly",
          serverVerified: true
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: "pro",
      quotaSubject: expect.stringMatching(/^pro:[a-f0-9]{64}$/),
      productId: "app.kabuyomi.pro.monthly",
      boundDeviceHash: "device-hash-1"
    });
  });

  it("rejects lookups when the stored device binding does not match", async () => {
    const entitlement = new EntitlementDO(createState() as never);

    await entitlement.fetch(
      new Request("https://do/entitlement", {
        method: "POST",
        headers: { "content-type": "application/json", "x-kabuyomi-device-binding": "device-hash-1" },
        body: JSON.stringify({
          originalTransactionId: "tx-123",
          active: true,
          productId: "app.kabuyomi.pro.monthly",
          serverVerified: true
        })
      })
    );

    const response = await entitlement.fetch(
      new Request("https://do/entitlement", {
        method: "GET",
        headers: { "x-kabuyomi-device-binding": "device-hash-2" }
      })
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: "Entitlement device binding mismatch"
    });
  });

  it("stores a pro max entitlement for an internally server-verified mutation", async () => {
    const entitlement = new EntitlementDO(createState() as never);

    const response = await entitlement.fetch(
      new Request("https://do/entitlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalTransactionId: "tx-123",
          active: true,
          productId: "app.kabuyomi.pro_max.monthly",
          serverVerified: true
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: "pro_max",
      quotaSubject: expect.stringMatching(/^pro_max:[a-f0-9]{64}$/),
      productId: "app.kabuyomi.pro_max.monthly"
    });
  });

  it("returns 400 when the payload is not valid JSON", async () => {
    const entitlement = new EntitlementDO(createState() as never);

    const response = await entitlement.fetch(
      new Request("https://do/entitlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid entitlement payload"
    });
  });

  it("returns 400 when required entitlement fields are missing", async () => {
    const entitlement = new EntitlementDO(createState() as never);

    const response = await entitlement.fetch(
      new Request("https://do/entitlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: "app.kabuyomi.pro.monthly"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid entitlement payload"
    });
  });
});
