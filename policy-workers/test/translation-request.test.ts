import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import test from "node:test";
import api, { type Env } from "../src/index.ts";
import { events } from "../src/fixture.ts";
import { processRealtimeTranslationForEvent, type TranslationEnv } from "../src/translation/service.ts";

class SQLiteD1Statement {
  private readonly database: DatabaseSync;
  private readonly sql: string;
  private readonly parameters: unknown[];

  constructor(database: DatabaseSync, sql: string, parameters: unknown[] = []) {
    this.database = database;
    this.sql = sql;
    this.parameters = parameters;
  }

  bind(...parameters: unknown[]): SQLiteD1Statement {
    return new SQLiteD1Statement(this.database, this.sql, parameters);
  }

  private statement(): StatementSync { return this.database.prepare(this.sql); }

  async first<T>(): Promise<T | null> {
    return (this.statement().get(...this.parameters) as T | undefined) ?? null;
  }

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

async function migratedDatabase(kind: "core" | "ops"): Promise<DatabaseSync> {
  const database = new DatabaseSync(":memory:");
  const root = new URL(`../migrations/${kind}/`, import.meta.url);
  for (const file of (await readdir(root)).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(await readFile(new URL(file, root), "utf8"));
  }
  return database;
}

async function fixture(
  availableAt = "2026-07-20T12:00:00.000Z"
): Promise<{ env: Env; core: DatabaseSync; ops: DatabaseSync; eventID: string }> {
  const core = await migratedDatabase("core");
  const ops = await migratedDatabase("ops");
  const eventID = events[0].id;
  const event = {
    ...events[0],
    isSynthetic: false,
    lastActivityAt: availableAt,
    publishedAt: availableAt,
    detectedAt: availableAt,
    revisedAt: null,
    titleJA: events[0].titleEN,
    summaryJA: "日本語要約は未作成です。",
    analysis: undefined,
    translation: undefined
  };
  core.prepare(`INSERT INTO policy_events(
    id,agency_code,title_ja,title_en,summary_ja,status,first_detected_at,last_activity_at,published_at,is_synthetic,created_at,updated_at
  ) VALUES (?,?,?,?,?,'published',?,?,?,0,?,?)`).run(
    eventID, event.agency.code, event.titleJA, event.titleEN, event.summaryJA,
    availableAt, availableAt, availableAt, availableAt, availableAt
  );
  core.prepare(`INSERT INTO event_read_models(event_id,schema_version,payload_json,source_updated_at,generated_at,published_at)
    VALUES (?,5,?,?,?,?)`).run(eventID, JSON.stringify(event), availableAt, availableAt, availableAt);
  const emptyBucket = {} as R2Bucket;
  return {
    env: {
      CORE: new SQLiteD1(core) as unknown as D1Database,
      OPS: new SQLiteD1(ops) as unknown as D1Database,
      RAW: emptyBucket,
      DERIVED: emptyBucket,
      TEMP: emptyBucket,
      ENVIRONMENT: "production",
      TRANSLATION_REALTIME_CUTOFF: "2026-07-21T15:00:00.000Z"
    },
    core,
    ops,
    eventID
  };
}

function request(eventID: string, method = "POST"): Request {
  return new Request(`https://example.test/v1/events/${eventID.toLowerCase()}/translation`, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? "{}" : undefined
  });
}

test("historical translation button promotes exactly one Batch candidate without creating a Batch manifest", async () => {
  const { env, core, ops, eventID } = await fixture();
  const first = await api.fetch(request(eventID), env);
  assert.equal(first.status, 202, await first.clone().text());
  const firstBody = await first.json() as { data: { eventID: string; mode: string; state: string } };
  assert.equal(firstBody.data.eventID, eventID);
  assert.equal(firstBody.data.mode, "on_demand");
  assert.equal(firstBody.data.state, "queued");

  const job = ops.prepare("SELECT event_id,lane,status FROM translation_jobs").get() as Record<string, unknown>;
  assert.equal(job.event_id, eventID);
  assert.equal(job.lane, "manual_priority");
  assert.equal(job.status, "queued");
  assert.equal(ops.prepare("SELECT COUNT(*) AS count FROM translation_jobs").get().count, 1);
  assert.equal(ops.prepare("SELECT COUNT(*) AS count FROM translation_batch_manifests").get().count, 0);

  const repeated = await api.fetch(request(eventID), env);
  assert.equal(repeated.status, 202);
  assert.equal(ops.prepare("SELECT COUNT(*) AS count FROM translation_jobs").get().count, 1);

  const status = await api.fetch(request(eventID, "GET"), env);
  assert.equal(status.status, 200);
  assert.equal((await status.json() as { data: { state: string } }).data.state, "queued");
  core.close();
  ops.close();
});

test("a completed job without an accepted translation can be retried immediately", async () => {
  const { env, core, ops, eventID } = await fixture();
  await api.fetch(request(eventID), env);
  ops.prepare("UPDATE translation_jobs SET status='completed',attempt_count=3 WHERE event_id=?").run(eventID);

  const response = await api.fetch(request(eventID), env);
  assert.equal(response.status, 202);
  assert.equal((await response.json() as { data: { state: string } }).data.state, "queued");
  const job = ops.prepare("SELECT status,attempt_count FROM translation_jobs WHERE event_id=?").get(eventID) as Record<string, unknown>;
  assert.equal(job.status, "queued");
  assert.equal(job.attempt_count, 0);
  core.close();
  ops.close();
});

