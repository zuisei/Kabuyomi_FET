-- Server-issued anonymous installation principals and one-time App Attest challenges.
-- Raw IP addresses, legacy device keys, App Attest objects, and assertions are never stored.

CREATE TABLE IF NOT EXISTS installation_identities (
  principal TEXT PRIMARY KEY,
  token_reference TEXT NOT NULL UNIQUE,
  token_version INTEGER NOT NULL,
  attestation_status TEXT NOT NULL,
  credit_mode TEXT NOT NULL,
  app_attest_key_hash TEXT,
  network_key TEXT NOT NULL,
  legacy_device_key_hash TEXT,
  bootstrap_operation_hash TEXT NOT NULL UNIQUE,
  issued_at TEXT NOT NULL,
  attested_at TEXT,
  last_seen_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_installation_identities_legacy_key
  ON installation_identities (legacy_device_key_hash)
  WHERE legacy_device_key_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_installation_identities_network_issued
  ON installation_identities (network_key, issued_at);

CREATE TABLE IF NOT EXISTS installation_bootstrap_limits (
  network_route_key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  accepted_count INTEGER NOT NULL,
  rejected_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (network_route_key, window_start)
);

CREATE TABLE IF NOT EXISTS app_attest_challenges (
  challenge_id TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  token_reference TEXT NOT NULL,
  purpose TEXT NOT NULL,
  key_id_hash TEXT NOT NULL,
  nonce_digest TEXT NOT NULL,
  method TEXT,
  path TEXT,
  body_sha256 TEXT,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  result TEXT,
  FOREIGN KEY (principal) REFERENCES installation_identities(principal)
);

CREATE INDEX IF NOT EXISTS idx_app_attest_challenges_expiry
  ON app_attest_challenges (expires_at, consumed_at);
