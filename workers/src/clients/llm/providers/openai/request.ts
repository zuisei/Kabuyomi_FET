import type { Env } from "../../../../env";
import { logEvent } from "../../../../lib/logging";
import { chatResponseJsonSchema, quoteTranslationResponseJsonSchema, summaryResponseJsonSchema } from "../../../gemini/prompts";
import { buildOpenAIApiRequestError, classifyOpenAIHttpError } from "./errors";
import { parseOpenAIChatCompletionPayload, parseOpenAIResponsesPayload } from "./response";
import type { OpenAIChatCompletionPayload, OpenAIChatInvocationResult, OpenAIResponsesPayload } from "./types";

export const DEFAULT_OPENAI_CHAT_MODEL = "gpt-5-nano";
const DEFAULT_OPENAI_TIMEOUT_MS = 12_000;
const DEFAULT_OPENAI_MAX_COMPLETION_TOKENS = 1_800;
// 要約は verdict + highlights + changes をまとめて返すため chat より長い。
// また 10-K は本文が長く、生成は waitUntil の背景処理なので chat より待てる。
const DEFAULT_OPENAI_SUMMARY_MAX_COMPLETION_TOKENS = 2_500;
const DEFAULT_OPENAI_SUMMARY_TIMEOUT_MS = 30_000;
const DEFAULT_OPENAI_REASONING_EFFORT = "minimal";
export type OpenAIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export type OpenAIReasoningConfig = {
  requestedReasoningEffort: string | null;
  effectiveReasoningEffort: OpenAIReasoningEffort;
  reasoningEffortInvalid: boolean;
};

