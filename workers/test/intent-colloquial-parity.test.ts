import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isBusinessOverviewQuestion } from "../src/lib/chat/business-overview-question";
import { buildDeterministicMetricAnswer } from "../src/lib/chat/deterministic";
import { classifyQuestionIntent, type QuestionIntent } from "../src/lib/chat/intent";
import { analyzeQuestion } from "../src/clients/gemini/fallback-question";

/**
 * The paired benchmark runs 2026-08-22-post-constant-removal-canary-32 (clean
 * phrasing) and 2026-08-22-human-phrasing-canary-32 (colloquial phrasing) asked
 * the same tickers the same intents and differed only in wording. Q01 collapsed
 * on 6 of 8 tickers under 「この会社ってなにで稼いでんの？」 because the regex
 * intent layer had never learned the colloquial business-overview forms that the
 * production prompt itself names.
 *
 * These tests are phrased as parity between the two question sets rather than
 * against a hardcoded bench-label→code-intent map, so they keep holding if the
 * intent enum is renamed or re-partitioned.
 */

type BenchQuestion = {
  templateId: string;
  question: string;
  intent: string;
};

function readQuestions(path: string): BenchQuestion[] {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as BenchQuestion);
}

const CLEAN = readQuestions("testbench/questions/core-12.jsonl");
const COLLOQUIAL = readQuestions("testbench/questions/human-phrasing-12.jsonl");

const PAIRS = CLEAN.map((clean) => {
  const colloquial = COLLOQUIAL.find((row) => row.templateId === clean.templateId);
  if (!colloquial) {
    throw new Error(`human-phrasing-12 is missing ${clean.templateId}`);
  }
  return { templateId: clean.templateId, clean, colloquial };
});

/**
 * Enum-level parity does not hold for every template, and the gaps are not
 * business-overview gaps — they are separate recognizer holes in neighbouring
 * intents that this change deliberately does not touch, because widening those
 * patterns is exactly how a colloquial fix starts stealing intents. Each
 * exception pins the actual (clean, colloquial) pair, so it fails loudly if a
 * future change closes the gap (update the row) or, worse, closes it by
 * absorbing the question into business_overview.
 */
const ENUM_PARITY_EXCEPTIONS: Record<string, { clean: QuestionIntent; colloquial: QuestionIntent; why: string }> = {
  // 「売上どうだった？伸びてる？」 — 伸び is a change word, so the colloquial form
  // reaches the yoy_change branch before the plain revenue branch. Both sides
  // still route to revenue evidence; the split is snapshot vs change framing.
  Q02: { clean: "revenue_breakdown", colloquial: "yoy_change", why: "伸びてる？ adds a change signal the clean snapshot phrasing lacks" },
  // 「これは一時要因？それとも構造的な変化？」 carries 変化 plus 売上-less cause
  // wording; 「それ一時的なやつ？それともずっとこう？」 has neither, so it lands
  // in the generic reasoning bucket. Both are followups: the durability handling
  // that matters happens in resolveHardFinancialIntent, which agrees on both.
  Q06: { clean: "yoy_change", colloquial: "mda_summary", why: "followup without conversation context; margin durability is resolved downstream" },
  // 「前回決算と比べて大きく変わった点は？」 is claimed by the historical
  // comparison classifier; 「前とくらべて何が変わった？」 is not. A prior-filing
  // delta recognizer gap, unrelated to business overview.
  Q07: { clean: "historical_comparison", colloquial: "yoy_change", why: "前回決算 triggers historical comparison; 前と does not" },
  // 「どこの事業が調子いいの？」 classifies as unknown. This row is bait: a looser
  // どんな会社／事業 pattern would make it "agree" by absorbing it into
  // business_overview, which is precisely the capture the fix must avoid.
  // Q08 / Q10 / Q11 were pinned gaps until 2026-08-22 (どこの事業, 借金, やばい
  // added to the segment / liquidity / risk recognizers). They now agree and
  // are covered by the parity assertion like every other row.
};

const COLLOQUIAL_BUSINESS_QUESTION = "この会社ってなにで稼いでんの？";
const CASH_FLOW_QUESTION = "ちゃんとキャッシュ稼げてる？";

