import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../../env";
import type { ChatContextPack } from "../../lib/chat/context-pack";
import type { QuestionIntent } from "../../lib/chat/intent";

export interface SummaryPromptInput {
  filingKey: string;
  ticker: string;
  companyName: string;
  formType: "10-K" | "10-Q";
  filedAt: string;
  periodOfReport: string;
  metrics: MetricSnapshot[];
  sourceChunks: SourceChunkRecord[];
}

export interface ChatPromptInput {
  filing: FilingCacheRecord;
  question: string;
  questionIntent?: QuestionIntent;
  contextPack?: ChatContextPack;
  retryInstruction?: ChatRetryInstruction;
}

export type ChatFallbackReason =
  | "gemini_timeout"
  | "gemini_api_error"
  | "json_parse_failed"
  | "schema_invalid"
  | "invalid_source_id"
  | "no_sources"
  | "weak_grounding"
  | "low_quality_answer"
  | "deterministic_repair"
  | "metrics_only_insufficient";

export interface QuoteTranslationPromptInput {
  text: string;
  sourceLanguage?: string;
  targetLanguage: "ja";
}

export interface GeminiChatAnswer {
  answer: string;
  sourceIds: string[];
  usedRemoteModel?: boolean;
  llmUsage?: GeminiInvocationUsage[];
  geminiCalled?: boolean;
  geminiSucceeded?: boolean;
  fallbackReason?: ChatFallbackReason;
  schemaValid?: boolean;
  retryAttempt?: number;
  retryReason?: ChatFallbackReason;
}

export interface GeminiInvocationUsage {
  model: string;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  latencyMs: number;
}

export interface ChatRetryInstruction {
  attempt: 1;
  reason: ChatFallbackReason;
  previousResponse?: unknown;
}
