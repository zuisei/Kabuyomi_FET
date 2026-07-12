-- One-time, auditable legacy-device to server-installation quota migrations.
-- Only keyed legacy digests and server principals are stored; raw device keys are never persisted.

CREATE TABLE IF NOT EXISTS installation_principal_migrations (
  legacy_device_key_hash TEXT PRIMARY KEY,
  installation_principal TEXT NOT NULL UNIQUE,
  migration_id TEXT NOT NULL UNIQUE,
  source_snapshot_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applying', 'applied', 'no_source', 'conflict')),
  conflict_reason TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (installation_principal) REFERENCES installation_identities(principal)
);

CREATE INDEX IF NOT EXISTS idx_installation_principal_migrations_status
  ON installation_principal_migrations(status, created_at);
