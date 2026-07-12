CREATE TABLE IF NOT EXISTS account_principals (
  account_principal TEXT PRIMARY KEY,
  apple_subject_digest TEXT NOT NULL UNIQUE,
  app_account_token TEXT NOT NULL UNIQUE,
  key_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_authenticated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_device_bindings (
  account_principal TEXT NOT NULL,
  installation_principal_digest TEXT NOT NULL UNIQUE,
  bound_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (account_principal, installation_principal_digest),
  FOREIGN KEY (account_principal) REFERENCES account_principals(account_principal)
);

CREATE TABLE IF NOT EXISTS paid_credit_account_migrations (
  migration_id TEXT PRIMARY KEY,
  account_principal TEXT NOT NULL,
  legacy_principal_digest TEXT NOT NULL UNIQUE,
  source_snapshot_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('previewed', 'applying', 'applied', 'conflict')),
  conflict_reason TEXT,
  expected_purchased_remaining INTEGER NOT NULL DEFAULT 0,
  purchase_evidence_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  applied_at TEXT,
  FOREIGN KEY (account_principal) REFERENCES account_principals(account_principal)
);

CREATE INDEX IF NOT EXISTS idx_account_device_bindings_account
  ON account_device_bindings(account_principal);
