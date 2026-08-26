import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { PolicyEvent } from "../src/domain/types.ts";
import { replaySnapshot } from "../src/domain/replay.ts";

const fixturePath = new URL("../DemoPolicyEvents.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { events: PolicyEvent[] };
const event = fixture.events.find((candidate) => candidate.id === "E6A78BA1-531A-4C10-9F2F-0B6FD116A001");
assert.ok(event);

test("10:07 replay exposes only facts known by the first report", () => {
  const replay = replaySnapshot(event, "2026-07-16T10:07:18-04:00");
  assert.equal(replay.timelineItems.length, 3);
  assert.equal(replay.documentVersion?.version, 1);
  assert.equal(replay.marketSeries.at(-1)?.timestamp, "2026-07-16T10:07:18-04:00");
  assert.equal(replay.marketSummaries.length, 0);
  assert.equal(replay.laterFactCount, 3);
});

test("10:12 replay switches to the second document revision", () => {
  const replay = replaySnapshot(event, "2026-07-16T10:12:44-04:00");
  assert.equal(replay.timelineItems.length, 4);
  assert.equal(replay.documentVersion?.version, 2);
  assert.equal(replay.marketSeries.at(-1)?.timestamp, "2026-07-16T10:12:44-04:00");
  assert.equal(replay.marketSummaries.length, 0);
});

test("10:32 replay exposes the completed market evaluation but not future points", () => {
  const replay = replaySnapshot(event, "2026-07-16T10:32:14-04:00");
  assert.equal(replay.timelineItems.length, 5);
  assert.equal(replay.marketSummaries.length, 1);
  assert.equal(replay.marketSeries.at(-1)?.timestamp, "2026-07-16T10:32:14-04:00");
  assert.equal(replay.marketSeries.some((point) => point.timestamp === "2026-07-16T11:02:14-04:00"), false);
});

test("invalid as_of is rejected", () => {
  assert.throws(() => replaySnapshot(event, "later"), /ISO-8601/);
  assert.throws(() => replaySnapshot(event, "2026-07-16"), /ISO-8601/);
});

test("a correcting amendment becomes visible only at its own availability boundary", () => {
  const live = {
    ...event,
    documentVersions: [],
    documents: [
      {
        id: "cb10538b-96f1-43ca-a6d5-a24077411a9f", documentType: "final_rule", relationship: "primary", correctsDocumentID: null,
        documentNumber: "FR Doc. 2023-17243", publisherJA: "米国商務省産業安全保障局", publisherEN: "Bureau of Industry and Security",
        titleJA: "原規則", titleEN: "Final rule", officialURL: "https://example.test/final.pdf", publishedOn: "2023-08-14", effectiveOn: "2023-08-11", applicableOn: null,
        sourceStatedAt: "Filed 8/11/2023 8:45 am", sourceStatedTimezone: null, firstObservedAt: "2026-07-20T00:00:00Z", ingestedAt: "2026-07-20T00:00:01Z",
        availableAt: "2023-08-14T00:00:00Z", availabilityBasis: "publication_date_only", timePrecision: "day", currentRevision: 1,
        contentHash: { algorithm: "sha256", value: "a".repeat(64) }, bodyJA: "原規則", bodyEN: "Final rule"
      },
      {
        id: "ee524680-9145-4a85-9ed5-e913a24af766", documentType: "correcting_amendment", relationship: "corrects", correctsDocumentID: "cb10538b-96f1-43ca-a6d5-a24077411a9f",
        documentNumber: "FR Doc. 2023-18047", publisherJA: "米国商務省産業安全保障局", publisherEN: "Bureau of Industry and Security",
        titleJA: "訂正文書", titleEN: "Correcting amendment", officialURL: "https://example.test/correction.pdf", publishedOn: "2023-08-21", effectiveOn: "2023-08-17", applicableOn: "2023-08-11",
        sourceStatedAt: "Filed 8/17/2023 4:15 pm", sourceStatedTimezone: null, firstObservedAt: "2026-07-20T00:01:00Z", ingestedAt: "2026-07-20T00:01:01Z",
        availableAt: "2023-08-21T00:00:00Z", availabilityBasis: "publication_date_only", timePrecision: "day", currentRevision: 1,
        contentHash: { algorithm: "sha256", value: "b".repeat(64) }, bodyJA: "訂正文書", bodyEN: "Correction"
      }
    ]
  } satisfies PolicyEvent;
  assert.deepEqual(replaySnapshot(live, "2023-08-20T23:59:59Z").documents.map((document) => document.documentNumber), ["FR Doc. 2023-17243"]);
  assert.deepEqual(replaySnapshot(live, "2023-08-21T00:00:00Z").documents.map((document) => document.documentNumber), ["FR Doc. 2023-17243", "FR Doc. 2023-18047"]);
});

test("a confounder is hidden until the time it became known", () => {
  const live = {
    ...event,
    confounders: [{
      id: "5339361a-6421-47db-9915-c0437c898916",
      occurredAt: "2026-07-16T10:01:00-04:00",
      availableAt: "2026-07-16T10:20:00-04:00",
      titleJA: "同時刻帯の別材料",
      detailJA: "10:20に確認されたため、それ以前のReplayには出さない。",
      relevance: "同じ銘柄に影響し得る別の公開情報"
    }]
  } satisfies PolicyEvent;

  const before = replaySnapshot(live, "2026-07-16T10:19:59-04:00");
  assert.equal(before.confounders.length, 0);
  assert.ok(before.laterFactCount >= 1);
  assert.equal(replaySnapshot(live, "2026-07-16T10:20:00-04:00").confounders.length, 1);
});
