CREATE TABLE policy_translations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  source_content_hash TEXT NOT NULL,
  source_language TEXT NOT NULL DEFAULT 'en',
  title_ja TEXT NOT NULL,
  title_status TEXT NOT NULL DEFAULT 'machine_translated',
  factual_summary_ja TEXT NOT NULL,
  factual_summary_status TEXT NOT NULL DEFAULT 'machine_translated',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  translated_at TEXT NOT NULL,
  validation_warnings_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(validation_warnings_json)),
  created_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  UNIQUE(event_id, source_content_hash, prompt_version)
);

CREATE INDEX policy_translations_event_idx
ON policy_translations(event_id, translated_at DESC);

CREATE INDEX policy_translations_status_idx
ON policy_translations(title_status, factual_summary_status, translated_at DESC);

CREATE TRIGGER policy_translations_values_insert_guard
BEFORE INSERT ON policy_translations
WHEN NEW.title_status NOT IN ('machine_translated','editorial_reviewed','rejected')
  OR NEW.factual_summary_status NOT IN ('machine_translated','editorial_reviewed','rejected')
  OR length(NEW.source_content_hash) <> 64
  OR NEW.source_content_hash GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'unsupported policy translation value');
END;

CREATE TRIGGER policy_translations_values_update_guard
BEFORE UPDATE ON policy_translations
WHEN NEW.title_status NOT IN ('machine_translated','editorial_reviewed','rejected')
  OR NEW.factual_summary_status NOT IN ('machine_translated','editorial_reviewed','rejected')
  OR length(NEW.source_content_hash) <> 64
  OR NEW.source_content_hash GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'unsupported policy translation value');
END;

CREATE TRIGGER policy_translations_review_insert_guard
BEFORE INSERT ON policy_translations
WHEN (NEW.title_status = 'editorial_reviewed' OR NEW.factual_summary_status = 'editorial_reviewed')
  AND (trim(COALESCE(NEW.reviewed_by,'')) = '' OR NEW.reviewed_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'translation reviewer is required');
END;

CREATE TRIGGER policy_translations_review_update_guard
BEFORE UPDATE ON policy_translations
WHEN (NEW.title_status = 'editorial_reviewed' OR NEW.factual_summary_status = 'editorial_reviewed')
  AND (trim(COALESCE(NEW.reviewed_by,'')) = '' OR NEW.reviewed_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'translation reviewer is required');
END;

PRAGMA foreign_keys = ON;
