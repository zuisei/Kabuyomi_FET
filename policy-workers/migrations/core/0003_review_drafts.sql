ALTER TABLE publication_reviews ADD COLUMN draft_object_key TEXT;
ALTER TABLE publication_reviews ADD COLUMN source_job_id TEXT;
ALTER TABLE publication_reviews ADD COLUMN content_sha256 TEXT;

CREATE UNIQUE INDEX publication_reviews_source_job_idx ON publication_reviews(source_job_id) WHERE source_job_id IS NOT NULL;
CREATE INDEX publication_reviews_draft_idx ON publication_reviews(event_id, state, created_at DESC);

CREATE TRIGGER publication_reviews_sha256_insert_guard
BEFORE INSERT ON publication_reviews
WHEN NEW.content_sha256 IS NOT NULL AND (
  length(NEW.content_sha256) != 64
  OR NEW.content_sha256 != lower(NEW.content_sha256)
  OR NEW.content_sha256 GLOB '*[^0-9a-f]*'
)
BEGIN
  SELECT RAISE(ABORT, 'content_sha256 must be 64 lowercase hexadecimal characters');
END;
