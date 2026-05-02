import { afterEach, describe, expect, it, vi } from "vitest";
import { generateModelChatAnswer, resolveLlmProvider } from "../src/clients/llm/provider";
import {
  buildOpenAIChatRequest,
  buildOpenAIResponsesPromptRequest,
  classifyOpenAIError,
  classifyOpenAIHttpError,
  DEFAULT_OPENAI_CHAT_MODEL,
  OpenAIApiRequestError,
  parseOpenAIChatCompletionPayload,
  parseOpenAIResponsesPayload,
  resolveOpenAIPromptId,
  resolveOpenAIChatModel
} from "../src/clients/llm/providers/openai";
import type { FilingCacheRecord } from "../src/env";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenAI provider config", () => {
  it("keeps Gemini as the default provider", () => {
    expect(resolveLlmProvider({} as never)).toBe("gemini-legacy");
    expect(resolveLlmProvider({ LLM_PROVIDER: "gemini" } as never)).toBe("gemini-legacy");
    expect(resolveLlmProvider({ LLM_PROVIDER: "gemini-legacy" } as never)).toBe("gemini-legacy");
  });

  it("selects OpenAI and resolves gpt-5-nano by default", () => {
    expect(resolveLlmProvider({ LLM_PROVIDER: "openai" } as never)).toBe("openai");
    expect(resolveOpenAIChatModel({} as never)).toBe(DEFAULT_OPENAI_CHAT_MODEL);
    expect(resolveOpenAIChatModel({ OPENAI_CHAT_MODEL: "gpt-5-nano" } as never)).toBe("gpt-5-nano");
  });

  it("builds a Chat Completions JSON-schema request for gpt-5-nano", () => {
    const request = buildOpenAIChatRequest("gpt-5-nano", "Return JSON.");

    expect(request).toMatchObject({
      model: "gpt-5-nano",
      reasoning_effort: "minimal",
      max_completion_tokens: 1800,
      response_format: {
        type: "json_schema",
        json_schema: {
          strict: true
        }
      }
    });
    expect(JSON.stringify(request)).toContain("kabuyomi_chat_answer");
    expect(JSON.stringify(request)).toContain("additionalProperties");
    expect(JSON.stringify(request)).toContain("sourceIds");
  });

  it("builds a Responses API request for a dashboard prompt", () => {
    const request = buildOpenAIResponsesPromptRequest({
      OPENAI_PROMPT_ID: "pmpt_test",
      OPENAI_PROMPT_VERSION: "1",
      OPENAI_REASONING_EFFORT: "minimal",
      OPENAI_MAX_COMPLETION_TOKENS: "500"
    } as never, {
      question: "なにで稼いでんのこの会社",
      sources_json: "[]"
    });

    expect(resolveOpenAIPromptId({ OPENAI_PROMPT_ID: "pmpt_test" } as never)).toBe("pmpt_test");
    expect(request).toMatchObject({
      prompt: {
        id: "pmpt_test",
        version: "1",
        variables: {
          question: "なにで稼いでんのこの会社",
          sources_json: "[]"
        }
      },
      text: {
        format: {
          type: "json_schema",
          name: "kabuyomi_chat_answer",
          strict: true
        },
        verbosity: "low"
      },
      reasoning: {
        effort: "minimal"
      },
      max_output_tokens: 500
    });
    expect(JSON.stringify(request)).toContain("sourceIds");
  });
});

