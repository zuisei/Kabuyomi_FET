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
  backfillMarginSourceAssets: vi.fn(async (record) => record),
  backfillRevenueDriverSourceAssets: vi.fn(async (record) => record),
  enqueueContentUpgrade: vi.fn(),
  isMetricsOnlyRecord: vi.fn((record: { contentMode?: string }) => record.contentMode === "metrics_only"),
  needsMarginSourceBackfill: vi.fn(() => false),
  needsRevenueDriverSourceBackfill: vi.fn(() => false),
  upgradeMetricsOnlyRecord: vi.fn(async (record: { contentMode?: string }) =>
    record.contentMode === "metrics_only" ? { ...record, contentMode: "full", mdaText: "upgraded md&a" } : record
  )
}));

vi.mock("../src/lib/quota", () => ({
  readQuotaIdentity: vi.fn(),
  loadUsage: vi.fn()
}));

vi.mock("../src/lib/request-execution", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/request-execution")>()),
  beginRequestExecution: vi.fn(),
  completeRequestExecution: vi.fn(),
  failRequestExecution: vi.fn()
}));

vi.mock("../src/clients/gemini/request", () => ({
  resolveGeminiModel: vi.fn(() => "gemini-2.5-flash")
}));

import { handleChatRoute } from "../src/routes/chat";
import { loadFilingByKey, isCurrentCacheRecord } from "../src/lib/filings/cache";
import {
  backfillRevenueDriverSourceAssets,
  needsRevenueDriverSourceBackfill,
  upgradeMetricsOnlyRecord
} from "../src/lib/filings/content-upgrade";
import { buildChatResponse } from "../src/lib/chat/orchestrator";
import {
  beginRequestExecution,
  completeRequestExecution,
  failRequestExecution
} from "../src/lib/request-execution";
import {
  loadUsage,
  readQuotaIdentity
} from "../src/lib/quota";

const mockBuildChatResponse = vi.mocked(buildChatResponse);
const mockLoadFilingByKey = vi.mocked(loadFilingByKey);
const mockIsCurrentCacheRecord = vi.mocked(isCurrentCacheRecord);
const mockUpgradeMetricsOnlyRecord = vi.mocked(upgradeMetricsOnlyRecord);
const mockBackfillRevenueDriverSourceAssets = vi.mocked(backfillRevenueDriverSourceAssets);
const mockNeedsRevenueDriverSourceBackfill = vi.mocked(needsRevenueDriverSourceBackfill);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);
const mockLoadUsage = vi.mocked(loadUsage);
const mockBeginRequestExecution = vi.mocked(beginRequestExecution);
const mockCompleteRequestExecution = vi.mocked(completeRequestExecution);
const mockFailRequestExecution = vi.mocked(failRequestExecution);

function chatLeaderResult(mode: "credits" | "unmetered" = "credits") {
  return {
    outcome: "leader" as const,
    executionPolicyVersion: "chat-request-execution-v1",
    createdAt: "2026-04-18T00:00:00.000Z",
    reservationId: "reservation-chat-1",
    reservationMode: mode,
    reservationExpiresAt: "2026-04-18T00:05:00.000Z",
    creditsReserved: mode === "credits" ? 2 : 0
  };
}

function chatCompletionResult(creditsCharged = 2, reservationStatus: "committed" | "released" | "none" = "committed") {
  return {
    outcome: "completed" as const,
    didMutate: true,
    reservationStatus,
    creditsCharged
  };
}

