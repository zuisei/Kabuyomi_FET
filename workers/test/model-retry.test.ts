import { describe, expect, it } from "vitest";
import type { GeminiChatAnswer } from "../src/clients/gemini/types";
import { mergeRetryModelResponse } from "../src/lib/chat/model-retry";

describe("model retry metadata", () => {
  it("preserves the prior follow-up answer and source gate after a retry", () => {
    const previous = {
      answer: "初回回答",
      sources: [],
      qualityControl: {
        sourceGateApplied: true,
        sourceGateSufficient: true,
        sourceGateMissingSourceTypes: [],
        sourceGateFailureLabels: [],
        sourceGateEvidenceSlots: {},
        followupPreviousAnswer: "決済ネットワーク売上は国際取引量、決済額、処理件数の増加が主な説明要因です。",
        sourceGateRetrievalRetryRecommended: false,
        retrievalRetryUsed: false,
        retrievalRetryOutcome: "not_used",
        evidenceFallbackUsed: false,
        fallbackKind: "none",
        driverSlotsCount: 3,
        marginDriverSlotsCount: 0,
        followupTargetFound: true,
        genericFallbackPhraseDetected: false
      }
    } as unknown as GeminiChatAnswer;
    const retry = {
      answer: "再試行回答",
      sources: []
    } as unknown as GeminiChatAnswer;

    const merged = mergeRetryModelResponse(previous, retry, "weak_grounding");

    expect(merged.qualityControl?.sourceGateApplied).toBe(true);
    expect(merged.qualityControl?.sourceGateSufficient).toBe(true);
    expect(merged.qualityControl?.followupPreviousAnswer).toContain("国際取引量");
    expect(merged.retryAttempt).toBe(1);
    expect(merged.retryReason).toBe("weak_grounding");
  });
});
