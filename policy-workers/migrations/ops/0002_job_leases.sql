ALTER TABLE jobs ADD COLUMN claimed_by TEXT;
ALTER TABLE jobs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE jobs ADD COLUMN next_attempt_at TEXT;
ALTER TABLE jobs ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
ALTER TABLE jobs ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX jobs_idempotency_idx ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX jobs_lease_claim_idx ON jobs(status, next_attempt_at, lease_expires_at);
