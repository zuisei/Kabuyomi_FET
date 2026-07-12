import { describe, expect, it } from "vitest";
import {
  buildChatRequestHash,
  buildQuoteTranslationRequestHash,
  canonicalJson
} from "../src/lib/request-fingerprint";

describe("request fingerprints", () => {
  it("canonicalizes object keys recursively while preserving array order", () => {
    expect(
      canonicalJson({ z: 1, a: { y: true, b: null }, rows: [{ q: 2, a: 1 }] })
    ).toBe('{"a":{"b":null,"y":true},"rows":[{"a":1,"q":2}],"z":1}');
  });

  it("produces the same chat hash for equivalent validated whitespace", async () => {
    const first = await buildChatRequestHash({
      filingKey: " filing-1 ",
      question: " Revenue? ",
      conversationContext: [{ role: "user", content: " Prior question " }],
      analysisTier: null,
      creditCost: 2
    });
    const second = await buildChatRequestHash({
      filingKey: "filing-1",
      question: "Revenue?",
      conversationContext: [{ role: "user", content: "Prior question" }],
      creditCost: 2
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toBe(first);
  });

  it.each([
    ["filing", { filingKey: "filing-2" }],
    ["question", { question: "Margin?" }],
    ["context role", { conversationContext: [{ role: "assistant" as const, content: "Prior question" }] }],
    ["context content", { conversationContext: [{ role: "user" as const, content: "Different" }] }],
    [
      "context order",
      {
        conversationContext: [
          { role: "assistant" as const, content: "Second" },
          { role: "user" as const, content: "First" }
        ]
      }
    ],
    ["analysis tier", { analysisTier: "deep" }],
    ["credit cost", { creditCost: 3 }]
  ])("changes the chat hash when %s changes", async (_label, override) => {
    const base = {
      filingKey: "filing-1",
      question: "Revenue?",
      conversationContext: [
        { role: "user" as const, content: "First" },
        { role: "assistant" as const, content: "Second" }
      ],
      analysisTier: null,
      creditCost: 2
    };

    expect(await buildChatRequestHash({ ...base, ...override })).not.toBe(await buildChatRequestHash(base));
  });

  it("does not include provider or execution configuration in a chat fingerprint", async () => {
    const input = {
      filingKey: "filing-1",
      question: "Revenue?",
      conversationContext: [],
      analysisTier: null,
      creditCost: 2
    };
    expect(await buildChatRequestHash(input)).toBe(await buildChatRequestHash({ ...input }));
  });

  it("binds translation text, source language, target language, and cost", async () => {
    const base = {
      text: "Revenue increased.",
      sourceLanguage: "en",
      targetLanguage: "ja",
      creditCost: 1
    };
    const hash = await buildQuoteTranslationRequestHash(base);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    await expect(buildQuoteTranslationRequestHash({ ...base, text: "Revenue fell." })).resolves.not.toBe(hash);
    await expect(buildQuoteTranslationRequestHash({ ...base, sourceLanguage: "fr" })).resolves.not.toBe(hash);
    await expect(buildQuoteTranslationRequestHash({ ...base, targetLanguage: "en" })).resolves.not.toBe(hash);
    await expect(buildQuoteTranslationRequestHash({ ...base, creditCost: 2 })).resolves.not.toBe(hash);
  });

  it("normalizes an omitted translation target to Japanese", async () => {
    const omitted = await buildQuoteTranslationRequestHash({ text: "Revenue", creditCost: 1 });
    const explicit = await buildQuoteTranslationRequestHash({
      text: "Revenue",
      sourceLanguage: null,
      targetLanguage: "ja",
      creditCost: 1
    });
    expect(omitted).toBe(explicit);
  });

  it("rejects values outside canonical JSON", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
  });
});
