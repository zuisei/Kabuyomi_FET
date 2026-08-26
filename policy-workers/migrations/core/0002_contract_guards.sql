CREATE TRIGGER document_revisions_sha256_insert_guard
BEFORE INSERT ON document_revisions
WHEN length(NEW.content_sha256) != 64
  OR NEW.content_sha256 != lower(NEW.content_sha256)
  OR NEW.content_sha256 GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'content_sha256 must be 64 lowercase hexadecimal characters');
END;

CREATE TRIGGER document_revisions_sha256_update_guard
BEFORE UPDATE OF content_sha256 ON document_revisions
WHEN length(NEW.content_sha256) != 64
  OR NEW.content_sha256 != lower(NEW.content_sha256)
  OR NEW.content_sha256 GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'content_sha256 must be 64 lowercase hexadecimal characters');
END;

CREATE TRIGGER storage_objects_sha256_insert_guard
BEFORE INSERT ON storage_objects
WHEN length(NEW.sha256) != 64
  OR NEW.sha256 != lower(NEW.sha256)
  OR NEW.sha256 GLOB '*[^0-9a-f]*'
BEGIN
  SELECT RAISE(ABORT, 'sha256 must be 64 lowercase hexadecimal characters');
END;

CREATE TRIGGER policy_events_agency_insert_guard
BEFORE INSERT ON policy_events
WHEN NEW.agency_code NOT IN ('BIS', 'WH', 'USTR', 'DOC', 'FR', 'GOVINFO')
BEGIN
  SELECT RAISE(ABORT, 'unsupported agency_code');
END;

CREATE TRIGGER policy_events_agency_update_guard
BEFORE UPDATE OF agency_code ON policy_events
WHEN NEW.agency_code NOT IN ('BIS', 'WH', 'USTR', 'DOC', 'FR', 'GOVINFO')
BEGIN
  SELECT RAISE(ABORT, 'unsupported agency_code');
END;

