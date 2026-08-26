PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS policy_events_agency_insert_guard;
DROP TRIGGER IF EXISTS policy_events_agency_update_guard;
DROP TRIGGER IF EXISTS documents_type_insert_guard;
DROP TRIGGER IF EXISTS documents_type_update_guard;
DROP TRIGGER IF EXISTS event_documents_relationship_insert_guard;

ALTER TABLE policy_events ADD COLUMN coverage_state TEXT NOT NULL DEFAULT 'metadata_only';
ALTER TABLE policy_events ADD COLUMN verification_state TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE policy_events ADD COLUMN domain_slug TEXT;
ALTER TABLE policy_events ADD COLUMN instrument_type TEXT;
ALTER TABLE policy_events ADD COLUMN time_precision TEXT NOT NULL DEFAULT 'day';
ALTER TABLE documents ADD COLUMN govinfo_url TEXT;
ALTER TABLE documents ADD COLUMN metadata_sha256 TEXT;

CREATE INDEX policy_events_taxonomy_idx ON policy_events(domain_slug,instrument_type,coverage_state);
CREATE INDEX policy_events_agency_idx ON policy_events(agency_code,last_activity_at DESC);

CREATE TABLE policy_domains (
  slug TEXT PRIMARY KEY,
  label_ja TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE
);

CREATE TABLE policy_instruments (
  code TEXT PRIMARY KEY,
  label_en TEXT NOT NULL,
  sort_order INTEGER NOT NULL UNIQUE
);

CREATE TABLE source_adapters (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  tier TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  requires_api_key INTEGER NOT NULL DEFAULT 0 CHECK(requires_api_key IN (0,1)),
  schedule_minutes INTEGER,
  notes TEXT
);

CREATE TABLE dockets (
  id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL,
  official_url TEXT NOT NULL,
  title TEXT,
  rin TEXT,
  last_verified_at TEXT
);

CREATE TABLE event_dockets (
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  docket_id TEXT NOT NULL REFERENCES dockets(id),
  PRIMARY KEY(event_id,docket_id)
);

CREATE TABLE document_relationships (
  id TEXT PRIMARY KEY,
  from_document_id TEXT NOT NULL REFERENCES documents(id),
  to_document_id TEXT NOT NULL REFERENCES documents(id),
  relationship TEXT NOT NULL,
  confidence REAL,
  review_state TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL,
  UNIQUE(from_document_id,to_document_id,relationship)
);

CREATE TABLE issuers (
  id TEXT PRIMARY KEY,
  cik TEXT UNIQUE,
  legal_name TEXT NOT NULL,
  sic TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  last_verified_at TEXT
);

CREATE TABLE securities (
  id TEXT PRIMARY KEY,
  issuer_id TEXT REFERENCES issuers(id),
  ticker TEXT NOT NULL,
  exchange TEXT NOT NULL,
  security_class TEXT,
  is_benchmark INTEGER NOT NULL DEFAULT 0 CHECK(is_benchmark IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  UNIQUE(ticker,exchange)
);

CREATE TABLE ticker_aliases (
  alias TEXT NOT NULL,
  security_id TEXT NOT NULL REFERENCES securities(id),
  valid_from TEXT,
  valid_to TEXT,
  PRIMARY KEY(alias,security_id)
);

CREATE TABLE company_exposures (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  security_id TEXT NOT NULL REFERENCES securities(id),
  relationship TEXT NOT NULL,
  confidence REAL,
  origin TEXT NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'candidate',
  reviewed_by TEXT,
  reviewed_at TEXT,
  UNIQUE(event_id,security_id,relationship)
);

CREATE TABLE exposure_evidence (
  id TEXT PRIMARY KEY,
  exposure_id TEXT NOT NULL REFERENCES company_exposures(id),
  document_id TEXT REFERENCES documents(id),
  clause_text TEXT,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE market_data_providers (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  license_mode TEXT NOT NULL,
  attribution TEXT,
  delay_status TEXT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))
);

