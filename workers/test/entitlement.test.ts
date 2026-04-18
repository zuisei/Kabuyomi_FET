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
  it("stores and returns an entitlement payload for valid input", async () => {
    const entitlement = new EntitlementDO(createState() as never);

    const response = await entitlement.fetch(
      new Request("https://do/entitlement", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalTransactionId: "tx-123",
          active: true,
          productId: "kabuyomi.pro.monthly"
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: "pro",
      quotaSubject: expect.stringMatching(/^pro:[a-f0-9]{64}$/),
      productId: "kabuyomi.pro.monthly"
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
          productId: "kabuyomi.pro.monthly"
        })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid entitlement payload"
    });
  });
});
