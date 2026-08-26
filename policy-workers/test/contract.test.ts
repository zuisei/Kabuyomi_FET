import assert from "node:assert/strict";
import test from "node:test";
import { events } from "../src/fixture.ts";
import { eventByID, filterEvents, marketPayloadForEvent, recordUpdatedAt, summaryForEvent } from "../src/index.ts";

const summaryKeys = [
  "agency", "analysis", "confounderCount", "coverageState", "domain", "hasCorrectionDocument", "hasMarketData", "id", "instrumentType",
  "lastActivityAt", "legalDates", "marketEvaluationAvailableAt", "publishedAt", "revisedAt", "status", "verificationState",
  "publicationGrouping", "relatedDocumentCount", "summaryJA", "tickers", "timelineItemCount", "titleEN", "titleJA", "topics", "translation", "updateCount"
].sort();

test("event summaries expose only the fixed list contract", () => {
  for (const event of events) {
    const summary = summaryForEvent(event);
    assert.deepEqual(Object.keys(summary).sort(), summaryKeys);
    assert.equal("unreadUpdateCount" in summary, false);
    assert.equal("documentInfo" in summary, false);
    assert.equal("documentVersions" in summary, false);
    assert.equal("exposures" in summary, false);
    assert.equal("documentDiff" in summary, false);
  }
});

test("fixture agency codes and content hashes obey the production contract", () => {
  const agencyCodes = events.map((event) => event.agency.code);
  assert.deepEqual(agencyCodes, ["BIS", "WH", "USTR", "DOC"]);
  for (const event of events) {
    assert.equal(event.documentInfo.contentHash.algorithm, "sha256");
    assert.match(event.documentInfo.contentHash.value, /^[0-9a-f]{64}$/);
    assert.equal("hash" in event.documentInfo, false);
    assert.equal("unreadUpdateCount" in event, false);
  }
});

test("UUID path lookup is case insensitive", () => {
  const id = events[0].id;
  assert.equal(eventByID(events, id.toUpperCase())?.id, id);
  assert.equal(eventByID(events, id.toLowerCase())?.id, id);
});

test("live reviewed market data returns its persisted provider provenance", () => {
  const event = structuredClone(events[0]);
  event.isSynthetic = false;
  event.marketProvenance = { provider: "Licensed Feed", licenseMode: "licensed_proxy", attribution: "© Licensed Feed", delayStatus: "15-minute delayed" };
  const payload = marketPayloadForEvent(event);
  assert.equal(payload.provider, "Licensed Feed");
  assert.equal(payload.licenseMode, "licensed_proxy");
  assert.equal(payload.attribution, "© Licensed Feed");
});

test("server search matches official identifiers and URL filters", () => {
  const enriched = structuredClone(events[0]);
  enriched.documents = [{
    id: "11111111-1111-4111-8111-111111111111", documentType: "final_rule", relationship: "primary", correctsDocumentID: null,
    documentNumber: "2026-0042", publisherJA: "BIS", publisherEN: "BIS", titleJA: "規則", titleEN: "Rule",
    officialURL: "https://www.federalregister.gov/d/2026-0042", publishedOn: "2026-07-21", effectiveOn: null, applicableOn: null,
    sourceStatedAt: null, sourceStatedTimezone: null, firstObservedAt: "2026-07-21T00:00:00Z", ingestedAt: "2026-07-21T00:00:01Z",
    availableAt: "2026-07-21T00:00:00Z", availabilityBasis: "publication_date_only", timePrecision: "day", currentRevision: 1,
    contentHash: { algorithm: "sha256", value: "a".repeat(64) }, bodyJA: "規則", bodyEN: "Rule",
    docketIDs: ["BIS-2026-0042"], regulationIDNumbers: ["0694-AJ99"], cfrReferences: ["15 CFR 744"]
  }];
  enriched.instrumentType = "final_rule";
  enriched.policyDomain = { slug: "export-controls", labelJA: "輸出管理" };
  enriched.eventVerificationState = "analyst_verified";
  enriched.titleEN = "Bitcoin market reporting rule";
  enriched.agency.displayNameJA = "商務省産業安全保障局";

  for (const query of ["q=BIS-2026-0042", "q=0694-AJ99", "q=15%20CFR%20744", "q=BTC", "q=商務省産業安全保障局", "filter%5Bagency%5D=BIS&filter%5Bdomain%5D=export-controls&filter%5Binstrument%5D=final_rule&filter%5Bverification%5D=analyst_verified"]) {
    assert.deepEqual(filterEvents([enriched], new URL(`https://example.test/v1/search?${query}`)).map((event) => event.id), [enriched.id]);
  }
  assert.equal(filterEvents([enriched], new URL("https://example.test/v1/search?filter%5Bstatus%5D=corrected")).length, 0);
});

