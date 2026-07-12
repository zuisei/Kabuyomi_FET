-- Additive index and migration audit for stable Apple subscription principals.
-- Hot entitlement and quota state remains in Durable Objects. Only opaque/HMAC
-- identifiers and reconciliation metadata are stored here.

CREATE TABLE IF NOT EXISTS subscription_entitlement_index (
  entitlement_key TEXT PRIMARY KEY,
  stable_principal TEXT NOT NULL UNIQUE,
  principal_key_version TEXT NOT NULL,
  legacy_quota_subject TEXT,
  environment TEXT NOT NULL,
  status TEXT NOT NULL,
  product_id TEXT,
  period_start TEXT,
  period_end TEXT,
  expires_at TEXT,
  last_verified_at TEXT NOT NULL,
  verification_version TEXT NOT NULL,
  migration_status TEXT NOT NULL DEFAULT 'not_required',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_entitlement_index_status_updated
  ON subscription_entitlement_index (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS subscription_device_bindings (
  entitlement_key TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  method TEXT NOT NULL,
  bound_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  transfer_id TEXT,
  PRIMARY KEY (entitlement_key, binding_hash),
  FOREIGN KEY (entitlement_key) REFERENCES subscription_entitlement_index(entitlement_key)
);

CREATE INDEX IF NOT EXISTS idx_subscription_device_bindings_status
  ON subscription_device_bindings (entitlement_key, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS subscription_principal_migrations (
  migration_id TEXT PRIMARY KEY,
  entitlement_key TEXT NOT NULL UNIQUE,
  target_principal TEXT NOT NULL,
  status TEXT NOT NULL,
  manifest_digest TEXT NOT NULL,
  expected_monthly_remaining INTEGER NOT NULL,
  expected_purchased_remaining INTEGER NOT NULL,
  source_count INTEGER NOT NULL,
  conflict_reason TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  reconciled_at TEXT,
  FOREIGN KEY (entitlement_key) REFERENCES subscription_entitlement_index(entitlement_key)
);

CREATE INDEX IF NOT EXISTS idx_subscription_principal_migrations_status
  ON subscription_principal_migrations (status, created_at);

CREATE TABLE IF NOT EXISTS subscription_principal_migration_sources (
  migration_id TEXT NOT NULL,
  source_quota_subject TEXT NOT NULL,
  source_snapshot_digest TEXT NOT NULL,
  monthly_remaining INTEGER NOT NULL,
  purchased_remaining INTEGER NOT NULL,
  evidence_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (migration_id, source_quota_subject),
  FOREIGN KEY (migration_id) REFERENCES subscription_principal_migrations(migration_id)
);
