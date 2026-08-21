import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock のファクトリはファイル先頭に巻き上げられるため、
// スパイは vi.hoisted で先に生成しておく必要がある。
const { invokeOpenAISummary, generateGeminiSummary } = vi.hoisted(() => ({
  invokeOpenAISummary: vi.fn(),
  generateGeminiSummary: vi.fn()
}));

vi.mock("../src/clients/llm/providers/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/clients/llm/providers/openai")>();
  return { ...actual, invokeOpenAISummary };
});

vi.mock("../src/clients/gemini", () => ({
  generateSummary: generateGeminiSummary,
  generateQuoteTranslation: vi.fn()
}));

import type { Env } from "../src/env";
import { buildOpenAISummaryRequest } from "../src/clients/llm/providers/openai";
import { generateModelSummary, isModelSummaryAvailable } from "../src/clients/llm/provider";
import type { SummaryPromptInput } from "../src/clients/gemini/types";

function makeInput(): SummaryPromptInput {
  return {
    filingKey: "v9:0000320193:000032019326000020",
    ticker: "AAPL",
    companyName: "Apple Inc.",
    formType: "10-Q",
    filedAt: "2026-07-31",
    periodOfReport: "2026-06-27",
    metrics: [],
    sourceChunks: []
  };
}

function openAIEnv(overrides: Partial<Env> = {}): Env {
  return { LLM_PROVIDER: "openai", OPENAI_API_KEY: "openai-test-key", ...overrides } as Env;
}

function validSummaryPayload() {
  return {
    verdict: "売上高は前年同期比で増加しました。",
    highlights: [{ text: "売上高が伸びました。", sourceIds: ["s1"] }],
    changes: [{ text: "営業利益率が改善しました。", sourceIds: ["s2"] }]
  };
}

function invocation(data: unknown, failureReason?: "schema_invalid" | "json_parse_failed") {
  return { data, usage: [], ...(failureReason ? { failureReason } : {}) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateModelSummary", () => {
  it("uses OpenAI and reports the openai provider when the response is valid", async () => {
    invokeOpenAISummary.mockResolvedValueOnce(invocation(validSummaryPayload()));

    const result = await generateModelSummary(openAIEnv(), makeInput());

    expect(invokeOpenAISummary).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("openai");
    expect(result.summary.verdict).toContain("売上高");
    expect(result.summary.highlights).toHaveLength(1);
    expect(generateGeminiSummary).not.toHaveBeenCalled();
  });

  it("never calls a provider when the caller asks for the fallback template", async () => {
    const result = await generateModelSummary(openAIEnv(), makeInput(), { forceFallback: true });

    expect(invokeOpenAISummary).not.toHaveBeenCalled();
    expect(generateGeminiSummary).not.toHaveBeenCalled();
    expect(result.provider).toBe("fallback");
  });

  it("retries once when the first response fails schema validation", async () => {
    invokeOpenAISummary
      .mockResolvedValueOnce(invocation({ nonsense: true }, "schema_invalid"))
      .mockResolvedValueOnce(invocation(validSummaryPayload()));

    const result = await generateModelSummary(openAIEnv(), makeInput());

    expect(invokeOpenAISummary).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("openai");
  });

  it("falls back to the template when every attempt fails schema validation", async () => {
    invokeOpenAISummary.mockResolvedValue(invocation({ nonsense: true }, "schema_invalid"));

    const result = await generateModelSummary(openAIEnv(), makeInput());

    expect(invokeOpenAISummary).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("fallback");
  });

  it("retries a retryable transport failure but never throws", async () => {
    invokeOpenAISummary
      .mockRejectedValueOnce(Object.assign(new Error("timed out"), { name: "AbortError" }))
      .mockResolvedValueOnce(invocation(validSummaryPayload()));

    const result = await generateModelSummary(openAIEnv(), makeInput());

    expect(invokeOpenAISummary).toHaveBeenCalledTimes(2);
    expect(result.provider).toBe("openai");
  });

  it("stops after one attempt when the failure is not retryable", async () => {
    invokeOpenAISummary.mockRejectedValue(new Error("invalid api key"));

    const result = await generateModelSummary(openAIEnv(), makeInput());

    expect(invokeOpenAISummary).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("fallback");
  });

  it("falls back without calling OpenAI when the key is missing", async () => {
    const result = await generateModelSummary({ LLM_PROVIDER: "openai" } as Env, makeInput());

    expect(invokeOpenAISummary).not.toHaveBeenCalled();
    expect(result.provider).toBe("fallback");
  });

  it("delegates to the legacy Gemini implementation when that provider is selected", async () => {
    generateGeminiSummary.mockResolvedValueOnce({
      summary: validSummaryPayload(),
      provider: "gemini"
    });

    const result = await generateModelSummary(
      { LLM_PROVIDER: "gemini-legacy", GEMINI_API_KEY: "k" } as Env,
      makeInput()
    );

    expect(generateGeminiSummary).toHaveBeenCalledTimes(1);
    expect(invokeOpenAISummary).not.toHaveBeenCalled();
    expect(result.provider).toBe("gemini");
  });

  it("returns the fallback template when the provider is disabled", async () => {
    const result = await generateModelSummary({ LLM_PROVIDER: "disabled" } as Env, makeInput());

    expect(invokeOpenAISummary).not.toHaveBeenCalled();
    expect(generateGeminiSummary).not.toHaveBeenCalled();
    expect(result.provider).toBe("fallback");
  });
});

describe("isModelSummaryAvailable", () => {
  it("follows the selected provider's own key", () => {
    expect(isModelSummaryAvailable(openAIEnv())).toBe(true);
    expect(isModelSummaryAvailable({ LLM_PROVIDER: "openai", GEMINI_API_KEY: "stale" } as Env)).toBe(false);
    expect(isModelSummaryAvailable({ LLM_PROVIDER: "gemini-legacy", GEMINI_API_KEY: "k" } as Env)).toBe(true);
    expect(isModelSummaryAvailable({ LLM_PROVIDER: "disabled", OPENAI_API_KEY: "k" } as Env)).toBe(false);
  });
});

describe("buildOpenAISummaryRequest", () => {
  // OpenAI の strict モードは入れ子のオブジェクトすべてに
  // additionalProperties: false と全プロパティを含む required を要求する。
  it("emits a strict-mode-compatible json schema at every nesting level", () => {
    const request = buildOpenAISummaryRequest("gpt-5-nano", "prompt") as {
      response_format: { json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
    };
    const schema = request.response_format.json_schema;

    expect(schema.name).toBe("kabuyomi_filing_summary");
    expect(schema.strict).toBe(true);

    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node === null || typeof node !== "object") {
        return;
      }
      const record = node as Record<string, unknown>;
      if (record.type === "object") {
        objects.push(record);
      }
      Object.values(record).forEach(walk);
    };
    walk(schema.schema);

    expect(objects.length).toBeGreaterThanOrEqual(3);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect(object.required).toEqual(Object.keys(object.properties as Record<string, unknown>));
    }
  });
});
