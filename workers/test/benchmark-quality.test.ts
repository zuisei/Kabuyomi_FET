import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveHardIntentRetrievalMode } from "../src/lib/chat/hard-intent-retrieval";

// @ts-ignore testbench helper is an ESM script consumed by Node, not part of the TS Worker build.
const quality = await import("../testbench/scripts/benchmark-quality.mjs");
// @ts-ignore testbench helper is an ESM script consumed by Node, not part of the TS Worker build.
const benchmarkFields = await import("../testbench/scripts/benchmark-debug-fields.mjs");
// @ts-ignore testbench helper is an ESM script consumed by Node, not part of the TS Worker build.
const standardRelease = await import("../testbench/scripts/standard-release-profile.mjs");

describe("benchmark infra and quality metric separation", () => {
  it("preserves final-surface numeric proof fields in benchmark JSONL rows", () => {
    const proof = {
      semanticQualityLabels: ["q08_semantic_complete"],
      numericAlignmentInitialStatus: "repaired",
      numericAlignmentClaimBindings: [{ claimId: "claim-1", factId: "VF-1" }],
      numericAlignmentFinalSurfaceChecked: true,
      numericAlignmentFinalSurfaceStatus: "passed",
      numericAlignmentFinalSurfaceClaimCount: 1,
      numericAlignmentFinalSurfaceVerifiedClaimCount: 1,
      numericAlignmentFinalSurfaceBlockedClaimCount: 0,
      numericAlignmentFinalSurfaceAnswerHash: "d".repeat(64)
    };

    expect(benchmarkFields.extractBenchmarkProofFields(proof)).toEqual(proof);
  });

  it("fails unsupported concrete answers even when known product keywords look plausible", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        ticker: "AAPL",
        answer: "iPhoneとサービスが必ず伸びるので買い推奨です。",
        claimSourceJudge: { version: "claim-source-judge-v1", model: "fixed", overall: 2, factualAccuracy: 2, filingGrounding: 2, sourceRelevance: 2, followUpHandling: 2, fallbackAcceptability: 2 }
      })
    ]);
    const gate = quality.evaluateQualityGate(summary);
    expect(gate.ok).toBe(false);
    expect(summary.unsupportedInvestmentAdvice).toBe(1);
  });

  it("allows an unseen ticker when deterministic checks and calibrated judge scores pass", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        ticker: "UNSEENX",
        sourceIdsValid: true,
        answer: "提出資料では売上増の要因が説明されています。",
        claimSourceJudge: { version: "claim-source-judge-v1", model: "fixed", overall: 4.5, factualAccuracy: 4.5, filingGrounding: 4.5, sourceRelevance: 4.4, followUpHandling: 4.2, fallbackAcceptability: 4.0 }
      })
    ]);
    expect(quality.evaluateQualityGate(summary).ok).toBe(true);
  });

  it("treats unresolved numeric and period mismatch labels as critical regardless of formatting", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({ answer: "売上高は143.8億ドルです。", numericAlignmentStatus: "blocked", numericAlignmentLabels: ["unit_mismatch"] }),
      makeRow({ answer: "当期売上高は1,243億ドルです。", numericAlignmentStatus: "blocked", numericAlignmentLabels: ["period_mismatch"] })
    ]);
    expect(summary.materialNumericErrors).toBe(2);
    expect(summary.numericAlignmentBlockedRows).toBe(2);
    expect(quality.evaluateQualityGate(summary).ok).toBe(false);
  });

  it("fails repaired numeric mismatches without explicit final-surface proof", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        answer: "売上高は1,111.8億ドルです。",
        numericAlignmentStatus: "repaired",
        numericAlignmentLabels: ["unit_mismatch", "source_identity_repaired"]
      })
    ]);

    expect(summary.materialNumericErrors).toBe(1);
    expect(summary.unitCurrencyMismatches).toBe(1);
    expect(summary.numericAlignmentRepairedRows).toBe(1);
    expect(summary.numericAlignmentRepairedWithoutFinalProof).toBe(1);
    expect(quality.evaluateQualityGate(summary).ok).toBe(false);
  });

  it("accepts a repaired answer only with complete final-surface proof", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        answer: "売上高は1,111.8億ドルです。",
        numericAlignmentStatus: "repaired",
        numericAlignmentLabels: ["unit_mismatch", "source_identity_repaired"],
        numericAlignmentFinalSurfaceChecked: true,
        numericAlignmentFinalSurfaceStatus: "passed",
        numericAlignmentFinalSurfaceClaimCount: 1,
        numericAlignmentFinalSurfaceVerifiedClaimCount: 1,
        numericAlignmentFinalSurfaceBlockedClaimCount: 0,
        numericAlignmentFinalSurfaceAnswerHash: createHash("sha256").update("売上高は1,111.8億ドルです。").digest("hex")
      })
    ]);

    expect(summary.materialNumericErrors).toBe(0);
    expect(summary.numericAlignmentRepairedWithoutFinalProof).toBe(0);
    expect(quality.evaluateQualityGate(summary).ok).toBe(true);
  });

  it("uses filing industry metadata before auxiliary ticker classification", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({ ticker: "JPM", templateId: "Q09", intent: "cash_flow", industryClassification: { isBank: false }, answer: "預金と貸出の変動を見ます。" }),
      makeRow({ ticker: "NEWBANK", templateId: "Q09", intent: "cash_flow", industryClassification: { isBank: true }, answer: "預金と貸出の変動を見ます。" })
    ]);
    expect(summary.nonFinancialCashFlowBankLanguage).toBe(1);
  });

  it("fails Q07 unless it uses history, cites two filings, and avoids YoY masquerade", () => {
    const historicalSource = (filingKey: string, period: string, url: string) => ({
      sourceId: `${filingKey}:S9`,
      sourceKind: "historical_filing",
      sourceStrength: "filing_primary",
      sectionType: "historical_metric",
      sourceLabel: `10-Q filed ${period} · period ${period}`,
      excerpt: `売上高 (${period})`,
      sourceUrl: url
    });
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q07",
        templateId: "Q07",
        intent: "prior_filing_delta",
        responsePath: "openai",
        answer: "売上高は前年同期比15.7%増です。",
        sources: []
      }),
      makeRow({
        caseId: "MSFT-Q07",
        ticker: "MSFT",
        templateId: "Q07",
        intent: "prior_filing_delta",
        responsePath: "historical",
        answer: "対象期間2025-12-31と2025-09-30を比較しました。",
        sources: [historicalSource("v6:0000789019:current", "2025-12-31", "https://example.com/current")],
        timings: { historicalLookupMs: 12 }
      }),
      makeRow({
        caseId: "NVDA-Q07",
        ticker: "NVDA",
        templateId: "Q07",
        intent: "prior_filing_delta",
        responsePath: "historical",
        answer: "対象期間2025-12-31と2024-12-31を比較しました。",
        sources: [
          historicalSource("v6:0001045810:current", "2025-12-31", "https://example.com/current"),
          historicalSource("v6:0001045810:older", "2024-12-31", "https://example.com/older")
        ],
        timings: { historicalLookupMs: 12 }
      })
    ]);

    expect(summary.q07HistoricalLookupMissing).toBe(1);
    expect(summary.q07DistinctFilingSourcesMissing).toBe(2);
    expect(summary.q07YoYMasquerade).toBe(2);
    expect(summary.q07SourcePeriodMismatch).toBe(2);
    expect(summary.q07TypedClaimMappingMissing).toBe(3);
    expect(quality.evaluateQualityGate(summary).failures).toEqual(expect.arrayContaining([
      expect.stringContaining("q07HistoricalLookupMissing"),
      expect.stringContaining("q07DistinctFilingSourcesMissing"),
      expect.stringContaining("q07YoYMasquerade"),
      expect.stringContaining("q07SourcePeriodMismatch"),
      expect.stringContaining("q07TypedClaimMappingMissing")
    ]));
  });

  it("passes Q07 gate metrics for immediate-prior periods backed by two filings", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q07",
        templateId: "Q07",
        intent: "prior_filing_delta",
        responsePath: "historical",
        answer: "対象期間2025-12-27と直前の2025-06-28を比べると、売上高は前回比10.6%増加しました。",
        sources: [
          {
            sourceId: "v6:0000320193:current:S9",
            sourceKind: "historical_filing",
            sourceLabel: "10-Q filed 2026-01-30 · period 2025-12-27",
            sourceUrl: "https://example.com/current"
          },
          {
            sourceId: "v6:0000320193:prior:S9",
            sourceKind: "historical_filing",
            sourceLabel: "10-Q filed 2025-08-01 · period 2025-06-28",
            sourceUrl: "https://example.com/prior"
          }
        ],
        timings: { historicalLookupMs: 12 },
        numericAlignmentStatus: "passed",
        numericAlignmentClaimCount: 3,
        numericAlignmentVerifiedClaimCount: 3,
        numericAlignmentBlockedClaimCount: 0,
        numericAlignmentMatchedFactIds: ["VF-current", "VF-prior"]
      })
    ]);

    expect(summary.q07HistoricalLookupMissing).toBe(0);
    expect(summary.q07DistinctFilingSourcesMissing).toBe(0);
    expect(summary.q07YoYMasquerade).toBe(0);
    expect(summary.q07SourcePeriodMismatch).toBe(0);
    expect(summary.q07TypedClaimMappingMissing).toBe(0);
    expect(quality.evaluateQualityGate(summary).ok).toBe(true);
  });

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

  it("normalizes low_quality reason labels before applying counters", () => {
    expect(quality.normalizeQualityLabel("low_quality:contextual_reasoning_metric_only")).toBe(
      "contextual_reasoning_metric_only"
    );
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q03",
        templateId: "Q03",
        intent: "revenue_driver",
        answerQualityFlags: ["low_quality:contextual_reasoning_metric_only"]
      }),
      makeRow({
        caseId: "AAPL-Q04",
        templateId: "Q04",
        intent: "driver_durability_followup",
        answerQualityFlags: ["low_quality:durability_missing_assessment"]
      })
    ]);

    expect(summary.metricOnlyImportantIntentAnswers).toBe(1);
    expect(summary.unsupportedDurabilityClassification).toBe(1);
    expect(summary.lowQualityReasonBreakdown).toMatchObject({
      contextual_reasoning_metric_only: 1,
      durability_missing_assessment: 1
    });
  });

  it("requires complete Q08, Q09, and Q10 answers with returned-source mapping", () => {
    const evidence = [{
      sourceId: "S9",
      sourceLabel: "XBRL revenue",
      sectionType: "xbrl_metric",
      excerpt: "Revenue 100 USD; cash 20 USD; debt 10 USD"
    }];
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q08",
        templateId: "Q08",
        intent: "segment_driver",
        answer: "主な売上区分は製品別売上です。",
        sources: evidence
      }),
      makeRow({
        caseId: "AAPL-Q09",
        templateId: "Q09",
        intent: "cash_flow_quality",
        answer: "営業CFはプラスです。",
        sources: evidence
      }),
      makeRow({
        caseId: "AAPL-Q10",
        templateId: "Q10",
        intent: "liquidity_debt",
        answer: "負債に注意が必要です。",
        sources: evidence
      })
    ]);

    expect(summary.q08CompletenessMissing).toBe(1);
    expect(summary.q09CompletenessMissing).toBe(1);
    expect(summary.q10CompletenessMissing).toBe(1);
    expect(quality.evaluateQualityGate(summary).ok).toBe(false);
  });

  it("requires canonical runtime semantic-completeness labels when emitted", () => {
    const evidence = [{ sourceId: "S9", sourceLabel: "Typed evidence", sectionType: "xbrl_metric", excerpt: "cash debt revenue" }];
    const incomplete = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q08",
        templateId: "Q08",
        intent: "segment_driver",
        answer: "売上の柱は製品です。サービスは強く、その他は弱いです。",
        sources: evidence,
        semanticQualityLabels: [
          "q08_strong_dimension_source_backed",
          "q08_weak_dimension_source_backed",
          "q08_evidence_mapped"
        ]
      })
    ]);
    expect(incomplete.q08CompletenessMissing).toBe(1);

    const complete = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q09",
        templateId: "Q09",
        intent: "cash_flow_quality",
        answer: "営業CFは純利益を上回り、運転資本と設備投資後の余力も確認したため質は良好です。",
        sources: evidence,
        semanticQualityLabels: [
          "q09_operating_cash_flow_typed",
          "q09_compatible_net_income_compared",
          "q09_working_capital_assessed",
          "q09_capex_assessed",
          "q09_sign_safe",
          "q09_evidence_mapped",
          "q09_semantic_complete"
        ]
      })
    ]);
    expect(complete.q09CompletenessMissing).toBe(0);
    expect(complete.q09EvidenceMappingMissing).toBe(0);
  });

  it("accepts complete Q08, Q09, and Q10 answers with returned evidence", () => {
    const evidence = [{
      sourceId: "S9",
      sourceLabel: "XBRL revenue, cash and debt",
      sectionType: "xbrl_metric",
      excerpt: "Revenue 100 USD; cash 20 USD; debt 10 USD"
    }];
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q08",
        templateId: "Q08",
        intent: "segment_driver",
        answer: "売上の柱は製品セグメントです。サービスは成長して強く、その他製品は減少して弱い部分です。",
        sources: evidence
      }),
      makeRow({
        caseId: "AAPL-Q09",
        templateId: "Q09",
        intent: "cash_flow_quality",
        answer: "営業CFは純利益を上回り、利益を現金で裏付けているため質は良好です。",
        sources: evidence
      }),
      makeRow({
        caseId: "AAPL-Q10",
        templateId: "Q10",
        intent: "liquidity_debt",
        answer: "手元現金で負債返済を賄える余力があり、資金繰りの懸念は限定的です。",
        sources: evidence
      })
    ]);

    expect(summary.q08CompletenessMissing).toBe(0);
    expect(summary.q08EvidenceMappingMissing).toBe(0);
    expect(summary.q09CompletenessMissing).toBe(0);
    expect(summary.q09EvidenceMappingMissing).toBe(0);
    expect(summary.q10CompletenessMissing).toBe(0);
    expect(summary.q10EvidenceMappingMissing).toBe(0);
    expect(quality.evaluateQualityGate(summary).ok).toBe(true);
  });

  it("requires typed current/comparison margin direction and a cited Q05 factor", () => {
    const weak = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q05",
        templateId: "Q05",
        intent: "margin_driver",
        answer: "営業利益率は改善しました。",
        sources: [{ sourceId: "S9", sourceLabel: "XBRL operating margin", excerpt: "margin", sectionType: "xbrl_metric" }]
      })
    ]);
    expect(weak.q05TypedMarginDirectionMissing).toBe(1);
    expect(weak.q05CitedFactorMissing).toBe(1);

    const complete = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q05",
        templateId: "Q05",
        intent: "margin_driver",
        answer: "営業利益率は前期の28.0%から30.0%へ上昇しました。サービス構成比の上昇が押し上げ要因です。",
        sources: [{ sourceId: "S9", sourceLabel: "MD&A margin discussion", excerpt: "Service mix raised operating margin from 28% to 30%", sectionType: "md_a" }],
        numericAlignmentStatus: "passed",
        numericAlignmentClaimCount: 2,
        numericAlignmentVerifiedClaimCount: 2,
        numericAlignmentBlockedClaimCount: 0,
        numericAlignmentMatchedFactIds: ["VF-current", "VF-comparison"]
      })
    ]);
    expect(complete.q05TypedMarginDirectionMissing).toBe(0);
    expect(complete.q05CitedFactorMissing).toBe(0);
    expect(quality.evaluateQualityGate(complete).ok).toBe(true);
  });

  it("allows an explicit honest Q05 source-insufficient fallback", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q05",
        templateId: "Q05",
        intent: "margin_driver",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        fallbackCategory: "source_insufficient",
        fallbackUserReason: "margin_driver_sources_missing"
      })
    ]);
    expect(summary.q05TypedMarginDirectionMissing).toBe(0);
    expect(summary.q05CitedFactorMissing).toBe(0);
  });

  it("accepts a proof-complete bank Q05 recovery that explicitly declines an incomparable sales margin", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        ticker: "JPM",
        caseId: "JPM-Q05",
        templateId: "Q05",
        intent: "margin_driver",
        responsePath: "deterministic",
        answer: "選択された指標だけでは、売上高に対する利益率を同じ定義で計算できないため、利益率の改善・悪化は断定しません。純利益は比較期の146.4億ドルから当期の164.9億ドルへ増加しています。本文で確認できる利益要因は、人件費と法務費用の増加です。",
        sourceRepairLabels: ["margin_driver_deterministic_recovery"],
        sources: [
          {
            sourceId: "S10",
            sourceLabel: "XBRL 純利益 (NetIncomeLoss)",
            excerpt: "純利益: 16494000000 USD / 比較値: 14643000000",
            sectionType: "xbrl_metric"
          },
          {
            sourceId: "S8",
            sourceLabel: "10-Q margin and profitability discussion",
            excerpt: "Higher compensation expense and higher legal expense.",
            sectionType: "md_a"
          }
        ],
        numericAlignmentStatus: "passed",
        numericAlignmentClaimCount: 2,
        numericAlignmentVerifiedClaimCount: 2,
        numericAlignmentBlockedClaimCount: 0,
        numericAlignmentMatchedFactIds: ["VF-prior-net-income", "VF-current-net-income"]
      })
    ]);

    expect(summary.q05TypedMarginDirectionMissing).toBe(0);
    expect(summary.q05CitedFactorMissing).toBe(0);
  });

  it("does not let the bank Q05 recovery bypass proof, sector, narrative, or contradiction checks", () => {
    const proofComplete = {
      templateId: "Q05",
      intent: "margin_driver",
      responsePath: "deterministic",
      answer: "選択された指標だけでは、売上高に対する利益率を同じ定義で計算できないため、利益率の改善・悪化は断定しません。純利益は比較期の10億ドルから当期の12億ドルへ増加しています。本文で確認できる利益要因は、人件費の増加です。",
      sourceRepairLabels: ["margin_driver_deterministic_recovery"],
      sources: [
        {
          sourceId: "S10",
          sourceLabel: "XBRL 純利益 (NetIncomeLoss)",
          excerpt: "純利益: 1200000000 USD / 比較値: 1000000000",
          sectionType: "xbrl_metric"
        },
        {
          sourceId: "S8",
          sourceLabel: "10-Q profitability discussion",
          excerpt: "Higher compensation expense affected profit.",
          sectionType: "md_a"
        }
      ],
      numericAlignmentStatus: "passed",
      numericAlignmentClaimCount: 2,
      numericAlignmentVerifiedClaimCount: 2,
      numericAlignmentBlockedClaimCount: 0,
      numericAlignmentMatchedFactIds: ["VF-prior", "VF-current"]
    };
    const summary = quality.buildBenchmarkSummary([
      makeRow({ ...proofComplete, ticker: "AAPL", caseId: "AAPL-Q05-wrong-sector" }),
      makeRow({
        ...proofComplete,
        ticker: "JPM",
        caseId: "JPM-Q05-missing-proof",
        numericAlignmentStatus: "not_applicable",
        numericAlignmentClaimCount: 0,
        numericAlignmentVerifiedClaimCount: 0,
        numericAlignmentMatchedFactIds: []
      }),
      makeRow({
        ...proofComplete,
        ticker: "JPM",
        caseId: "JPM-Q05-no-narrative",
        sources: [proofComplete.sources[0]]
      }),
      makeRow({
        ...proofComplete,
        ticker: "JPM",
        caseId: "JPM-Q05-contradictory",
        answer: `${proofComplete.answer} 営業利益率は改善しました。`
      })
    ]);

    expect(summary.q05TypedMarginDirectionMissing).toBe(4);
    expect(quality.evaluateQualityGate(summary).failures).toEqual(
      expect.arrayContaining([expect.stringContaining("q05TypedMarginDirectionMissing=4")])
    );
  });

  it("does not penalize a deterministic hard-follow-up that explicitly preserves evidence insufficiency", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q04",
        templateId: "Q04",
        intent: "driver_durability_followup",
        responsePath: "deterministic",
        answer: "前問で挙がっていた売上要因候補は、iPhoneとサービス売上です。ただし、この資料だけでは一時要因か継続要因かは断定しません。次に見るべき指標は、製品別売上です。",
        sourceIdsValid: true,
        sources: [{ sourceId: "S1", sourceLabel: "10-Q product performance", excerpt: "iPhone and Services net sales", sectionType: "md_a" }],
        sourceGateApplied: true,
        sourceGateSufficient: false,
        sourceGateFailureLabels: ["durability_context_missing", "source_gate_failed"],
        sourceRepairLabels: [
          "q04_previous_answer_driver_candidate_repair",
          "hard_intent_explicit_insufficiency_repair"
        ]
      }),
      makeRow({
        caseId: "AAPL-Q06",
        templateId: "Q06",
        intent: "margin_durability_followup",
        responsePath: "deterministic",
        answer: "前問の利益率要因候補は、サービス構成比です。ただし、この資料だけでは一時要因か構造的変化かは断定しません。次に見るべき指標は、サービス粗利率です。",
        sourceIdsValid: true,
        sources: [{ sourceId: "S2", sourceLabel: "10-Q margin discussion", excerpt: "Services mix increased gross profit and operating margin during the period.", sectionType: "md_a" }],
        sourceGateApplied: true,
        sourceGateSufficient: false,
        sourceGateFailureLabels: ["missing_margin_durability_context", "source_gate_failed"],
        sourceRepairLabels: [
          "q06_previous_answer_margin_candidate_repair",
          "hard_intent_explicit_insufficiency_repair"
        ]
      })
    ]);

    expect(summary.q03Q04Q06FinalEvidenceMissing).toBe(0);
    expect(summary.qualitySourceEvidenceWeak).toBe(0);
    expect(summary.qualityQ03Q04Q06Fallback).toBe(0);
    expect(summary.qualityHardIntentFallback).toBe(0);
  });

  it("rejects explicit hard-intent insufficiency on generic gate failure or irrelevant evidence", () => {
    const base = {
      templateId: "Q04",
      intent: "driver_durability_followup",
      responsePath: "deterministic",
      answer: "前問で挙がっていた売上要因候補は、iPhoneとサービス売上です。ただし、この資料だけでは一時要因か継続要因かは断定しません。",
      sourceIdsValid: true,
      sourceGateApplied: true,
      sourceGateSufficient: false,
      sourceRepairLabels: [
        "q04_previous_answer_driver_candidate_repair",
        "hard_intent_explicit_insufficiency_repair"
      ]
    };
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        ...base,
        caseId: "AAPL-Q04-generic",
        sourceGateFailureLabels: ["source_gate_failed"],
        sources: [{
          sourceId: "S1",
          sourceLabel: "10-Q revenue discussion",
          sectionType: "md_a",
          excerpt: "iPhone and Services net sales increased during the period."
        }]
      }),
      makeRow({
        ...base,
        caseId: "AAPL-Q04-irrelevant",
        sourceGateFailureLabels: ["durability_context_missing", "source_gate_failed"],
        sources: [{
          sourceId: "S2",
          sourceLabel: "10-K governance exhibit",
          sectionType: "other",
          excerpt: "The board maintains committees under its corporate governance guidelines."
        }]
      })
    ]);

    expect(summary.q03Q04Q06FinalEvidenceMissing).toBe(2);
    expect(summary.qualitySourceEvidenceWeak).toBe(2);
    expect(quality.evaluateQualityGate(summary).failures).toEqual(expect.arrayContaining([
      expect.stringContaining("q03Q04Q06FinalEvidenceMissing=2"),
      expect.stringContaining("qualitySourceEvidenceWeak=2")
    ]));
  });

  it("fails inconsistent fallback taxonomy tuples", () => {
    const summary = quality.buildBenchmarkSummary([
      makeRow({
        caseId: "AAPL-Q03",
        responsePath: "openai",
        fallbackKind: "none",
        fallbackCategory: "source_insufficient",
        fallbackUserReason: "revenue_driver_sources_missing",
        evidenceFallbackUsed: true
      }),
      makeRow({
        caseId: "AAPL-Q04",
        responsePath: "fallback",
        fallbackReason: "low_quality_answer",
        fallbackKind: "evidence_slot",
        fallbackKindSource: "model_quality_control",
        fallbackCategory: "answer_quality_guard",
        fallbackUserReason: "revenue_driver_sources_missing"
      })
    ]);

    expect(summary.fallbackTaxonomyTupleMismatch).toBe(2);
    expect(quality.evaluateQualityGate(summary).failures).toEqual(
      expect.arrayContaining([expect.stringContaining("fallbackTaxonomyTupleMismatch")])
    );
  });

  it("requires full judge coverage unless a verified complete human review is supplied", () => {
    const unjudged = makeRow({ claimSourceJudge: null });
    const missing = quality.buildBenchmarkSummary([unjudged]);
    expect(missing.evaluationCoverageMode).toBe("missing");
    expect(quality.evaluateQualityGate(missing).failures).toEqual(
      expect.arrayContaining([expect.stringContaining("evaluationCoverageMissing")])
    );

    const manuallyReviewed = quality.buildBenchmarkSummary([unjudged], {
      calibratedAlternative: {
        type: "complete_human_review_v2",
        verified: true,
        reviewedRows: 1,
        sourceRunSha256: "b".repeat(64),
        reviewContentSha256: "c".repeat(64),
        reviewer: "release-reviewer",
        signedAt: "2026-07-12T12:00:00.000Z"
      }
    });
    expect(manuallyReviewed.evaluationCoverageMode).toBe("complete_human_review_v2");
    expect(quality.evaluateQualityGate(manuallyReviewed).ok).toBe(true);
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

  it("does not let lowered diagnostic env thresholds weaken the standard release profile", () => {
    const fixture = JSON.parse(readFileSync("testbench/company-sets/prompt-v2-expanded-multisector.json", "utf8"));
    const diagnosticThresholds = quality.qualityGateThresholdsFromEnv({
      KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES: "Q01",
      KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS: "1",
      KABUYOMI_QUALITY_GATE_MIN_ROWS: "1",
      KABUYOMI_QUALITY_GATE_MAX_FALLBACK_RATE: "1",
      KABUYOMI_QUALITY_GATE_MAX_Q03_Q04_Q06_FALLBACK: "150",
      KABUYOMI_QUALITY_GATE_MAX_HARD_INTENT_FALLBACK: "150"
    });
    const releaseThresholds = standardRelease.applyStandardReleaseProfile(diagnosticThresholds);
    const oneRow = quality.buildBenchmarkSummary([makeRow({ templateId: "Q01", intent: "business_model" })]);
    const gate = quality.evaluateQualityGate(oneRow, releaseThresholds);

    expect(releaseThresholds.minRows).toBe(150);
    expect(releaseThresholds.exactRows).toBe(150);
    expect(releaseThresholds.requiredTemplates).toEqual([
      "Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08", "Q09", "Q10"
    ]);
    expect(releaseThresholds.exactTickers).toEqual([
      "AAPL", "JPM", "XOM", "CAT", "WMT", "NVDA", "MU", "MSFT", "GOOGL", "AMZN", "TSLA", "LLY", "V", "KO", "DAL"
    ]);
    expect(releaseThresholds.exactTickers).toEqual(fixture.tickers);
    expect(gate.ok).toBe(false);
    expect(gate.failures).toEqual(expect.arrayContaining([
      "rows=1 < 150",
      "rows=1 != 150",
      "templateSetMismatch=standard_release_profile",
      "tickerSetMismatch=standard_release_profile"
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
    sourceCount: 1,
    sources: [{
      sourceId: "S1",
      sourceLabel: "SEC filing evidence",
      sectionType: "md_a",
      excerpt: "Management discussion and analysis"
    }],
    latencyMs: 100,
    failureLabelsObserved: [],
    answerQualityFlags: [],
    sourceGateFailureLabels: [],
    bannedFallbackPhraseHits: [],
    claimSourceJudge: {
      version: "claim-source-judge-v1",
      model: "fixed-test-judge",
      overall: 5,
      factualAccuracy: 5,
      filingGrounding: 5,
      sourceRelevance: 5,
      followUpHandling: 5,
      fallbackAcceptability: 5
    },
    ...overrides
  };
}
