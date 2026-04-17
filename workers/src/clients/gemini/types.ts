import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../../env";

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
}

export interface GeminiChatAnswer {
  answer: string;
  sourceIds: string[];
}