describe("colloquial phrasing parity with clean phrasing", () => {
  it("covers every template in both question sets", () => {
    expect(PAIRS).toHaveLength(12);
    expect(COLLOQUIAL).toHaveLength(12);
  });

  /**
   * The load-bearing assertion. Whether a question is a business-overview
   * question must not depend on how casually it is typed, at any of the three
   * classifier sites that decide which answer gets built.
   */
  it.each(PAIRS.map((pair) => [pair.templateId, pair.clean.question, pair.colloquial.question] as const))(
    "%s classifies the same as a business-overview question at every site",
    (_templateId, cleanQuestion, colloquialQuestion) => {
      // Site 1: the QuestionIntent classifier the context pack routes on.
      expect(classifyQuestionIntent(colloquialQuestion) === "business_overview").toBe(
        classifyQuestionIntent(cleanQuestion) === "business_overview"
      );
      // Site 2: the deterministic answerer's gate on buildBusinessOverviewAnswer.
      expect(isBusinessOverviewQuestion(colloquialQuestion)).toBe(isBusinessOverviewQuestion(cleanQuestion));
      // Site 3: the fallback layer's question profile.
      expect(analyzeQuestion(colloquialQuestion).asksBusinessOverview).toBe(
        analyzeQuestion(cleanQuestion).asksBusinessOverview
      );
    }
  );

  it("recognizes Q01 as a business-overview question under both phrasings, and only Q01", () => {
    for (const pair of PAIRS) {
      const expected = pair.templateId === "Q01";
      expect(isBusinessOverviewQuestion(pair.clean.question), `${pair.templateId} clean`).toBe(expected);
      expect(isBusinessOverviewQuestion(pair.colloquial.question), `${pair.templateId} colloquial`).toBe(expected);
    }
  });

  it.each(PAIRS.map((pair) => [pair.templateId, pair.clean.question, pair.colloquial.question] as const))(
    "%s resolves to the same QuestionIntent under both phrasings, or to a pinned known gap",
    (templateId, cleanQuestion, colloquialQuestion) => {
      const cleanIntent = classifyQuestionIntent(cleanQuestion);
      const colloquialIntent = classifyQuestionIntent(colloquialQuestion);
      const exception = ENUM_PARITY_EXCEPTIONS[templateId];
      if (exception) {
        expect({ clean: cleanIntent, colloquial: colloquialIntent }).toEqual({
          clean: exception.clean,
          colloquial: exception.colloquial
        });
        // Whatever the gap is, it is never closed by widening business overview.
        expect(colloquialIntent).not.toBe("business_overview");
        return;
      }
      expect(colloquialIntent).toBe(cleanIntent);
    }
  );
});

