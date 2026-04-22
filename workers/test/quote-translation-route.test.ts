import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/gemini", () => ({
  generateQuoteTranslation: vi.fn()
}));

vi.mock("../src/lib/quota", () => ({
  readQuotaIdentity: vi.fn()
}));

import { generateQuoteTranslation } from "../src/clients/gemini";
import { readQuotaIdentity } from "../src/lib/quota";
import { handleTranslateQuoteRoute } from "../src/routes/translate-quote";

const mockGenerateQuoteTranslation = vi.mocked(generateQuoteTranslation);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);

describe("handleTranslateQuoteRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadQuotaIdentity.mockResolvedValue({
      quotaSubject: "free:local:device-123",
      plan: "free",
      identityKind: "local_device"
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
          targetLanguage: "ja"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/translate-quote"),
      env: {
        GEMINI_API_KEY: "test-key"
      } as never,
      config: {} as never,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toEqual({
      translatedText: "売上高は前年同期比で増加しました。",
      modelName: "gemma-4-26b-a4b-it"
    });
    expect(mockGenerateQuoteTranslation).toHaveBeenCalledWith(
      expect.anything(),
      {
        text: "Revenue increased year over year.",
        targetLanguage: "ja"
      }
    );
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
