import assert from "node:assert/strict";
import test from "node:test";
import api, { type Env } from "../src/index.ts";
import { events } from "../src/fixture.ts";

type Row = Record<string, unknown>;

function database(options: { eventRows?: Row[]; sourceHealth?: Row[]; translationRows?: Row[] } = {}): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind() { return statement; },
        async all() {
          const results = sql.includes("event_read_models") ? options.eventRows ?? []
            : sql.includes("policy_translations") ? options.translationRows ?? []
            : sql.includes("source_health") ? options.sourceHealth ?? [] : [];
          return { success: true, results, meta: {} };
        },
        async first() { return { ok: 1 }; }
      };
      return statement;
    }
  } as unknown as D1Database;
}

function environment(environment: string, eventRows: Row[] = [], sourceHealth: Row[] = [], translationRows: Row[] = []): Env {
  const emptyBucket = {} as R2Bucket;
  return {
    CORE: database({ eventRows, translationRows }), OPS: database({ sourceHealth }), RAW: emptyBucket, DERIVED: emptyBucket, TEMP: emptyBucket,
    ENVIRONMENT: environment,
    CF_VERSION_METADATA: { id: "worker-test", tag: "", timestamp: "2026-07-21T02:00:00.000Z" }
  };
}

function automatedSignal(overrides: Row = {}): Row {
  return {
    analysisStatus: "automated_draft",
    presentationTier: "signal",
    canonicalTitleJA: "自動生成タイトル",
    canonicalTitleEN: events[0].titleEN,
    changeSummaryJA: "公式資料に記載された変更点。",
    whyItMattersJA: "制度条件に影響し得るため追跡対象とする。",
    policyType: "final_rule",
    policyDomainCodes: ["export-controls-sanctions"],
    primaryAgencyCode: events[0].agency.code,
    affectedRegionCodes: ["US"],
    affectedSectorCodes: [],
    affectedProductTerms: [],
    marketAnalysisMode: "not_applicable",
    marketRelevanceReasonJA: null,
    noCompanyReasonJA: "個別企業を特定していない",
    noMarketDataReasonJA: "市場評価の対象外",
    analysisVersion: 1,
    reviewedAt: null,
    publishedAt: null,
    companyRelations: [],
    ...overrides
  };
}

