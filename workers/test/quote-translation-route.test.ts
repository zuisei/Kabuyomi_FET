import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/clients/llm/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/clients/llm/provider")>()),
  generateModelQuoteTranslation: vi.fn(),
  isQuoteTranslationAvailable: vi.fn()
}));

vi.mock("../src/lib/quota", () => ({
  loadUsage: vi.fn(),
  readQuotaIdentity: vi.fn()
}));

vi.mock("../src/lib/request-execution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/request-execution")>()),
  beginRequestExecution: vi.fn(),
  completeRequestExecution: vi.fn(),
  failRequestExecution: vi.fn()
}));

import { generateModelQuoteTranslation, isQuoteTranslationAvailable } from "../src/clients/llm/provider";
import { loadUsage, readQuotaIdentity } from "../src/lib/quota";
import {
  beginRequestExecution,
  completeRequestExecution,
  failRequestExecution
} from "../src/lib/request-execution";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";
import { handleTranslateQuoteRoute } from "../src/routes/translate-quote";

const mockGenerateQuoteTranslation = vi.mocked(generateModelQuoteTranslation);
const mockIsQuoteTranslationAvailable = vi.mocked(isQuoteTranslationAvailable);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);
const mockLoadUsage = vi.mocked(loadUsage);
const mockBeginRequestExecution = vi.mocked(beginRequestExecution);
const mockCompleteRequestExecution = vi.mocked(completeRequestExecution);
const mockFailRequestExecution = vi.mocked(failRequestExecution);

function translationLeaderResult(mode: "credits" | "unmetered" = "credits") {
  return {
    outcome: "leader" as const,
    executionPolicyVersion: "quote-translation-execution-v1",
    createdAt: "2026-04-18T00:00:00.000Z",
    reservationId: "reservation-translation-1",
    reservationMode: mode,
    reservationExpiresAt: "2026-04-18T00:05:00.000Z",
    creditsReserved: mode === "credits" ? 1 : 0
  };
}

function translationCompletionResult(
  creditsCharged = 1,
  reservationStatus: "committed" | "released" | "none" = "committed"
) {
  return {
    outcome: "completed" as const,
    didMutate: true,
    reservationStatus,
    creditsCharged
  };
}

