import { classifyProviderHttpError } from "../../errors";
import type { OpenAIApiErrorDiagnostics, OpenAIApiErrorKind } from "./types";

const RETRYABLE_OPENAI_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class OpenAIApiRequestError extends Error {
  readonly diagnostics: OpenAIApiErrorDiagnostics;

  constructor(message: string, diagnostics: OpenAIApiErrorDiagnostics) {
    super(message);
    this.name = "OpenAIApiRequestError";
    this.diagnostics = diagnostics;
  }
}

export function classifyOpenAIError(error: unknown): OpenAIApiErrorDiagnostics {
  if (error instanceof OpenAIApiRequestError) {
    return error.diagnostics;
  }
  const timedOut =
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /timeout|timed out|aborted/i.test(error.message));
  if (timedOut) {
    return {
      modelApiErrorKind: "timeout",
      modelApiErrorMessageSample: sampleErrorMessage(error instanceof Error ? error.message : "timeout"),
      modelApiErrorRetryable: true,
      modelProvider: "openai",
      modelErrorOccurredBeforeResponse: true
    };
  }
  return {
    modelApiErrorKind: "unknown",
    modelApiErrorMessageSample: sampleErrorMessage(error instanceof Error ? error.message : String(error)),
    modelApiErrorRetryable: false,
    modelProvider: "openai",
    modelErrorOccurredBeforeResponse: true
  };
}

export function buildOpenAIApiRequestError({
  kind,
  status,
  code,
  model,
  message,
  prompt
}: {
  kind: OpenAIApiErrorKind;
  status?: number;
  code?: string | null;
  model: string;
  message: string;
  prompt: string;
}): OpenAIApiRequestError {
  return new OpenAIApiRequestError(`OpenAI request failed: ${kind}`, {
    modelApiErrorKind: kind,
    modelApiErrorStatus: status ?? null,
    modelApiErrorCode: code ?? null,
    modelApiErrorMessageSample: sampleErrorMessage(message),
    modelApiErrorRetryable: isRetryableOpenAIApiError(kind, status),
    modelRequestPromptCharCount: prompt.length,
    modelRequestEstimatedTokens: Math.ceil(prompt.length / 4),
    modelName: model,
    modelProvider: "openai",
    modelErrorOccurredBeforeResponse: status === undefined
  });
}

export function classifyOpenAIHttpError(status: number, bodyPreview: string): { kind: OpenAIApiErrorKind; code: string | null } {
  return classifyProviderHttpError(status, bodyPreview);
}

export function isRetryableOpenAIApiError(kind: OpenAIApiErrorKind, status?: number): boolean {
  return kind === "rate_limit" ||
    kind === "provider_server_error" ||
    kind === "network_error" ||
    kind === "timeout" ||
    (status !== undefined && RETRYABLE_OPENAI_STATUS_CODES.has(status));
}

function sampleErrorMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}
