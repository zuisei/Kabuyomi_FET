import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import test from "node:test";
import admin, { type Env } from "../src/admin.ts";

class SQLiteD1Statement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly parameters: any[];
  constructor(database: DatabaseSync, sql: string, parameters: any[] = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }
  bind(...parameters: unknown[]): SQLiteD1Statement { return new SQLiteD1Statement(this.database, this.sql, parameters); }
  private statement(): StatementSync { return this.database.prepare(this.sql); }
  async first<T>(): Promise<T | null> { return (this.statement().get(...this.parameters) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, never> }> {
    return { results: this.statement().all(...this.parameters) as T[], success: true, meta: {} };
  }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = this.statement().run(...this.parameters);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SQLiteD1 {
  readonly database: DatabaseSync;
  constructor(database: DatabaseSync) { this.database = database; }
  prepare(sql: string): SQLiteD1Statement { return new SQLiteD1Statement(this.database, sql); }
  async batch(statements: SQLiteD1Statement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

const eventID = "11111111-1111-4111-8111-111111111111";
const relationshipID = "22222222-2222-4222-8222-222222222222";

async function fixture(): Promise<{ env: Env; database: DatabaseSync }> {
  const database = new DatabaseSync(":memory:");
  const migrationURL = new URL("../migrations/core/", import.meta.url);
  for (const file of (await readdir(migrationURL)).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(await readFile(new URL(file, migrationURL), "utf8"));
  }
  const now = "2026-07-21T00:00:00.000Z";
  database.prepare("INSERT INTO policy_events (id,agency_code,title_ja,title_en,summary_ja,status,first_detected_at,last_activity_at,published_at,is_synthetic,created_at,updated_at) VALUES (?,?,?,?,?,'published',?,?,?,0,?,?)")
    .run(eventID, "BIS", "試験規則", "Test rule", "自動要約", now, now, now, now, now);
  database.prepare("INSERT INTO event_read_models (event_id,schema_version,payload_json,source_updated_at,generated_at,published_at) VALUES (?,3,?,?,?,?)")
    .run(eventID, JSON.stringify({ id: eventID, summaryJA: "自動要約", coverageState: "metadata_only", eventVerificationState: "source_verified", confounders: [], confounderReviewState: "unreviewed", importantClauses: [] }), now, now, now);
  database.prepare("INSERT INTO sources (id,code,display_name,source_kind,created_at) VALUES ('source','TEST','Test','official',?)").run(now);
  database.prepare("INSERT INTO source_items (id,source_id,external_id,first_detected_at,last_detected_at,available_at) VALUES ('item','source','1',?,?,?)").run(now, now, now);
  for (const [id, number] of [["33333333-3333-4333-8333-333333333333", "2026-00001"], ["44444444-4444-4444-8444-444444444444", "2026-00002"]]) {
    database.prepare("INSERT INTO documents (id,source_item_id,document_number,publisher,title,created_at) VALUES (?,'item',?,'Federal Register','Test',?)").run(id, number, now);
  }
  database.prepare("INSERT INTO document_relationships (id,from_document_id,to_document_id,relationship,confidence,review_state,created_at) VALUES (?,?,?,'corrects',0.9,'candidate',?)")
    .run(relationshipID, "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444", now);
  const core = new SQLiteD1(database) as unknown as D1Database;
  return { env: { CORE: core, ADMIN_TOKEN: "secret", ENVIRONMENT: "test" } as Env, database };
}

function request(path: string, body: Record<string, unknown>, method = "POST"): Request {
  return new Request(`https://admin.example.test${path}`, {
    method,
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

test("editorial drafts cannot claim human review or publish without a human decision", async () => {
  const { env, database } = await fixture();
  const forged = await admin.fetch(request(`/admin/events/${eventID}/analysis-drafts`, {
    analysisStatus: "editorial_reviewed", presentationTier: "monitor", marketAnalysisMode: "not_applicable",
    noMarketDataReasonJA: "定例的な行政資料のため市場評価対象外", noCompanyReasonJA: "個別企業を対象としない"
  }), env);
  assert.equal(forged.status, 400);

  const created = await admin.fetch(request(`/admin/events/${eventID}/analysis-drafts`, {
    presentationTier: "monitor", marketAnalysisMode: "not_applicable",
    noMarketDataReasonJA: "定例的な行政資料のため市場評価対象外", noCompanyReasonJA: "個別企業を対象としない"
  }), env);
  assert.equal(created.status, 201, await created.clone().text());
  const analysisID = (await created.json() as { analysisID: string }).analysisID;
  const publish = await admin.fetch(request(`/admin/analyses/${analysisID}/transition`, {
    action: "publish", reviewedBy: "reviewer@example.test"
  }), env);
  assert.equal(publish.status, 409);
  assert.equal((await publish.json() as { error: { code: string } }).error.code, "editorial_review_required");
  assert.equal(database.prepare("SELECT analysis_status FROM policy_analyses WHERE id=?").get(analysisID)!.analysis_status, "automated_draft");
  database.close();
});

test("Signal rejects incomplete editorial fields while Monitor and Archive remain lossless", async () => {
  const { env, database } = await fixture();
  const signal = await admin.fetch(request(`/admin/events/${eventID}/analysis-drafts`, {
    presentationTier: "signal", marketAnalysisMode: "unmapped", marketRelevanceReasonJA: "関連候補を確認中"
  }), env);
  assert.equal(signal.status, 400);
  assert.match(await signal.text(), /canonicalTitleJA/);

  const monitor = await admin.fetch(request(`/admin/events/${eventID}/analysis-drafts`, {
    presentationTier: "monitor", marketAnalysisMode: "not_applicable",
    noMarketDataReasonJA: "事務的なNoticeのため市場評価対象外", noCompanyReasonJA: "個別企業を対象としない"
  }), env);
  assert.equal(monitor.status, 201, await monitor.clone().text());
  const analysisID = (await monitor.json() as { analysisID: string }).analysisID;
  const replaced = await admin.fetch(request(`/admin/analyses/${analysisID}`, {
    presentationTier: "archive", marketAnalysisMode: "not_applicable",
    noMarketDataReasonJA: "検索用アーカイブ資料", noCompanyReasonJA: "個別企業を対象としない"
  }, "PUT"), env);
  assert.equal(replaced.status, 200, await replaced.text());
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM policy_events WHERE id=?").get(eventID)!.count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM documents").get()!.count, 2);
  assert.equal(database.prepare("SELECT presentation_tier FROM policy_analyses WHERE id=?").get(analysisID)!.presentation_tier, "archive");
  database.close();
});

test("a complete automated Signal is public without a human-review transition", async () => {
  const { env, database } = await fixture();
  const created = await admin.fetch(request(`/admin/events/${eventID}/analysis-drafts`, {
    presentationTier: "signal",
    canonicalTitleJA: "自動選定する政策",
    changeSummaryJA: "公式資料に記載された変更点。",
    whyItMattersJA: "制度条件に影響し得るため追跡対象とする。",
    policyType: "final_rule",
    policyDomainCodes: ["export-controls-sanctions"],
    marketAnalysisMode: "not_applicable",
    noMarketDataReasonJA: "市場評価の対象外",
    noCompanyReasonJA: "個別企業を特定していない"
  }), env);
  assert.equal(created.status, 201, await created.clone().text());
  const body = await created.json() as {
    analysisStatus: string;
    publicVisible: boolean;
    previewVisible: boolean;
    automaticallySelectedSignal: boolean;
  };
  assert.equal(body.analysisStatus, "automated_draft");
  assert.equal(body.publicVisible, true);
  assert.equal(body.previewVisible, true);
  assert.equal(body.automaticallySelectedSignal, true);
  database.close();
});

test("analyst enrichment records human review and updates the published model", async () => {
  const { env, database } = await fixture();
  const response = await admin.fetch(request(`/admin/events/${eventID}/enrich`, {
    summaryJA: "確認済み要約", domainSlug: "export-controls-sanctions", importantClauseJA: "対象品目を限定する条項",
    clauseSourceURL: "https://www.federalregister.gov/example", confounderReviewState: "verified_none", reviewedBy: "reviewer@example.test"
  }), env);
  assert.equal(response.status, 200, await response.text());
  const row = database.prepare("SELECT payload_json FROM event_read_models WHERE event_id=?").get(eventID) as { payload_json: string };
  const model = JSON.parse(row.payload_json) as Record<string, unknown>;
  assert.equal(model.coverageState, "analyst_enriched");
  assert.equal(model.eventVerificationState, "analyst_verified");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM analyst_reviews").get()!.count, 1);
  database.close();
});

test("manual confounder addition retains occurrence and later availability separately", async () => {
  const { env, database } = await fixture();
  const response = await admin.fetch(request(`/admin/events/${eventID}/confounders`, {
    titleJA: "同時刻帯の企業開示", detailJA: "8-Kが別の材料になり得る。", relevance: "対象銘柄に直接関係",
    kind: "issuer_filing", sourceURL: "https://www.sec.gov/example", occurredAt: "2026-07-21T12:00:00Z",
    availableAt: "2026-07-21T12:05:00Z", reviewState: "verified", reviewedBy: "reviewer@example.test"
  }), env);
  assert.equal(response.status, 200, await response.text());
  const row = database.prepare("SELECT occurred_at,available_at,relevance,kind,reviewed_by FROM confounders").get() as Record<string, unknown>;
  assert.equal(row.occurred_at, "2026-07-21T12:00:00Z");
  assert.equal(row.available_at, "2026-07-21T12:05:00Z");
  assert.equal(row.relevance, "対象銘柄に直接関係");
  database.close();
});

test("relationship review records the human decision", async () => {
  const { env, database } = await fixture();
  const response = await admin.fetch(request(`/admin/relationships/${relationshipID}/review`, {
    decision: "approved", reviewedBy: "reviewer@example.test", note: "文書番号とDocketを確認"
  }), env);
  assert.equal(response.status, 200, await response.text());
  const row = database.prepare("SELECT review_state,reviewed_by,reviewed_at FROM document_relationships WHERE id=?").get(relationshipID) as Record<string, unknown>;
  assert.equal(row.review_state, "approved");
  assert.equal(row.reviewed_by, "reviewer@example.test");
  assert.ok(row.reviewed_at);
  database.close();
});

const marketMapping = {
  ticker: "AAPL", exchange: "NASDAQ", companyName: "Apple Inc.", relationship: "direct", confidence: 0.92,
  evidenceDocumentID: "33333333-3333-4333-8333-333333333333", evidenceClause: "対象となる製品分類を公式文書で確認", evidenceURL: "https://www.federalregister.gov/example",
  benchmarkTicker: "SPY", providerID: "twelve-data-byok", windowName: "thirtyMinutes",
  windowStart: "2026-07-21T14:30:00.000Z", windowEnd: "2026-07-21T15:00:00.000Z", timePrecision: "minute",
  evaluatedAt: "2026-07-21T15:01:00.000Z", availableAt: "2026-07-21T15:01:00.000Z", reviewedBy: "market-reviewer@example.test",
  points: [
    { timestamp: "2026-07-21T14:30:00.000Z", normalizedSecurityPrice: 100, normalizedBenchmarkPrice: 100, volumeRatio: 1 },
    { timestamp: "2026-07-21T15:00:00.000Z", normalizedSecurityPrice: 104, normalizedBenchmarkPrice: 100.5, volumeRatio: 1.8 }
  ]
};

async function enrichForMarket(env: Env): Promise<void> {
  const response = await admin.fetch(request(`/admin/events/${eventID}/enrich`, {
    summaryJA: "確認済み要約", domainSlug: "export-controls-sanctions", importantClauseJA: "対象品目を限定する条項",
    clauseSourceURL: "https://www.federalregister.gov/example", confounderReviewState: "verified_none", reviewedBy: "reviewer@example.test"
  }), env);
  assert.equal(response.status, 200, await response.text());
  const database = (env.CORE as unknown as SQLiteD1).database;
  database.prepare("INSERT INTO event_documents (event_id,document_id,relationship) VALUES (?,?,'primary')").run(eventID, "33333333-3333-4333-8333-333333333333");
}

test("market mapping remains closed until provider display rights are reviewed", async () => {
  const { env, database } = await fixture();
  await enrichForMarket(env);
  const response = await admin.fetch(request(`/admin/events/${eventID}/market-mappings`, marketMapping), env);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "market_rights_required");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM market_evaluations").get()!.count, 0);
  database.close();
});

test("rights review and market mapping persist evidence and server-calculated results", async () => {
  const { env, database } = await fixture();
  await enrichForMarket(env);
  const rights = await admin.fetch(request("/admin/market-providers/twelve-data-byok/review", {
    decision: "approved", rightsNote: "TestFlight display is permitted by the reviewed plan", reviewedBy: "legal-reviewer@example.test"
  }), env);
  assert.equal(rights.status, 200, await rights.text());
  const response = await admin.fetch(request(`/admin/events/${eventID}/market-mappings`, marketMapping), env);
  assert.equal(response.status, 200, await response.text());
  const evaluation = database.prepare("SELECT abnormal_return,provider_id,license_mode,reviewed_by FROM market_evaluations").get() as Record<string, unknown>;
  assert.ok(Math.abs(Number(evaluation.abnormal_return) - 0.035) < 0.000001);
  assert.equal(evaluation.provider_id, "twelve-data-byok");
  assert.equal(evaluation.license_mode, "bring_your_own_key");
  assert.equal(evaluation.reviewed_by, "market-reviewer@example.test");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM market_points").get()!.count, 2);
  assert.equal(database.prepare("SELECT review_state FROM company_exposures").get()!.review_state, "approved");
  const model = JSON.parse((database.prepare("SELECT payload_json FROM event_read_models WHERE event_id=?").get(eventID) as { payload_json: string }).payload_json) as Record<string, any>;
  assert.equal(model.coverageState, "market_mapped");
  assert.equal(model.marketProvenance.provider, "Twelve Data (BYOK)");
  assert.equal(model.exposures[0].verificationState, "humanVerified");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='approve_market_mapping'").get()!.count, 1);
  database.close();
});

test("market mapping rejects future availability leakage and stores nothing", async () => {
  const { env, database } = await fixture();
  await enrichForMarket(env);
  await admin.fetch(request("/admin/market-providers/twelve-data-byok/review", {
    decision: "approved", rightsNote: "Display rights checked", reviewedBy: "legal-reviewer@example.test"
  }), env);
  const response = await admin.fetch(request(`/admin/events/${eventID}/market-mappings`, {
    ...marketMapping, evaluatedAt: "2026-07-21T14:59:00.000Z", availableAt: "2026-07-21T14:59:00.000Z"
  }), env);
  assert.equal(response.status, 400);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM market_evaluations").get()!.count, 0);
  database.close();
});
