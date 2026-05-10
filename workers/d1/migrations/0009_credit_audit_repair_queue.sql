-- Recoverable audit repair queue for post-DO D1 audit write failures.
-- The USER_QUOTA Durable Object remains the credit balance source of truth.

CREATE TABLE IF NOT EXISTS credit_audit_repair_queue (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL,
  kind TEXT NOT NULL,
  operation_id TEXT,
  quota_subject_hash TEXT,
  transaction_id_suffix TEXT,
  reward_intent_id_suffix TEXT,
  source TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credit_audit_repair_queue_status_created
  ON credit_audit_repair_queue (status, created_at);

CREATE INDEX IF NOT EXISTS idx_credit_audit_repair_queue_kind_updated
  ON credit_audit_repair_queue (kind, updated_at DESC);
