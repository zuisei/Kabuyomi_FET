ALTER TABLE storage_objects ADD COLUMN state TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE storage_objects ADD COLUMN source_job_id TEXT;
ALTER TABLE storage_objects ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';

UPDATE storage_objects SET updated_at = created_at WHERE updated_at = '1970-01-01T00:00:00Z';

CREATE INDEX storage_objects_state_idx ON storage_objects(state, updated_at);
CREATE INDEX storage_objects_job_idx ON storage_objects(source_job_id);

CREATE TRIGGER storage_objects_state_insert_guard
BEFORE INSERT ON storage_objects
WHEN NEW.state NOT IN ('pending', 'ready')
BEGIN
  SELECT RAISE(ABORT, 'unsupported storage object state');
END;

CREATE TRIGGER storage_objects_state_update_guard
BEFORE UPDATE OF state ON storage_objects
WHEN NEW.state NOT IN ('pending', 'ready')
BEGIN
  SELECT RAISE(ABORT, 'unsupported storage object state');
END;
