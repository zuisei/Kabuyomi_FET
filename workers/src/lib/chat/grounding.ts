import type { SourceChunkRecord } from "../../env";
import { AppError } from "../errors";

export type ChatSourceKind = "sec_filing" | "historical_filing" | "web_supplement";
export type ChatSourceStrength = "filing_primary" | "supplement_article" | "supplement_snippet";
export type ChatResponsePath = "historical" | "deterministic" | "fallback" | "gemini";

export interface ChatEvidenceSource {
  sourceId: string;
  sourceKind: ChatSourceKind;
  sourceStrength: ChatSourceStrength;
  sectionType: string;
  sourceLabel: string;
  excerpt: string;
}

export interface ChatResponsePayload {
  answer: string;
  sources: ChatEvidenceSource[];
  responsePath?: ChatResponsePath;
}

export const CONTEXT_UNAVAILABLE_ANSWER = "この filing の提供コンテキストでは確認できません。";

export function dedupeChatSources(sources: ChatEvidenceSource[]): ChatEvidenceSource[] {
  const deduped: ChatEvidenceSource[] = [];
  for (const source of sources) {
    if (!deduped.some((entry) => entry.sourceId === source.sourceId)) {
      deduped.push(source);
    }
  }

  return deduped;
}

export function buildSecFilingSource(source: SourceChunkRecord): ChatEvidenceSource {
  return {
    sourceId: source.sourceId,
    sourceKind: "sec_filing",
    sourceStrength: "filing_primary",
    sectionType: source.sectionType,
    sourceLabel: source.sourceLabel,
    excerpt: source.text.slice(0, 220)
  };
}

export function ensureFilingGroundedResponse(response: ChatResponsePayload): ChatResponsePayload {
  if (response.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    return {
      answer: response.answer,
      sources: []
    };
  }

  if (!response.sources.some((source) => source.sourceKind === "sec_filing" || source.sourceKind === "historical_filing")) {
    throw new AppError(502, "Chat response must cite the filing", "No SEC filing source was attached");
  }

  return response;
}
