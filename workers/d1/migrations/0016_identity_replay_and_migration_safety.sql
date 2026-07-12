-- Bound installation credentials, App Attest assertions, and principal migrations.
-- Apply this migration before deploying Worker code that reads these columns.

ALTER TABLE installation_identities ADD COLUMN token_expires_at TEXT;
ALTER TABLE installation_identities ADD COLUMN revoked_at TEXT;
ALTER TABLE installation_identities ADD COLUMN last_assertion_counter INTEGER NOT NULL DEFAULT 0;

UPDATE installation_identities
SET token_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', issued_at, '+90 days')
WHERE token_expires_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_installation_identities_app_attest_key
  ON installation_identities (app_attest_key_hash)
  WHERE app_attest_key_hash IS NOT NULL;

ALTER TABLE app_attest_challenges ADD COLUMN expected_client_data_hash TEXT;

