import assert from "node:assert/strict";
import test from "node:test";
import { mergeAutomatedDiscoveryModel } from "../src/discovery.ts";

const automatic = {
  id: "11111111-1111-4111-8111-111111111111",
  summaryJA: "自動取得・未分析",
  topics: ["自動分類"],
  coverageState: "metadata_only",
  eventVerificationState: "source_verified",
  policyDomain: { slug: "trade-tariffs", labelJA: "貿易・関税" },
  importantClauses: [],
  tickers: [], exposures: [], marketSummaries: [], marketSeries: [], confounders: [], correctionNotes: [],
  confounderReviewState: "unreviewed",
  documents: [{ id: "new-document" }]
};

test("scheduled discovery preserves human editorial and market work while refreshing source documents", () => {
  const prior = {
    ...automatic,
    summaryJA: "人間が確認した要約",
    topics: ["確認済み分類"],
    coverageState: "market_mapped",
    eventVerificationState: "analyst_verified",
    policyDomain: { slug: "export-controls-sanctions", labelJA: "輸出管理・制裁" },
    importantClauses: [{ id: "clause", textJA: "重要条項", sourceURL: "https://example.test/clause" }],
    tickers: ["NVDA"],
    exposures: [{ id: "exposure" }],
    marketSummaries: [{ ticker: "NVDA" }],
    marketSeries: [{ timestamp: "2026-07-21T00:00:00Z" }],
    confounders: [{ id: "confounder" }],
    confounderReviewState: "verified"
  };
  const merged = mergeAutomatedDiscoveryModel(automatic, prior);
  assert.equal(merged.summaryJA, prior.summaryJA);
  assert.equal(merged.coverageState, "market_mapped");
  assert.deepEqual(merged.tickers, ["NVDA"]);
  assert.deepEqual(merged.confounders, [{ id: "confounder" }]);
  assert.deepEqual(merged.documents, [{ id: "new-document" }]);
});

test("scheduled discovery corrects stale automatic verification when no human review exists", () => {
  const merged = mergeAutomatedDiscoveryModel(automatic, {
    ...automatic,
    eventVerificationState: "source_verified",
    timelineItems: [{ verificationState: "humanVerified" }]
  });
  assert.equal(merged.coverageState, "metadata_only");
  assert.equal(merged.eventVerificationState, "source_verified");
  assert.equal(merged.confounderReviewState, "unreviewed");
});
