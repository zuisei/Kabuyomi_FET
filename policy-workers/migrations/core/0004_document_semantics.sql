ALTER TABLE documents ADD COLUMN document_type TEXT NOT NULL DEFAULT 'other';
ALTER TABLE documents ADD COLUMN corrects_document_id TEXT REFERENCES documents(id);
ALTER TABLE documents ADD COLUMN source_stated_at TEXT;
ALTER TABLE documents ADD COLUMN source_stated_timezone TEXT;
ALTER TABLE documents ADD COLUMN first_observed_at TEXT;
ALTER TABLE documents ADD COLUMN ingested_at TEXT;
ALTER TABLE documents ADD COLUMN published_on TEXT;
ALTER TABLE documents ADD COLUMN effective_on TEXT;
ALTER TABLE documents ADD COLUMN applicable_on TEXT;
ALTER TABLE documents ADD COLUMN available_at TEXT;
ALTER TABLE documents ADD COLUMN availability_basis TEXT;

CREATE INDEX documents_number_idx ON documents(document_number);
CREATE INDEX documents_available_idx ON documents(available_at);

CREATE TRIGGER documents_type_insert_guard
BEFORE INSERT ON documents
WHEN NEW.document_type NOT IN ('final_rule', 'correcting_amendment', 'notice', 'other')
BEGIN
  SELECT RAISE(ABORT, 'unsupported document_type');
END;

CREATE TRIGGER documents_type_update_guard
BEFORE UPDATE OF document_type ON documents
WHEN NEW.document_type NOT IN ('final_rule', 'correcting_amendment', 'notice', 'other')
BEGIN
  SELECT RAISE(ABORT, 'unsupported document_type');
END;

CREATE TRIGGER documents_availability_insert_guard
BEFORE INSERT ON documents
WHEN NEW.availability_basis IS NOT NULL
  AND NEW.availability_basis NOT IN ('source_stated', 'first_observed', 'publication_date_only', 'manual_estimate')
BEGIN
  SELECT RAISE(ABORT, 'unsupported availability_basis');
END;

CREATE TRIGGER event_documents_relationship_insert_guard
BEFORE INSERT ON event_documents
WHEN NEW.relationship NOT IN ('primary', 'corrects', 'related')
BEGIN
  SELECT RAISE(ABORT, 'unsupported document relationship');
END;
