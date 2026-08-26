import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcilePendingStorage,
  type PendingStorageObject,
  type StorageRepairIO
} from "../src/storage/repair.ts";

const referenced: PendingStorageObject = { id: "referenced", bucketRole: "raw", objectKey: "raw/referenced", sourceJobID: "job-complete" };
const active: PendingStorageObject = { id: "active", bucketRole: "derived", objectKey: "derived/active", sourceJobID: "job-active" };
const orphan: PendingStorageObject = { id: "orphan", bucketRole: "derived", objectKey: "derived/orphan", sourceJobID: "job-failed" };

test("pending R2 ledger repair marks references ready, preserves active work and removes orphans", async () => {
  const actions: string[] = [];
  const io: StorageRepairIO = {
    async listPending(cutoff) {
      assert.equal(cutoff, "2026-07-21T01:00:00.000Z");
      return [referenced, active, orphan];
    },
    async isReferenced(entry) { return entry.id === referenced.id; },
    async isJobActive(jobID, now) {
      assert.equal(now, "2026-07-21T02:00:00.000Z");
      return jobID === "job-active";
    },
    async markReady(entry) { actions.push(`ready:${entry.id}`); },
    async removeObject(entry) { actions.push(`r2-delete:${entry.id}`); },
    async removeLedgerEntry(entry) { actions.push(`ledger-delete:${entry.id}`); }
  };

  const summary = await reconcilePendingStorage(io, new Date("2026-07-21T02:00:00.000Z"), 3600);
  assert.deepEqual(summary, { scanned: 3, markedReady: 1, removed: 1, skippedActive: 1 });
  assert.deepEqual(actions, ["ready:referenced", "r2-delete:orphan", "ledger-delete:orphan"]);
});

test("repair enforces a fifteen-minute minimum pending age", async () => {
  let observedCutoff = "";
  const io: StorageRepairIO = {
    async listPending(cutoff) { observedCutoff = cutoff; return []; },
    async isReferenced() { return false; },
    async isJobActive() { return false; },
    async markReady() {},
    async removeObject() {},
    async removeLedgerEntry() {}
  };
  await reconcilePendingStorage(io, new Date("2026-07-21T02:00:00.000Z"), 1);
  assert.equal(observedCutoff, "2026-07-21T01:45:00.000Z");
});