CREATE TABLE market_windows (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES policy_events(id),
  security_id TEXT NOT NULL REFERENCES securities(id),
  provider_id TEXT NOT NULL REFERENCES market_data_providers(id),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  time_precision TEXT NOT NULL,
  benchmark_security_id TEXT REFERENCES securities(id),
  evaluated_at TEXT,
  license_mode TEXT NOT NULL,
  attribution TEXT,
  UNIQUE(event_id,security_id,provider_id,window_start,window_end)
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO policy_domains(slug,label_ja,sort_order) VALUES
('foreign-security','外交・安全保障',1),('defense-procurement','防衛・政府調達',2),('trade-tariffs','貿易・関税',3),('export-controls-sanctions','輸出管理・制裁',4),('financial-regulation','金融規制・銀行・証券',5),('monetary-policy','金融政策・中央銀行',6),('tax-budget','税制・財政・予算',7),('antitrust','競争政策・反トラスト',8),('technology-ai-semiconductors','テクノロジー・AI・半導体',9),('telecommunications','通信・電波',10),('energy-nuclear','エネルギー・原子力',11),('environment-climate','環境・気候',12),('health-medicine','医薬品・医療・公衆衛生',13),('labor-employment','労働・雇用',14),('immigration-border','移民・国境',15),('agriculture-food','農業・食品',16),('transportation','運輸・航空・自動車',17),('housing-real-estate','住宅・不動産',18),('education','教育',19),('consumer-protection','消費者保護',20),('industrial-policy','産業政策・補助金',21);

INSERT INTO policy_instruments(code,label_en,sort_order) VALUES
('final_rule','Final Rule',1),('proposed_rule','Proposed Rule',2),('interim_final_rule','Interim Final Rule',3),('notice','Notice',4),('correcting_amendment','Correcting Amendment / Correction',5),('withdrawal','Withdrawal',6),('guidance','Guidance',7),('executive_order','Executive Order',8),('presidential_memorandum','Presidential Memorandum',9),('proclamation','Proclamation',10),('fact_sheet','Fact Sheet',11),('agency_press_release','Agency Press Release',12),('sanctions_designation','Sanctions / Designation',13),('export_control_action','Export Control Action',14),('tariff_action','Tariff Action',15),('legislative_bill_resolution','Legislative Bill / Resolution',16),('committee_action_hearing','Committee Action / Hearing',17),('monetary_policy_decision','Monetary Policy Decision / Minutes / Statement',18),('enforcement_action','Enforcement Action',19),('grant_subsidy_program','Grant / Subsidy Program',20),('government_contract_award','Government Contract / Award',21);

INSERT INTO source_adapters(code,display_name,source_url,tier,enabled,requires_api_key,schedule_minutes,notes) VALUES
('FEDERAL_REGISTER','Federal Register / Public Inspection','https://www.federalregister.gov','P0',1,0,15,'Discovery API; GovInfo PDF is legal evidence'),
('GOVINFO','GovInfo','https://www.govinfo.gov','P0',1,1,60,'Official PDF links active; package API requires key'),
('REGULATIONS_GOV','Regulations.gov','https://www.regulations.gov','P0',0,1,60,'DEMO_KEY is never used in TestFlight'),
('WHITE_HOUSE','The White House','https://www.whitehouse.gov','P1',1,0,60,'Presidential actions RSS health check'),
('CONGRESS_GOV','Congress.gov','https://www.congress.gov','P1',0,1,60,'API key required'),
('AGENCY_REGISTRY','Agency Registry','https://www.usa.gov/agency-index','P1',1,0,360,'Manual fallback and deduplication registry');

INSERT INTO market_data_providers(id,display_name,license_mode,attribution,delay_status,enabled) VALUES
('market-disabled','市場データ未設定','market_disabled','市場データ提供元未設定','unavailable',1),
('twelve-data-byok','Twelve Data (BYOK)','bring_your_own_key','Data provided by Twelve Data','provider-dependent',0);

INSERT INTO securities(id,ticker,exchange,security_class,is_benchmark,active) VALUES
('sec-spy','SPY','NYSE Arca','ETF',1,1),('sec-qqq','QQQ','NASDAQ','ETF',1,1),('sec-iwm','IWM','NYSE Arca','ETF',1,1),
('sec-xlk','XLK','NYSE Arca','ETF',0,1),('sec-soxx','SOXX','NASDAQ','ETF',0,1),('sec-xlf','XLF','NYSE Arca','ETF',0,1),('sec-xle','XLE','NYSE Arca','ETF',0,1),
('sec-aapl','AAPL','NASDAQ','Common Stock',0,1),('sec-msft','MSFT','NASDAQ','Common Stock',0,1),('sec-nvda','NVDA','NASDAQ','Common Stock',0,1),('sec-amd','AMD','NASDAQ','Common Stock',0,1),
('sec-intc','INTC','NASDAQ','Common Stock',0,1),('sec-googl','GOOGL','NASDAQ','Class A',0,1),('sec-goog','GOOG','NASDAQ','Class C',0,1),('sec-meta','META','NASDAQ','Class A',0,1),
('sec-amzn','AMZN','NASDAQ','Common Stock',0,1),('sec-tsla','TSLA','NASDAQ','Common Stock',0,1),('sec-jpm','JPM','NYSE','Common Stock',0,1),('sec-gs','GS','NYSE','Common Stock',0,1),
('sec-xom','XOM','NYSE','Common Stock',0,1),('sec-cvx','CVX','NYSE','Common Stock',0,1),('sec-pfe','PFE','NYSE','Common Stock',0,1),('sec-lly','LLY','NYSE','Common Stock',0,1);
