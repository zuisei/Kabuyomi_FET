import type { GeminiInvocationUsage } from "../clients/gemini/types";
import { logEvent } from "./logging";

export type LlmUsageTask = "chat" | "translation" | "summary";

interface LlmUsageLogContext {
  aiTask: LlmUsageTask;
  route: string;
  responsePath: string;
  ticker?: string;
  filingKey?: string;
}

export function logLlmUsage(usage: GeminiInvocationUsage[] | undefined, context: LlmUsageLogContext): void {
  for (const row of usage ?? []) {
    logEvent("llm_usage", {
      aiTask: context.aiTask,
      model: row.model,
      route: context.route,
      ticker: context.ticker,
      filingKey: context.filingKey,
      responsePath: context.responsePath,
      promptTokenCount: row.promptTokenCount,
      candidatesTokenCount: row.candidatesTokenCount,
      totalTokenCount: row.totalTokenCount,
      latencyMs: row.latencyMs
    });
  }
}
