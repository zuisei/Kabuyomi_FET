import { describe, expect, it } from "vitest";
import { buildChatFactualPack } from "../src/lib/chat/context-factual-pack";
import { buildChatPrompt, buildChatPromptTemplateVariables } from "../src/clients/gemini/prompts";
import type { ChatContextPack } from "../src/lib/chat/context-pack";
import type { FilingCacheRecord, SourceChunkRecord } from "../src/env";

/**
 * seedKnownTickerLabels merges hardcoded labels into the factual pack whether or
 * not the filing contains them, and the production prompt tells the model to
 * prefer the factual pack over raw excerpts. So a seeded label the filing never
 * mentions is stated as fact however well the model obeys "do not invent facts"
 * — to the model, it is provided context.
 *
 * seededOnlyLabels records that, so production traffic can say how much the
 * seeded tickers actually depend on the constants before anyone decides whether
 * removing them makes answers worse. It is attribution about the pack, not a
 * fact about the company, so it must never reach the model.
 */

function source(sourceId: string, text: string): SourceChunkRecord {
  return { sourceId, sectionType: "md_a", text } as SourceChunkRecord;
}

function filing(ticker: string, sources: SourceChunkRecord[]): FilingCacheRecord {
  return {
    filingKey: `v1:${ticker}:test`,
    ticker,
    companyName: `${ticker} Inc.`,
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: sources.map((chunk) => chunk.text).join("\n"),
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: sources,
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as FilingCacheRecord;
}

describe("factual pack seeded label attribution", () => {
  it("marks labels the filing never mentions as seed-only", () => {
    const pack = buildChatFactualPack(
      filing("AAPL", [source("s1", "General discussion with no product names at all.")]),
      "business_overview"
    );

    expect(pack?.productsServices).toContain("iPhone");
    // The filing says nothing about iPhone; only the seed table does.
    expect(pack?.seededOnlyLabels).toContain("iPhone");
  });

  it("does not mark a label as seed-only when the filing actually contains it", () => {
    const pack = buildChatFactualPack(
      filing("AAPL", [source("s1", "iPhone revenue increased while Services revenue also grew.")]),
      "business_overview"
    );

    expect(pack?.productsServices).toContain("iPhone");
    expect(pack?.seededOnlyLabels ?? []).not.toContain("iPhone");
  });

  it("reports nothing for a ticker that is not seeded", () => {
    const pack = buildChatFactualPack(
      filing("CAT", [source("s1", "Construction Industries revenue rose on price realization.")]),
      "business_overview"
    );

    expect(pack?.seededOnlyLabels ?? []).toHaveLength(0);
  });

  it("never sends the attribution to the model", () => {
    const target = filing("AAPL", [source("s1", "General discussion with no product names at all.")]);
    const factualPack = buildChatFactualPack(target, "business_overview");
    expect(factualPack?.seededOnlyLabels?.length).toBeGreaterThan(0);

    const contextPack = {
      questionIntent: "business_overview",
      contentMode: "full",
      metrics: [],
      verifiedFacts: [],
      factualPack,
      sourceChunks: target.sourceChunks,
      contextTokenBudget: 0,
      selectedSourceCount: 1,
      sourceSelectionStrategy: "test",
      selectionDiagnostics: {}
    } as unknown as ChatContextPack;
    const input = { filing: target, question: "何の会社ですか", contextPack };

    // Both serialisation points spread the whole pack, so both need the guard.
    expect(buildChatPromptTemplateVariables(input).factual_pack_json).not.toContain("seededOnlyLabels");
    expect(buildChatPrompt(input)).not.toContain("seededOnlyLabels");
    // The labels themselves still reach the model — that is the behaviour being
    // measured, not changed.
    expect(buildChatPromptTemplateVariables(input).factual_pack_json).toContain("iPhone");
  });
});
