import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

vi.mock("../src/lib/chat/orchestrator", () => ({
  buildChatResponse: vi.fn()
}));

vi.mock("../src/lib/filings/cache", () => ({
  loadFilingByKey: vi.fn(),
  isCurrentCacheRecord: vi.fn()
}));

vi.mock("../src/lib/filings/content-upgrade", () => ({
  enqueueContentUpgrade: vi.fn(),
  isMetricsOnlyRecord: vi.fn((record: { contentMode?: string }) => record.contentMode === "metrics_only"),
  upgradeMetricsOnlyRecord: vi.fn(async (record: { contentMode?: string }) =>
    record.contentMode === "metrics_only" ? { ...record, contentMode: "full", mdaText: "upgraded md&a" } : record
  )
}));

vi.mock("../src/lib/quota", () => ({
  readQuotaIdentity: vi.fn(),
  consumeChatQuota: vi.fn(),
  refundChatQuota: vi.fn(),
  consumeCredit: vi.fn(),
  refundCredit: vi.fn(),
  InsufficientCreditsError: class InsufficientCreditsError extends Error {
    readonly status = 402;
    readonly publicMessage = "insufficient_credits";

    constructor(
      readonly creditsRequired: number,
      readonly creditsRemaining: number
    ) {
      super("insufficient_credits");
    }
  }
}));

vi.mock("../src/clients/gemini/request", () => ({
  resolveGeminiModel: vi.fn(() => "gemini-2.5-flash")
}));

import { handleChatRoute } from "../src/routes/chat";
import { loadFilingByKey, isCurrentCacheRecord } from "../src/lib/filings/cache";
import { upgradeMetricsOnlyRecord } from "../src/lib/filings/content-upgrade";
import { buildChatResponse } from "../src/lib/chat/orchestrator";
import {
  consumeChatQuota,
  consumeCredit,
  readQuotaIdentity,
  refundChatQuota,
  refundCredit,
  InsufficientCreditsError
} from "../src/lib/quota";

const mockBuildChatResponse = vi.mocked(buildChatResponse);
const mockLoadFilingByKey = vi.mocked(loadFilingByKey);
const mockIsCurrentCacheRecord = vi.mocked(isCurrentCacheRecord);
const mockUpgradeMetricsOnlyRecord = vi.mocked(upgradeMetricsOnlyRecord);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);
const mockConsumeChatQuota = vi.mocked(consumeChatQuota);
const mockRefundChatQuota = vi.mocked(refundChatQuota);
const mockConsumeCredit = vi.mocked(consumeCredit);
const mockRefundCredit = vi.mocked(refundCredit);