describe("handleTranslateQuoteRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsQuoteTranslationAvailable.mockReturnValue(true);
    mockBeginRequestExecution.mockResolvedValue(translationLeaderResult());
    mockCompleteRequestExecution.mockImplementation(async (_identity, _env, options) =>
      translationCompletionResult(
        Number(options.resultBody.creditsCharged ?? 0),
        options.chargeable ? "committed" : "released"
      )
    );
    mockFailRequestExecution.mockResolvedValue({
      outcome: "failed",
      didMutate: true,
      reservationStatus: "released"
    });
    mockReadQuotaIdentity.mockResolvedValue({
      quotaSubject: "free:local:device-123",
      plan: "free",
      identityKind: "local_device"
    } as never);
    mockLoadUsage.mockResolvedValue({
      chatsUsed: 0,
      chatLimit: 10,
      stocksUsed: 0,
      stockLimit: 3,
      plan: "free",
      dateJST: "2026-04-18",
      credits: {
        monthlyRemaining: 29,
        monthlyLimit: 30,
        purchasedRemaining: 0,
        totalRemaining: 29,
        resetsAt: "2026-05-01T00:00:00+09:00"
      }
    } as never);
  });

  it("returns a translated quote with the dedicated translation model name", async () => {
    mockGenerateQuoteTranslation.mockResolvedValue({
      translatedText: "売上高は前年同期比で増加しました。",
      modelName: "gpt-5-nano",
      providerName: "openai"
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
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key"
      } as never,
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      translatedText: "売上高は前年同期比で増加しました。",
      modelName: "gpt-5-nano",
      creditsCharged: 1,
      creditsRemaining: 29
    });
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      DEFAULT_REMOTE_CONFIG,
      expect.objectContaining({
        operationId: "translate-op-1",
        reservation: {
          mode: "credits",
          creditsRequired: 1,
          reference: { type: "quote_translation", id: "source_preview" }
        }
      })
    );
    expect(mockGenerateQuoteTranslation).toHaveBeenCalledWith(
      expect.anything(),
      {
        text: "Revenue increased year over year.",
        targetLanguage: "ja",
        operationId: "translate-op-1"
      }
    );
    expect(mockBeginRequestExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockGenerateQuoteTranslation.mock.invocationCallOrder[0]!
    );
    expect(mockGenerateQuoteTranslation.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompleteRequestExecution.mock.invocationCallOrder[0]!
    );
    expect(mockCompleteRequestExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockLoadUsage.mock.invocationCallOrder[0]!
    );
    expect(mockCompleteRequestExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        chargeable: true,
        resultBody: {
          kind: "quote_translation",
          translatedText: "売上高は前年同期比で増加しました。",
          modelName: "gpt-5-nano",
          creditsCharged: 1
        }
      })
    );
    expect(mockCompleteRequestExecution.mock.calls[0]?.[2].resultBody).not.toHaveProperty("usage");
    expect(mockCompleteRequestExecution.mock.calls[0]?.[2].resultBody).not.toHaveProperty("creditsRemaining");
  });

  it("replays an exact translation once and attaches fresh usage", async () => {
    mockGenerateQuoteTranslation.mockResolvedValue({
      translatedText: "売上高は増加しました。",
      modelName: "gpt-5-nano",
      providerName: "openai"
    });
    let cachedResult: Parameters<typeof completeRequestExecution>[2]["resultBody"] | undefined;
    mockBeginRequestExecution.mockImplementation(async () =>
      cachedResult
        ? { outcome: "replay", result: cachedResult, resultMetadata: {} }
        : translationLeaderResult()
    );
    mockCompleteRequestExecution.mockImplementation(async (_identity, _env, options) => {
      cachedResult = options.resultBody;
      return translationCompletionResult();
    });
    mockLoadUsage.mockResolvedValue({
      chatsUsed: 0,
      chatLimit: 10,
      stocksUsed: 0,
      stockLimit: 3,
      plan: "free",
      dateJST: "2026-04-18",
      credits: {
        monthlyRemaining: 27,
        monthlyLimit: 30,
        purchasedRemaining: 0,
        totalRemaining: 27,
        resetsAt: "2026-05-01T00:00:00+09:00"
      }
    } as never);
    const send = () =>
      handleTranslateQuoteRoute({
        request: new Request("https://kabuyomi.test/v1/translate-quote", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify({
            text: "Revenue increased.",
            targetLanguage: "ja",
            operationId: "translate-op-replay"
          })
        }),
        url: new URL("https://kabuyomi.test/v1/translate-quote"),
        env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" } as never,
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      });

    const first = await send();
    const second = await send();

    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    expect(mockGenerateQuoteTranslation).toHaveBeenCalledTimes(1);
    expect(mockCompleteRequestExecution).toHaveBeenCalledTimes(1);
    await expect(second?.json()).resolves.toMatchObject({
      translatedText: "売上高は増加しました。",
      creditsCharged: 1,
      creditsRemaining: 27,
      usage: {
        creditBillingEnabled: true,
        credits: { totalRemaining: 27 }
      }
    });
  });

  it("rejects changed translation text under the same operation ID", async () => {
    mockGenerateQuoteTranslation.mockResolvedValue({
      translatedText: "売上高は増加しました。",
      modelName: "gpt-5-nano",
      providerName: "openai"
    });
    let originalHash: string | undefined;
    mockBeginRequestExecution.mockImplementation(async (_identity, _env, _config, options) => {
      if (!originalHash) {
        originalHash = options.requestHash;
        return translationLeaderResult();
      }
      return options.requestHash === originalHash
        ? { outcome: "pending", retryAfterSeconds: 1 }
        : { outcome: "payload_mismatch" };
    });
    const send = (text: string) =>
      handleTranslateQuoteRoute({
        request: new Request("https://kabuyomi.test/v1/translate-quote", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify({ text, targetLanguage: "ja", operationId: "translate-op-mismatch" })
        }),
        url: new URL("https://kabuyomi.test/v1/translate-quote"),
        env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" } as never,
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      });

    expect((await send("Revenue increased."))?.status).toBe(200);
    const changed = await send("Revenue declined.");

    expect(changed?.status).toBe(409);
    await expect(changed?.json()).resolves.toEqual({ error: "operation_id_payload_mismatch" });
    expect(mockGenerateQuoteTranslation).toHaveBeenCalledTimes(1);
    expect(mockCompleteRequestExecution).toHaveBeenCalledTimes(1);
  });

  it("replays after the translation provider is disabled", async () => {
    mockIsQuoteTranslationAvailable.mockReturnValue(false);
    mockBeginRequestExecution.mockResolvedValue({
      outcome: "replay",
      result: {
        kind: "quote_translation",
        translatedText: "保存済みの翻訳です。",
        modelName: "gpt-5-nano",
        creditsCharged: 1
      },
      resultMetadata: { responsePath: "openai" }
    });

    const response = await handleTranslateQuoteRoute({
      request: new Request("https://kabuyomi.test/v1/translate-quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          text: "Revenue increased.",
          targetLanguage: "ja",
          operationId: "translate-op-disabled-replay"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/translate-quote"),
      env: { LLM_PROVIDER: "disabled" } as never,
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      translatedText: "保存済みの翻訳です。",
      creditsCharged: 1
    });
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      DEFAULT_REMOTE_CONFIG,
      expect.objectContaining({ allowCreate: false })
    );
    expect(mockGenerateQuoteTranslation).not.toHaveBeenCalled();
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
  });

  it("returns result expiry without regenerating or charging", async () => {
    mockBeginRequestExecution.mockResolvedValue({ outcome: "result_expired" });

    const response = await handleTranslateQuoteRoute({
      request: new Request("https://kabuyomi.test/v1/translate-quote", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          text: "Revenue increased.",
          targetLanguage: "ja",
          operationId: "translate-op-expired"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/translate-quote"),
      env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" } as never,
      config: DEFAULT_REMOTE_CONFIG,
      ctx: {} as never
    });

    expect(response?.status).toBe(410);
    await expect(response?.json()).resolves.toEqual({ error: "operation_result_expired" });
    expect(mockGenerateQuoteTranslation).not.toHaveBeenCalled();
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
  });

  it("releases the translation reservation when generation fails", async () => {
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
          LLM_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key"
        } as never,
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toThrow("translation unavailable");

    expect(mockFailRequestExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        operationId: "translate-op-1",
        route: "quote_translation",
        failureCode: "quote_translation_failed"
      })
    );
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
    expect(mockLoadUsage).not.toHaveBeenCalled();
  });

  it("preserves the translation error when reservation release persistence fails", async () => {
    mockGenerateQuoteTranslation.mockRejectedValue(new Error("translation unavailable"));
    mockFailRequestExecution.mockRejectedValue(new Error("release unavailable"));

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
          LLM_PROVIDER: "openai",
          OPENAI_API_KEY: "test-key"
        } as never,
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toThrow("translation unavailable");

    expect(mockFailRequestExecution).toHaveBeenCalled();
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
  });

  it("does not log raw translation text, operation ID, or provider error messages", async () => {
    const rawText = "RAW_PRIVATE_TRANSLATION_TEXT";
    const operationId = "translation-operation-private-1234567890";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGenerateQuoteTranslation.mockRejectedValue(new Error(`provider rejected ${rawText}`));
    mockFailRequestExecution.mockRejectedValue(new Error(`release rejected ${rawText}`));

    await expect(
      handleTranslateQuoteRoute({
        request: new Request("https://kabuyomi.test/v1/translate-quote", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify({ text: rawText, targetLanguage: "ja", operationId })
        }),
        url: new URL("https://kabuyomi.test/v1/translate-quote"),
        env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" } as never,
        config: DEFAULT_REMOTE_CONFIG,
        ctx: {} as never
      })
    ).rejects.toThrow("provider rejected");

    const serializedLogs = errorLog.mock.calls.map(([line]) => String(line)).join("\n");
    expect(serializedLogs).not.toContain(rawText);
    expect(serializedLogs).not.toContain(operationId);
    expect(serializedLogs).not.toContain("provider rejected");
    expect(serializedLogs).not.toContain("release rejected");
    errorLog.mockRestore();
  });

  it("returns 402 before model execution when billing UI is disabled and credits are zero", async () => {
    mockBeginRequestExecution.mockResolvedValue({
      outcome: "failed",
      failureCode: "insufficient_credits",
      failureStatus: 402,
      failureDetails: { creditsRequired: 1, creditsRemaining: 0 }
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
          operationId: "translate-op-empty"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/translate-quote"),
      env: {
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key"
      } as never,
      config: {
        ...DEFAULT_REMOTE_CONFIG,
        creditBillingEnabled: false
      },
      ctx: {} as never
    });

    expect(response?.status).toBe(402);
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ creditBillingEnabled: false }),
      expect.objectContaining({
        reservation: {
          mode: "credits",
          creditsRequired: 1,
          reference: { type: "quote_translation", id: "source_preview" }
        }
      })
    );
    expect(mockGenerateQuoteTranslation).not.toHaveBeenCalled();
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
    await expect(response?.json()).resolves.toEqual({
      error: "insufficient_credits",
      creditsRequired: 1,
      creditsRemaining: 0
    });
  });

  it("never calls the translation provider beyond reserved credit capacity", async () => {
    let reservationsGranted = 0;
    mockBeginRequestExecution.mockImplementation(async () => {
      if (reservationsGranted < 2) {
        reservationsGranted += 1;
        return translationLeaderResult("credits");
      }
      return {
        outcome: "failed",
        failureCode: "insufficient_credits",
        failureStatus: 402,
        failureDetails: { creditsRequired: 1, creditsRemaining: 0 }
      };
    });
    mockGenerateQuoteTranslation.mockResolvedValue({
      translatedText: "予約済み翻訳",
      modelName: "gpt-5-nano",
      providerName: "openai"
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        handleTranslateQuoteRoute({
          request: new Request("https://kabuyomi.test/v1/translate-quote", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-device-key": "device-123"
            },
            body: JSON.stringify({
              text: `Revenue sample ${index}.`,
              targetLanguage: "ja",
              operationId: `translate-op-capacity-${index}`
            })
          }),
          url: new URL("https://kabuyomi.test/v1/translate-quote"),
          env: { LLM_PROVIDER: "openai", OPENAI_API_KEY: "test-key" } as never,
          config: DEFAULT_REMOTE_CONFIG,
          ctx: {} as never
        })
      )
    );

    expect(responses.filter((response) => response?.status === 200)).toHaveLength(2);
    expect(responses.filter((response) => response?.status === 402)).toHaveLength(8);
    expect(mockGenerateQuoteTranslation).toHaveBeenCalledTimes(2);
    expect(mockCompleteRequestExecution).toHaveBeenCalledTimes(2);
  });

  it("returns 503 when quote translation is disabled server-side", async () => {
    mockIsQuoteTranslationAvailable.mockReturnValue(false);
    mockBeginRequestExecution.mockResolvedValue({ outcome: "not_started" });

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
          operationId: "translate-op-disabled"
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
    expect(mockReadQuotaIdentity).toHaveBeenCalledOnce();
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        operationId: "translate-op-disabled",
        allowCreate: false
      })
    );
    expect(mockGenerateQuoteTranslation).not.toHaveBeenCalled();
  });
});
