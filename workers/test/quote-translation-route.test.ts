import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/gemini", () => ({
  generateQuoteTranslation: vi.fn()
}));

vi.mock("../src/lib/quota", () => ({
  consumeCredit: vi.fn(),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    constructor(
      readonly creditsRequired: number,
      readonly creditsRemaining: number
    ) {
      super("insufficient_credits");
    }
  },
  readQuotaIdentity: vi.fn(),
  refundCredit: vi.fn()
}));

import { generateQuoteTranslation } from "../src/clients/gemini";
import { consumeCredit, InsufficientCreditsError, readQuotaIdentity, refundCredit } from "../src/lib/quota";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { handleTranslateQuoteRoute } from "../src/routes/translate-quote";

const mockGenerateQuoteTranslation = vi.mocked(generateQuoteTranslation);
const mockConsumeCredit = vi.mocked(consumeCredit);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);
const mockRefundCredit = vi.mocked(refundCredit);

describe("handleTranslateQuoteRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadQuotaIdentity.mockResolvedValue({
      quotaSubject: "free:local:device-123",
      plan: "free",
      identityKind: "local_device"
    } as never);
    mockConsumeCredit.mockResolvedValue({
      usage: {
        chatsUsed: 0,
        chatLimit: 10,
        stocksViewed: 0,
        stockLimit: 3,
        savedTickers: [],
        savedTickerLimit: 3,
        credits: {
          monthlyRemaining: 29,
          monthlyLimit: 30,
          purchasedRemaining: 0,
          totalRemaining: 29,
          resetsAt: "2026-05-01T00:00:00+09:00"
        },
        creditBillingEnabled: true
      },
      didMutate: true,
      operationId: "translate-op-1",
      creditsCharged: 1,
      creditsRemaining: 29
    } as never);
  });

  it("returns a translated quote with the dedicated translation model name", async () => {
    mockGenerateQuoteTranslation.mockResolvedValue({
      translatedText: "売上高は前年同期比で増加しました。",
      modelName: "gemma-4-26b-a4b-it"
    });

    const response = await handleTranslateQuoteRoute({
      request: new Request("https://kabuyomi.test/v1/translate-quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          text: "Revenue increased year over year.",
          targetLanguage: "ja",
          operationId: "translate-op-1"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/translate-quote"),
      env: {
        GEMINI_API_KEY: "test-key"
      } as never,
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      translatedText: "売上高は前年同期比で増加しました。",
      modelName: "gemma-4-26b-a4b-it",
      creditsCharged: 1,
      creditsRemaining: 29
    });
    expect(mockConsumeCredit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
      operationId: "translate-op-1",
      creditsRequired: 1,
      reference: {
        type: "quote_translation",
        id: "source_preview"
      }
    });
    expect(mockGenerateQuoteTranslation).toHaveBeenCalledWith(
      expect.anything(),
      {
        text: "Revenue increased year over year.",
        targetLanguage: "ja",
        operationId: "translate-op-1"
      }
    );
  });

  it("refunds the translation credit when generation fails", async () => {
    mockGenerateQuoteTranslation.mockRejectedValue(new Error("translation unavailable"));

    await expect(
      handleTranslateQuoteRoute({
        request: new Request("https://kabuyomi.test/v1/translate-quote", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify({
            text: "Revenue increased year over year.",
            targetLanguage: "ja",
            operationId: "translate-op-1"
          })
        }),
        url: new URL("https://kabuyomi.test/v1/translate-quote"),
        env: {
          GEMINI_API_KEY: "test-key"
        } as never,
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toThrow("translation unavailable");

    expect(mockRefundCredit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
      originalOperationId: "translate-op-1",
      refundOperationId: "refund:translate-op-1",
      credits: 1,
      reference: {
        type: "quote_translation",
        id: "source_preview"
      }
    });
  });

  it("preserves the translation error when refunding the consumed credit fails", async () => {
    mockGenerateQuoteTranslation.mockRejectedValue(new Error("translation unavailable"));
    mockRefundCredit.mockRejectedValue(new Error("refund unavailable"));

    await expect(
      handleTranslateQuoteRoute({
        request: new Request("https://kabuyomi.test/v1/translate-quote", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify({
            text: "Revenue increased year over year.",
            targetLanguage: "ja",
            operationId: "translate-op-1"
          })
        }),
        url: new URL("https://kabuyomi.test/v1/translate-quote"),
        env: {
          GEMINI_API_KEY: "test-key"
        } as never,
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toThrow("translation unavailable");

    expect(mockRefundCredit).toHaveBeenCalled();
  });

  it("returns insufficient_credits before translating", async () => {
    mockConsumeCredit.mockRejectedValue(new InsufficientCreditsError(1, 0));

    const response = await handleTranslateQuoteRoute({
      request: new Request("https://kabuyomi.test/v1/translate-quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          text: "Revenue increased year over year.",
          targetLanguage: "ja",
          operationId: "translate-op-empty"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/translate-quote"),
      env: {
        GEMINI_API_KEY: "test-key"
      } as never,
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(402);
    expect(mockGenerateQuoteTranslation).not.toHaveBeenCalled();
    await expect(response?.json()).resolves.toEqual({
      error: "insufficient_credits",
      creditsRequired: 1,
      creditsRemaining: 0
    });
  });

  it("returns 503 when quote translation is disabled server-side", async () => {
    const response = await handleTranslateQuoteRoute({
      request: new Request("https://kabuyomi.test/v1/translate-quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          text: "Revenue increased year over year.",
          targetLanguage: "ja"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/translate-quote"),
      env: {} as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      error: "Quote translation is temporarily disabled"
    });
    expect(mockReadQuotaIdentity).not.toHaveBeenCalled();
    expect(mockGenerateQuoteTranslation).not.toHaveBeenCalled();
  });
});
