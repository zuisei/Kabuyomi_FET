import type { GeminiApiErrorKind, GeminiInvocationUsage } from "../../../gemini/types";

export type OpenAIProviderName = "openai";
export type OpenAIApiErrorKind = GeminiApiErrorKind;

export interface OpenAIChatInvocationResult {
  data: unknown;
  usage: GeminiInvocationUsage[];
  failureReason?: "json_parse_failed" | "schema_invalid";
  /**
   * finish_reason was "length": the model was cut off at max_completion_tokens,
   * so the JSON is truncated rather than malformed. Retrying the same request
   * with the same cap fails identically, and retrying with a longer prompt makes
   * it worse.
   */
  truncatedAtTokenLimit?: boolean;
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

export interface OpenAIResponsesPayload {
  model?: string;
  /** "incomplete" when the response was cut short; see incomplete_details. */
  status?: string;
  incomplete_details?: {
    reason?: string;
  };
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}
