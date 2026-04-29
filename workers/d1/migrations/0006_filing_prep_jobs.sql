-- Filing preparation job state for async watchlist add.
-- This keeps progress/failure visible without moving to Queues/Workflows yet.

CREATE TABLE IF NOT EXISTS filing_prep_jobs (
  job_id TEXT PRIMARY KEY,
  quota_subject TEXT NOT NULL,
  ticker TEXT NOT NULL,
  cik TEXT NOT NULL,
  company_name TEXT NOT NULL,
  status TEXT NOT NULL,
  filing_key TEXT,
  error_message TEXT,
  retry_after_seconds INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_filing_prep_jobs_subject_updated
  ON filing_prep_jobs (quota_subject, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_filing_prep_jobs_ticker_updated
  ON filing_prep_jobs (ticker, updated_at DESC);
