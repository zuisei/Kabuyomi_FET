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
  sourceUrl?: string;
}

export interface ChatResponsePayload {
  answer: string;
  sources: ChatEvidenceSource[];
  responsePath?: ChatResponsePath;
  chargeable?: boolean;
  debug?: ChatResponseDebug;
}

export interface ChatResponseDebug {
  questionIntent?: string;
  responsePath?: ChatResponsePath;
  fallbackReason?: string | null;
  sourceCount?: number;
  sourceIds?: string[];
  sourceIdsValid?: boolean;
  contextApplied?: boolean;
  modelName?: string | null;
  contentMode?: "full" | "metrics_only";
  geminiCalled?: boolean;
  geminiSucceeded?: boolean;
  schemaValid?: boolean;
  retryAttempt?: number;
  retryReason?: string | null;
  contextTokenBudget?: number | null;
  selectedSourceCount?: number | null;
  selectedSourceCharCount?: number | null;
  estimatedContextTokens?: number | null;
  sourceSelectionStrategy?: string | null;
  selectedSourceIds?: string[];
  selectedSourceLabels?: string[];
  answerQualityFlags?: string[];
  totalPipelineMs?: number;
  historicalLookupMs?: number;
  deterministicBuildMs?: number;
  contextBuildMs?: number;
  geminiFirstCallMs?: number;
  geminiRetryMs?: number;
  fallbackBuildMs?: number;
  webSupplementMs?: number;
  groundingMs?: number;
}

export const CONTEXT_UNAVAILABLE_ANSWER = "この決算資料の範囲では確認できません。";

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

export function attachCurrentFilingSourceUrls(
  response: ChatResponsePayload,
  primaryDocumentUrl: string
): ChatResponsePayload {
  if (!primaryDocumentUrl) {
    return response;
  }

  return {
    ...response,
    sources: response.sources.map((source) =>
      source.sourceKind === "sec_filing" && !source.sourceUrl
        ? {
            ...source,
            sourceUrl: primaryDocumentUrl
          }
        : source
    )
  };
}

export function ensureFilingGroundedResponse(response: ChatResponsePayload): ChatResponsePayload {
  if (response.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    return {
      ...response,
      answer: response.answer,
      sources: []
    };
  }

  if (!response.sources.some((source) => source.sourceKind === "sec_filing" || source.sourceKind === "historical_filing")) {
    throw new AppError(502, "Chat response must cite the filing", "No SEC filing source was attached");
  }

  return response;
}
