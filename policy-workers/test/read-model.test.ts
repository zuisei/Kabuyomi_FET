import assert from "node:assert/strict";
import test from "node:test";
import { buildReadModel, type ProcessorIngestInput } from "../src/processor/read-model.ts";

function input(overrides: Partial<ProcessorIngestInput> = {}): ProcessorIngestInput {
  return {
    sourceCode: "FR",
    externalID: "2026-00001",
    sourceURL: "https://www.federalregister.gov/documents/2026/07/21/2026-00001/example",
    eventID: "11111111-1111-4111-8111-111111111111",
    documentID: "22222222-2222-4222-8222-222222222222",
    documentNumber: "2026-00001",
    revisionNumber: 1,
    documentType: "final_rule",
    relationship: "primary",
    titleJA: "試験規則",
    titleEN: "Test rule",
    publisherJA: "連邦官報",
    publisherEN: "Federal Register",
    publishedOn: "2026-07-21",
    availableAt: "2026-07-21T00:00:00Z",
    availabilityBasis: "publication_date_only",
    timePrecision: "day",
    bodyText: "Official body",
    displayBodyJA: "試験本文",
    displayBodyEN: "Official body",
    firstObservedAt: "2026-07-21T03:00:00Z",
    ...overrides
  };
}

test("date-only manual ingest never invents an official publication timestamp", () => {
  const model = buildReadModel(input(), null, "a".repeat(64));
  assert.equal(model.publishedAt, null);
  assert.equal(model.timestampState, "systemDetectedOnly");
  assert.equal(model.analysisAnchor, "systemDetection");
  assert.equal(model.documents[0].timePrecision, "day");
  assert.equal(model.coverageState, "content_fetched");
  assert.equal(model.eventVerificationState, "source_verified");
  assert.equal(model.confounderReviewState, "unreviewed");
  assert.deepEqual(model.importantClauses, []);
});

test("source-stated hour precision is preserved without claiming minute precision", () => {
  const model = buildReadModel(input({
    availabilityBasis: "source_stated",
    timePrecision: "hour",
    availableAt: "2026-07-21T14:00:00Z",
    sourceStatedAt: "10:00 a.m. EDT",
    sourceStatedTimezone: "America/New_York"
  }), null, "b".repeat(64));
  assert.equal(model.publishedAt, "2026-07-21T14:00:00Z");
  assert.equal(model.timestampState, "officialExact");
  assert.equal(model.analysisAnchor, "officialPublication");
  assert.equal(model.documents[0].timePrecision, "hour");
});

test("a document revision preserves existing market evidence", () => {
  const prior = {
    documents: [], timelineItems: [], tickers: ["NVDA"],
    marketSummaries: [{ availableAt: "2026-07-21T15:00:00Z" }],
    marketSeries: [{ timestamp: "2026-07-21T15:00:00Z" }]
  };
  const model = buildReadModel(input(), prior, "c".repeat(64));
  assert.deepEqual(model.tickers, ["NVDA"]);
  assert.equal(model.marketSummaries.length, 1);
  assert.equal(model.marketSeries.length, 1);
});
