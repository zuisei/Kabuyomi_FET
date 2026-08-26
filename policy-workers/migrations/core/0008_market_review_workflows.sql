PRAGMA foreign_keys = ON;

ALTER TABLE securities ADD COLUMN company_name TEXT;

ALTER TABLE market_data_providers ADD COLUMN rights_review_state TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE market_data_providers ADD COLUMN rights_reviewed_by TEXT;
ALTER TABLE market_data_providers ADD COLUMN rights_reviewed_at TEXT;
ALTER TABLE market_data_providers ADD COLUMN rights_note TEXT;

ALTER TABLE market_evaluations ADD COLUMN window_id TEXT REFERENCES market_windows(id);
ALTER TABLE market_evaluations ADD COLUMN provider_id TEXT REFERENCES market_data_providers(id);
ALTER TABLE market_evaluations ADD COLUMN evaluated_at TEXT;
ALTER TABLE market_evaluations ADD COLUMN time_precision TEXT;
ALTER TABLE market_evaluations ADD COLUMN license_mode TEXT;
ALTER TABLE market_evaluations ADD COLUMN attribution TEXT;
ALTER TABLE market_evaluations ADD COLUMN delay_status TEXT;
ALTER TABLE market_evaluations ADD COLUMN evidence_url TEXT;
ALTER TABLE market_evaluations ADD COLUMN reviewed_by TEXT;
ALTER TABLE market_evaluations ADD COLUMN reviewed_at TEXT;

CREATE INDEX market_evaluations_review_idx ON market_evaluations(reviewed_at, event_id);
CREATE INDEX market_providers_rights_idx ON market_data_providers(rights_review_state, enabled);

UPDATE securities SET company_name=ticker WHERE company_name IS NULL;
UPDATE market_data_providers SET rights_review_state='not_applicable',rights_note='No market data is displayed in this mode'
WHERE license_mode='market_disabled';
