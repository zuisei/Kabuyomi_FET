import assert from "node:assert/strict";
import test from "node:test";
import { StorageKey } from "../src/storage/storage-key.ts";

const documentId = "E6A78BA1-531A-4C10-9F2F-0B6FD116A001";
const fromRevisionId = "B4000001-0000-4000-8000-000000000001";
const toRevisionId = "B4000001-0000-4000-8000-000000000002";

test("raw object keys are content addressed and normalized", () => {
  const hash = "D554B3F1FAA68C3B76C5C09CAB44B3157DFD34B0F1984C0CF25AAC84F987DE21";
  assert.equal(StorageKey.raw(hash), `v1/blobs/sha256/d5/${hash.toLowerCase()}`);
  assert.throws(() => StorageKey.raw("abcd"), /64 hexadecimal/);
});

test("derived object keys are deterministic", () => {
  const document = documentId.toLowerCase();
  const from = fromRevisionId.toLowerCase();
  const to = toRevisionId.toLowerCase();
  assert.equal(StorageKey.normalized(documentId, fromRevisionId), `v1/documents/${document}/revisions/${from}/normalized.json`);
  assert.equal(StorageKey.plainText(documentId, fromRevisionId), `v1/documents/${document}/revisions/${from}/plain.txt`);
  assert.equal(StorageKey.diff(documentId, fromRevisionId, toRevisionId), `v1/documents/${document}/diffs/${from}--${to}.json`);
});

test("temporary keys are scoped to a run and job", () => {
  assert.equal(
    StorageKey.temp(documentId, fromRevisionId, "response.body"),
    `v1/runs/${documentId.toLowerCase()}/jobs/${fromRevisionId.toLowerCase()}/response.body`
  );
  assert.throws(() => StorageKey.temp("not-a-uuid", fromRevisionId, "parser-debug.json"), /runId/);
});

