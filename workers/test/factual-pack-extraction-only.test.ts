import { describe, expect, it } from "vitest";
import { buildChatFactualPack, type ChatFactualPack } from "../src/lib/chat/context-factual-pack";
import { buildChatPrompt, buildChatPromptTemplateVariables } from "../src/clients/gemini/prompts";
import type { ChatContextPack } from "../src/lib/chat/context-pack";
import type { FilingCacheRecord, SourceChunkRecord } from "../src/env";

/**
 * The factual pack is the highest-trust context the model receives: the prompt
 * tells it to prefer the pack over the raw excerpts. Anything in the pack is
 * therefore stated as fact however well the model obeys "do not invent facts".
 *
 * This file replaces the seeded-label attribution tests. `seedKnownTickerLabels`
 * used to merge a per-ticker constant table into the pack whether or not the
 * filing mentioned those labels, and `seededOnlyLabels` recorded how much of the
 * pack came from that table. Both are gone; the pack now carries only what
 * extraction matched in the filing, so what these tests pin is the absence of
 * seeding and the allowlist that keeps pack-level diagnostics out of the prompt.
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

describe("chat factual pack carries only extracted labels", () => {
  it("names no product the filing never mentions", () => {
    const pack = buildChatFactualPack(
      filing("AAPL", [source("s1", "General discussion with no product names at all.")]),
      "business_overview"
    );

    // Previously this pack contained iPhone, Mac, iPad, Wearables and Services
    // from the seed table, on a filing that names none of them.
    expect(pack?.productsServices ?? []).not.toContain("iPhone");
    expect(pack?.productsServices ?? []).toHaveLength(0);
  });

  it("still extracts the labels the filing does mention", () => {
    const pack = buildChatFactualPack(
      filing("AAPL", [source("s1", "iPhone revenue increased while Services revenue also grew.")]),
      "business_overview"
    );

    expect(pack?.productsServices).toContain("iPhone");
    expect(pack?.productsServices).toContain("Services");
    // Not merged in from anywhere: the filing does not mention these.
    expect(pack?.productsServices ?? []).not.toContain("Mac");
    expect(pack?.productsServices ?? []).not.toContain("iPad");
  });

  it("returns no pack at all for a formerly seeded ticker whose filing supports nothing", () => {
    // PH used to be seeded with Aerospace Systems / Diversified Industrial /
    // Motion and Control Technologies, which made a pack out of a filing that
    // said none of it.
    const pack = buildChatFactualPack(
      filing("PH", [source("s1", "General discussion with no segment names at all.")]),
      "business_overview"
    );

    expect(pack).toBeUndefined();
  });

  it("seeds no revenue category into a revenue-breakdown pack", () => {
    const pack = buildChatFactualPack(
      filing("AAPL", [source("s1", "iPhone net sales increased during the period.")]),
      "revenue_breakdown"
    );

    const labels = (pack?.revenueCategories ?? []).map((fact) => fact.label);
    expect(labels).toContain("iPhone");
    expect(labels).not.toContain("Mac");
    expect(labels).not.toContain("Services");
  });
});

describe("prompt serialisation of the factual pack is an allowlist", () => {
  it("does not forward a pack field that describes the pack rather than the company", () => {
    const target = filing("AAPL", [source("s1", "iPhone revenue increased during the period.")]);
    const extracted = buildChatFactualPack(target, "business_overview");
    expect(extracted).toBeDefined();

    // Stands in for any provenance/diagnostic field a future change might add to
    // ChatFactualPack. It must not reach the model just by existing on the
    // object — promptSafeFactualPack has to name a field for it to ship.
    const factualPack = {
      ...(extracted as ChatFactualPack),
      packProvenanceDiagnostic: ["internal-attribution-not-a-company-fact"]
    } as ChatFactualPack;

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

    // Both serialisation points go through the same allowlist, so both are checked.
    expect(buildChatPromptTemplateVariables(input).factual_pack_json).not.toContain("packProvenanceDiagnostic");
    expect(buildChatPromptTemplateVariables(input).factual_pack_json).not.toContain("internal-attribution-not-a-company-fact");
    expect(buildChatPrompt(input)).not.toContain("packProvenanceDiagnostic");
    expect(buildChatPrompt(input)).not.toContain("internal-attribution-not-a-company-fact");

    // The extracted labels themselves are company facts and do reach the model.
    expect(buildChatPromptTemplateVariables(input).factual_pack_json).toContain("iPhone");
    expect(buildChatPromptTemplateVariables(input).factual_pack_json).toContain("sourceIds");
  });
});