describe("handleChatRoute", () => {
  const env = {} as never;
  const ctx = {} as never;
  const identity = {
    quotaSubject: "free:local:device-123",
    plan: "free",
    identityKind: "local_device"
  } as const;
  const legacyQuotaConfig = {
    ...DEFAULT_REMOTE_CONFIG,
    creditBillingEnabled: false
  };
  const usage = {
    plan: "free",
    dateJST: "2026-04-18",
    chatsUsed: 1,
    chatLimit: 3,
    stocksUsed: 1,
    stockLimit: 3,
    updatedAt: "2026-04-18T00:00:00.000Z"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadFilingByKey.mockResolvedValue({
      filingKey: "filing-1",
      ticker: "ORCL",
      cik: "0001341439",
      extractorVersion: DEFAULT_REMOTE_CONFIG.extractorVersion,
      promptVersion: DEFAULT_REMOTE_CONFIG.promptVersion
    } as never);
    mockIsCurrentCacheRecord.mockReturnValue(true);
    mockReadQuotaIdentity.mockResolvedValue(identity as never);
    mockConsumeChatQuota.mockResolvedValue(usage as never);
    mockRefundChatQuota.mockResolvedValue(usage as never);
    mockConsumeCredit.mockResolvedValue({
      usage: {
        ...usage,
        credits: {
          monthlyRemaining: 28,
          monthlyLimit: 30,
          purchasedRemaining: 0,
          totalRemaining: 28,
          resetsAt: "2026-05-01T00:00:00+09:00"
        }
      },
      didMutate: true,
      operationId: "chat-op-1",
      creditsCharged: 2,
      creditsRemaining: 28
    } as never);
    mockRefundCredit.mockResolvedValue({
      usage,
      didMutate: true,
      operationId: "refund-chat-op-1",
      creditsRefunded: 2,
      creditsRemaining: 30
    } as never);
  });

  it("returns a null modelName for non-remote response paths", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "Deterministic answer",
      sources: [],
      responsePath: "deterministic"
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "利益率は改善した？"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: legacyQuotaConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      responsePath: "deterministic",
      modelName: null
    });
    expect(mockBuildChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({ filingKey: "filing-1" }),
      "利益率は改善した？",
      expect.anything(),
      expect.anything(),
      { executionContext: ctx }
    );
    expect(mockConsumeChatQuota.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildChatResponse.mock.invocationCallOrder[0]!
    );
    expect(mockRefundChatQuota).not.toHaveBeenCalled();
    expect(mockConsumeCredit).not.toHaveBeenCalled();
  });

  it("includes chat debug metadata only for the test worker environment", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "Debug answer",
      sources: [{ sourceId: "S1", sourceKind: "sec_filing", sourceStrength: "filing_primary", sectionType: "md_a", sourceLabel: "10-Q", excerpt: "source" }],
      responsePath: "fallback",
      debug: {
        questionIntent: "business_overview",
        responsePath: "fallback",
        fallbackReason: "schema_invalid",
        sourceIdsValid: false,
        retryReason: "schema_invalid"
      }
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "何の会社？"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env: { KABUYOMI_ENV: "test" } as never,
      config: legacyQuotaConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      debug: {
        questionIntent: "business_overview",
        responsePath: "fallback",
        fallbackReason: "schema_invalid",
        sourceCount: 1,
        sourceIds: ["S1"],
        sourceIdsValid: false,
        contextApplied: false,
        modelName: null,
        retryReason: "schema_invalid"
      }
    });
  });

  it("anchors short follow-up questions to recent chat context", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "営業CF answer",
      sources: [],
      responsePath: "deterministic"
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "なぜ？",
          conversationContext: [
            { role: "user", content: "営業CF" },
            { role: "assistant", content: "営業キャッシュフローはマイナスで、前年比で減少しました。" }
          ]
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: legacyQuotaConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockBuildChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({ filingKey: "filing-1" }),
      "営業CFが変化した理由は？",
      expect.anything(),
      expect.anything(),
      { executionContext: ctx }
    );
  });

  it("logs chat quality pipeline fields for diagnosability", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockBuildChatResponse.mockResolvedValue({
      answer: "Debug answer",
      sources: [
        {
          sourceId: "S1",
          sourceKind: "sec_filing",
          sourceStrength: "filing_primary",
          sectionType: "md_a",
          sourceLabel: "10-Q Part I Item 2",
          excerpt: "source"
        }
      ],
      responsePath: "fallback",
      debug: {
        questionIntent: "mda_summary",
        responsePath: "fallback",
        fallbackReason: "weak_grounding",
        sourceIdsValid: false,
        selectedSourceCount: 2,
        selectedSourceCharCount: 1234,
        estimatedContextTokens: 309,
        selectedSourceIds: ["S1", "S2"],
        selectedSourceLabels: ["10-Q Part I Item 2", "10-Q XBRL 売上高"],
        geminiCalled: true,
        geminiSucceeded: true,
        schemaValid: true,
        retryAttempt: 1,
        retryReason: "weak_grounding"
      }
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "なぜ？",
          conversationContext: [
            { role: "user", content: "売上高は？" },
            { role: "assistant", content: "売上高は前年同期比で増加しました。" }
          ]
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: legacyQuotaConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    const qualityLog = logSpy.mock.calls
      .map(([line]) => (typeof line === "string" ? JSON.parse(line) as Record<string, unknown> : null))
      .find((entry): entry is Record<string, unknown> => entry?.event === "chat_quality_pipeline");

    expect(qualityLog).toMatchObject({
      ticker: "ORCL",
      filingKey: "filing-1",
      originalQuestion: "なぜ？",
      rewrittenQuestion: "売上高が変化した理由は？",
      questionIntent: "mda_summary",
      responsePath: "fallback",
      fallbackReason: "weak_grounding",
      selectedSourceCount: 2,
      selectedSourceCharCount: 1234,
      estimatedContextTokens: 309,
      modelName: "gemini-2.5-flash",
      selectedSourceIds: ["S1", "S2"],
      selectedSourceLabels: ["10-Q Part I Item 2", "10-Q XBRL 売上高"],
      sourceIdsValid: false,
      geminiCalled: true,
      geminiSucceeded: true,
      schemaValid: true,
      retryAttempt: 1,
      retryReason: "weak_grounding",
      contextApplied: true,
      contextMessageCount: 2,
      finalSourceIds: ["S1"],
      finalSourceLabels: ["10-Q Part I Item 2"]
    });
    expect(qualityLog?.answerQualityFlags).toEqual(
      expect.arrayContaining(["context_rewritten", "fallback_path", "fallback:weak_grounding", "invalid_source_ids", "model_retry_used"])
    );
  });

  it("upgrades metrics-only filings before consuming chat quota", async () => {
    const metricsOnlyFiling = {
      filingKey: "filing-1",
      ticker: "ORCL",
      cik: "0001341439",
      extractorVersion: DEFAULT_REMOTE_CONFIG.extractorVersion,
      promptVersion: DEFAULT_REMOTE_CONFIG.promptVersion,
      contentMode: "metrics_only"
    };
    const upgradedFiling = {
      ...metricsOnlyFiling,
      contentMode: "full",
      mdaText: "upgraded md&a"
    };
    mockLoadFilingByKey.mockResolvedValue(metricsOnlyFiling as never);
    mockUpgradeMetricsOnlyRecord.mockResolvedValue(upgradedFiling as never);
    mockBuildChatResponse.mockResolvedValue({
      answer: "Full filing answer",
      sources: [],
      responsePath: "gemini"
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "この企業はなんの企業？"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: legacyQuotaConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockUpgradeMetricsOnlyRecord).toHaveBeenCalledWith(metricsOnlyFiling, env);
    expect(mockUpgradeMetricsOnlyRecord.mock.invocationCallOrder[0]).toBeLessThan(
      mockConsumeChatQuota.mock.invocationCallOrder[0]!
    );
    expect(mockBuildChatResponse).toHaveBeenCalledWith(
      upgradedFiling,
      "この企業はなんの企業？",
      expect.anything(),
      expect.anything(),
      { executionContext: ctx }
    );
  });

  it("returns the resolved model name only for gemini responses", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "Remote answer",
      sources: [],
      responsePath: "gemini"
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "ガイダンスの見方は？"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: DEFAULT_REMOTE_CONFIG,
      ctx
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      responsePath: "gemini",
      modelName: "gemini-2.5-flash"
    });
  });

  it("returns notFound for stale requested filings instead of silently upgrading to latest", async () => {
    mockIsCurrentCacheRecord.mockReturnValue(false);

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "利益率は改善した？"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: DEFAULT_REMOTE_CONFIG,
      ctx
    });

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({
      error: "Filing cache not found"
    });
    expect(mockConsumeChatQuota).not.toHaveBeenCalled();
    expect(mockBuildChatResponse).not.toHaveBeenCalled();
  });

  it("refunds consumed chat quota when chat generation fails after quota mutation", async () => {
    mockBuildChatResponse.mockRejectedValue(new Error("Gemini unavailable"));

    await expect(
      handleChatRoute({
        request: new Request("https://kabuyomi.test/v1/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify({
            filingKey: "filing-1",
            question: "ガイダンスの見方は？"
          })
        }),
        url: new URL("https://kabuyomi.test/v1/chat"),
        env,
        config: legacyQuotaConfig,
        ctx
      })
    ).rejects.toThrow("Gemini unavailable");

    expect(mockConsumeChatQuota).toHaveBeenCalledWith(identity, expect.anything(), expect.anything());
    expect(mockRefundChatQuota).toHaveBeenCalledWith(identity, expect.anything(), expect.anything(), {
      operationId: expect.any(String)
    });
  });

  it("refunds chat quota for non-chargeable historical preparation responses", async () => {
    mockRefundChatQuota.mockResolvedValue({ ...usage, chatsUsed: 0 } as never);
    mockBuildChatResponse.mockResolvedValue({
      answer: "履歴比較をバックグラウンドで準備中のため、今回は3年比較を完了できません。",
      sources: [],
      responsePath: "fallback",
      chargeable: false
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "3年でどう推移した？"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: legacyQuotaConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockRefundChatQuota).toHaveBeenCalledWith(identity, env, expect.anything(), {
      operationId: expect.any(String)
    });
    await expect(response?.json()).resolves.toMatchObject({
      responsePath: "fallback",
      usage: {
        chatsUsed: 0
      }
    });
  });

  it("uses credit billing when enabled and returns credit charge metadata", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "Credit answer",
      sources: [],
      responsePath: "gemini"
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "ガイダンスの見方は？",
          operationId: "chat-op-1"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: {
        ...DEFAULT_REMOTE_CONFIG,
        creditBillingEnabled: true
      },
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockConsumeChatQuota).not.toHaveBeenCalled();
    expect(mockConsumeCredit).toHaveBeenCalledWith(identity, env, expect.anything(), {
      operationId: "chat-op-1",
      creditsRequired: 2,
      reference: {
        type: "chat",
        id: "filing-1"
      }
    });
    await expect(response?.json()).resolves.toMatchObject({
      creditsCharged: 2,
      creditsRemaining: 28,
      usage: {
        credits: {
          totalRemaining: 28
        }
      }
    });
  });

  it("refunds credits for non-chargeable historical preparation responses", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "履歴比較をバックグラウンドで準備中のため、今回は3年比較を完了できません。",
      sources: [],
      responsePath: "fallback",
      chargeable: false
    });
    mockRefundCredit.mockResolvedValue({
      usage: {
        ...usage,
        credits: {
          monthlyRemaining: 30,
          monthlyLimit: 30,
          purchasedRemaining: 0,
          totalRemaining: 30,
          resetsAt: "2026-05-01T00:00:00+09:00"
        }
      },
      didMutate: true,
      operationId: "refund:chat-op-1",
      creditsRefunded: 2,
      creditsRemaining: 30
    } as never);

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "3年でどう推移した？",
          operationId: "chat-op-1"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: {
        ...DEFAULT_REMOTE_CONFIG,
        creditBillingEnabled: true
      },
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockRefundCredit).toHaveBeenCalledWith(identity, env, expect.anything(), {
      originalOperationId: "chat-op-1",
      refundOperationId: "refund:chat-op-1",
      credits: 2,
      reference: {
        type: "chat",
        id: "filing-1"
      }
    });
    await expect(response?.json()).resolves.toMatchObject({
      creditsCharged: 0,
      creditsRemaining: 30,
      usage: {
        credits: {
          totalRemaining: 30
        }
      }
    });
  });

  it("uses credit billing for detached dev access without the global credit flag", async () => {
    mockReadQuotaIdentity.mockResolvedValue({
      ...identity,
      plan: "pro",
      identityKind: "detached_device",
      accessMode: "dev_unlimited"
    } as never);
    mockBuildChatResponse.mockResolvedValue({
      answer: "Detached credit answer",
      sources: [],
      responsePath: "gemini"
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123",
          "x-kabuyomi-detached-access": "dev_unlimited"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "ガイダンスの見方は？",
          operationId: "chat-op-1"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: legacyQuotaConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockConsumeChatQuota).not.toHaveBeenCalled();
    expect(mockConsumeCredit).toHaveBeenCalled();
    await expect(response?.json()).resolves.toMatchObject({
      usage: {
        creditBillingEnabled: true
      },
      creditsCharged: 2,
      creditsRemaining: 28
    });
  });

  it("refunds credit when chat generation fails after credit consumption", async () => {
    mockBuildChatResponse.mockRejectedValue(new Error("Gemini unavailable"));

    await expect(
      handleChatRoute({
        request: new Request("https://kabuyomi.test/v1/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify({
            filingKey: "filing-1",
            question: "ガイダンスの見方は？",
            operationId: "chat-op-1"
          })
        }),
        url: new URL("https://kabuyomi.test/v1/chat"),
        env,
        config: {
          ...DEFAULT_REMOTE_CONFIG,
          creditBillingEnabled: true
        },
        ctx
      })
    ).rejects.toThrow("Gemini unavailable");

    expect(mockRefundChatQuota).not.toHaveBeenCalled();
    expect(mockRefundCredit).toHaveBeenCalledWith(identity, env, expect.anything(), {
      originalOperationId: "chat-op-1",
      refundOperationId: "refund:chat-op-1",
      credits: 2,
      reference: {
        type: "chat",
        id: "filing-1"
      }
    });
  });

  it("returns insufficient_credits without running chat generation", async () => {
    mockConsumeCredit.mockRejectedValue(new InsufficientCreditsError(2, 0));

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "ガイダンスの見方は？",
          operationId: "chat-op-empty"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: {
        ...DEFAULT_REMOTE_CONFIG,
        creditBillingEnabled: true
      },
      ctx
    });

    expect(response?.status).toBe(402);
    expect(mockBuildChatResponse).not.toHaveBeenCalled();
    await expect(response?.json()).resolves.toEqual({
      error: "insufficient_credits",
      creditsRequired: 2,
      creditsRemaining: 0
    });
  });

  it("allows filing chat access without a saved ticker gate", async () => {
    mockLoadFilingByKey.mockResolvedValue({
      filingKey: "filing-1",
      ticker: "BRK-A",
      cik: "0001067983",
      extractorVersion: DEFAULT_REMOTE_CONFIG.extractorVersion,
      promptVersion: DEFAULT_REMOTE_CONFIG.promptVersion
    } as never);
    mockBuildChatResponse.mockResolvedValue({
      answer: "ok",
      sources: [],
      responsePath: "deterministic"
    });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "どう？"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: DEFAULT_REMOTE_CONFIG,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockBuildChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({ ticker: "BRK-A" }),
      "どう？",
      expect.anything(),
      expect.anything(),
      { executionContext: ctx }
    );
  });
});
