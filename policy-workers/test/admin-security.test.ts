import assert from "node:assert/strict";
import test from "node:test";
import admin, { type Env } from "../src/admin.ts";

const env = { ADMIN_TOKEN: "test-admin-secret", ENVIRONMENT: "test" } as Env;

test("Production admin page requires the bearer token", async () => {
  const missing = await admin.fetch(new Request("https://admin.example.test/admin"), { ...env, ENVIRONMENT: "production" });
  assert.equal(missing.status, 401);

  const authorized = await admin.fetch(new Request("https://admin.example.test/admin", {
    headers: { authorization: "Bearer test-admin-secret" }
  }), { ...env, ENVIRONMENT: "production" });
  assert.equal(authorized.status, 200);
  assert.match(await authorized.text(), /Market Docket 管理/);
});

test("admin API rejects a missing or incorrect bearer token before storage access", async () => {
  const missing = await admin.fetch(new Request("https://admin.example.test/admin/status"), env);
  assert.equal(missing.status, 401);
  assert.equal((await missing.json() as { error: { code: string } }).error.code, "unauthorized");

  const incorrect = await admin.fetch(new Request("https://admin.example.test/admin/status", {
    headers: { authorization: "Bearer wrong-secret" }
  }), env);
  assert.equal(incorrect.status, 401);
});

test("admin API rejects cross-origin browser mutations before storage access", async () => {
  const response = await admin.fetch(new Request("https://admin.example.test/admin/discover/federal-register", {
    method: "POST",
    headers: {
      authorization: "Bearer test-admin-secret",
      origin: "https://attacker.example"
    }
  }), env);
  assert.equal(response.status, 403);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "origin_rejected");
});

test("internal immediate-translation route requires its dedicated trigger token", async () => {
  const url = "https://admin.example.test/internal/translations/realtime/run";
  const missing = await admin.fetch(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventID: "11111111-1111-4111-8111-111111111111" })
  }), { ...env, TRANSLATION_TRIGGER_TOKEN: "translation-trigger-test" });
  assert.equal(missing.status, 401);

  const incorrect = await admin.fetch(new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-md-translation-trigger": "wrong" },
    body: JSON.stringify({ eventID: "11111111-1111-4111-8111-111111111111" })
  }), { ...env, TRANSLATION_TRIGGER_TOKEN: "translation-trigger-test" });
  assert.equal(incorrect.status, 401);
});

test("authorized internal translation trigger is event-scoped and fails closed without OpenAI credentials", async () => {
  const response = await admin.fetch(new Request("https://admin.example.test/internal/translations/realtime/run", {
    method: "POST",
    headers: { "content-type": "application/json", "x-md-translation-trigger": "translation-trigger-test" },
    body: JSON.stringify({ eventID: "11111111-1111-4111-8111-111111111111" })
  }), { ...env, TRANSLATION_TRIGGER_TOKEN: "translation-trigger-test" });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { processing: { state: string } }).processing.state, "missing_credentials");
});

test("authorized admin status exposes review, failure, relationship, source and storage queues", async () => {
  const database = {
    prepare(sql: string) {
      return {
        async all() {
          const results = sql.includes("source_health") ? [{ source_code: "FEDERAL_REGISTER", state: "healthy" }]
            : sql.includes("document_relationships") ? [{ id: "relationship-1", review_state: "candidate" }]
            : sql.includes("storage_objects") ? [{ state: "ready", count: 3 }]
            : [];
          return { results, success: true, meta: {} };
        }
      };
    }
  } as unknown as D1Database;
  const response = await admin.fetch(new Request("https://admin.example.test/admin/status", {
    headers: { authorization: "Bearer test-admin-secret" }
  }), { ...env, CORE: database, OPS: database });
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  for (const key of ["jobs", "failures", "duplicateRevisions", "publicationQueue", "relationshipCandidates", "correctionQueue", "analystQueue", "marketProviders", "marketMapped", "sourceHealth", "storage"]) {
    assert.ok(key in body, `missing ${key}`);
  }
});
