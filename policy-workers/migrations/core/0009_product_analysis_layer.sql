CREATE TABLE policy_analyses (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  analysis_status TEXT NOT NULL DEFAULT 'unreviewed',
  presentation_tier TEXT NOT NULL DEFAULT 'archive',
  canonical_title_ja TEXT,
  canonical_title_en TEXT,
  change_summary_ja TEXT,
  why_it_matters_ja TEXT,
  policy_type TEXT,
  policy_domain_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(policy_domain_codes_json)),
  primary_agency_code TEXT,
  affected_region_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(affected_region_codes_json)),
  affected_sector_codes_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(affected_sector_codes_json)),
  affected_product_terms_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(affected_product_terms_json)),
  market_analysis_mode TEXT NOT NULL DEFAULT 'unmapped',
  market_relevance_reason_ja TEXT,
  no_company_reason_ja TEXT,
  no_market_data_reason_ja TEXT,
  editorial_priority INTEGER NOT NULL DEFAULT 0,
  analysis_version INTEGER NOT NULL CHECK (analysis_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  published_at TEXT,
  UNIQUE(event_id, analysis_version)
);

CREATE INDEX policy_analyses_event_version_idx ON policy_analyses(event_id, analysis_version DESC);
CREATE INDEX policy_analyses_public_idx ON policy_analyses(analysis_status, presentation_tier, editorial_priority DESC, updated_at DESC);

CREATE TABLE policy_analysis_history (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL REFERENCES policy_analyses(id),
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL
);

CREATE INDEX policy_analysis_history_event_idx ON policy_analysis_history(event_id, created_at DESC);

CREATE TABLE policy_company_relations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  issuer_id TEXT NOT NULL REFERENCES issuers(id),
  security_id TEXT REFERENCES securities(id),
  relation_type TEXT NOT NULL,
  evidence_document_id TEXT REFERENCES documents(id),
  evidence_reference TEXT NOT NULL,
  evidence_summary_ja TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  UNIQUE(event_id, issuer_id, security_id, relation_type)
);

CREATE INDEX policy_company_relations_event_idx ON policy_company_relations(event_id, review_status, relation_type);

ALTER TABLE company_exposures ADD COLUMN relation_type TEXT;
ALTER TABLE company_exposures ADD COLUMN review_status TEXT;
ALTER TABLE exposure_evidence ADD COLUMN evidence_reference TEXT;
ALTER TABLE exposure_evidence ADD COLUMN evidence_summary_ja TEXT;

UPDATE company_exposures
SET relation_type = CASE relationship
  WHEN 'supplier' THEN 'supply_chain'
  ELSE relationship
END,
review_status = review_state
WHERE relation_type IS NULL OR review_status IS NULL;

CREATE TRIGGER policy_analyses_values_insert_guard
BEFORE INSERT ON policy_analyses
WHEN NEW.analysis_status NOT IN ('unreviewed','automated_draft','editorial_reviewed','published','rejected')
  OR NEW.presentation_tier NOT IN ('signal','monitor','archive')
  OR NEW.market_analysis_mode NOT IN ('intraday','daily','unmapped','not_applicable','disabled')
BEGIN
  SELECT RAISE(ABORT, 'unsupported policy analysis value');
END;

CREATE TRIGGER policy_analyses_values_update_guard
BEFORE UPDATE OF analysis_status,presentation_tier,market_analysis_mode ON policy_analyses
WHEN NEW.analysis_status NOT IN ('unreviewed','automated_draft','editorial_reviewed','published','rejected')
  OR NEW.presentation_tier NOT IN ('signal','monitor','archive')
  OR NEW.market_analysis_mode NOT IN ('intraday','daily','unmapped','not_applicable','disabled')
BEGIN
  SELECT RAISE(ABORT, 'unsupported policy analysis value');
END;

CREATE TRIGGER policy_analyses_signal_insert_guard
BEFORE INSERT ON policy_analyses
WHEN NEW.presentation_tier = 'signal' AND (
  trim(COALESCE(NEW.canonical_title_ja,'')) = ''
  OR trim(COALESCE(NEW.change_summary_ja,'')) = ''
  OR trim(COALESCE(NEW.why_it_matters_ja,'')) = ''
  OR trim(COALESCE(NEW.policy_type,'')) = ''
  OR (json_array_length(NEW.policy_domain_codes_json) = 0 AND json_array_length(NEW.affected_region_codes_json) = 0)
)
BEGIN
  SELECT RAISE(ABORT, 'signal analysis requires editorial fields');
END;

CREATE TRIGGER policy_analyses_signal_update_guard
BEFORE UPDATE ON policy_analyses
WHEN NEW.presentation_tier = 'signal' AND (
  trim(COALESCE(NEW.canonical_title_ja,'')) = ''
  OR trim(COALESCE(NEW.change_summary_ja,'')) = ''
  OR trim(COALESCE(NEW.why_it_matters_ja,'')) = ''
  OR trim(COALESCE(NEW.policy_type,'')) = ''
  OR (json_array_length(NEW.policy_domain_codes_json) = 0 AND json_array_length(NEW.affected_region_codes_json) = 0)
)
BEGIN
  SELECT RAISE(ABORT, 'signal analysis requires editorial fields');
END;

CREATE TRIGGER policy_analyses_human_review_insert_guard
BEFORE INSERT ON policy_analyses
WHEN NEW.analysis_status IN ('editorial_reviewed','published') AND (
  trim(COALESCE(NEW.reviewed_by,'')) = '' OR NEW.reviewed_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'human reviewer is required');
END;

CREATE TRIGGER policy_analyses_human_review_update_guard
BEFORE UPDATE OF analysis_status,reviewed_by,reviewed_at ON policy_analyses
WHEN NEW.analysis_status IN ('editorial_reviewed','published') AND (
  trim(COALESCE(NEW.reviewed_by,'')) = '' OR NEW.reviewed_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'human reviewer is required');
END;

CREATE TRIGGER policy_company_relations_values_insert_guard
BEFORE INSERT ON policy_company_relations
WHEN NEW.relation_type NOT IN ('direct','indirect','supply_chain','competitor','customer','geographic_exposure','policy_beneficiary','policy_risk')
  OR NEW.review_status NOT IN ('candidate','approved','rejected')
BEGIN
  SELECT RAISE(ABORT, 'unsupported company relation value');
END;

CREATE TRIGGER policy_company_relations_values_update_guard
BEFORE UPDATE OF relation_type,review_status ON policy_company_relations
WHEN NEW.relation_type NOT IN ('direct','indirect','supply_chain','competitor','customer','geographic_exposure','policy_beneficiary','policy_risk')
  OR NEW.review_status NOT IN ('candidate','approved','rejected')
BEGIN
  SELECT RAISE(ABORT, 'unsupported company relation value');
END;

INSERT INTO policy_analyses (
  id,event_id,analysis_status,presentation_tier,canonical_title_en,policy_type,
  policy_domain_codes_json,primary_agency_code,affected_region_codes_json,
  affected_sector_codes_json,affected_product_terms_json,market_analysis_mode,
  editorial_priority,analysis_version,created_at,updated_at
)
SELECT
  id || ':analysis:1',id,'unreviewed','archive',title_en,'unclassified',
  CASE WHEN domain_slug IS NULL THEN '[]' ELSE json_array(domain_slug) END,
  agency_code,'[]','[]','[]','unmapped',0,1,updated_at,updated_at
FROM policy_events;
