import type { GeminiApiErrorKind, GeminiInvocationUsage } from "../../../gemini/types";

export type OpenAIProviderName = "openai";
export type OpenAIApiErrorKind = GeminiApiErrorKind;

export interface OpenAIChatInvocationResult {
  data: unknown;
  usage: GeminiInvocationUsage[];
  failureReason?: "json_parse_failed" | "schema_invalid";
}

export interface OpenAIApiErrorDiagnostics {
  modelApiErrorKind: OpenAIApiErrorKind;
  modelApiErrorStatus?: number | null;
  modelApiErrorCode?: string | null;
  modelApiErrorMessageSample?: string | null;
  modelApiErrorRetryable: boolean;
  modelRequestPromptCharCount?: number | null;
  modelRequestEstimatedTokens?: number | null;
  modelRequestSourceCount?: number | null;
  modelRequestContextCharCount?: number | null;
  modelName?: string | null;
  modelProvider: OpenAIProviderName;
  modelErrorOccurredBeforeResponse?: boolean;
}

export interface OpenAIChatCompletionPayload {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      refusal?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}
