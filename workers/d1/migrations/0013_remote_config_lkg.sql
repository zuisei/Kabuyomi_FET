CREATE TABLE IF NOT EXISTS remote_config_lkg (
  singleton_key TEXT PRIMARY KEY CHECK (singleton_key = 'active'),
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  max_stale_age_seconds INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
