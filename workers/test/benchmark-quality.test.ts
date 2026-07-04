import { describe, expect, it } from "vitest";
import { resolveHardIntentRetrievalMode } from "../src/lib/chat/hard-intent-retrieval";

// @ts-ignore testbench helper is an ESM script consumed by Node, not part of the TS Worker build.
const quality = await import("../testbench/scripts/benchmark-quality.mjs");

describe("benchmark infra and quality metric separation", () => {
  it("marks rate_limit rows as infra errors and excludes them from quality metrics", () => {
    const row = quality.decorateBenchmarkRow(makeRow({ geminiApiErrorKind: "rate_limit" }));

    expect(row.infraError).toBe(true);
    expect(row.infraErrorKind).toBe("rate_limit");
    expect(row.qualityEvaluable).toBe(false);
    expect(row.excludedFromQualityMetricsReason).toBe("rate_limit");
  });

  it("counts rate_limit fallback rows in raw fallback but not quality fallback", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({ caseId: "AAPL-Q03", responsePath: "fallback", fallbackKind: "api_error", geminiApiErrorKind: "rate_limit" }),
      makeRow({ caseId: "AAPL-Q04", responsePath: "fallback", fallbackKind: "evidence_slot" }),
      makeRow({ caseId: "AAPL-Q05", responsePath: "gemini", fallbackKind: "none" })
    ]);

    expect(summary.rawFallbackTotal).toBe(2);
    expect(summary.qualityRows).toBe(2);
    expect(summary.qualityFallbackTotal).toBe(1);
    expect(summary.rateLimitRows).toBe(1);
  });

  it("marks a run infra contaminated when rate limits exceed the threshold", () => {
    const summary = quality.buildBenchmarkSummary(
      [
        makeRow({ caseId: "AAPL-Q01", geminiApiErrorKind: "rate_limit" }),
        makeRow({ caseId: "AAPL-Q02", geminiApiErrorKind: "rate_limit" }),
        makeRow({ caseId: "AAPL-Q03", geminiApiErrorKind: "rate_limit" }),
        makeRow({ caseId: "AAPL-Q04", geminiApiErrorKind: "rate_limit" })
      ],
      { rateLimitThreshold: 3 }
    );

    expect(summary.infraContaminated).toBe(true);
    expect(summary.infraContaminationReasons).toContain("rate_limit_rows>3");
  });

  it("keeps retry-success rows quality evaluable while preserving retry audit fields", () => {
    const row = quality.decorateBenchmarkRow(
      makeRow({
        benchmarkAttemptCount: 2,
        benchmarkRateLimitRetryCount: 1,
        benchmarkRateLimitBackoffMsTotal: 5000,
        rateLimitRetrySucceeded: true
      })
    );
    const summary = quality.buildBenchmarkSummary([row]);

    expect(row.qualityEvaluable).toBe(true);
    expect(row.rateLimitRetrySucceeded).toBe(true);
    expect(summary.qualityRows).toBe(1);
    expect(summary.rateLimitRetrySucceeded).toBe(1);
    expect(summary.benchmarkRateLimitRetryCount).toBe(1);
  });

  it("excludes retry-failure rows after all rate-limit attempts", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        responsePath: "fallback",
        fallbackKind: "api_error",
        geminiApiErrorKind: "rate_limit",
        benchmarkAttemptCount: 3,
        benchmarkRateLimitRetryCount: 2,
        rateLimitRetrySucceeded: false
      })
    ]);

    expect(summary.rawFallbackTotal).toBe(1);
    expect(summary.qualityRows).toBe(0);
    expect(summary.qualityFallbackTotal).toBe(0);
    expect(summary.rateLimitRows).toBe(1);
  });

  it("treats auth_error as infra contamination, not answer quality failure", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({ responsePath: "fallback", fallbackKind: "api_error", geminiApiErrorKind: "auth_error" })
    ]);

    expect(summary.authErrorRows).toBe(1);
    expect(summary.infraContaminated).toBe(true);
    expect(summary.qualityRows).toBe(0);
    expect(summary.qualityFallbackTotal).toBe(0);
  });

  it("summarizes fallback taxonomy breakdowns without removing old fallback fields", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        responsePath: "fallback",
        fallbackKind: "evidence_slot",
        fallbackReason: "low_quality_answer",
        fallbackCategory: "source_insufficient",
        fallbackUserReason: "revenue_driver_sources_missing"
      }),
      makeRow({
        responsePath: "fallback",
        fallbackKind: "language_guard_fallback",
        fallbackReason: "low_quality_answer",
        fallbackCategory: "language_guard",
        fallbackUserReason: "raw_english_detected"
      })
    ]);

    expect(summary.rawFallbackReasonBreakdown.low_quality_answer).toBe(2);
    expect(summary.fallbackCategoryBreakdown.source_insufficient).toBe(1);
    expect(summary.fallbackCategoryBreakdown.language_guard).toBe(1);
    expect(summary.fallbackUserReasonBreakdown.revenue_driver_sources_missing).toBe(1);
    expect(summary.fallbackUserReasonBreakdown.raw_english_detected).toBe(1);
  });

  it("separates user-visible raw English from diagnostic/source-repair raw English", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        answer: "修復後の回答は日本語です。",
        finalAnswerLanguageLabels: ["raw_english_excerpt", "answer_repaired_to_japanese"],
        languageGuardOk: true
      }),
      makeRow({
        answer: "前問の具体的な要因を十分に特定できていないため、この資料だけで一時要因か継続要因かは分類しません。",
        finalAnswerRawExcerptLike: true,
        finalAnswerLanguageLabels: ["raw_english_excerpt", "answer_rewritten_to_japanese_fallback"],
        languageGuardOk: false
      }),
      makeRow({
        answer: "This answer copied a full English source sentence into the final user response.",
        finalAnswerRawExcerptLike: true,
        languageGuardOk: false
      })
    ]);

    expect(summary.rawEnglishInDiagnostics).toBe(2);
    expect(summary.rawEnglishInAnswer).toBe(1);
    expect(summary.rawEnglishSurfaced).toBe(1);
  });

  it("counts prompt-v2 visible quality failures without suppressing diagnostics", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q01",
        templateId: "Q01",
        intent: "business_overview",
        answer: "Appleは主に製品とサービスの提供を通じて収益を得ています。"
      }),
      makeRow({
        caseId: "CAT-Q03",
        templateId: "Q03",
        intent: "revenue_driver",
        answer: "higher 稼働率 expense が要因です。"
      }),
      makeRow({
        caseId: "MU-Q03",
        templateId: "Q03",
        intent: "revenue_driver",
        answer: "売上高は増加しました。税金費用が売上変化の要因として説明されています。"
      }),
      makeRow({
        caseId: "KO-Q02",
        templateId: "Q02",
        intent: "revenue_snapshot",
        answer: "主な売上区分は地域別売上です。大きい区分は地域別売上です。"
      }),
      makeRow({
        caseId: "GOOGL-Q08",
        templateId: "Q08",
        intent: "segment_driver",
        answer: "主な売上区分は Google Services と Google Cloud。大きい区分は Google Services で、YouTube ads は成長、Google Network は減少です。"
      }),
      makeRow({
        caseId: "DAL-Q08",
        templateId: "Q08",
        intent: "segment_driver",
        answer: "主な売上区分は Passenger revenue、Cargo、Other。Premium products と loyalty 需要がPassenger revenueを押し上げました。"
      }),
      makeRow({
        caseId: "AAPL-Q09",
        templateId: "Q09",
        intent: "cash_flow",
        answer: "営業CFはプラスですが、金融機関では預金や貸出の変動も見る必要があります。"
      }),
      makeRow({
        caseId: "WMT-Q04",
        templateId: "Q04",
        intent: "driver_durability_followup",
        answer: "前問の具体的な要因を十分に特定できていないため、この資料だけで一時要因か継続要因かは分類しません。"
      }),
      makeRow({
        caseId: "CAT-Q06",
        templateId: "Q06",
        intent: "margin_durability_followup",
        sourceGateFailureLabels: ["unsupported_durability_classification"]
      }),
      makeRow({
        caseId: "LLY-Q10",
        templateId: "Q10",
        intent: "liquidity_debt",
        finalAnswerLanguageLabels: ["unsupported_liquidity_conclusion"]
      }),
      makeRow({
        caseId: "CAT-Q03",
        templateId: "Q03",
        intent: "revenue_driver",
        sourceGateApplied: true,
        sourceGateSufficient: false,
        sourceGateFailureLabels: ["source_gate_failed", "sector_required_source_missing"]
      }),
      makeRow({
        caseId: "CAT-Q06",
        templateId: "Q06",
        intent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackKind: "evidence_slot",
        fallbackUserReason: "revenue_driver_sources_missing"
      }),
      makeRow({
        caseId: "JPM-Q05",
        templateId: "Q05",
        intent: "margin_driver",
        answerQualityFlags: ["answer_too_metric_only"]
      }),
      makeRow({
        caseId: "JPM-Q02",
        templateId: "Q02",
        intent: "revenue_snapshot",
        answer: "売上高は1,000億円です。"
      }),
      makeRow({
        caseId: "AAPL-Q12",
        templateId: "Q12",
        intent: "watch_points",
        responsePath: "fallback",
        fallbackKind: "none"
      })
    ]);

    expect(summary.genericBusinessModelAnswers).toBe(1);
    expect(summary.hybridEnglishJapaneseSurfaced).toBe(1);
    expect(summary.genericRevenueBreakdownAnswers).toBe(1);
    expect(summary.misleadingRevenueDriverCauses).toBe(1);
    expect(summary.nonFinancialCashFlowBankLanguage).toBe(1);
    expect(summary.durabilityFollowupLostPriorDriver).toBe(2);
    expect(summary.metricOnlyImportantIntentAnswers).toBe(1);
    expect(summary.numericDisplaySuspicious).toBe(1);
    expect(summary.unsupportedDurabilityClassification).toBe(1);
    expect(summary.unsupportedRiskOrLiquidityConclusion).toBe(1);
    expect(summary.qualitySourceEvidenceWeak).toBe(1);
    expect(summary.fallbackTaxonomyIntentMismatch).toBe(1);
    expect(summary.fallbackKindNoneOnFallbackRows).toBe(1);
  });

  it("does not count repaired language-guard labels as visible hybrid English", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q06",
        templateId: "Q06",
        intent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackKind: "language_guard_fallback",
        fallbackUserReason: "raw_english_detected",
        finalAnswerLanguageLabels: [
          "hybrid_english_business_phrase",
          "final_answer_language_violation",
          "answer_rewritten_to_japanese_fallback"
        ],
        answer: "利益率の方向は確認できますが、具体的な利益率要因は十分に特定できません。判断には、コスト、製品構成、価格、営業費用、引当金、セグメント利益率などの説明が必要です。"
      })
    ]);

    expect(summary.hybridEnglishJapaneseSurfaced).toBe(0);
  });

  it("fails the prompt-v2 quality gate on visible quality regressions", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q04",
        templateId: "Q04",
        intent: "driver_durability_followup",
        responsePath: "fallback",
        answer: "前問の具体的な要因を十分に特定できていないため、この資料だけで一時要因か継続要因かは分類しません。"
      }),
      makeRow({
        caseId: "AAPL-Q09",
        templateId: "Q09",
        intent: "cash_flow",
        answer: "営業CFはプラスですが、金融機関では預金や貸出の変動も見る必要があります。"
      }),
      makeRow({
        caseId: "MU-Q03",
        templateId: "Q03",
        intent: "revenue_driver",
        answer: "売上高は増加しました。TACと税金費用が売上変化の要因です。"
      }),
      makeRow({
        caseId: "KO-Q02",
        templateId: "Q02",
        intent: "revenue_snapshot",
        answer: "主な売上区分は geography revenue で、大きい区分も geography revenue です。"
      }),
      makeRow({
        caseId: "CAT-Q06",
        templateId: "Q06",
        intent: "margin_durability_followup",
        sourceGateFailureLabels: ["unsupported_durability_classification"]
      }),
      makeRow({
        caseId: "LLY-Q10",
        templateId: "Q10",
        intent: "liquidity_debt",
        finalAnswerLanguageLabels: ["unsupported_liquidity_conclusion"]
      }),
      makeRow({
        caseId: "CAT-Q03",
        templateId: "Q03",
        intent: "revenue_driver",
        sourceGateApplied: true,
        sourceGateSufficient: false,
        sourceGateFailureLabels: ["source_gate_failed"]
      }),
      makeRow({
        caseId: "CAT-Q06",
        templateId: "Q06",
        intent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackKind: "evidence_slot",
        fallbackUserReason: "risk_sources_missing"
      }),
      makeRow({
        caseId: "AAPL-Q12",
        templateId: "Q12",
        intent: "watch_points",
        responsePath: "fallback",
        fallbackKind: "none"
      })
    ]);
    const gate = quality.evaluateQualityGate(summary);

    expect(gate.ok).toBe(false);
    expect(gate.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("nonFinancialCashFlowBankLanguage"),
      expect.stringContaining("genericRevenueBreakdownAnswers"),
      expect.stringContaining("misleadingRevenueDriverCauses"),
      expect.stringContaining("durabilityFollowupLostPriorDriver"),
      expect.stringContaining("unsupportedDurabilityClassification"),
      expect.stringContaining("unsupportedRiskOrLiquidityConclusion"),
      expect.stringContaining("qualitySourceEvidenceWeak"),
      expect.stringContaining("fallbackTaxonomyIntentMismatch"),
      expect.stringContaining("fallbackKindNoneOnFallbackRows"),
      expect.stringContaining("qualityQ03Q04Q06Fallback")
    ]));
  });

  it("collects representative rows for strict quality issue counters", () => {
    const rows = [
      makeRow({
        caseId: "AAPL-Q04",
        templateId: "Q04",
        intent: "driver_durability_followup",
        responsePath: "fallback",
        fallbackKind: "evidence_slot",
        fallbackUserReason: "revenue_driver_sources_missing",
        answer: "前問の具体的な要因を十分に特定できていないため、この資料だけで一時要因か継続要因かは分類しません。"
      }),
      makeRow({
        caseId: "AAPL-Q09",
        templateId: "Q09",
        intent: "cash_flow",
        answer: "営業CFはプラスですが、金融機関では預金や貸出の変動も見る必要があります。"
      }),
      makeRow({
        caseId: "GOOGL-Q08",
        templateId: "Q08",
        intent: "segment_driver",
        answer: "主な売上区分は Google Services と Google Cloud。"
      }),
      makeRow({
        caseId: "CAT-Q03",
        templateId: "Q03",
        intent: "revenue_driver",
        sourceGateApplied: true,
        sourceGateSufficient: false,
        sourceGateFailureLabels: ["source_gate_failed"],
        answer: "売上高は伸びましたが、根拠sourceが不足しています。"
      }),
      makeRow({
        caseId: "CAT-Q06",
        templateId: "Q06",
        intent: "margin_durability_followup",
        responsePath: "fallback",
        fallbackKind: "evidence_slot",
        fallbackUserReason: "revenue_driver_sources_missing",
        answer: "利益率要因なのに売上driver不足として分類されています。"
      })
    ];

    const issueRows = quality.collectQualityIssueRows(rows);

    expect(issueRows.durabilityFollowupLostPriorDriver.map((row: { caseId: string }) => row.caseId)).toEqual(["AAPL-Q04"]);
    expect(issueRows.qualityQ03Q04Q06Fallback.map((row: { caseId: string }) => row.caseId)).toEqual(["AAPL-Q04", "CAT-Q06"]);
    expect(issueRows.qualityHardIntentFallback.map((row: { caseId: string }) => row.caseId)).toEqual(["AAPL-Q04", "CAT-Q06"]);
    expect(issueRows.nonFinancialCashFlowBankLanguage.map((row: { caseId: string }) => row.caseId)).toEqual(["AAPL-Q09"]);
    expect(issueRows.genericRevenueBreakdownAnswers).toEqual([]);
    expect(issueRows.qualitySourceEvidenceWeak.map((row: { caseId: string }) => row.caseId)).toEqual(["CAT-Q03"]);
    expect(issueRows.fallbackTaxonomyIntentMismatch.map((row: { caseId: string }) => row.caseId)).toEqual(["CAT-Q06"]);
  });

  it("passes the prompt-v2 quality gate when strict visible-failure counters are clean", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q01",
        templateId: "Q01",
        intent: "business_overview",
        responsePath: "openai",
        answer: "Appleは、iPhone、Mac、iPad、サービスを主な収益源とする会社です。"
      }),
      makeRow({
        caseId: "AAPL-Q04",
        templateId: "Q04",
        intent: "driver_durability_followup",
        responsePath: "openai",
        answer: "前問の売上要因候補はサービス売上です。ただし、継続性は次期のサービス売上と製品需要を見て判断します。"
      })
    ]);
    const gate = quality.evaluateQualityGate(summary);

    expect(gate.ok).toBe(true);
    expect(gate.failures).toEqual([]);
  });

  it("can enforce final-run coverage for required templates and ticker count", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({ ticker: "AAPL", templateId: "Q01", intent: "business_overview" }),
      makeRow({ ticker: "JPM", templateId: "Q03", intent: "revenue_driver" })
    ]);
    const gate = quality.evaluateQualityGate(summary, {
      ...quality.DEFAULT_QUALITY_GATE_THRESHOLDS,
      requiredTemplates: ["Q01", "Q02", "Q03", "Q08", "Q09"],
      minCompanyTickers: 3,
      minRows: 3
    });

    expect(gate.ok).toBe(false);
    expect(gate.failures).toEqual(expect.arrayContaining([
      "requiredTemplatesMissing=Q02,Q08,Q09",
      "companyTickers=2 < 3",
      "rows=2 < 3"
    ]));
  });

  it("keeps active hard retrieval disabled by default", () => {
    expect(resolveHardIntentRetrievalMode(undefined)).not.toBe("active");
  });
});

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    caseId: "AAPL-Q03",
    ticker: "AAPL",
    templateId: "Q03",
    intent: "revenue_driver",
    responsePath: "gemini",
    fallbackKind: "none",
    sourceIdsValid: true,
    latencyMs: 100,
    failureLabelsObserved: [],
    answerQualityFlags: [],
    sourceGateFailureLabels: [],
    bannedFallbackPhraseHits: [],
    ...overrides
  };
}