export async function invokeOpenAIChat(env: Env, prompt: string): Promise<OpenAIChatInvocationResult> {
  const model = resolveOpenAIChatModel(env);
  const reasoningConfig = resolveOpenAIReasoningConfig(env);
  logInvalidReasoningEffortIfNeeded("chat", model, reasoningConfig);
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
        reasoningEffort: reasoningConfig.effectiveReasoningEffort,
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
    latencyMs,
    requestedModelName: requestedOpenAIChatModel(env),
    effectiveModelName: model,
    ...reasoningConfig
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

export async function invokeOpenAIQuoteTranslation(env: Env, prompt: string): Promise<OpenAIChatInvocationResult> {
  const model = resolveOpenAIChatModel(env);
  const reasoningConfig = resolveOpenAIReasoningConfig(env);
  logInvalidReasoningEffortIfNeeded("quote_translation", model, reasoningConfig);
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
      body: JSON.stringify(buildOpenAIQuoteTranslationRequest(model, prompt, {
        reasoningEffort: reasoningConfig.effectiveReasoningEffort,
        maxCompletionTokens: Math.min(resolveOpenAIMaxCompletionTokens(env), 700)
      })),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut =
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof DOMException && error.name === "AbortError");
    logEvent("openai_request_failed", {
      kind: "quote_translation",
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
      kind: "quote_translation",
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
    kind: "quote_translation",
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
    latencyMs,
    requestedModelName: requestedOpenAIChatModel(env),
    effectiveModelName: model,
    ...reasoningConfig
  }];

  if (parsed.failureReason !== undefined) {
    logEvent("openai_invalid_response", {
      kind: "quote_translation",
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
  const reasoningConfig = resolveOpenAIReasoningConfig(env);
  logInvalidReasoningEffortIfNeeded("responses", model, reasoningConfig);

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
    latencyMs,
    requestedModelName: requestedOpenAIChatModel(env),
    effectiveModelName: model,
    ...reasoningConfig
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

export async function invokeOpenAISummary(env: Env, prompt: string): Promise<OpenAIChatInvocationResult> {
  const model = resolveOpenAIChatModel(env);
  const reasoningConfig = resolveOpenAIReasoningConfig(env);
  logInvalidReasoningEffortIfNeeded("summary", model, reasoningConfig);
  const timeoutMs = resolveOpenAISummaryTimeoutMs(env);
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
      body: JSON.stringify(buildOpenAISummaryRequest(model, prompt, {
        reasoningEffort: reasoningConfig.effectiveReasoningEffort,
        maxCompletionTokens: resolveOpenAISummaryMaxCompletionTokens(env)
      })),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    const timedOut =
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof DOMException && error.name === "AbortError");
    logEvent("openai_request_failed", {
      kind: "summary",
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
      kind: "summary",
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
    kind: "summary",
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
    latencyMs,
    requestedModelName: requestedOpenAIChatModel(env),
    effectiveModelName: model,
    ...reasoningConfig
  }];

  if (parsed.failureReason !== undefined) {
    logEvent("openai_invalid_response", {
      kind: "summary",
      reason: parsed.failureReason,
      finishReason: parsed.finishReason
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

export function buildOpenAISummaryRequest(
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
        name: "kabuyomi_filing_summary",
        strict: true,
        schema: openAISummaryResponseJsonSchema()
      }
    },
    max_completion_tokens: options.maxCompletionTokens ?? DEFAULT_OPENAI_SUMMARY_MAX_COMPLETION_TOKENS
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

export function buildOpenAIQuoteTranslationRequest(
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
        name: "kabuyomi_quote_translation",
        strict: true,
        schema: {
          ...quoteTranslationResponseJsonSchema(),
          additionalProperties: false
        }
      }
    },
    max_completion_tokens: options.maxCompletionTokens ?? 700
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
    model: resolveOpenAIChatModel(env),
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

export function requestedOpenAIChatModel(env: Env): string | null {
  return env.OPENAI_CHAT_MODEL?.trim() || null;
}

export function resolveOpenAIPromptId(env: Env): string | null {
  return env.OPENAI_PROMPT_ID?.trim() || null;
}

function resolveOpenAITimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.OPENAI_TIMEOUT_MS ?? env.GEMINI_CHAT_TIMEOUT_MS ?? env.GEMINI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENAI_TIMEOUT_MS;
}

export function resolveOpenAIReasoningEffort(env: Env): OpenAIReasoningEffort {
  return resolveOpenAIReasoningConfig(env).effectiveReasoningEffort;
}

export function resolveOpenAIReasoningConfig(env: Env): OpenAIReasoningConfig {
  const raw = env.OPENAI_REASONING_EFFORT?.trim();
  if (isOpenAIReasoningEffort(raw)) {
    return {
      requestedReasoningEffort: raw,
      effectiveReasoningEffort: raw,
      reasoningEffortInvalid: false
    };
  }
  return {
    requestedReasoningEffort: raw || null,
    effectiveReasoningEffort: DEFAULT_OPENAI_REASONING_EFFORT,
    reasoningEffortInvalid: Boolean(raw)
  };
}

function isOpenAIReasoningEffort(value: string | undefined): value is OpenAIReasoningEffort {
  return value === "none" || value === "minimal" || value === "low" || value === "medium" || value === "high";
}

function logInvalidReasoningEffortIfNeeded(kind: string, model: string, config: OpenAIReasoningConfig): void {
  if (!config.reasoningEffortInvalid) {
    return;
  }
  logEvent("openai_invalid_reasoning_effort", {
    kind,
    model,
    requestedReasoningEffort: config.requestedReasoningEffort,
    effectiveReasoningEffort: config.effectiveReasoningEffort
  });
}

function resolveOpenAIMaxCompletionTokens(env: Env): number {
  const parsed = Number.parseInt(env.OPENAI_MAX_COMPLETION_TOKENS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OPENAI_MAX_COMPLETION_TOKENS;
}

function resolveOpenAISummaryTimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.OPENAI_SUMMARY_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  // chat 用の値しか設定されていない環境でも、要約だけは既定の長めの上限まで許す。
  return Math.max(resolveOpenAITimeoutMs(env), DEFAULT_OPENAI_SUMMARY_TIMEOUT_MS);
}

function resolveOpenAISummaryMaxCompletionTokens(env: Env): number {
  const parsed = Number.parseInt(env.OPENAI_SUMMARY_MAX_COMPLETION_TOKENS ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return Math.max(resolveOpenAIMaxCompletionTokens(env), DEFAULT_OPENAI_SUMMARY_MAX_COMPLETION_TOKENS);
}

/// OpenAI の strict モードは、入れ子の各オブジェクトに `additionalProperties: false` と
/// 全プロパティを含む `required` を要求する。`summaryResponseJsonSchema` は Gemini と共有なので、
/// ここで再帰的に強制する(スキーマ定義が増えても追従する)。
function withStrictObjectConstraints(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(withStrictObjectConstraints);
  }
  if (schema === null || typeof schema !== "object") {
    return schema;
  }

  const source = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    result[key] = withStrictObjectConstraints(value);
  }

  if (source.type === "object") {
    result.additionalProperties = false;
    const properties = result.properties;
    if (properties !== null && typeof properties === "object") {
      result.required = Object.keys(properties as Record<string, unknown>);
    }
  }

  return result;
}

function openAISummaryResponseJsonSchema(): Record<string, unknown> {
  return withStrictObjectConstraints(summaryResponseJsonSchema()) as Record<string, unknown>;
}

function openAIChatResponseJsonSchema(): Record<string, unknown> {
  return {
    ...chatResponseJsonSchema(),
    additionalProperties: false
  };
}