test("a failed automatic translation can be requeued for immediate processing", async () => {
  const { env, core, ops, eventID } = await fixture("2026-07-22T12:00:00.000Z");
  const initial = await api.fetch(request(eventID), env);
  assert.equal(initial.status, 202);
  assert.equal((await initial.json() as { data: { mode: string; state: string } }).data.mode, "automatic");

  ops.prepare("UPDATE translation_jobs SET status='failed',attempt_count=3,last_error='translation validation failed' WHERE event_id=?")
    .run(eventID);
  const failed = await api.fetch(request(eventID, "GET"), env);
  assert.equal((await failed.json() as { data: { mode: string; state: string } }).data.state, "failed");

  const retried = await api.fetch(request(eventID), env);
  assert.equal(retried.status, 202);
  const retriedBody = await retried.json() as { data: { eventID: string; mode: string; state: string } };
  assert.equal(retriedBody.data.eventID, eventID);
  assert.equal(retriedBody.data.mode, "automatic");
  assert.equal(retriedBody.data.state, "queued");
  const job = ops.prepare("SELECT lane,status,attempt_count,last_error FROM translation_jobs WHERE event_id=?")
    .get(eventID) as Record<string, unknown>;
  assert.equal(job.lane, "realtime");
  assert.equal(job.status, "queued");
  assert.equal(job.attempt_count, 0);
  assert.equal(job.last_error, null);
  core.close();
  ops.close();
});

test("public translation request invokes the private admin service immediately", async () => {
  const { env, core, ops, eventID } = await fixture();
  let triggerRequest: Request | null = null;
  const openAIFetcher: typeof fetch = async () => new Response(JSON.stringify({
    id: "resp_bound_translation",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
      titleJA: "先端計算用輸出管理を更新（デモ）",
      factualSummaryJA: "当局は先端計算用製品の輸出管理規則を更新しました。"
    }) }] }],
    usage: { input_tokens: 100, output_tokens: 25 }
  }), { status: 200, headers: { "content-type": "application/json" } });
  const translationAdmin = {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      triggerRequest = input instanceof Request ? input : new Request(input, init);
      const processing = await processRealtimeTranslationForEvent({
        ...env,
        OPENAI_API_KEY: "test-openai-key"
      } as unknown as TranslationEnv, eventID, openAIFetcher);
      return new Response(JSON.stringify({ processing }), { status: 200 });
    }
  } as unknown as Fetcher;
  const response = await api.fetch(request(eventID), {
    ...env,
    TRANSLATION_ADMIN: translationAdmin,
    TRANSLATION_TRIGGER_TOKEN: "translation-trigger-test"
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json() as { data: { state: string } }).data.state, "translated");
  assert.ok(triggerRequest);
  assert.equal(triggerRequest.url, "https://translation-admin.internal/internal/translations/realtime/run");
  assert.equal(triggerRequest.headers.get("x-md-translation-trigger"), "translation-trigger-test");
  assert.deepEqual(await triggerRequest.json(), { eventID });
  assert.equal(ops.prepare("SELECT COUNT(*) AS count FROM translation_batch_manifests").get().count, 0);
  core.close();
  ops.close();
});

test("event-scoped immediate processor completes the requested job without preparing Batch", async () => {
  const { env, core, ops, eventID } = await fixture();
  await api.fetch(request(eventID), env);
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    const requestBody = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ text: string }> }> };
    if (calls === 2) assert.match(requestBody.input[0].content[0].text, /title_has_no_japanese_script/);
    return new Response(JSON.stringify({
    id: "resp_immediate_translation",
    output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({
      titleJA: calls === 1 ? "Advanced Computing Export Controls Updated (Demo)" : "先端計算用輸出管理を更新（デモ）",
      factualSummaryJA: "当局は先端計算用製品の輸出管理規則を更新しました。"
    }) }] }],
    usage: { input_tokens: 100, output_tokens: 25 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await processRealtimeTranslationForEvent({
    ...env,
    OPENAI_API_KEY: "test-openai-key"
  } as unknown as TranslationEnv, eventID, fetcher);

  assert.equal(result.attempted, 1);
  assert.equal(result.translated, 1);
  assert.equal(calls, 2);
  assert.equal(result.inputTokens, 200);
  assert.equal(result.outputTokens, 50);
  assert.equal(ops.prepare("SELECT status FROM translation_jobs WHERE event_id=?").get(eventID).status, "completed");
  assert.equal(core.prepare("SELECT COUNT(*) AS count FROM policy_translations WHERE event_id=?").get(eventID).count, 1);
  assert.equal(ops.prepare("SELECT COUNT(*) AS count FROM translation_batch_manifests").get().count, 0);
  core.close();
  ops.close();
});

test("translation mutation requires JSON so browser form posts cannot enqueue paid work", async () => {
  const { env, core, ops, eventID } = await fixture();
  const response = await api.fetch(new Request(`https://example.test/v1/events/${eventID}/translation`, {
    method: "POST",
    body: ""
  }), env);
  assert.equal(response.status, 415);
  assert.equal(ops.prepare("SELECT COUNT(*) AS count FROM translation_jobs").get().count, 0);
  core.close();
  ops.close();
});
