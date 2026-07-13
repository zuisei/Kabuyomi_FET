-- Persist only the verified App Attest public key and its Apple environment.
-- Private keys remain hardware-bound on device; raw attestation/assertion objects are never stored.

ALTER TABLE installation_identities ADD COLUMN app_attest_public_key_spki BLOB
  CHECK (app_attest_public_key_spki IS NULL OR length(app_attest_public_key_spki) BETWEEN 80 AND 120);
ALTER TABLE installation_identities ADD COLUMN app_attest_environment TEXT
  CHECK (app_attest_environment IS NULL OR app_attest_environment IN ('development', 'production'));
