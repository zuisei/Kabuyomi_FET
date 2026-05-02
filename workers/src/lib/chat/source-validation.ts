import type { FilingCacheRecord, SourceChunkRecord } from "../../env";
import type { GeminiChatAnswer } from "../../clients/gemini/types";
import type { ChatContextPack } from "./context-pack";
import { buildSecFilingSource, type ChatEvidenceSource } from "./grounding";

export interface ChatSourceValidationResult {
  approvedSourceIds: string[];
  modelSourceIdsValid: boolean;
}

export function validateModelSources(
  modelResponse: GeminiChatAnswer,
  contextPack: ChatContextPack,
  filing?: FilingCacheRecord
): ChatSourceValidationResult {
  const validSourceIds = new Set([
    ...(modelResponse.usedRemoteModel === true || !filing ? [] : filing.sourceChunks.map((chunk) => chunk.sourceId)),
    ...contextPack.sourceChunks.map((chunk) => chunk.sourceId)
  ]);
  const approvedSourceIds = modelResponse.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));
  return {
    approvedSourceIds,
    modelSourceIdsValid: modelResponse.sourceIds.length > 0 && approvedSourceIds.length === modelResponse.sourceIds.length
  };
}

export function buildFallbackValidSourceIds(
  filing: FilingCacheRecord,
  contextPack: ChatContextPack
): Set<string> {
  return new Set([
    ...filing.sourceChunks.map((chunk) => chunk.sourceId),
    ...contextPack.sourceChunks.map((chunk) => chunk.sourceId)
  ]);
}

export function buildSourceLookup(
  filing: FilingCacheRecord,
  contextPack?: ChatContextPack
): Map<string, SourceChunkRecord> {
  const sourceById = new Map<string, SourceChunkRecord>();
  for (const source of filing.sourceChunks) {
    sourceById.set(source.sourceId, source);
  }
  for (const source of contextPack?.sourceChunks ?? []) {
    sourceById.set(source.sourceId, source);
  }
  return sourceById;
}

export function mapSourceIdsToSecFilingSources(
  sourceIds: string[],
  sourceById: Map<string, SourceChunkRecord>
): ChatEvidenceSource[] {
  return sourceIds.map((sourceId) => {
    const source = sourceById.get(sourceId)!;
    return buildSecFilingSource(source);
  });
}
