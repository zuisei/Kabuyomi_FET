import {
  isAutomaticallySelectedSignal,
  publicAnalysis,
  relationFromRow,
  signalFieldErrors,
  validateAnalysisDraft,
  type AnalysisDraftInput,
  type PolicyAnalysisRow,
  type PolicyCompanyRelationRow,
  type PublicPolicyAnalysis
} from "./analysis.ts";

export type EditorialEnv = { CORE: D1Database; ENVIRONMENT: string };

const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function snapshot(input: AnalysisDraftInput, status = "automated_draft"): Record<string, unknown> {
  return {
    analysisStatus: status,
    presentationTier: input.presentationTier,
    canonicalTitleJA: input.canonicalTitleJA,
    canonicalTitleEN: input.canonicalTitleEN,
    changeSummaryJA: input.changeSummaryJA,
    whyItMattersJA: input.whyItMattersJA,
    policyType: input.policyType,
    policyDomainCodes: input.policyDomainCodes,
    primaryAgencyCode: input.primaryAgencyCode,
    affectedRegionCodes: input.affectedRegionCodes,
    affectedSectorCodes: input.affectedSectorCodes,
    affectedProductTerms: input.affectedProductTerms,
    marketAnalysisMode: input.marketAnalysisMode,
    marketRelevanceReasonJA: input.marketRelevanceReasonJA,
    noCompanyReasonJA: input.noCompanyReasonJA,
    noMarketDataReasonJA: input.noMarketDataReasonJA,
    editorialPriority: input.editorialPriority
  };
}

