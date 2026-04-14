import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";

describe("worker routing", () => {
  it("disables billing sync during beta", async () => {
    const response = await worker.fetch(
      new Request("https://kabuyomi.test/v1/billing/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          originalTransactionId: "tx-1",
          productId: "app.kabuyomi.pro.monthly",
          active: true
        })
      }),
      {
        KABUYOMI_CACHE: {
          get: vi.fn().mockResolvedValue(null)
        }
      } as never
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Billing sync is disabled during beta"
    });
  });
});
