import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_REMOTE_CONFIG } from "../src/lib/remote-config";

vi.mock("../src/lib/pipeline", () => ({
  buildChatResponse: vi.fn(),
  loadFilingByKey: vi.fn()
}));

vi.mock("../src/lib/quota", () => ({
  readQuotaIdentity: vi.fn(),
  ensureChatQuotaAvailable: vi.fn(),
  consumeChatQuota: vi.fn()
}));

vi.mock("../src/clients/gemini/request", () => ({
  resolveGeminiModel: vi.fn(() => "gemini-2.5-flash")
}));

import { handleChatRoute } from "../src/routes/chat";
import { buildChatResponse, loadFilingByKey } from "../src/lib/pipeline";
import { consumeChatQuota, ensureChatQuotaAvailable, readQuotaIdentity } from "../src/lib/quota";

const mockBuildChatResponse = vi.mocked(buildChatResponse);
const mockLoadFilingByKey = vi.mocked(loadFilingByKey);
const mockReadQuotaIdentity = vi.mocked(readQuotaIdentity);
const mockEnsureChatQuotaAvailable = vi.mocked(ensureChatQuotaAvailable);
const mockConsumeChatQuota = vi.mocked(consumeChatQuota);

describe("handleChatRoute", () => {
  const env = {} as never;
  const ctx = {} as never;
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
    mockLoadFilingByKey.mockResolvedValue({ filingKey: "filing-1" } as never);
    mockReadQuotaIdentity.mockResolvedValue({
      quotaSubject: "free:local:device-123",
      plan: "free",
      identityKind: "local_device"
    });
    mockEnsureChatQuotaAvailable.mockResolvedValue(usage as never);
    mockConsumeChatQuota.mockResolvedValue(usage as never);
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
});
