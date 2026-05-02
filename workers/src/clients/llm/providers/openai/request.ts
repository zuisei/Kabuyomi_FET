import type { Env } from "../../../../env";
import { logEvent } from "../../../../lib/logging";
import { chatResponseJsonSchema } from "../../../gemini/prompts";
import { buildOpenAIApiRequestError, classifyOpenAIHttpError } from "./errors";
import { parseOpenAIChatCompletionPayload, parseOpenAIResponsesPayload } from "./response";
import type { OpenAIChatCompletionPayload, OpenAIChatInvocationResult, OpenAIResponsesPayload } from "./types";

export const DEFAULT_OPENAI_CHAT_MODEL = "gpt-5-nano";
const DEFAULT_OPENAI_TIMEOUT_MS = 12_000;
const DEFAULT_OPENAI_MAX_COMPLETION_TOKENS = 1_800;

export async function invokeOpenAIChat(env: Env, prompt: string): Promise<OpenAIChatInvocationResult> {
  const model = resolveOpenAIChatModel(env);
  const timeoutMs = resolveOpenAITimeoutMs(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.OPENAI_API_KEY ?? ""}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(buildOpenAIChatRequest(model, prompt, {
        reasoningEffort: resolveOpenAIReasoningEffort(env),
        maxCompletionTokens: resolveOpenAIMaxCompletionTokens(env)
      })),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut =
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof DOMException && error.name === "AbortError");
    logEvent("openai_request_failed", {
      kind: "chat",
      model,
      timeoutMs,
      reason: timedOut ? "timeout" : "network_error"
    });
    throw buildOpenAIApiRequestError({
      kind: timedOut ? "timeout" : "network_error",
      model,
      message: error instanceof Error ? error.message : "OpenAI network request failed.",
      prompt
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const bodyPreview = (await response.text()).slice(0, 240);
    const classified = classifyOpenAIHttpError(response.status, bodyPreview);
    logEvent("openai_request_failed", {
      kind: "chat",
      model,
      status: response.status,
      bodyPreview,
      errorKind: classified.kind
    });
    throw buildOpenAIApiRequestError({
      kind: classified.kind,
      status: response.status,
      code: classified.code,
      model,
      message: bodyPreview || `OpenAI request failed (${response.status})`,
      prompt
    });
  }

  const latencyMs = Date.now() - startedAt;
  logEvent("openai_request_succeeded", {
    kind: "chat",
    model,
    status: response.status,
    latencyMs
  });

  const payload = await response.json<OpenAIChatCompletionPayload>();
  const parsed = parseOpenAIChatCompletionPayload(payload);
  const usage = [{
    model,
    promptTokenCount: payload.usage?.prompt_tokens ?? null,
    candidatesTokenCount: payload.usage?.completion_tokens ?? null,
    totalTokenCount: payload.usage?.total_tokens ?? null,
    latencyMs
  }];

  if (parsed.failureReason === "schema_invalid") {
    logEvent("openai_invalid_response", {
      kind: "chat",
      reason: "empty_content",
      finishReason: parsed.finishReason
    });
    return {
      data: {},
      usage,
      failureReason: "schema_invalid"
    };
  }
  if (parsed.failureReason === "json_parse_failed") {
    logEvent("openai_invalid_response", { kind: "chat" });
    return {
      data: {},
      usage,
      failureReason: "json_parse_failed"
    };
  }

  return {
    data: parsed.data,
    usage
  };
}

