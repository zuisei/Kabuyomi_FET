import type { ChatModelProviderName, GeminiApiErrorKind, GeminiChatAnswer } from "../gemini/types";

export type LlmProviderName = "gemini-legacy" | "openai" | "disabled";

export type LlmApiErrorKind = GeminiApiErrorKind;

export type ChatModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ChatModelResult = {
  ok: boolean;
  answer?: string;
  modelName: string;
  providerName: LlmProviderName;
  errorKind?: LlmApiErrorKind;
  rawUsage?: ChatModelUsage;
  raw?: unknown;
};

export type ChatModelAnswer = GeminiChatAnswer & {
  modelProvider?: ChatModelProviderName | LlmProviderName | null;
};