describe("colloquial business-overview guard", () => {
  it("routes 「この会社ってなにで稼いでんの？」 to business overview at all three sites", () => {
    expect(classifyQuestionIntent(COLLOQUIAL_BUSINESS_QUESTION)).toBe("business_overview");
    expect(isBusinessOverviewQuestion(COLLOQUIAL_BUSINESS_QUESTION)).toBe(true);
    expect(analyzeQuestion(COLLOQUIAL_BUSINESS_QUESTION).asksBusinessOverview).toBe(true);

    // Site 2's real entry point: the colloquial phrasing must reach the same
    // extraction-derived answer the clean phrasing gets from the same filing.
    const filing = makeSegmentedFiling();
    const colloquial = buildDeterministicMetricAnswer(filing, COLLOQUIAL_BUSINESS_QUESTION);
    const clean = buildDeterministicMetricAnswer(filing, "この会社は何で儲けている？");
    expect(colloquial?.strategy).toBe("business_overview");
    expect(colloquial?.response.answer).toBe(clean?.response.answer);
    expect(colloquial?.response.answer).toContain("クラウドサービス");
  });

  it.each([
    "この会社ってなにで稼いでんの？",
    "つまり何屋なの？",
    "どうやって稼いでるの？",
    "何で稼ぐ会社なの",
    "なにで稼いでる？",
    "この会社のビジネスモデルって？",
    "何してる会社？",
    "どんな会社なの？",
    "収益源はどこ？",
    "事業内容を教えて"
  ])("recognizes %s as a business-overview question", (question) => {
    expect(isBusinessOverviewQuestion(question)).toBe(true);
    expect(analyzeQuestion(question).asksBusinessOverview).toBe(true);
    expect(classifyQuestionIntent(question)).toBe("business_overview");
  });

  /**
   * The non-capture side. 稼 on its own is not a business-overview signal, and
   * business overview is checked before cash flow at both classifier sites, so a
   * leak here silently steals the cash-flow intent.
   */
  it("keeps 「ちゃんとキャッシュ稼げてる？」 out of business overview", () => {
    expect(isBusinessOverviewQuestion(CASH_FLOW_QUESTION)).toBe(false);
    expect(analyzeQuestion(CASH_FLOW_QUESTION).asksBusinessOverview).toBe(false);
    expect(classifyQuestionIntent(CASH_FLOW_QUESTION)).toBe("cash_flow");
    expect(buildDeterministicMetricAnswer(makeSegmentedFiling(), CASH_FLOW_QUESTION)?.strategy).not.toBe(
      "business_overview"
    );
  });

  /**
   * The cash veto only applies to phrasings the cash_flow branch actually
   * claims. Bare キャッシュ is not one of them, so vetoing it would strand this
   * question in unknown rather than routing it to cash flow; it keeps the
   * business-overview reading it had before this change.
   */
  it("leaves bare キャッシュ with an instrument interrogative where it already was", () => {
    expect(isBusinessOverviewQuestion("キャッシュを何で稼いでる？")).toBe(true);
    expect(classifyQuestionIntent("キャッシュを何で稼いでる？")).toBe("business_overview");
    expect(classifyQuestionIntent("キャッシュフローは何で稼いでる？")).toBe("cash_flow");
  });

  it.each([
    ["ちゃんとキャッシュ稼げてる？", "cash_flow"],
    ["お金はちゃんと稼げてる？", "cash_flow"],
    ["現金はどうやって稼いでる？", "cash_flow"],
    ["売上どうだった？伸びてる？", "yoy_change"],
    ["借金やばくない？大丈夫？", "liquidity_debt"],
    ["どこの事業が調子いいの？逆にダメなとこは？", "segment_analysis"]
  ])("does not absorb %s into business overview", (question, expectedIntent) => {
    expect(isBusinessOverviewQuestion(question)).toBe(false);
    expect(analyzeQuestion(question).asksBusinessOverview).toBe(false);
    expect(classifyQuestionIntent(question)).toBe(expectedIntent);
  });
  // 2026-08-22 LKG(human-phrasing-12x15 vs core-12x15): Q08 だけ経路が割れていた。
  it("routes the colloquial segment-performance question to the same deterministic answer", () => {
    const filing = makeSegmentedFiling();
    const colloquial = buildDeterministicMetricAnswer(filing, "どこの事業が調子いいの？逆にダメなとこは？");
    const clean = buildDeterministicMetricAnswer(filing, "どのセグメントや地域が伸びた？弱かった部分は？");
    expect(clean?.strategy).toBe("revenue_breakdown");
    expect(colloquial?.strategy).toBe(clean?.strategy);
    expect(colloquial?.response.answer).toBe(clean?.response.answer);
  });
});

function makeSegmentedFiling() {
  return {
    filingKey: "v6:0000789019:000078901926000001",
    ticker: "MSFT",
    companyName: "MICROSOFT CORP",
    cik: "0000789019",
    formType: "10-Q",
    filedAt: "2026-04-24",
    periodOfReport: "2026-03-31",
    primaryDocumentUrl: "https://example.com",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [
      {
        logicalName: "revenue",
        tagUsed: "RevenueFromContractWithCustomerExcludingAssessedTax",
        value: 81270000000,
        unit: "USD",
        periodEnd: "2026-03-31",
        comparisonValue: 69630000000,
        yoyPercent: 16.7
      }
    ],
    sourceChunks: [
      {
        sourceId: "S9",
        sectionType: "xbrl_metric",
        sectionTitle: "売上高",
        sourceLabel: "XBRL 売上高 (RevenueFromContractWithCustomerExcludingAssessedTax)",
        text: "売上高: 81270000000 USD / 比較値: 69630000000 / YoY: 16.7%",
        startOffset: 0,
        endOffset: 0,
        tagName: "RevenueFromContractWithCustomerExcludingAssessedTax",
        sortOrder: 9
      },
      {
        sourceId: "S1",
        sectionType: "md_a",
        sectionTitle: "Management discussion",
        sourceLabel: "10-Q Management discussion",
        text: "Management discusses cloud demand, advertising revenue, productivity software, LinkedIn and gaming, but this excerpt does not contain a full revenue table.",
        startOffset: 0,
        endOffset: 0,
        sortOrder: 1
      }
    ],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-04-30T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  } as any;
}
