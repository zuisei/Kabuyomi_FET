import type { ChatResponseDebug } from "./grounding";

export type ChatTimingMetric = Extract<
  keyof ChatResponseDebug,
  | "historicalLookupMs"
  | "deterministicBuildMs"
  | "contextBuildMs"
  | "geminiFirstCallMs"
  | "geminiRetryMs"
  | "fallbackBuildMs"
  | "webSupplementMs"
  | "groundingMs"
>;

export type ChatTimingSnapshot = Pick<
  ChatResponseDebug,
  | "totalPipelineMs"
  | "historicalLookupMs"
  | "deterministicBuildMs"
  | "contextBuildMs"
  | "geminiFirstCallMs"
  | "geminiRetryMs"
  | "fallbackBuildMs"
  | "webSupplementMs"
  | "groundingMs"
>;

export interface ChatTimingTracker {
  add: (metric: ChatTimingMetric, ms: number) => void;
  timeSync: <T>(metric: ChatTimingMetric, work: () => T) => T;
  timeAsync: <T>(metric: ChatTimingMetric, work: () => Promise<T>) => Promise<T>;
  snapshot: () => Partial<ChatTimingSnapshot>;
}

export function createChatTimingTracker(): ChatTimingTracker {
  const startedAt = Date.now();
  const values: Partial<Record<ChatTimingMetric, number>> = {};
  const add = (metric: ChatTimingMetric, ms: number): void => {
    values[metric] = Math.max(0, Math.round((values[metric] ?? 0) + ms));
  };

  return {
    add,
    timeSync(metric, work) {
      const stageStartedAt = Date.now();
      try {
        return work();
      } finally {
        add(metric, Date.now() - stageStartedAt);
      }
    },
    async timeAsync(metric, work) {
      const stageStartedAt = Date.now();
      try {
        return await work();
      } finally {
        add(metric, Date.now() - stageStartedAt);
      }
    },
    snapshot() {
      return {
        totalPipelineMs: Math.max(0, Date.now() - startedAt),
        ...values
      };
    }
  };
}