function insertStatement(env: EditorialEnv, id: string, eventID: string, version: number, input: AnalysisDraftInput, now: string): D1PreparedStatement {
  return env.CORE.prepare(`INSERT INTO policy_analyses (
    id,event_id,analysis_status,presentation_tier,canonical_title_ja,canonical_title_en,change_summary_ja,why_it_matters_ja,
    policy_type,policy_domain_codes_json,primary_agency_code,affected_region_codes_json,affected_sector_codes_json,
    affected_product_terms_json,market_analysis_mode,market_relevance_reason_ja,no_company_reason_ja,no_market_data_reason_ja,
    editorial_priority,analysis_version,created_at,updated_at
  ) VALUES (?,?,'automated_draft',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    id, eventID, input.presentationTier, input.canonicalTitleJA, input.canonicalTitleEN, input.changeSummaryJA, input.whyItMattersJA,
    input.policyType, JSON.stringify(input.policyDomainCodes ?? []), input.primaryAgencyCode, JSON.stringify(input.affectedRegionCodes ?? []),
    JSON.stringify(input.affectedSectorCodes ?? []), JSON.stringify(input.affectedProductTerms ?? []), input.marketAnalysisMode,
    input.marketRelevanceReasonJA, input.noCompanyReasonJA, input.noMarketDataReasonJA, input.editorialPriority ?? 0, version, now, now
  );
}

async function rowForID(env: EditorialEnv, analysisID: string): Promise<PolicyAnalysisRow | null> {
  return env.CORE.prepare("SELECT * FROM policy_analyses WHERE id=?").bind(analysisID).first<PolicyAnalysisRow>();
}

async function relationsForEvent(env: EditorialEnv, eventID: string): Promise<PolicyCompanyRelationRow[]> {
  const result = await env.CORE.prepare(`SELECT relation.id,relation.event_id,relation.issuer_id,issuer.legal_name AS issuer_name,
    relation.security_id,security.ticker,relation.relation_type,relation.evidence_document_id,relation.evidence_reference,
    relation.evidence_summary_ja,relation.review_status,relation.reviewed_at
    FROM policy_company_relations relation JOIN issuers issuer ON issuer.id=relation.issuer_id
    LEFT JOIN securities security ON security.id=relation.security_id
    WHERE relation.event_id=? ORDER BY relation.created_at`).bind(eventID).all<PolicyCompanyRelationRow>();
  return result.results;
}

export async function createAnalysisDraft(request: Request, env: EditorialEnv, eventID: string): Promise<Response> {
  const event = await env.CORE.prepare("SELECT id,agency_code,title_en FROM policy_events WHERE id=?").bind(eventID).first<{ id: string; agency_code: string; title_en: string | null }>();
  if (!event) return json({ error: { code: "event_not_found", message: "Policy event was not found" } }, 404);
  let input: AnalysisDraftInput;
  try { input = validateAnalysisDraft(await request.json()); }
  catch (error) { return json({ error: { code: "invalid_analysis_draft", message: error instanceof Error ? error.message : String(error) } }, 400); }
  input.primaryAgencyCode = input.primaryAgencyCode ?? event.agency_code;
  input.canonicalTitleEN = input.canonicalTitleEN ?? event.title_en;
  const latest = await env.CORE.prepare("SELECT MAX(analysis_version) AS version FROM policy_analyses WHERE event_id=?").bind(eventID).first<{ version: number | null }>();
  const version = (latest?.version ?? 0) + 1;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const actor = nonEmpty(input.generatedBy) ?? "automated-editorial-draft";
  const state = snapshot(input);
  await env.CORE.batch([
    insertStatement(env, id, eventID, version, input, now),
    env.CORE.prepare("INSERT INTO policy_analysis_history (id,analysis_id,event_id,action,from_status,to_status,actor,note,snapshot_json,created_at) VALUES (?,?,?,'create_draft',NULL,'automated_draft',?,?,?,?)")
      .bind(crypto.randomUUID(), id, eventID, actor, input.note ?? null, JSON.stringify(state), now),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'create_analysis_draft','policy_analysis',?,?,?)")
      .bind(crypto.randomUUID(), actor, id, JSON.stringify({ eventID, version, presentationTier: input.presentationTier, marketAnalysisMode: input.marketAnalysisMode }), now)
  ]);
  return json({
    eventID,
    analysisID: id,
    analysisVersion: version,
    analysisStatus: "automated_draft",
    publicVisible: true,
    previewVisible: true,
    automaticallySelectedSignal: isAutomaticallySelectedSignal(input)
  }, 201);
}

export async function replaceAnalysisDraft(request: Request, env: EditorialEnv, analysisID: string): Promise<Response> {
  const current = await rowForID(env, analysisID);
  if (!current) return json({ error: { code: "analysis_not_found", message: "Policy analysis was not found" } }, 404);
  if (!new Set(["unreviewed", "automated_draft"]).has(current.analysis_status)) return json({ error: { code: "analysis_locked", message: "Reviewed or published analyses must be corrected as a new version" } }, 409);
  let input: AnalysisDraftInput;
  try { input = validateAnalysisDraft(await request.json()); }
  catch (error) { return json({ error: { code: "invalid_analysis_draft", message: error instanceof Error ? error.message : String(error) } }, 400); }
  const now = new Date().toISOString();
  const actor = nonEmpty(input.generatedBy) ?? "editorial-draft-editor";
  const state = snapshot(input);
  await env.CORE.batch([
    env.CORE.prepare(`UPDATE policy_analyses SET analysis_status='automated_draft',presentation_tier=?,canonical_title_ja=?,canonical_title_en=?,
      change_summary_ja=?,why_it_matters_ja=?,policy_type=?,policy_domain_codes_json=?,primary_agency_code=?,affected_region_codes_json=?,
      affected_sector_codes_json=?,affected_product_terms_json=?,market_analysis_mode=?,market_relevance_reason_ja=?,no_company_reason_ja=?,
      no_market_data_reason_ja=?,editorial_priority=?,updated_at=?,reviewed_by=NULL,reviewed_at=NULL,published_at=NULL WHERE id=?`).bind(
      input.presentationTier, input.canonicalTitleJA, input.canonicalTitleEN, input.changeSummaryJA, input.whyItMattersJA, input.policyType,
      JSON.stringify(input.policyDomainCodes ?? []), input.primaryAgencyCode, JSON.stringify(input.affectedRegionCodes ?? []),
      JSON.stringify(input.affectedSectorCodes ?? []), JSON.stringify(input.affectedProductTerms ?? []), input.marketAnalysisMode,
      input.marketRelevanceReasonJA, input.noCompanyReasonJA, input.noMarketDataReasonJA, input.editorialPriority ?? 0, now, analysisID
    ),
    env.CORE.prepare("INSERT INTO policy_analysis_history (id,analysis_id,event_id,action,from_status,to_status,actor,note,snapshot_json,created_at) VALUES (?,?,?,'edit_draft',?,'automated_draft',?,?,?,?)")
      .bind(crypto.randomUUID(), analysisID, current.event_id, current.analysis_status, actor, input.note ?? null, JSON.stringify(state), now),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'edit_analysis_draft','policy_analysis',?,?,?)")
      .bind(crypto.randomUUID(), actor, analysisID, JSON.stringify({ eventID: current.event_id }), now)
  ]);
  return json({ eventID: current.event_id, analysisID, analysisStatus: "automated_draft", updatedAt: now });
}

async function publishableErrors(env: EditorialEnv, row: PolicyAnalysisRow): Promise<string[]> {
  const analysis = publicAnalysis(row);
  const errors = analysis.presentationTier === "signal" ? signalFieldErrors(analysis) : [];
  const documents = await env.CORE.prepare(`SELECT document.published_on,document.effective_on,document.applicable_on,
    document.availability_basis,COALESCE(revision.time_precision,event.time_precision) AS time_precision
    FROM policy_events event JOIN event_documents link ON link.event_id=event.id
    JOIN documents document ON document.id=link.document_id
    LEFT JOIN document_revisions revision ON revision.id=document.current_revision_id
    WHERE event.id=?`).bind(row.event_id).all<{ published_on: string | null; effective_on: string | null; applicable_on: string | null; availability_basis: string | null; time_precision: string | null }>();
  if (analysis.presentationTier === "signal" && !documents.results.some((document) => document.published_on || document.effective_on || document.applicable_on)) errors.push("legal date");
  if (analysis.marketAnalysisMode === "daily" && !documents.results.some((document) => document.time_precision === "day")) errors.push("day-precision document");
  if (analysis.marketAnalysisMode === "intraday") {
    const hasExactSource = documents.results.some((document) => ["exact", "minute"].includes(document.time_precision ?? "") && document.availability_basis === "source_stated");
    if (!hasExactSource) errors.push("verified exact/minute source time");
    const mapping = await env.CORE.prepare("SELECT COUNT(*) AS count FROM policy_company_relations WHERE event_id=? AND review_status='approved'").bind(row.event_id).first<{ count: number }>();
    const licensed = await env.CORE.prepare("SELECT COUNT(*) AS count FROM market_data_providers WHERE enabled=1 AND rights_review_state='approved' AND license_mode<>'market_disabled'").first<{ count: number }>();
    if ((mapping?.count ?? 0) === 0) errors.push("approved company/security mapping");
    if ((licensed?.count ?? 0) === 0) errors.push("approved market display rights");
  }
  const relationCount = await env.CORE.prepare("SELECT COUNT(*) AS count FROM policy_company_relations WHERE event_id=? AND review_status<>'rejected'").bind(row.event_id).first<{ count: number }>();
  if ((relationCount?.count ?? 0) === 0 && !analysis.noCompanyReasonJA) errors.push("company relation or noCompanyReasonJA");
  return errors;
}

export async function transitionAnalysis(request: Request, env: EditorialEnv, analysisID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { action?: string; reviewedBy?: string; note?: string };
  const action = body.action;
  if (!new Set(["review", "publish", "reject"]).has(action ?? "")) return json({ error: { code: "invalid_transition", message: "action must be review, publish or reject" } }, 400);
  const actor = nonEmpty(body.reviewedBy);
  if (!actor) return json({ error: { code: "reviewer_required", message: "reviewedBy is required for an explicit human decision" } }, 400);
  const current = await rowForID(env, analysisID);
  if (!current) return json({ error: { code: "analysis_not_found", message: "Policy analysis was not found" } }, 404);
  let next: "editorial_reviewed" | "published" | "rejected";
  if (action === "review") {
    if (current.analysis_status !== "automated_draft") return json({ error: { code: "invalid_transition", message: "Only an automated draft can enter editorial review" } }, 409);
    next = "editorial_reviewed";
  } else if (action === "publish") {
    if (current.analysis_status !== "editorial_reviewed") return json({ error: { code: "editorial_review_required", message: "An automated draft cannot be published or presented as human-reviewed" } }, 409);
    const errors = await publishableErrors(env, current);
    if (errors.length > 0) return json({ error: { code: "analysis_not_publishable", message: `Missing or invalid: ${errors.join(", ")}` } }, 409);
    next = "published";
  } else {
    if (current.analysis_status === "rejected") return json({ analysisID, analysisStatus: "rejected", unchanged: true });
    next = "rejected";
  }
  const now = new Date().toISOString();
  const analysis = publicAnalysis({ ...current, analysis_status: next, reviewed_by: actor, reviewed_at: now, published_at: next === "published" ? now : current.published_at });
  await env.CORE.batch([
    env.CORE.prepare("UPDATE policy_analyses SET analysis_status=?,reviewed_by=?,reviewed_at=?,published_at=?,updated_at=? WHERE id=? AND analysis_status=?")
      .bind(next, actor, now, next === "published" ? now : current.published_at, now, analysisID, current.analysis_status),
    env.CORE.prepare("INSERT INTO policy_analysis_history (id,analysis_id,event_id,action,from_status,to_status,actor,note,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), analysisID, current.event_id, action, current.analysis_status, next, actor, nonEmpty(body.note), JSON.stringify(analysis), now),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), actor, `analysis_${action}`, "policy_analysis", analysisID, JSON.stringify({ eventID: current.event_id, from: current.analysis_status, to: next }), now)
  ]);
  return json({ eventID: current.event_id, analysisID, analysisStatus: next, decidedAt: now });
}

export async function analysisPreview(env: EditorialEnv, eventID: string): Promise<Response> {
  const row = await env.CORE.prepare("SELECT * FROM policy_analyses WHERE event_id=? AND analysis_status<>'rejected' ORDER BY analysis_version DESC LIMIT 1").bind(eventID).first<PolicyAnalysisRow>();
  if (!row) return json({ error: { code: "analysis_not_found", message: "Policy analysis was not found" } }, 404);
  const event = await env.CORE.prepare("SELECT title_ja,title_en,summary_ja FROM policy_events WHERE id=?").bind(eventID).first();
  const relations = (await relationsForEvent(env, eventID)).map(relationFromRow);
  return json({ event, analysis: publicAnalysis(row, relations), internal: { editorialPriority: row.editorial_priority, reviewedBy: row.reviewed_by } });
}

export async function analysisHistory(env: EditorialEnv, eventID: string): Promise<Response> {
  const rows = await env.CORE.prepare("SELECT id,analysis_id,action,from_status,to_status,actor,note,snapshot_json,created_at FROM policy_analysis_history WHERE event_id=? ORDER BY created_at DESC").bind(eventID).all();
  return json(rows.results.map((row) => ({ ...row, snapshot: typeof row.snapshot_json === "string" ? JSON.parse(row.snapshot_json) : null, snapshot_json: undefined })));
}

export async function addCompanyRelationCandidate(request: Request, env: EditorialEnv, eventID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as {
    issuerName?: string; ticker?: string; exchange?: string; relationType?: string; evidenceDocumentID?: string;
    evidenceReference?: string; evidenceSummaryJA?: string; generatedBy?: string;
  };
  for (const [field, value] of [["issuerName", body.issuerName], ["relationType", body.relationType], ["evidenceDocumentID", body.evidenceDocumentID], ["evidenceReference", body.evidenceReference], ["evidenceSummaryJA", body.evidenceSummaryJA]] as const) {
    if (!nonEmpty(value)) return json({ error: { code: "invalid_company_relation", message: `${field} is required` } }, 400);
  }
  const relationTypes = new Set(["direct", "indirect", "supply_chain", "competitor", "customer", "geographic_exposure", "policy_beneficiary", "policy_risk"]);
  if (!relationTypes.has(body.relationType!)) return json({ error: { code: "invalid_company_relation", message: "relationType is invalid" } }, 400);
  const evidence = await env.CORE.prepare("SELECT 1 AS found FROM event_documents WHERE event_id=? AND document_id=?").bind(eventID, body.evidenceDocumentID).first();
  if (!evidence) return json({ error: { code: "evidence_document_mismatch", message: "Evidence document does not belong to this event" } }, 400);
  const now = new Date().toISOString();
  const issuerID = crypto.randomUUID();
  const relationID = crypto.randomUUID();
  const actor = nonEmpty(body.generatedBy) ?? "automated-company-candidate";
  let securityID: string | null = null;
  if (nonEmpty(body.ticker) && nonEmpty(body.exchange)) securityID = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    env.CORE.prepare("INSERT INTO issuers (id,cik,legal_name,active,last_verified_at) VALUES (?,NULL,?,1,NULL)").bind(issuerID, body.issuerName!.trim())
  ];
  if (securityID) statements.push(env.CORE.prepare("INSERT INTO securities (id,issuer_id,ticker,exchange,company_name,security_class,is_benchmark,active) VALUES (?,?,?,?,?,'equity',0,1)").bind(securityID, issuerID, body.ticker!.trim(), body.exchange!.trim(), body.issuerName!.trim()));
  statements.push(
    env.CORE.prepare("INSERT INTO policy_company_relations (id,event_id,issuer_id,security_id,relation_type,evidence_document_id,evidence_reference,evidence_summary_ja,review_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'candidate',?,?)")
      .bind(relationID, eventID, issuerID, securityID, body.relationType, body.evidenceDocumentID, body.evidenceReference!.trim(), body.evidenceSummaryJA!.trim(), now, now),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'create_company_relation_candidate','policy_company_relation',?,?,?)")
      .bind(crypto.randomUUID(), actor, relationID, JSON.stringify({ eventID, issuerID, securityID, relationType: body.relationType }), now)
  );
  await env.CORE.batch(statements);
  return json({ eventID, relationID, issuerID, securityID, reviewStatus: "candidate" }, 201);
}

export async function reviewCompanyRelation(request: Request, env: EditorialEnv, relationID: string): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { decision?: string; reviewedBy?: string; note?: string };
  if (!new Set(["approved", "rejected"]).has(body.decision ?? "")) return json({ error: { code: "invalid_company_relation_review", message: "decision must be approved or rejected" } }, 400);
  const actor = nonEmpty(body.reviewedBy);
  if (!actor) return json({ error: { code: "reviewer_required", message: "reviewedBy is required" } }, 400);
  const existing = await env.CORE.prepare("SELECT id,event_id FROM policy_company_relations WHERE id=?").bind(relationID).first<{ id: string; event_id: string }>();
  if (!existing) return json({ error: { code: "company_relation_not_found", message: "Company relation was not found" } }, 404);
  const now = new Date().toISOString();
  await env.CORE.batch([
    env.CORE.prepare("UPDATE policy_company_relations SET review_status=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE id=?").bind(body.decision, actor, now, now, relationID),
    env.CORE.prepare("INSERT INTO audit_logs (id,actor,action,entity_type,entity_id,detail_json,created_at) VALUES (?,?, 'review_company_relation','policy_company_relation',?,?,?)")
      .bind(crypto.randomUUID(), actor, relationID, JSON.stringify({ eventID: existing.event_id, decision: body.decision, note: nonEmpty(body.note) }), now)
  ]);
  return json({ eventID: existing.event_id, relationID, reviewStatus: body.decision, reviewedAt: now });
}
