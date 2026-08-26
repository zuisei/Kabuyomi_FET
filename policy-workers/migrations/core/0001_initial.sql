PRAGMA foreign_keys = ON;

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  base_url TEXT,
  source_kind TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE source_items (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  external_id TEXT,
  canonical_url TEXT,
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  UNIQUE(source_id, external_id)
);
CREATE INDEX source_items_available_at_idx ON source_items(available_at);

CREATE TABLE storage_objects (
  id TEXT PRIMARY KEY,
  bucket_role TEXT NOT NULL CHECK (bucket_role IN ('raw', 'derived')),
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  content_type TEXT,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  source_item_id TEXT REFERENCES source_items(id),
  document_number TEXT,
  publisher TEXT NOT NULL,
  title TEXT NOT NULL,
  official_url TEXT,
  current_revision_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE document_revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  raw_object_id TEXT REFERENCES storage_objects(id),
  normalized_object_id TEXT REFERENCES storage_objects(id),
  official_published_at TEXT,
  first_detected_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  time_precision TEXT NOT NULL DEFAULT 'exact',
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(document_id, revision_number),
  UNIQUE(document_id, content_sha256)
);
CREATE INDEX document_revisions_replay_idx ON document_revisions(document_id, available_at);

CREATE TABLE document_diffs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  from_revision_id TEXT NOT NULL REFERENCES document_revisions(id),
  to_revision_id TEXT NOT NULL REFERENCES document_revisions(id),
  object_id TEXT NOT NULL REFERENCES storage_objects(id),
  summary_ja TEXT,
  available_at TEXT NOT NULL,
  UNIQUE(from_revision_id, to_revision_id)
);
CREATE INDEX document_diffs_available_at_idx ON document_diffs(document_id, available_at);

CREATE TABLE policy_events (
  id TEXT PRIMARY KEY,
  agency_code TEXT NOT NULL,
  title_ja TEXT NOT NULL,
  title_en TEXT,
  summary_ja TEXT NOT NULL,
  status TEXT NOT NULL,
  official_published_at TEXT,
  first_detected_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  published_at TEXT,
  is_synthetic INTEGER NOT NULL DEFAULT 0 CHECK (is_synthetic IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX policy_events_public_idx ON policy_events(published_at, last_activity_at DESC);

CREATE TABLE event_documents (
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  document_id TEXT NOT NULL REFERENCES documents(id),
  relationship TEXT NOT NULL,
  PRIMARY KEY(event_id, document_id)
);

CREATE TABLE timeline_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  kind TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  title_ja TEXT NOT NULL,
  detail_ja TEXT NOT NULL,
  source_type TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  document_revision_id TEXT REFERENCES document_revisions(id)
);
CREATE INDEX timeline_entries_replay_idx ON timeline_entries(event_id, available_at, occurred_at);

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  ticker TEXT,
  display_name TEXT NOT NULL,
  UNIQUE(entity_type, ticker)
);

CREATE TABLE event_entities (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  relationship TEXT NOT NULL,
  evidence_ja TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  available_at TEXT NOT NULL,
  UNIQUE(event_id, entity_id, relationship)
);
CREATE INDEX event_entities_replay_idx ON event_entities(event_id, available_at);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  display_name_ja TEXT NOT NULL
);

CREATE TABLE event_tags (
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  tag_id TEXT NOT NULL REFERENCES tags(id),
  PRIMARY KEY(event_id, tag_id)
);

CREATE TABLE confounders (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  occurred_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  title_ja TEXT NOT NULL,
  detail_ja TEXT NOT NULL,
  verification_state TEXT NOT NULL
);
CREATE INDEX confounders_replay_idx ON confounders(event_id, available_at);

CREATE TABLE market_evaluations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  ticker TEXT NOT NULL,
  benchmark_ticker TEXT NOT NULL,
  window_name TEXT NOT NULL,
  security_return REAL,
  benchmark_return REAL,
  abnormal_return REAL,
  max_volume_ratio REAL,
  abnormal_reaction_detected INTEGER CHECK (abnormal_reaction_detected IN (0, 1)),
  available_at TEXT NOT NULL,
  UNIQUE(event_id, ticker, benchmark_ticker, window_name)
);
CREATE INDEX market_evaluations_replay_idx ON market_evaluations(event_id, available_at);

CREATE TABLE market_points (
  id TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES market_evaluations(id),
  observed_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  normalized_security_price REAL NOT NULL,
  normalized_benchmark_price REAL NOT NULL,
  abnormal_return_points REAL NOT NULL,
  volume_ratio REAL NOT NULL,
  UNIQUE(evaluation_id, observed_at)
);
CREATE INDEX market_points_replay_idx ON market_points(evaluation_id, available_at, observed_at);

CREATE TABLE corrections (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  occurred_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  title_ja TEXT NOT NULL,
  detail_ja TEXT NOT NULL,
  supersedes_id TEXT REFERENCES corrections(id)
);
CREATE INDEX corrections_replay_idx ON corrections(event_id, available_at);

CREATE TABLE publication_reviews (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  state TEXT NOT NULL CHECK (state IN ('draft', 'approved', 'rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX publication_reviews_event_idx ON publication_reviews(event_id, created_at DESC);

CREATE TABLE event_read_models (
  event_id TEXT PRIMARY KEY REFERENCES policy_events(id),
  schema_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX event_read_models_public_idx ON event_read_models(published_at);