test("event summaries expose official identifiers needed for safe publication grouping", () => {
  const enriched = structuredClone(events[0]);
  enriched.documents = [{
    id: "11111111-1111-4111-8111-111111111111", documentType: "proposed_rule", relationship: "primary", correctsDocumentID: null,
    documentNumber: "2026-0042", publisherJA: "BIS", publisherEN: "BIS", titleJA: "規則案", titleEN: "Proposed Rule",
    officialURL: "https://www.federalregister.gov/d/2026-0042", publishedOn: "2026-07-21", effectiveOn: null, applicableOn: null,
    sourceStatedAt: null, sourceStatedTimezone: null, firstObservedAt: "2026-07-21T00:00:00Z", ingestedAt: "2026-07-21T00:00:01Z",
    availableAt: "2026-07-21T00:00:00Z", availabilityBasis: "publication_date_only", timePrecision: "day", currentRevision: 1,
    contentHash: { algorithm: "sha256", value: "a".repeat(64) }, bodyJA: "規則案", bodyEN: "Proposed Rule",
    docketIDs: ["BIS-2026-0042"], regulationIDNumbers: ["0694-AJ99"], cfrReferences: ["15 CFR 744"]
  }];

  assert.deepEqual(summaryForEvent(enriched).publicationGrouping, {
    documentNumber: "2026-0042",
    docketIDs: ["BIS-2026-0042"],
    regulationIDNumbers: ["0694-AJ99"],
    cfrReferences: ["15 CFR 744"]
  });
});

test("event summaries expose only source-stated legal dates with their official document", () => {
  const enriched = structuredClone(events[0]);
  enriched.documents = [{
    id: "21111111-1111-4111-8111-111111111111", documentType: "proposed_rule", relationship: "primary", correctsDocumentID: null,
    documentNumber: "2026-0099", publisherJA: "BIS", publisherEN: "BIS", titleJA: "規則案", titleEN: "Proposed Rule",
    officialURL: "https://www.federalregister.gov/d/2026-0099", publishedOn: "2026-07-21", effectiveOn: "2026-09-01",
    applicableOn: "2026-10-01", commentsCloseOn: "2026-08-21", sourceStatedAt: null, sourceStatedTimezone: null,
    firstObservedAt: "2026-07-21T00:00:00Z", ingestedAt: "2026-07-21T00:00:01Z",
    availableAt: "2026-07-21T00:00:00Z", availabilityBasis: "publication_date_only", timePrecision: "day", currentRevision: 1,
    contentHash: { algorithm: "sha256", value: "b".repeat(64) }, bodyJA: "規則案", bodyEN: "Proposed Rule"
  }];
  const primary = enriched.documents[0];

  assert.deepEqual(summaryForEvent(enriched).legalDates, [
    {
      kind: "comments_close",
      date: "2026-08-21",
      documentID: primary.id,
      documentNumber: primary.documentNumber,
      officialURL: primary.officialURL
    },
    {
      kind: "effective",
      date: "2026-09-01",
      documentID: primary.id,
      documentNumber: primary.documentNumber,
      officialURL: primary.officialURL
    },
    {
      kind: "applicable",
      date: "2026-10-01",
      documentID: primary.id,
      documentNumber: primary.documentNumber,
      officialURL: primary.officialURL
    }
  ]);
});

test("updated_since includes old events when translation or editorial state changed", () => {
  const enriched = structuredClone(events[0]);
  enriched.lastActivityAt = "2026-07-20T00:00:00.000Z";
  enriched.translation = {
    titleStatus: "machine_translated",
    factualSummaryStatus: "machine_translated",
    sourceLanguage: "en",
    provider: "openai",
    model: "gpt-5-nano-2025-08-07",
    promptVersion: "policy-translation-v1",
    translatedAt: "2026-07-23T01:00:00.000Z",
    sourceContentHash: "a".repeat(64)
  };
  assert.equal(recordUpdatedAt(enriched), "2026-07-23T01:00:00.000Z");
  assert.deepEqual(
    filterEvents([enriched], new URL("https://example.test/v1/events?updated_since=2026-07-23T00%3A00%3A00.000Z")).map((event) => event.id),
    [enriched.id]
  );
  assert.equal(filterEvents([enriched], new URL("https://example.test/v1/events?updated_since=invalid")).length, 0);
});
