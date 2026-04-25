-- Lightweight metadata indexes used to keep KV out of hot request paths.

CREATE TABLE IF NOT EXISTS latest_filing_aliases (
  extractor_version TEXT NOT NULL,
  ticker TEXT NOT NULL,
  filing_key TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (extractor_version, ticker)
);

CREATE INDEX IF NOT EXISTS idx_latest_filing_aliases_filing_key
  ON latest_filing_aliases (filing_key);

CREATE TABLE IF NOT EXISTS search_form_type_cache (
  ticker TEXT PRIMARY KEY,
  latest_form_type TEXT,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_form_type_cache_expires_at
  ON search_form_type_cache (expires_at);
