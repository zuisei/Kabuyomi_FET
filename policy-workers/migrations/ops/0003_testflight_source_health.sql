INSERT OR IGNORE INTO source_health(source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json) VALUES
('FEDERAL_REGISTER','degraded',0,NULL,NULL,NULL,'{"reason":"not_yet_run"}'),
('GOVINFO','missing_credentials',0,NULL,NULL,NULL,'{"reason":"api_key_required","pdf_links":"available"}'),
('REGULATIONS_GOV','missing_credentials',0,NULL,NULL,NULL,'{"reason":"api_key_required","demo_key_allowed":false}'),
('WHITE_HOUSE','degraded',0,NULL,NULL,NULL,'{"reason":"not_yet_run"}'),
('CONGRESS_GOV','missing_credentials',0,NULL,NULL,NULL,'{"reason":"api_key_required"}'),
('AGENCY_REGISTRY','healthy',0,NULL,NULL,NULL,'{"manual_fallback":true}');
