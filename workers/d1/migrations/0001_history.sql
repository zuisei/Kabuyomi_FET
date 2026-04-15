-- Kabuyomi history index
-- Keep D1 focused on lookup/index metadata. Heavy payloads live in R2.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS filings (
  filing_key TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  cik TEXT NOT NULL,
  form_type TEXT NOT NULL,
  filed_at TEXT NOT NULL,
  period_of_report TEXT NOT NULL,
  accession TEXT NOT NULL,
  primary_document_url TEXT,
  generated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_filings_ticker_period
  ON filings (ticker, form_type, period_of_report DESC);

CREATE TABLE IF NOT EXISTS metric_history (
  filing_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  period_end TEXT NOT NULL,
  logical_name TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  yoy_percent REAL,
  source_id TEXT NOT NULL,
  PRIMARY KEY (filing_key, logical_name, source_id),
  FOREIGN KEY (filing_key) REFERENCES filings(filing_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_metric_history_lookup
  ON metric_history (ticker, logical_name, period_end DESC);

CREATE TABLE IF NOT EXISTS segment_highlights (
  filing_key TEXT NOT NULL,
  ticker TEXT NOT NULL,
  period_end TEXT NOT NULL,
  dimension TEXT NOT NULL,
  label TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_id TEXT,
  PRIMARY KEY (filing_key, dimension, label),
  FOREIGN KEY (filing_key) REFERENCES filings(filing_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_segment_highlights_lookup
  ON segment_highlights (ticker, period_end DESC);