test("TestFlight never falls back to synthetic fixtures when its live dataset is empty", async () => {
  const response = await api.fetch(new Request("https://example.test/v1/events"), environment("testflight"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-md-data-mode"), "live");
  assert.equal(response.headers.get("x-md-dataset-revision"), null);
  assert.deepEqual(await response.json(), {
    data_mode: "live",
    data: [],
    pagination: { total: 0, limit: 50, cursor: "0", nextCursor: null }
  });
});

test("Preview retains an explicit synthetic fixture fallback", async () => {
  const response = await api.fetch(new Request("https://example.test/v1/events?limit=1"), environment("preview"));
  assert.equal(response.headers.get("x-md-data-mode"), "synthetic");
  const body = await response.json() as { data_mode: string; data: Array<{ id: string }> };
  assert.equal(body.data_mode, "synthetic");
  assert.equal(body.data[0].id, events[0].id);
});

test("Production exposes a complete automated Signal without presenting it as human-reviewed", async () => {
  const event = {
    ...events[0],
    isSynthetic: false,
    instrumentType: "final_rule",
    analysis: automatedSignal()
  };
  const response = await api.fetch(new Request("https://example.test/v1/events"), environment("production", [{
    payload_json: JSON.stringify(event),
    source_updated_at: "2026-07-21T03:00:00.000Z"
  }]));
  assert.equal(response.status, 200);
  const body = await response.json() as { data: Array<{ analysis: { analysisStatus: string; presentationTier: string; canonicalTitleJA: string | null } }> };
  assert.equal(body.data[0].analysis.analysisStatus, "automated_draft");
  assert.equal(body.data[0].analysis.presentationTier, "signal");
  assert.equal(body.data[0].analysis.canonicalTitleJA, "自動生成タイトル");
});

test("Production exposes machine-translated facts and separately labels automated analysis", async () => {
  const hash = "b".repeat(64);
  const event = {
    ...events[0], isSynthetic: false,
    documentInfo: { ...events[0].documentInfo, contentHash: { algorithm: "sha256", value: hash } },
    analysis: automatedSignal()
  };
  const translation = {
    id: "translation-1", event_id: event.id, source_content_hash: hash, source_language: "en",
    title_ja: "機械翻訳された公式タイトル", title_status: "machine_translated",
    factual_summary_ja: "原文に記載された事実のみを短く要約しています。", factual_summary_status: "machine_translated",
    provider: "openai", model: "gpt-5-nano-2025-08-07", prompt_version: "policy-translation-v1",
    translated_at: "2026-07-22T00:10:00.000Z", validation_warnings_json: "[]"
  };
  const response = await api.fetch(new Request("https://example.test/v1/events"), environment("production", [{
    payload_json: JSON.stringify(event), source_updated_at: "2026-07-22T00:00:00.000Z"
  }], [], [translation]));
  const body = await response.json() as { data: Array<{ titleJA: string; summaryJA: string; translation: { titleStatus: string }; analysis: { analysisStatus: string } }> };
  assert.equal(body.data[0].titleJA, translation.title_ja);
  assert.equal(body.data[0].summaryJA, translation.factual_summary_ja);
  assert.equal(body.data[0].translation.titleStatus, "machine_translated");
  assert.equal(body.data[0].analysis.analysisStatus, "automated_draft");
});

test("an incomplete automated Signal is safely routed to Monitor", async () => {
  const event = {
    ...events[0],
    isSynthetic: false,
    analysis: automatedSignal({ whyItMattersJA: null })
  };
  const response = await api.fetch(new Request("https://example.test/v1/events"), environment("production", [{
    payload_json: JSON.stringify(event),
    source_updated_at: "2026-07-23T00:00:00.000Z"
  }]));
  const body = await response.json() as { data: Array<{ analysis: { analysisStatus: string; presentationTier: string } }> };
  assert.equal(body.data[0].analysis.analysisStatus, "automated_draft");
  assert.equal(body.data[0].analysis.presentationTier, "monitor");
});

test("live pagination, safe metadata headers and ETag 304 share one response contract", async () => {
  const rows = events.slice(0, 3).map((event, index) => ({
    payload_json: JSON.stringify({ ...event, isSynthetic: false }),
    source_updated_at: `2026-07-21T02:00:0${index}.000Z`
  }));
  const env = environment("testflight", rows);
  const request = new Request("https://example.test/v1/events?limit=1&cursor=1");
  const response = await api.fetch(request, env);
  assert.equal(response.status, 200);
  for (const header of ["x-md-data-mode", "x-md-schema-version", "etag"]) {
    assert.ok(response.headers.get(header), `missing ${header}`);
  }
  for (const header of ["x-md-version", "x-md-environment", "x-md-dataset-revision"]) {
    assert.equal(response.headers.get(header), null, `public response leaked ${header}`);
  }
  const body = await response.json() as { data_mode: string; data: Array<{ id: string }>; pagination: { total: number; nextCursor: string | null } };
  assert.equal(body.data_mode, "live");
  assert.equal(body.data.length, 1);
  assert.equal(body.pagination.total, 3);
  assert.equal(body.pagination.nextCursor, "2");

  const conditional = await api.fetch(new Request(request.url, { headers: { "if-none-match": response.headers.get("etag")! } }), env);
  assert.equal(conditional.status, 304);
  assert.equal(await conditional.text(), "");
});

test("source adapter diagnostics are not public and public mutations remain forbidden", async () => {
  const sourceHealth = [{ source_code: "GOVINFO", state: "missing_credentials", detail_json: '{"reason":"api_key_required"}' }];
  const response = await api.fetch(new Request("https://example.test/v1/sources/health"), environment("testflight", [], sourceHealth));
  assert.equal(response.status, 404);
  assert.doesNotMatch(await response.text(), /api_key_required|GOVINFO/);

  const mutation = await api.fetch(new Request("https://example.test/v1/events", { method: "POST" }), environment("testflight"));
  assert.equal(mutation.status, 405);
});
