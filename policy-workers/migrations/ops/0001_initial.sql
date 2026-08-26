PRAGMA foreign_keys = ON;

CREATE TABLE ingestion_runs (
  id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  summary_json TEXT
);
CREATE INDEX ingestion_runs_started_idx ON ingestion_runs(started_at DESC);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingestion_runs(id),
  job_kind TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  locked_by TEXT,
  completed_at TEXT,
  payload_json TEXT NOT NULL,
  last_error TEXT
);
CREATE INDEX jobs_claim_idx ON jobs(status, available_at);
CREATE INDEX jobs_run_idx ON jobs(run_id);

CREATE TABLE job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  event_kind TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX job_events_job_idx ON job_events(job_id, created_at);

CREATE TABLE fetch_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ingestion_runs(id),
  source_code TEXT NOT NULL,
  request_url TEXT NOT NULL,
  response_status INTEGER,
  response_object_key TEXT,
  etag TEXT,
  last_modified TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_code TEXT
);
CREATE INDEX fetch_attempts_source_idx ON fetch_attempts(source_code, started_at DESC);

CREATE TABLE source_health (
  source_code TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_failure_at TEXT,
  next_check_at TEXT,
  detail_json TEXT
);

CREATE TABLE usage_counters (
  period_start TEXT NOT NULL,
  counter_name TEXT NOT NULL,
  counter_value INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(period_start, counter_name)
);

CREATE TABLE maintenance_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE dead_letters (
  id TEXT PRIMARY KEY,
  original_job_id TEXT NOT NULL,
  job_kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  error_json TEXT NOT NULL,
  failed_at TEXT NOT NULL,
  retained_until TEXT NOT NULL
);
CREATE INDEX dead_letters_retention_idx ON dead_letters(retained_until);

