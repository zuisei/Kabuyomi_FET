export type PendingStorageObject = {
  id: string;
  bucketRole: "raw" | "derived";
  objectKey: string;
  sourceJobID: string | null;
};

export type StorageRepairSummary = {
  scanned: number;
  markedReady: number;
  removed: number;
  skippedActive: number;
};

export interface StorageRepairIO {
  listPending(cutoff: string): Promise<PendingStorageObject[]>;
  isReferenced(entry: PendingStorageObject): Promise<boolean>;
  isJobActive(jobID: string, now: string): Promise<boolean>;
  markReady(entry: PendingStorageObject, now: string): Promise<void>;
  removeObject(entry: PendingStorageObject): Promise<void>;
  removeLedgerEntry(entry: PendingStorageObject): Promise<void>;
}

export async function reconcilePendingStorage(
  io: StorageRepairIO,
  now = new Date(),
  minimumAgeSeconds = 3600
): Promise<StorageRepairSummary> {
  const cutoff = new Date(now.getTime() - Math.max(900, minimumAgeSeconds) * 1000).toISOString();
  const nowISO = now.toISOString();
  const pending = await io.listPending(cutoff);
  const summary: StorageRepairSummary = { scanned: pending.length, markedReady: 0, removed: 0, skippedActive: 0 };

  for (const entry of pending) {
    if (await io.isReferenced(entry)) {
      await io.markReady(entry, nowISO);
      summary.markedReady += 1;
      continue;
    }
    if (entry.sourceJobID && await io.isJobActive(entry.sourceJobID, nowISO)) {
      summary.skippedActive += 1;
      continue;
    }
    await io.removeObject(entry);
    await io.removeLedgerEntry(entry);
    summary.removed += 1;
  }
  return summary;
}

export type StorageRepairEnv = {
  CORE: D1Database;
  OPS: D1Database;
  RAW: R2Bucket;
  DERIVED: R2Bucket;
};

export async function repairPendingStorage(
  env: StorageRepairEnv,
  now = new Date(),
  minimumAgeSeconds = 3600
): Promise<StorageRepairSummary> {
  const io: StorageRepairIO = {
    async listPending(cutoff) {
      const rows = await env.CORE.prepare(`SELECT id,bucket_role AS bucketRole,object_key AS objectKey,source_job_id AS sourceJobID
        FROM storage_objects WHERE state='pending' AND updated_at <= ? ORDER BY updated_at LIMIT 100`).bind(cutoff).all<PendingStorageObject>();
      return rows.results;
    },
    async isReferenced(entry) {
      const reference = await env.CORE.prepare(`SELECT 1 AS found FROM document_revisions WHERE raw_object_id=? OR normalized_object_id=?
        UNION SELECT 1 FROM document_diffs WHERE object_id=?
        UNION SELECT 1 FROM publication_reviews WHERE draft_object_key=? LIMIT 1`).bind(entry.id, entry.id, entry.id, entry.objectKey).first<{ found: number }>();
      return reference?.found === 1;
    },
    async isJobActive(jobID, currentTime) {
      const job = await env.OPS.prepare("SELECT status,lease_expires_at FROM jobs WHERE id=?").bind(jobID).first<{ status: string; lease_expires_at: string | null }>();
      return job?.status === "processing" && !!job.lease_expires_at && job.lease_expires_at > currentTime;
    },
    async markReady(entry, currentTime) {
      await env.CORE.prepare("UPDATE storage_objects SET state='ready',updated_at=? WHERE id=? AND state='pending'").bind(currentTime, entry.id).run();
    },
    async removeObject(entry) {
      await (entry.bucketRole === "raw" ? env.RAW : env.DERIVED).delete(entry.objectKey);
    },
    async removeLedgerEntry(entry) {
      await env.CORE.prepare("DELETE FROM storage_objects WHERE id=? AND state='pending'").bind(entry.id).run();
    }
  };
  return reconcilePendingStorage(io, now, minimumAgeSeconds);
}