export async function invokeOpenAIDashboardPrompt(
  env: Env,
  fallbackPrompt: string,
  variables: Record<string, string>
): Promise<OpenAIChatInvocationResult> {
  const model = resolveOpenAIChatModel(env);
  const promptId = resolveOpenAIPromptId(env);
  if (!promptId) {
    return invokeOpenAIChat(env, fallbackPrompt);
  }

  const timeoutMs = resolveOpenAITimeoutMs(env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  let response: Response;

  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${env.OPENAI_API_KEY ?? ""}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(buildOpenAIResponsesPromptRequest(env, variables)),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut =
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof DOMException && error.name === "AbortError");
    logEvent("openai_request_failed", {
      kind: "responses",
      model,
      promptId,
      timeoutMs,
      reason: timedOut ? "timeout" : "network_error"
    });
    throw buildOpenAIApiRequestError({
      kind: timedOut ? "timeout" : "network_error",
      model,
      message: error instanceof Error ? error.message : "OpenAI network request failed.",
      prompt: fallbackPrompt
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const bodyPreview = (await response.text()).slice(0, 240);
    const classified = classifyOpenAIHttpError(response.status, bodyPreview);
    logEvent("openai_request_failed", {
      kind: "responses",
      model,
      promptId,
      status: response.status,
      bodyPreview,
      errorKind: classified.kind
    });
    throw buildOpenAIApiRequestError({
      kind: classified.kind,
      status: response.status,
      code: classified.code,
      model,
      message: bodyPreview || `OpenAI request failed (${response.status})`,
      prompt: fallbackPrompt
    });
  }

  const latencyMs = Date.now() - startedAt;
  logEvent("openai_request_succeeded", {
    kind: "responses",
    model,
    promptId,
    status: response.status,
    latencyMs
  });

  const payload = await response.json<OpenAIResponsesPayload>();
  const parsed = parseOpenAIResponsesPayload(payload);
  const usage = [{
    model: payload.model ?? model,
    promptTokenCount: payload.usage?.input_tokens ?? null,
    candidatesTokenCount: payload.usage?.output_tokens ?? null,
    totalTokenCount: payload.usage?.total_tokens ?? null,
    latencyMs
  }];

  if (parsed.failureReason !== undefined) {
    logEvent("openai_invalid_response", {
      kind: "responses",
      reason: parsed.failureReason
    });
    return {
      data: {},
      usage,
      failureReason: parsed.failureReason
    };
  }

  return {
    data: parsed.data,
    usage
  };
}

export function buildOpenAIChatRequest(
  model: string,
  prompt: string,
  options: { reasoningEffort?: string; maxCompletionTokens?: number } = {}
): Record<string, unknown> {
  return {
    model,
    reasoning_effort: options.reasoningEffort ?? "minimal",
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "kabuyomi_chat_answer",
        strict: true,
        schema: openAIChatResponseJsonSchema()
      }
    },
    max_completion_tokens: options.maxCompletionTokens ?? DEFAULT_OPENAI_MAX_COMPLETION_TOKENS
  };
}

export function buildOpenAIResponsesPromptRequest(env: Env, variables: Record<string, string>): Record<string, unknown> {
  const prompt: Record<string, unknown> = {
    id: resolveOpenAIPromptId(env),
    variables
  };
  const version = env.OPENAI_PROMPT_VERSION?.trim();
  if (version) {
    prompt.version = version;
  }

  return {
    prompt,
    text: {
      format: {
        type: "json_schema",
        name: "kabuyomi_chat_answer",
        strict: true,
        schema: openAIChatResponseJsonSchema()
      },
      verbosity: "low"
    },
    reasoning: {
      effort: resolveOpenAIReasoningEffort(env)
    },
    max_output_tokens: resolveOpenAIMaxCompletionTokens(env)
  };
}

export function resolveOpenAIChatModel(env: Env): string {
  return env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_OPENAI_CHAT_MODEL;
}

export function resolveOpenAIPromptId(env: Env): string | null {
  return env.OPENAI_PROMPT_ID?.trim() || null;
}

function resolveOpenAITimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.OPENAI_TIMEOUT_MS ?? env.GEMINI_CHAT_TIMEOUT_MS ?? env.GEMINI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENAI_TIMEOUT_MS;
}

function resolveOpenAIReasoningEffort(env: Env): "minimal" | "low" | "medium" | "high" {
  const raw = env.OPENAI_REASONING_EFFORT?.trim();
  return raw === "low" || raw === "medium" || raw === "high" || raw === "minimal" ? raw : "minimal";
}

function resolveOpenAIMaxCompletionTokens(env: Env): number {
  const parsed = Number.parseInt(env.OPENAI_MAX_COMPLETION_TOKENS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENAI_MAX_COMPLETION_TOKENS;
}

function openAIChatResponseJsonSchema(): Record<string, unknown> {
  return {
    ...chatResponseJsonSchema(),
    additionalProperties: false
  };
}