describe("handleChatRoute", () => {
  const env = {} as never;
  const ctx = {} as never;
  const identity = {
    quotaSubject: "free:local:device-123",
    plan: "free",
    identityKind: "local_device"
  } as const;
  const billingUiDisabledConfig = {
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
  const creditUsage = {
    ...usage,
    credits: {
      monthlyRemaining: 30,
      monthlyLimit: 30,
      purchasedRemaining: 0,
      totalRemaining: 30,
      resetsAt: "2026-05-01T00:00:00+09:00"
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNeedsRevenueDriverSourceBackfill.mockReturnValue(false);
    mockBeginRequestExecution.mockResolvedValue(chatLeaderResult());
    mockCompleteRequestExecution.mockImplementation(async (_identity, _env, options) =>
      chatCompletionResult(
        Number(options.resultBody.creditsCharged ?? 0),
        options.chargeable ? "committed" : "released"
      )
    );
    mockFailRequestExecution.mockResolvedValue({
      outcome: "failed",
      didMutate: true,
      reservationStatus: "released"
    });
    mockBackfillRevenueDriverSourceAssets.mockImplementation(async (record) => record as never);
    mockLoadFilingByKey.mockResolvedValue({
      filingKey: "filing-1",
      ticker: "ORCL",
      cik: "0001341439",
      extractorVersion: DEFAULT_REMOTE_CONFIG.extractorVersion,
      promptVersion: DEFAULT_REMOTE_CONFIG.promptVersion
    } as never);
    mockIsCurrentCacheRecord.mockReturnValue(true);
    mockReadQuotaIdentity.mockResolvedValue(identity as never);
    mockLoadUsage.mockResolvedValue(creditUsage as never);
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
          question: "利益率は改善した？",
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: billingUiDisabledConfig,
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
    expect(mockBeginRequestExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildChatResponse.mock.invocationCallOrder[0]!
    );
    expect(mockBuildChatResponse.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompleteRequestExecution.mock.invocationCallOrder[0]!
    );
    expect(mockCompleteRequestExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockLoadUsage.mock.invocationCallOrder[0]!
    );
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      billingUiDisabledConfig,
      expect.objectContaining({
        reservation: {
          mode: "credits",
          creditsRequired: 2,
          reference: { type: "chat", id: "filing-1" }
        }
      })
    );
    const cachedResult = mockCompleteRequestExecution.mock.calls[0]?.[2].resultBody;
    expect(cachedResult).toEqual({
      kind: "chat",
      answer: "Deterministic answer",
      sources: [],
      responsePath: "deterministic",
      modelName: null,
      creditsCharged: 2
    });
    expect(cachedResult).not.toHaveProperty("usage");
    expect(cachedResult).not.toHaveProperty("creditsRemaining");
    expect(cachedResult).not.toHaveProperty("debug");
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
          question: "何の会社？",
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env: { KABUYOMI_ENV: "test", RELEASE_CANDIDATE_ID: "a".repeat(64) } as never,
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      debug: {
        releaseCandidateId: "a".repeat(64),
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
          ],
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env: { KABUYOMI_ENV: "test" } as never,
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockBuildChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({ filingKey: "filing-1" }),
      "営業CFが変化した理由は？",
      expect.anything(),
      expect.anything(),
      {
        executionContext: ctx,
        conversationContextSummary: "ユーザー: 営業CF\nアシスタント: 営業キャッシュフローはマイナスで、前年比で減少しました。",
        followupContext: {
          previousQuestion: "営業CF",
          previousAnswer: "営業キャッシュフローはマイナスで、前年比で減少しました。"
        }
      }
    );
  });

  it("anchors casual unclear follow-ups to a plain-language explanation request", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "売上高 explanation",
      sources: [],
      responsePath: "openai"
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
          question: "よくわからん",
          conversationContext: [
            { role: "user", content: "今回どう？" },
            { role: "assistant", content: "売上高は前年同期比で大きく増加しました。" }
          ],
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env: { KABUYOMI_ENV: "test", LLM_PROVIDER: "openai", OPENAI_CHAT_MODEL: "gpt-5-nano" } as never,
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockBuildChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({ filingKey: "filing-1" }),
      "売上高について、前の回答を投資初心者にも分かるように、何が起きたか・なぜ重要か・次に何を見るかに分けて説明してください。",
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        conversationContextSummary: "ユーザー: 今回どう？\nアシスタント: 売上高は前年同期比で大きく増加しました。",
        followupContext: {
          previousQuestion: "今回どう？",
          previousAnswer: "売上高は前年同期比で大きく増加しました。"
        }
      })
    );
  });

  it("runs revenue-driver source backfill before chat outside test env", async () => {
    mockNeedsRevenueDriverSourceBackfill.mockReturnValue(true);
    mockBackfillRevenueDriverSourceAssets.mockResolvedValue({
      filingKey: "filing-1",
      ticker: "TSLA",
      contentMode: "full",
      mdaText: "backfilled md&a",
      sourceChunks: []
    } as never);
    mockBuildChatResponse.mockResolvedValue({
      answer: "Backfilled answer",
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
          question: "売上成長、または減収の主な要因は？",
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockBackfillRevenueDriverSourceAssets).toHaveBeenCalled();
    expect(mockBuildChatResponse).toHaveBeenCalledWith(
      expect.objectContaining({ mdaText: "backfilled md&a" }),
      expect.any(String),
      expect.anything(),
      expect.anything(),
      expect.anything()
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
          ],
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env: { KABUYOMI_ENV: "test" } as never,
      config: billingUiDisabledConfig,
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

  it("upgrades metrics-only filings after reservation and before generation", async () => {
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
          question: "この企業はなんの企業？",
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockUpgradeMetricsOnlyRecord).toHaveBeenCalledWith(metricsOnlyFiling, env);
    expect(mockBeginRequestExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpgradeMetricsOnlyRecord.mock.invocationCallOrder[0]!
    );
    expect(mockUpgradeMetricsOnlyRecord.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildChatResponse.mock.invocationCallOrder[0]!
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
          question: "ガイダンスの見方は？",
          operationId: "chat-op-test"
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
          question: "利益率は改善した？",
          operationId: "chat-op-test"
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
    expect(mockFailRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ failureCode: "filing_cache_not_found", route: "chat" })
    );
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
    expect(mockBuildChatResponse).not.toHaveBeenCalled();
  });

  it("releases the credit reservation when generation fails while billing UI is disabled", async () => {
    const rawQuestion = "RAW_PRIVATE_CHAT_QUESTION";
    const operationId = "chat-operation-private-1234567890";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mockBuildChatResponse.mockRejectedValue(new Error(`Gemini unavailable for ${rawQuestion}`));

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
            question: rawQuestion,
            operationId
          })
        }),
        url: new URL("https://kabuyomi.test/v1/chat"),
        env,
        config: billingUiDisabledConfig,
        ctx
      })
    ).rejects.toThrow("Gemini unavailable");

    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      billingUiDisabledConfig,
      expect.objectContaining({
        reservation: {
          mode: "credits",
          creditsRequired: 2,
          reference: { type: "chat", id: "filing-1" }
        }
      })
    );
    expect(mockFailRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ operationId, route: "chat" })
    );
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
    expect(mockLoadUsage).not.toHaveBeenCalled();
    const serializedLogs = errorLog.mock.calls.map(([line]) => String(line)).join("\n");
    expect(serializedLogs).not.toContain(rawQuestion);
    expect(serializedLogs).not.toContain(operationId);
    errorLog.mockRestore();
  });

  it("releases a credit reservation for non-chargeable historical preparation responses", async () => {
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
          question: "3年でどう推移した？",
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockCompleteRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ chargeable: false, route: "chat" })
    );
    await expect(response?.json()).resolves.toMatchObject({
      responsePath: "fallback",
      usage: {
        chatsUsed: 1
      }
    });
  });

  it("uses credit billing when enabled and returns credit charge metadata", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "Credit answer",
      sources: [],
      responsePath: "gemini"
    });

    mockLoadUsage.mockResolvedValue({
      ...creditUsage,
      credits: { ...creditUsage.credits, monthlyRemaining: 28, totalRemaining: 28 }
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
    expect(mockBeginRequestExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildChatResponse.mock.invocationCallOrder[0]!
    );
    expect(mockBuildChatResponse.mock.invocationCallOrder[0]).toBeLessThan(
      mockCompleteRequestExecution.mock.invocationCallOrder[0]!
    );
    expect(mockCompleteRequestExecution.mock.invocationCallOrder[0]).toBeLessThan(
      mockLoadUsage.mock.invocationCallOrder[0]!
    );
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.anything(),
      expect.objectContaining({
        operationId: "chat-op-1",
        reservation: {
          mode: "credits",
          creditsRequired: 2,
          reference: { type: "chat", id: "filing-1" }
        }
      })
    );
    expect(mockCompleteRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ operationId: "chat-op-1", chargeable: true })
    );
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

  it("does not charge credits for non-chargeable historical preparation responses", async () => {
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
    expect(mockLoadUsage).toHaveBeenCalledWith(identity, env, expect.anything());
    expect(mockCompleteRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ chargeable: false })
    );
    expect(mockCompleteRequestExecution.mock.results[0]?.value).toBeDefined();
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

  it("uses an unmetered reservation for detached dev access", async () => {
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
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      expect.objectContaining({ accessMode: "dev_unlimited" }),
      env,
      billingUiDisabledConfig,
      expect.objectContaining({ reservation: { mode: "unmetered" } })
    );
    await expect(response?.json()).resolves.toMatchObject({
      usage: {
        creditBillingEnabled: true
      },
      creditsCharged: 0,
      creditsRemaining: 30
    });
  });

  it("releases the credit reservation when generation fails", async () => {
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

    expect(mockFailRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ operationId: "chat-op-1", route: "chat" })
    );
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
    expect(mockLoadUsage).not.toHaveBeenCalled();
  });

  it("releases the credit reservation on a simulated cpu-risk failure", async () => {
    mockBuildChatResponse.mockRejectedValue(new Error("simulated_cpu_risk_before_charge"));

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
            question: "重い質問",
            operationId: "chat-op-cpu-risk"
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
    ).rejects.toThrow("simulated_cpu_risk_before_charge");

    expect(mockFailRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ operationId: "chat-op-cpu-risk", route: "chat" })
    );
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
    expect(mockLoadUsage).not.toHaveBeenCalled();
  });

  it("replays an exact operation with one provider call, one commit, and fresh usage", async () => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "Credit answer",
      sources: [],
      responsePath: "gemini"
    });
    let cachedResult: Parameters<typeof completeRequestExecution>[2]["resultBody"] | undefined;
    mockBeginRequestExecution.mockImplementation(async () =>
      cachedResult
        ? { outcome: "replay", result: cachedResult, resultMetadata: {} }
        : chatLeaderResult()
    );
    mockCompleteRequestExecution.mockImplementation(async (_identity, _env, options) => {
      cachedResult = options.resultBody;
      return chatCompletionResult();
    });
    const replayUsage = {
      ...creditUsage,
      credits: {
        ...creditUsage.credits,
        monthlyRemaining: 27,
        totalRemaining: 27
      }
    };
    mockLoadUsage.mockReset();
    mockLoadUsage.mockResolvedValueOnce(creditUsage as never).mockResolvedValue(replayUsage as never);

    const makeRequest = () =>
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
            operationId: "chat-op-duplicate"
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

    const first = await makeRequest();
    const second = await makeRequest();

    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    expect(mockBuildChatResponse).toHaveBeenCalledTimes(1);
    expect(mockCompleteRequestExecution).toHaveBeenCalledTimes(1);
    expect(mockCompleteRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ operationId: "chat-op-duplicate", chargeable: true })
    );
    await expect(second?.json()).resolves.toMatchObject({
      answer: "Credit answer",
      creditsCharged: 2,
      creditsRemaining: 27,
      usage: {
        credits: {
          totalRemaining: 27
        }
      }
    });
  });

  it.each([
    ["question", { filingKey: "filing-1", question: "別の質問", operationId: "chat-op-mismatch" }],
    ["filing", { filingKey: "filing-2", question: "最初の質問", operationId: "chat-op-mismatch" }],
    [
      "context",
      {
        filingKey: "filing-1",
        question: "最初の質問",
        conversationContext: [{ role: "user" as const, content: "別の文脈" }],
        operationId: "chat-op-mismatch"
      }
    ]
  ])("rejects operation ID reuse with changed %s before provider work", async (_field, changedPayload) => {
    mockBuildChatResponse.mockResolvedValue({
      answer: "Original answer",
      sources: [],
      responsePath: "gemini"
    });
    let originalHash: string | undefined;
    mockBeginRequestExecution.mockImplementation(async (_identity, _env, _config, options) => {
      if (!originalHash) {
        originalHash = options.requestHash;
        return chatLeaderResult();
      }
      return options.requestHash === originalHash
        ? { outcome: "pending", retryAfterSeconds: 1 }
        : { outcome: "payload_mismatch" };
    });
    const send = (body: Record<string, unknown>) =>
      handleChatRoute({
        request: new Request("https://kabuyomi.test/v1/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify(body)
        }),
        url: new URL("https://kabuyomi.test/v1/chat"),
        env,
        config: DEFAULT_REMOTE_CONFIG,
        ctx
      });

    const first = await send({
      filingKey: "filing-1",
      question: "最初の質問",
      operationId: "chat-op-mismatch"
    });
    const changed = await send(changedPayload);

    expect(first?.status).toBe(200);
    expect(changed?.status).toBe(409);
    await expect(changed?.json()).resolves.toEqual({ error: "operation_id_payload_mismatch" });
    expect(mockBuildChatResponse).toHaveBeenCalledTimes(1);
    expect(mockCompleteRequestExecution).toHaveBeenCalledTimes(1);
  });

  it("returns pending with Retry-After and never enters provider or charging", async () => {
    mockBeginRequestExecution.mockResolvedValue({ outcome: "pending", retryAfterSeconds: 2 });

    const response = await handleChatRoute({
      request: new Request("https://kabuyomi.test/v1/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-device-key": "device-123"
        },
        body: JSON.stringify({
          filingKey: "filing-1",
          question: "同じ質問",
          operationId: "chat-op-pending"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: DEFAULT_REMOTE_CONFIG,
      ctx
    });

    expect(response?.status).toBe(202);
    expect(response?.headers.get("retry-after")).toBe("2");
    await expect(response?.json()).resolves.toEqual({ error: "execution_pending" });
    expect(mockLoadFilingByKey).not.toHaveBeenCalled();
    expect(mockBuildChatResponse).not.toHaveBeenCalled();
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
  });

  it("replays a completed result even after chat is disabled", async () => {
    mockBeginRequestExecution.mockResolvedValue({
      outcome: "replay",
      result: {
        kind: "chat",
        answer: "Cached answer",
        sources: [],
        responsePath: "openai",
        modelName: "gpt-5-nano",
        creditsCharged: 2
      },
      resultMetadata: {}
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
          question: "同じ質問",
          operationId: "chat-op-disabled-replay"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: { ...DEFAULT_REMOTE_CONFIG, chatEnabled: false },
      ctx
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      answer: "Cached answer",
      creditsCharged: 2,
      usage: { creditBillingEnabled: true }
    });
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ chatEnabled: false }),
      expect.objectContaining({ allowCreate: false })
    );
    expect(mockLoadFilingByKey).not.toHaveBeenCalled();
    expect(mockBuildChatResponse).not.toHaveBeenCalled();
  });

  it("allows only one provider call for twenty concurrent exact duplicates", async () => {
    let claimed = false;
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    mockBeginRequestExecution.mockImplementation(async () => {
      if (!claimed) {
        claimed = true;
        return chatLeaderResult();
      }
      return { outcome: "pending", retryAfterSeconds: 1 };
    });
    mockBuildChatResponse.mockImplementation(async () => {
      await providerGate;
      return {
        answer: "Concurrent answer",
        sources: [],
        responsePath: "gemini"
      };
    });
    const send = () =>
      handleChatRoute({
        request: new Request("https://kabuyomi.test/v1/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": "device-123"
          },
          body: JSON.stringify({
            filingKey: "filing-1",
            question: "同じ質問",
            operationId: "chat-op-concurrent"
          })
        }),
        url: new URL("https://kabuyomi.test/v1/chat"),
        env,
        config: DEFAULT_REMOTE_CONFIG,
        ctx
      });

    const pendingResponses = Array.from({ length: 20 }, () => send());
    await vi.waitFor(() => expect(mockBeginRequestExecution).toHaveBeenCalledTimes(20));
    expect(mockBuildChatResponse).toHaveBeenCalledTimes(1);
    releaseProvider();
    const responses = await Promise.all(pendingResponses);

    expect(responses.filter((response) => response?.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response?.status === 202)).toHaveLength(19);
    expect(mockBuildChatResponse).toHaveBeenCalledTimes(1);
    expect(mockCompleteRequestExecution).toHaveBeenCalledTimes(1);
  });

  it("returns 402 before filing or provider work when billing UI is disabled and credits are zero", async () => {
    mockBeginRequestExecution.mockResolvedValue({
      outcome: "failed",
      failureCode: "insufficient_credits",
      failureStatus: 402,
      failureDetails: { creditsRequired: 2, creditsRemaining: 0 }
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
          operationId: "chat-op-empty"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env,
      config: {
        ...DEFAULT_REMOTE_CONFIG,
        creditBillingEnabled: false
      },
      ctx
    });

    expect(response?.status).toBe(402);
    expect(mockBeginRequestExecution).toHaveBeenCalledWith(
      identity,
      env,
      expect.objectContaining({ creditBillingEnabled: false }),
      expect.objectContaining({
        reservation: {
          mode: "credits",
          creditsRequired: 2,
          reference: { type: "chat", id: "filing-1" }
        }
      })
    );
    expect(mockBuildChatResponse).not.toHaveBeenCalled();
    expect(mockCompleteRequestExecution).not.toHaveBeenCalled();
    expect(mockLoadFilingByKey).not.toHaveBeenCalled();
    await expect(response?.json()).resolves.toEqual({
      error: "insufficient_credits",
      creditsRequired: 2,
      creditsRemaining: 0
    });
  });

  it("never calls the provider for unique operations beyond reserved credit capacity", async () => {
    let reservationsGranted = 0;
    mockBeginRequestExecution.mockImplementation(async (_identity, _env, _config, _options) => {
      if (reservationsGranted < 2) {
        reservationsGranted += 1;
        return chatLeaderResult("credits");
      }
      return {
        outcome: "failed",
        failureCode: "insufficient_credits",
        failureStatus: 402,
        failureDetails: { creditsRequired: 2, creditsRemaining: 0 }
      };
    });
    mockBuildChatResponse.mockResolvedValue({
      answer: "Reserved answer",
      sources: [],
      responsePath: "gemini"
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        handleChatRoute({
          request: new Request("https://kabuyomi.test/v1/chat", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-device-key": "device-123"
            },
            body: JSON.stringify({
              filingKey: "filing-1",
              question: `unique question ${index}`,
              operationId: `chat-op-capacity-${index}`
            })
          }),
          url: new URL("https://kabuyomi.test/v1/chat"),
          env,
          config: { ...DEFAULT_REMOTE_CONFIG, creditBillingEnabled: true },
          ctx
        })
      )
    );

    expect(responses.filter((response) => response?.status === 200)).toHaveLength(2);
    expect(responses.filter((response) => response?.status === 402)).toHaveLength(8);
    expect(mockBuildChatResponse).toHaveBeenCalledTimes(2);
    expect(mockCompleteRequestExecution).toHaveBeenCalledTimes(2);
    expect(mockLoadFilingByKey).toHaveBeenCalledTimes(2);
  });

  it("emits compact production chat diagnostics without source excerpts or raw question text", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const rawQuestion = "RAW_SECRET_QUESTION";
    const sourceText = "SOURCE_SECRET_TEXT";
    mockBuildChatResponse.mockResolvedValue({
      answer: "Compact answer",
      sources: [
        {
          sourceId: "S1",
          sourceKind: "sec_filing",
          sourceStrength: "filing_primary",
          sectionType: "md_a",
          sourceLabel: "10-Q",
          excerpt: sourceText
        }
      ],
      responsePath: "gemini",
      debug: {
        selectedSourceExcerpts: [sourceText],
        selectedSourceTextPreview: [sourceText],
        sourceGateEvidenceSlots: { slot: sourceText },
        hardRetrievalQueries: ["query with raw details"],
        hardRetrievalMode: "diagnostic",
        selectedSourceCount: 1,
        selectedSourceCharCount: 18
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
          question: rawQuestion,
          operationId: "chat-op-compact"
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
    const qualityLog = logSpy.mock.calls
      .map(([line]) => (typeof line === "string" ? JSON.parse(line) as Record<string, unknown> : null))
      .find((entry): entry is Record<string, unknown> => entry?.event === "chat_quality_pipeline");
    const serialized = JSON.stringify(qualityLog);

    expect(qualityLog).toMatchObject({
      diagnosticsLevel: "compact",
      selectedSourceCount: 1,
      selectedSourceCharCount: 18,
      hardRetrievalMode: "diagnostic",
      hardRetrievalQueryCount: 1
    });
    expect(qualityLog).not.toHaveProperty("originalQuestion");
    expect(qualityLog).not.toHaveProperty("rewrittenQuestion");
    expect(qualityLog).not.toHaveProperty("selectedSourceExcerpts");
    expect(qualityLog).not.toHaveProperty("selectedSourceTextPreview");
    expect(qualityLog).not.toHaveProperty("sourceGateEvidenceSlots");
    expect(serialized).not.toContain(rawQuestion);
    expect(serialized).not.toContain(sourceText);
  });

  it("keeps verbose chat diagnostics in test environment only", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockBuildChatResponse.mockResolvedValue({
      answer: "Verbose answer",
      sources: [],
      responsePath: "fallback",
      debug: {
        selectedSourceExcerpts: ["verbose excerpt"],
        selectedSourceTextPreview: ["verbose preview"]
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
          question: "verbose question",
          operationId: "chat-op-test"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env: { KABUYOMI_ENV: "test" } as never,
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    const qualityLog = logSpy.mock.calls
      .map(([line]) => (typeof line === "string" ? JSON.parse(line) as Record<string, unknown> : null))
      .find((entry): entry is Record<string, unknown> => entry?.event === "chat_quality_pipeline");

    expect(qualityLog).toMatchObject({
      diagnosticsLevel: "verbose",
      originalQuestion: "verbose question",
      selectedSourceExcerpts: ["verbose excerpt"],
      selectedSourceTextPreview: ["verbose preview"]
    });
  });

  it("ignores a verbose diagnostics override in production", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const rawQuestion = "PRODUCTION_PRIVATE_QUESTION";
    const sourceText = "PRODUCTION_PRIVATE_SOURCE_TEXT";
    mockBuildChatResponse.mockResolvedValue({
      answer: "Compact production answer",
      sources: [],
      responsePath: "fallback",
      debug: {
        selectedSourceExcerpts: [sourceText],
        selectedSourceTextPreview: [sourceText]
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
          question: rawQuestion,
          operationId: "chat-op-production-verbose-override"
        })
      }),
      url: new URL("https://kabuyomi.test/v1/chat"),
      env: {
        KABUYOMI_ENV: "production",
        ENVIRONMENT: "production",
        CHAT_DIAGNOSTICS_LEVEL: "verbose"
      } as never,
      config: billingUiDisabledConfig,
      ctx
    });

    expect(response?.status).toBe(200);
    const qualityLog = logSpy.mock.calls
      .map(([line]) => (typeof line === "string" ? JSON.parse(line) as Record<string, unknown> : null))
      .find((entry): entry is Record<string, unknown> => entry?.event === "chat_quality_pipeline");
    const serialized = JSON.stringify(qualityLog);

    expect(qualityLog).toMatchObject({ diagnosticsLevel: "compact" });
    expect(serialized).not.toContain(rawQuestion);
    expect(serialized).not.toContain(sourceText);
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
          question: "どう？",
          operationId: "chat-op-test"
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