describe("OpenAI API error classification", () => {
  it("classifies common HTTP statuses", () => {
    expect(classifyOpenAIHttpError(429, "{\"error\":{\"type\":\"rate_limit_error\"}}").kind).toBe("rate_limit");
    expect(classifyOpenAIHttpError(401, "{\"error\":{\"type\":\"invalid_request_error\"}}").kind).toBe("auth_error");
    expect(classifyOpenAIHttpError(403, "{\"error\":{\"type\":\"invalid_request_error\"}}").kind).toBe("auth_error");
    expect(classifyOpenAIHttpError(400, "maximum context length exceeded").kind).toBe("context_too_large");
    expect(classifyOpenAIHttpError(400, "request body too large").kind).toBe("payload_too_large");
    expect(classifyOpenAIHttpError(400, "invalid json schema").kind).toBe("bad_request");
    expect(classifyOpenAIHttpError(503, "temporarily unavailable").kind).toBe("provider_server_error");
  });

  it("classifies request errors without leaking long messages", () => {
    const diagnostics = classifyOpenAIError(new OpenAIApiRequestError("rate limit", {
      modelApiErrorKind: "rate_limit",
      modelApiErrorStatus: 429,
      modelApiErrorCode: "rate_limit_error",
      modelApiErrorMessageSample: "quota",
      modelApiErrorRetryable: true,
      modelProvider: "openai",
      modelErrorOccurredBeforeResponse: false
    }));

    expect(diagnostics.modelApiErrorKind).toBe("rate_limit");
    expect(diagnostics.modelApiErrorStatus).toBe(429);
    expect(diagnostics.modelApiErrorRetryable).toBe(true);

    const unknown = classifyOpenAIError(new Error("x".repeat(500)));
    expect(unknown.modelApiErrorKind).toBe("unknown");
    expect(unknown.modelApiErrorMessageSample?.length).toBeLessThanOrEqual(180);
  });
});

describe("OpenAI response parser", () => {
  it("extracts answer text and sourceIds from a Chat Completions payload", () => {
    const parsed = parseOpenAIChatCompletionPayload({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              answer: "日本語の回答です。",
              sourceIds: ["S1"]
            })
          }
        }
      ]
    });

    expect(parsed.failureReason).toBeUndefined();
    expect(parsed.data).toEqual({
      answer: "日本語の回答です。",
      sourceIds: ["S1"]
    });
  });

  it("extracts answer text and sourceIds from a Responses API payload", () => {
    const parsed = parseOpenAIResponsesPayload({
      model: "gpt-5-nano",
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                answer: "日本語の回答です。",
                sourceIds: ["S1"]
              })
            }
          ]
        }
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120
      }
    });

    expect(parsed.failureReason).toBeUndefined();
    expect(parsed.data).toEqual({
      answer: "日本語の回答です。",
      sourceIds: ["S1"]
    });
  });
});

