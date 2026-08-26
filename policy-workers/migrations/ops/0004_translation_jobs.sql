CREATE TABLE translation_jobs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  source_content_hash TEXT NOT NULL,
  source_available_at TEXT NOT NULL,
  lane TEXT NOT NULL,
  status TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  estimated_input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (estimated_input_tokens >= 0),
  estimated_output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (estimated_output_tokens >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  openai_response_id TEXT,
  openai_batch_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(event_id, source_content_hash, prompt_version)
);

CREATE INDEX translation_jobs_claim_idx
ON translation_jobs(lane, status, COALESCE(next_attempt_at, created_at));

CREATE TABLE translation_batch_manifests (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  cutoff_before TEXT NOT NULL,
  candidate_count INTEGER NOT NULL CHECK (candidate_count > 0),
  estimated_input_tokens INTEGER NOT NULL CHECK (estimated_input_tokens >= 0),
  estimated_output_tokens INTEGER NOT NULL CHECK (estimated_output_tokens >= 0),
  estimated_max_cost_usd REAL NOT NULL CHECK (estimated_max_cost_usd >= 0),
  manifest_object_key TEXT NOT NULL,
  openai_input_file_id TEXT,
  openai_batch_id TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  completed_at TEXT,
  last_error TEXT
);

CREATE INDEX translation_batch_manifests_status_idx
ON translation_batch_manifests(status, created_at DESC);

CREATE TABLE translation_batch_manifest_jobs (
  manifest_id TEXT NOT NULL REFERENCES translation_batch_manifests(id),
  job_id TEXT NOT NULL REFERENCES translation_jobs(id),
  PRIMARY KEY(manifest_id, job_id),
  UNIQUE(job_id)
);

CREATE INDEX translation_batch_manifest_jobs_job_idx
ON translation_batch_manifest_jobs(job_id);

CREATE TRIGGER translation_jobs_values_insert_guard
BEFORE INSERT ON translation_jobs
WHEN NEW.lane NOT IN ('realtime','batch','manual_priority')
  OR NEW.status NOT IN ('queued','awaiting_batch','processing','submitted','completed','retry','failed','cancelled')
  OR length(NEW.source_content_hash) <> 64
  OR NEW.source_content_hash GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'unsupported translation job value');
END;

CREATE TRIGGER translation_jobs_values_update_guard
BEFORE UPDATE ON translation_jobs
WHEN NEW.lane NOT IN ('realtime','batch','manual_priority')
  OR NEW.status NOT IN ('queued','awaiting_batch','processing','submitted','completed','retry','failed','cancelled')
  OR length(NEW.source_content_hash) <> 64
  OR NEW.source_content_hash GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'unsupported translation job value');
END;

CREATE TRIGGER translation_batch_manifests_values_insert_guard
BEFORE INSERT ON translation_batch_manifests
WHEN NEW.status NOT IN ('prepared','submitted','processing','completed','failed','cancelled')
BEGIN
  SELECT RAISE(ABORT, 'unsupported translation batch manifest state');
END;

CREATE TRIGGER translation_batch_manifests_values_update_guard
BEFORE UPDATE OF status ON translation_batch_manifests
WHEN NEW.status NOT IN ('prepared','submitted','processing','completed','failed','cancelled')
BEGIN
  SELECT RAISE(ABORT, 'unsupported translation batch manifest state');
END;

PRAGMA foreign_keys = ON;
