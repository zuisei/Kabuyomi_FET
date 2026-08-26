import assert from "node:assert/strict";
import test from "node:test";
import { buildEnvironmentSnapshot, compareEnvironmentSnapshots, type ParityEventSummary } from "../src/environment-parity.ts";

function event(id: string, agency = "BIS"): ParityEventSummary {
  return {
    id,
    lastActivityAt: "2026-07-23T00:00:00.000Z",
    agency: { code: agency },
    status: "published",
    instrumentType: "final_rule",
    hasMarketData: false,
    translation: null,
    analysis: { analysisStatus: "unreviewed", presentationTier: "monitor", marketAnalysisMode: "unmapped" }
  };
}

test("environment snapshot reports product-state counts without private metadata", () => {
  const snapshot = buildEnvironmentSnapshot("TestFlight", [event("a"), event("b", "SEC")]);
  assert.equal(snapshot.total, 2);
  assert.deepEqual(snapshot.agencyCounts, { BIS: 1, SEC: 1 });
  assert.deepEqual(snapshot.translationCounts, { untranslated: 2 });
  assert.equal(snapshot.marketDataCount, 0);
  assert.match(snapshot.revision, /^[0-9a-f]{8}$/);
});

test("environment parity fails closed when either environment is missing IDs", () => {
  const left = buildEnvironmentSnapshot("TestFlight", [event("a"), event("b")]);
  const right = buildEnvironmentSnapshot("Production", [event("a"), event("c")]);
  const result = compareEnvironmentSnapshots(left, right);
  assert.equal(result.matches, false);
  assert.ok(result.differences.includes("event_ids"));
  assert.deepEqual(result.missingFromLeft, ["c"]);
  assert.deepEqual(result.missingFromRight, ["b"]);
});

test("environment parity also fails when IDs match but product state differs", () => {
  const left = buildEnvironmentSnapshot("TestFlight", [event("a"), event("b", "SEC")]);
  const changed = event("b", "SEC");
  changed.translation = {
    titleStatus: "machine_translated",
    factualSummaryStatus: "machine_translated",
    translatedAt: "2026-07-23T01:00:00Z"
  };
  const right = buildEnvironmentSnapshot("Production", [event("a"), changed]);
  const result = compareEnvironmentSnapshots(left, right);

  assert.equal(result.matches, false);
  assert.deepEqual(result.missingFromLeft, []);
  assert.deepEqual(result.missingFromRight, []);
  assert.ok(result.differences.includes("dataset_revision"));
  assert.ok(result.differences.includes("translation_counts"));
});
