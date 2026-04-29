import { describe, expect, it } from "vitest";
import type { FilingCacheRecord, SourceChunkRecord } from "../src/env";
import type { ChatContextPack } from "../src/lib/chat/context-pack";
import {
  buildFallbackValidSourceIds,
  buildSourceLookup,
  mapSourceIdsToSecFilingSources,
  validateModelSources
} from "../src/lib/chat/source-validation";

describe("chat source validation helpers", () => {
  it("keeps approved source IDs in model order when every source is valid", () => {
    const contextPack = makeContextPack([source("S1"), source("S2")]);

    expect(
      validateModelSources(
        {
          answer: "answer",
          sourceIds: ["S2", "S1"]
        },
        contextPack
      )
    ).toEqual({
      approvedSourceIds: ["S2", "S1"],
      modelSourceIdsValid: true
    });
  });

  it("filters invalid model source IDs without changing valid source order", () => {
    const contextPack = makeContextPack([source("S1"), source("S2")]);

    expect(
      validateModelSources(
        {
          answer: "answer",
          sourceIds: ["S9", "S2", "S1"]
        },
        contextPack
      )
    ).toEqual({
      approvedSourceIds: ["S2", "S1"],
      modelSourceIdsValid: false
    });
  });

  it("treats an empty model source list as invalid", () => {
    expect(validateModelSources({ answer: "answer", sourceIds: [] }, makeContextPack([source("S1")]))).toEqual({
      approvedSourceIds: [],
      modelSourceIdsValid: false
    });
  });

  it("builds fallback source IDs from both filing and context sources", () => {
    const ids = buildFallbackValidSourceIds(makeFiling([source("S1")]), makeContextPack([source("S2")]));

    expect([...ids]).toEqual(["S1", "S2"]);
  });

  it("maps approved source IDs to SEC filing sources", () => {
    const sourceById = buildSourceLookup(makeFiling([source("S1", "filing text")]), makeContextPack([source("S2", "context text")]));

    expect(mapSourceIdsToSecFilingSources(["S2", "S1"], sourceById)).toEqual([
      expect.objectContaining({
        sourceId: "S2",
        sourceKind: "sec_filing",
        sourceStrength: "filing_primary",
        excerpt: "context text"
      }),
      expect.objectContaining({
        sourceId: "S1",
        sourceKind: "sec_filing",
        sourceStrength: "filing_primary",
        excerpt: "filing text"
      })
    ]);
  });
});

function source(sourceId: string, text = "source text"): SourceChunkRecord {
  return {
    sourceId,
    sectionType: "md_a",
    sectionTitle: "Item 7",
    sourceLabel: `10-K ${sourceId}`,
    text,
    startOffset: 0,
    endOffset: text.length,
    sortOrder: Number(sourceId.replace(/\D/g, "")) || 1
  };
}

function makeContextPack(sourceChunks: SourceChunkRecord[]): ChatContextPack {
  return {
    questionIntent: "mda_summary",
    contentMode: "full",
    metrics: [],
    sourceChunks,
    contextTokenBudget: 6_000,
    selectedSourceCount: sourceChunks.length,
    sourceSelectionStrategy: "test",
    selectionDiagnostics: {
      candidateSourceCount: sourceChunks.length,
      selectedSourceCount: sourceChunks.length,
      selectedSourceCharCount: sourceChunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
      avgSelectedSourceChars: sourceChunks.length === 0 ? 0 : sourceChunks[0]!.text.length,
      contextTokenBudget: 6_000,
      estimatedContextTokens: 100,
      sourceSelectionStrategy: "test",
      rejectedShortCount: 0,
      rejectedTableFragmentCount: 0,
      rejectedLowTextQualityCount: 0,
      sectionHitCountBusiness: 0,
      sectionHitCountRisk: 0,
      sectionHitCountMda: sourceChunks.length
    }
  };
}

function makeFiling(sourceChunks: SourceChunkRecord[]): FilingCacheRecord {
  return {
    filingKey: "v1:0000000000:000000000000000001",
    ticker: "TEST",
    companyName: "Test Corp",
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com/filing.htm",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks,
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-29T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}
