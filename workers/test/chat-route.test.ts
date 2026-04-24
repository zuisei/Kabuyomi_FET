import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

vi.mock("../src/clients/sec", () => ({
  listTickersByCik: vi.fn()
}));

vi.mock("../src/lib/pipeline", () => ({
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
  ensureCompanyAccessAllowed: vi.fn(),
  refundChatQuota: vi.fn()
}));

vi.mock("../src/clients/gemini/request", () => ({
  resolveGeminiModel: vi.fn(() => "gemini-2.5-flash")
}));

import { handleChatRoute } from "../src/routes/chat";
import { listTickersByCik } from "../src/clients/sec";
import { loadFilingByKey, isCurrentCacheRecord } from "../src/lib/filings/cache";
import { upgradeMetricsOnlyRecord } from "../src/lib/filings/content-upgrade";
import { buildChatResponse } from "../src/lib/pipeline";
import {
  consumeChatQuota,
  ensureCompanyAccessAllowed,
  readQuotaIdentity,
  refundChatQuota
} from "../src/lib/quota";

const mockBuildChatResponse = vi.mocked(buildChatResponse);
const mockListTickersByCik = vi.mocked(listTickersByCik);
const mockLoadFilingByKey = vi.mocked(loadFilingByKey);
const mockIsCurrentCacheRecord = vi.mocked(isCurrentCacheRecord);
const mockUpgradeMetricsOnlyRecord = vi.mocked(upgradeMetricsOnlyRecord);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);
const mockConsumeChatQuota = vi.mocked(consumeChatQuota);
const mockEnsureCompanyAccessAllowed = vi.mocked(ensureCompanyAccessAllowed);
const mockRefundChatQuota = vi.mocked(refundChatQuota);

describe("handleChatRoute", () => {
  const env = {} as never;
  const ctx = {} as never;
  const identity = {
    quotaSubject: "free:local:device-123",
    plan: "free",
    identityKind: "local_device"
  } as const;
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
    mockListTickersByCik.mockResolvedValue(["ORCL"] as never);
    mockIsCurrentCacheRecord.mockReturnValue(true);
    mockReadQuotaIdentity.mockResolvedValue(identity as never);
    mockConsumeChatQuota.mockResolvedValue(usage as never);
    mockRefundChatQuota.mockResolvedValue(usage as never);
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
      config: DEFAULT_REMOTE_CONFIG,
      ctx
    });

    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      responsePath: "deterministic",
      modelName: null
    });
    expect(mockEnsureCompanyAccessAllowed).toHaveBeenCalledWith(
      identity,
      "ORCL",
      expect.any(Array),
      expect.anything(),
      expect.anything(),
      { relatedTickers: ["ORCL"] }
    );
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
      config: DEFAULT_REMOTE_CONFIG,
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
    expect(mockEnsureCompanyAccessAllowed).not.toHaveBeenCalled();
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
        config: DEFAULT_REMOTE_CONFIG,
        ctx
      })
    ).rejects.toThrow("Gemini unavailable");

    expect(mockConsumeChatQuota).toHaveBeenCalledWith(identity, expect.anything(), expect.anything());
    expect(mockRefundChatQuota).toHaveBeenCalledWith(identity, expect.anything(), expect.anything());
  });

  it("allows filing chat access through a related issuer ticker group", async () => {
    mockLoadFilingByKey.mockResolvedValue({
      filingKey: "filing-1",
      ticker: "BRK-A",
      cik: "0001067983",
      extractorVersion: DEFAULT_REMOTE_CONFIG.extractorVersion,
      promptVersion: DEFAULT_REMOTE_CONFIG.promptVersion
    } as never);
    mockListTickersByCik.mockResolvedValue(["BRK-A", "BRK-B"] as never);
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
    expect(mockEnsureCompanyAccessAllowed).toHaveBeenCalledWith(
      identity,
      "BRK-A",
      expect.any(Array),
      expect.anything(),
      expect.anything(),
      { relatedTickers: ["BRK-A", "BRK-B"] }
    );
  });
});
