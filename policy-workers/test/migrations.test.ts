import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const migrationRoot = new URL("../migrations/", import.meta.url);

async function apply(directory: "core" | "ops"): Promise<DatabaseSync> {
  const database = new DatabaseSync(":memory:");
  const directoryURL = new URL(`${directory}/`, migrationRoot);
  const files = (await readdir(directoryURL)).filter((file) => file.endsWith(".sql")).sort();
  assert.ok(files.length > 0);
  for (const file of files) database.exec(await readFile(new URL(file, directoryURL), "utf8"));
  return database;
}

test("core D1 migrations apply from scratch and include pending/ready storage repair state", async () => {
  const database = await apply("core");
  const columns = database.prepare("PRAGMA table_info(storage_objects)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "state"));
  assert.ok(columns.some((column) => column.name === "source_job_id"));
  assert.ok(columns.some((column) => column.name === "updated_at"));
  assert.throws(
    () => database.exec("INSERT INTO storage_objects(id,bucket_role,object_key,sha256,byte_length,created_at,state,updated_at) VALUES ('bad','raw','bad','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'2026-07-21T00:00:00Z','broken','2026-07-21T00:00:00Z')"),
    /unsupported storage object state/
  );
  const relationshipColumns = database.prepare("PRAGMA table_info(document_relationships)").all() as Array<{ name: string }>;
  for (const name of ["reviewed_by", "reviewed_at"]) assert.ok(relationshipColumns.some((column) => column.name === name));
  const confounderColumns = database.prepare("PRAGMA table_info(confounders)").all() as Array<{ name: string }>;
  for (const name of ["kind", "relevance", "source_url", "reviewed_by", "reviewed_at"]) assert.ok(confounderColumns.some((column) => column.name === name));
  const analystTable = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analyst_reviews'").get();
  assert.ok(analystTable);
  const providerColumns = database.prepare("PRAGMA table_info(market_data_providers)").all() as Array<{ name: string }>;
  for (const name of ["rights_review_state", "rights_reviewed_by", "rights_reviewed_at", "rights_note"]) assert.ok(providerColumns.some((column) => column.name === name));
  const evaluationColumns = database.prepare("PRAGMA table_info(market_evaluations)").all() as Array<{ name: string }>;
  for (const name of ["provider_id", "evaluated_at", "time_precision", "license_mode", "attribution", "delay_status", "evidence_url", "reviewed_by", "reviewed_at"]) assert.ok(evaluationColumns.some((column) => column.name === name));
  const documentColumns = database.prepare("PRAGMA table_info(documents)").all() as Array<{ name: string }>;
  assert.ok(documentColumns.some((column) => column.name === "comments_close_on"));
  const translationColumns = database.prepare("PRAGMA table_info(policy_translations)").all() as Array<{ name: string }>;
  for (const name of ["source_content_hash", "title_status", "factual_summary_status", "model", "prompt_version", "validation_warnings_json"]) {
    assert.ok(translationColumns.some((column) => column.name === name), `missing policy_translations.${name}`);
  }
  assert.throws(
    () => database.exec(`INSERT INTO policy_translations(
      id,event_id,source_content_hash,title_ja,title_status,factual_summary_ja,factual_summary_status,provider,model,prompt_version,translated_at,created_at
    ) VALUES ('bad','missing','not-a-hash','訳','machine_translated','要約','machine_translated','openai','model','v1','2026-07-22T00:00:00Z','2026-07-22T00:00:00Z')`),
    /unsupported policy translation value|FOREIGN KEY constraint failed/
  );
  database.close();
});

test("ops D1 migrations apply from scratch with lease, retry and idempotency columns", async () => {
  const database = await apply("ops");
  const columns = database.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
  for (const name of ["claimed_by", "lease_expires_at", "next_attempt_at", "created_at", "idempotency_key"]) {
    assert.ok(columns.some((column) => column.name === name), `missing jobs.${name}`);
  }
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='translation_jobs'").get());
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='translation_batch_manifests'").get());
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='translation_batch_manifest_jobs'").get());
  database.close();
});
