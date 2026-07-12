-- App Store Server Notifications V2 dedupe and processing audit.
-- Never persist the raw signedPayload; only its SHA-256 digest and minimal
-- verified routing metadata are retained.

CREATE TABLE IF NOT EXISTS app_store_notifications (
  notification_uuid TEXT PRIMARY KEY,
  signed_date INTEGER NOT NULL,
  version TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  subtype TEXT,
  environment TEXT NOT NULL,
  entitlement_key TEXT,
  payload_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processing_started_at TEXT,
  processed_at TEXT,
  error_code TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_store_notifications_status_received
  ON app_store_notifications (status, received_at);

CREATE INDEX IF NOT EXISTS idx_app_store_notifications_entitlement_signed
  ON app_store_notifications (entitlement_key, signed_date DESC);
