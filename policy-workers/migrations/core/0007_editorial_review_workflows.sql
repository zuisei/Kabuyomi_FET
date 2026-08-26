PRAGMA foreign_keys = ON;

ALTER TABLE document_relationships ADD COLUMN reviewed_by TEXT;
ALTER TABLE document_relationships ADD COLUMN reviewed_at TEXT;

ALTER TABLE confounders ADD COLUMN kind TEXT NOT NULL DEFAULT 'other';
ALTER TABLE confounders ADD COLUMN relevance TEXT NOT NULL DEFAULT '';
ALTER TABLE confounders ADD COLUMN source_url TEXT;
ALTER TABLE confounders ADD COLUMN reviewed_by TEXT;
ALTER TABLE confounders ADD COLUMN reviewed_at TEXT;

CREATE TABLE analyst_reviews (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  summary_ja TEXT NOT NULL,
  domain_slug TEXT NOT NULL REFERENCES policy_domains(slug),
  important_clause_ja TEXT NOT NULL,
  clause_source_url TEXT NOT NULL,
  confounder_review_state TEXT NOT NULL CHECK(confounder_review_state IN ('verified_none','candidate','verified')),
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  note TEXT
);

CREATE INDEX analyst_reviews_event_idx ON analyst_reviews(event_id, reviewed_at DESC);
