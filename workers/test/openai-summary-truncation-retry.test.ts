import { afterEach, describe, expect, it, vi } from "vitest";
import { generateModelSummary } from "../src/clients/llm/provider";
import type { Env } from "../src/env";
import type { SummaryPromptInput } from "../src/clients/gemini/types";

/**
 * finish_reason was parsed and logged but never acted on, so a summary cut off
 * at max_completion_tokens was retried against the same cap — and with a longer
 * prompt, since the schema-miss retry appends more instructions. That retry
 * could only truncate again.
 *
 * A schema miss and a truncation want opposite retries; these pin both.
 */

const env = {
  OPENAI_API_KEY: "test-key",
  LLM_PROVIDER: "openai",
  OPENAI_CHAT_MODEL: "gpt-5-nano"
} as unknown as Env;

const input: SummaryPromptInput = {
  filingKey: "v1:TEST:test",
  ticker: "TEST",
  companyName: "Test Corp",
  formType: "10-K",
  filedAt: "2026-01-01",
  periodOfReport: "2025-12-31",
  metrics: [],
  sourceChunks: []
};

function completion(content: string, finishReason: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function requestBodies(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI summary retry after a truncated response", () => {
  it("retries a token-limit truncation with the same prompt and more room", async () => {
    const fetchMock = vi
      .fn()
      // Cut off mid-JSON at the cap.
      .mockResolvedValueOnce(completion('{"verdict":"部分的な出', "length"))
      .mockResolvedValueOnce(completion('{"verdict":"ok","highlights":[],"changes":[]}', "stop"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateModelSummary(env, input);

    expect(result.provider).toBe("openai");
    const [first, second] = requestBodies(fetchMock);
    // Not the schema-nagging retry prompt — that only makes the output longer.
    expect(JSON.stringify(second!.messages)).not.toContain("did not match the required JSON schema");
    expect(second!.max_completion_tokens).toBe((first!.max_completion_tokens as number) * 2);
  });

  it("still uses the more explicit prompt when the failure was a schema miss", async () => {
    const fetchMock = vi
      .fn()
      // Complete output, just not the required shape.
      .mockResolvedValueOnce(completion('{"unexpected":"shape"}', "stop"))
      .mockResolvedValueOnce(completion('{"verdict":"ok","highlights":[],"changes":[]}', "stop"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateModelSummary(env, input);

    expect(result.provider).toBe("openai");
    const [first, second] = requestBodies(fetchMock);
    expect(JSON.stringify(second!.messages)).toContain("did not match the required JSON schema");
    expect(second!.max_completion_tokens).toBe(first!.max_completion_tokens);
  });

  it("stops instead of burning a third call when the raised cap also truncates", async () => {
    // A fresh Response per call: reusing one would fail the second read for an
    // unrelated reason and the test would pass without exercising the branch.
    const fetchMock = vi.fn(async () => completion('{"verdict":"まだ切れて', "length"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateModelSummary(env, input);

    expect(result.provider).toBe("fallback");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The second call is the raised-cap retry, not another identical attempt.
    const [first, second] = requestBodies(fetchMock);
    expect(second!.max_completion_tokens).toBe((first!.max_completion_tokens as number) * 2);
  });
});