describe("OpenAI chat provider", () => {
  it("returns a normal answer string and usage when selected", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: "売上成長の主因は、製品需要の増加です。",
                  sourceIds: ["S1"]
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateModelChatAnswer(
      {
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_CHAT_MODEL: "gpt-5-nano"
      } as never,
      {
        filing: makeFiling(),
        question: "売上成長の要因は？",
        questionIntent: "mda_summary"
      }
    );

    expect(response.usedRemoteModel).toBe(true);
    expect(response.modelProvider).toBe("openai");
    expect(response.modelName).toBe("gpt-5-nano");
    expect(response.answer).toContain("製品需要");
    expect(response.sourceIds).toEqual(["S1"]);
    expect(response.llmUsage?.[0]).toMatchObject({
      model: "gpt-5-nano",
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      totalTokenCount: 120
    });
  });

  it("uses the Responses API dashboard prompt when OPENAI_PROMPT_ID is configured", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toBe("https://api.openai.com/v1/responses");
      const body = JSON.parse(String(init?.body));
      expect(body.prompt.id).toBe("pmpt_test");
      expect(body.prompt.version).toBe("1");
      expect(body.prompt.variables.question).toBe("売上成長の要因は？");
      expect(body.prompt.variables.question_intent).toBe("mda_summary");
      expect(body.prompt.variables.filing_metadata_json).toContain("Test Corp");
      expect(body.prompt.variables.sources_json).toContain("S1");
      expect(body.text.format.name).toBe("kabuyomi_chat_answer");
      return new Response(
        JSON.stringify({
          model: "gpt-5-nano",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    answer: "売上成長の主因は、製品需要の増加です。",
                    sourceIds: ["S1"]
                  })
                }
              ]
            }
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateModelChatAnswer(
      {
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_CHAT_MODEL: "gpt-5-nano",
        OPENAI_PROMPT_ID: "pmpt_test",
        OPENAI_PROMPT_VERSION: "1"
      } as never,
      {
        filing: makeFiling(),
        question: "売上成長の要因は？",
        questionIntent: "mda_summary"
      }
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response.usedRemoteModel).toBe(true);
    expect(response.modelProvider).toBe("openai");
    expect(response.modelName).toBe("gpt-5-nano");
    expect(response.answer).toContain("製品需要");
    expect(response.sourceIds).toEqual(["S1"]);
    expect(response.llmUsage?.[0]).toMatchObject({
      model: "gpt-5-nano",
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      totalTokenCount: 120
    });
  });

  it("normalizes OpenAI source_ids aliases from structured output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  answer: "売上成長の主因は、製品需要の増加です。",
                  source_ids: ["S1"]
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ));

    const response = await generateModelChatAnswer(
      {
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_CHAT_MODEL: "gpt-5-nano"
      } as never,
      {
        filing: makeFiling(),
        question: "売上成長の要因は？",
        questionIntent: "mda_summary"
      }
    );

    expect(response.usedRemoteModel).toBe(true);
    expect(response.sourceIds).toEqual(["S1"]);
  });

  it("treats empty OpenAI content as schema-invalid fallback with usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: {
                content: ""
              }
            }
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 1200,
            total_tokens: 1300
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ));

    const response = await generateModelChatAnswer(
      {
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_CHAT_MODEL: "gpt-5-nano"
      } as never,
      {
        filing: makeFiling(),
        question: "売上成長の要因は？",
        questionIntent: "mda_summary"
      }
    );

    expect(response.usedRemoteModel).not.toBe(true);
    expect(response.fallbackReason).toBe("schema_invalid");
    expect(response.schemaValid).toBe(false);
    expect(response.llmUsage?.[0]).toMatchObject({
      candidatesTokenCount: 1200
    });
  });

  it("preserves fallbackKind/sourceIds-compatible diagnostics on OpenAI provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { type: "rate_limit_error", message: "quota exceeded" } }),
        { status: 429, headers: { "content-type": "application/json" } }
      )
    ));

    const response = await generateModelChatAnswer(
      {
        LLM_PROVIDER: "openai",
        OPENAI_API_KEY: "test-key",
        OPENAI_CHAT_MODEL: "gpt-5-nano"
      } as never,
      {
        filing: makeFiling(),
        question: "売上成長の要因は？",
        questionIntent: "mda_summary"
      }
    );

    expect(response.usedRemoteModel).not.toBe(true);
    expect(response.fallbackReason).toBe("gemini_api_error");
    expect(response.modelProvider).toBe("openai");
    expect(response.modelApiError?.modelApiErrorKind).toBe("rate_limit");
    expect(response.geminiApiError?.geminiApiErrorKind).toBe("rate_limit");
  });

  it("disabled provider does not call external APIs and returns a safe fallback", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await generateModelChatAnswer(
      { LLM_PROVIDER: "disabled" } as never,
      {
        filing: makeFiling(),
        question: "売上成長の要因は？",
        questionIntent: "mda_summary"
      }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.modelProvider).toBe("disabled");
    expect(response.usedRemoteModel).toBe(false);
    expect(response.answer.length).toBeGreaterThan(0);
    expect(response.geminiCalled).toBe(false);
  });
});

function makeFiling(): FilingCacheRecord {
  return {
    filingKey: "v1:0000000000:000000000000000001",
    ticker: "TEST",
    companyName: "Test Corp",
    cik: "0000000000",
    formType: "10-Q",
    filedAt: "2026-01-31",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/filing.htm",
    mdaText: "Revenue increased because product demand improved.",
    mdaTokenCount: 12,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "Revenues",
        value: 100,
        unit: "USD",
        periodEnd: "2025-12-31",
        comparisonValue: 80,
        yoyPercent: 25
      }
    ],
    sourceChunks: [
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "MD&A",
        sourceLabel: "10-Q MD&A",
        text: "Revenue increased because product demand improved.",
        startOffset: 0,
        endOffset: 48,
        sortOrder: 1
      }
    ],
    summary: {
      verdict: "テスト",
      highlights: [],
      changes: []
    },
    generatedAt: "2026-01-31T00:00:00.000Z",
    extractorVersion: "test",
    promptVersion: "test"
  };
}
