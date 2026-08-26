import type { PolicyEvent } from "../domain/types.ts";

export type AnalysisStatus = "unreviewed" | "automated_draft" | "editorial_reviewed" | "published" | "rejected";
export type PresentationTier = "signal" | "monitor" | "archive";
export type MarketAnalysisMode = "intraday" | "daily" | "unmapped" | "not_applicable" | "disabled";
export type CompanyRelationType = "direct" | "indirect" | "supply_chain" | "competitor" | "customer" | "geographic_exposure" | "policy_beneficiary" | "policy_risk";

export type PolicyCompanyRelation = {
  id: string;
  issuerID: string;
  issuerName: string;
  securityID: string | null;
  ticker: string | null;
  relationType: CompanyRelationType;
  evidenceDocumentID: string | null;
  evidenceReference: string;
  evidenceSummaryJA: string;
  reviewStatus: "candidate" | "approved" | "rejected";
  reviewedAt: string | null;
};

export type PublicPolicyAnalysis = {
  analysisStatus: AnalysisStatus;
  presentationTier: PresentationTier;
  canonicalTitleJA: string | null;
  canonicalTitleEN: string | null;
  changeSummaryJA: string | null;
  whyItMattersJA: string | null;
  policyType: string | null;
  policyDomainCodes: string[];
  primaryAgencyCode: string | null;
  affectedRegionCodes: string[];
  affectedSectorCodes: string[];
  affectedProductTerms: string[];
  marketAnalysisMode: MarketAnalysisMode;
  marketRelevanceReasonJA: string | null;
  noCompanyReasonJA: string | null;
  noMarketDataReasonJA: string | null;
  analysisVersion: number;
  reviewedAt: string | null;
  publishedAt: string | null;
  companyRelations: PolicyCompanyRelation[];
};

export type PolicyAnalysisRow = {
  id: string;
  event_id: string;
  analysis_status: AnalysisStatus;
  presentation_tier: PresentationTier;
  canonical_title_ja: string | null;
  canonical_title_en: string | null;
  change_summary_ja: string | null;
  why_it_matters_ja: string | null;
  policy_type: string | null;
  policy_domain_codes_json: string;
  primary_agency_code: string | null;
  affected_region_codes_json: string;
  affected_sector_codes_json: string;
  affected_product_terms_json: string;
  market_analysis_mode: MarketAnalysisMode;
  market_relevance_reason_ja: string | null;
  no_company_reason_ja: string | null;
  no_market_data_reason_ja: string | null;
  editorial_priority: number;
  analysis_version: number;
  created_at: string;
  updated_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_at: string | null;
};

export type PolicyCompanyRelationRow = {
  id: string;
  event_id: string;
  issuer_id: string;
  issuer_name: string;
  security_id: string | null;
  ticker: string | null;
  relation_type: CompanyRelationType;
  evidence_document_id: string | null;
  evidence_reference: string;
  evidence_summary_ja: string;
  review_status: "candidate" | "approved" | "rejected";
  reviewed_at: string | null;
};

export type AnalysisDraftInput = {
  canonicalTitleJA?: string | null;
  canonicalTitleEN?: string | null;
  changeSummaryJA?: string | null;
  whyItMattersJA?: string | null;
  policyType?: string | null;
  policyDomainCodes?: string[];
  primaryAgencyCode?: string | null;
  affectedRegionCodes?: string[];
  affectedSectorCodes?: string[];
  affectedProductTerms?: string[];
  marketAnalysisMode?: MarketAnalysisMode;
  marketRelevanceReasonJA?: string | null;
  noCompanyReasonJA?: string | null;
  noMarketDataReasonJA?: string | null;
  presentationTier?: PresentationTier;
  editorialPriority?: number;
  generatedBy?: string;
  note?: string | null;
};

const analysisStatuses = new Set<AnalysisStatus>(["unreviewed", "automated_draft", "editorial_reviewed", "published", "rejected"]);
const presentationTiers = new Set<PresentationTier>(["signal", "monitor", "archive"]);
const marketModes = new Set<MarketAnalysisMode>(["intraday", "daily", "unmapped", "not_applicable", "disabled"]);
const monitorInstruments = new Set([
  "final_rule", "proposed_rule", "interim_final_rule", "correcting_amendment", "withdrawal", "guidance",
  "executive_order", "presidential_memorandum", "proclamation", "sanctions_designation", "export_control_action",
  "tariff_action", "monetary_policy_decision", "enforcement_action", "grant_subsidy_program"
]);

export function sourcePresentationTier(instrumentType: unknown): PresentationTier {
  return typeof instrumentType === "string" && monitorInstruments.has(instrumentType) ? "monitor" : "archive";
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function jsonStrings(value: string): string[] {
  try { return strings(JSON.parse(value)); }
  catch { return []; }
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function validateAnalysisDraft(value: unknown): AnalysisDraftInput {
  if (!value || typeof value !== "object") throw new Error("JSON object is required");
  const input = value as AnalysisDraftInput & { analysisStatus?: string };
  if (input.analysisStatus && !new Set(["unreviewed", "automated_draft"]).has(input.analysisStatus)) {
    throw new Error("draft creation cannot claim human review or publication");
  }
  const tier = input.presentationTier ?? "archive";
  const marketMode = input.marketAnalysisMode ?? "unmapped";
  if (!presentationTiers.has(tier)) throw new Error("presentationTier is invalid");
  if (!marketModes.has(marketMode)) throw new Error("marketAnalysisMode is invalid");
  if (input.editorialPriority !== undefined && (!Number.isInteger(input.editorialPriority) || input.editorialPriority < -1000 || input.editorialPriority > 1000)) {
    throw new Error("editorialPriority must be an integer between -1000 and 1000");
  }
  for (const field of ["policyDomainCodes", "affectedRegionCodes", "affectedSectorCodes", "affectedProductTerms"] as const) {
    if (input[field] !== undefined && !Array.isArray(input[field])) throw new Error(`${field} must be an array`);
  }
  const normalized: AnalysisDraftInput = {
    canonicalTitleJA: nullableText(input.canonicalTitleJA),
    canonicalTitleEN: nullableText(input.canonicalTitleEN),
    changeSummaryJA: nullableText(input.changeSummaryJA),
    whyItMattersJA: nullableText(input.whyItMattersJA),
    policyType: nullableText(input.policyType),
    policyDomainCodes: strings(input.policyDomainCodes),
    primaryAgencyCode: nullableText(input.primaryAgencyCode),
    affectedRegionCodes: strings(input.affectedRegionCodes),
    affectedSectorCodes: strings(input.affectedSectorCodes),
    affectedProductTerms: strings(input.affectedProductTerms),
    marketAnalysisMode: marketMode,
    marketRelevanceReasonJA: nullableText(input.marketRelevanceReasonJA),
    noCompanyReasonJA: nullableText(input.noCompanyReasonJA),
    noMarketDataReasonJA: nullableText(input.noMarketDataReasonJA),
    presentationTier: tier,
    editorialPriority: input.editorialPriority ?? 0,
    generatedBy: nullableText(input.generatedBy) ?? "automated-editorial-draft",
    note: nullableText(input.note)
  };
  const errors = signalFieldErrors(normalized);
  if (tier === "signal" && errors.length > 0) throw new Error(`signal requires: ${errors.join(", ")}`);
  if (marketMode === "unmapped" && !normalized.marketRelevanceReasonJA) throw new Error("unmapped requires marketRelevanceReasonJA");
  if (marketMode === "not_applicable" && !normalized.noMarketDataReasonJA) throw new Error("not_applicable requires noMarketDataReasonJA");
  if (marketMode === "disabled" && !normalized.noMarketDataReasonJA) throw new Error("disabled requires noMarketDataReasonJA");
  return normalized;
}

export function signalFieldErrors(input: AnalysisDraftInput | PublicPolicyAnalysis): string[] {
  const errors: string[] = [];
  if (!nullableText(input.canonicalTitleJA)) errors.push("canonicalTitleJA");
  if (!nullableText(input.changeSummaryJA)) errors.push("changeSummaryJA");
  if (!nullableText(input.whyItMattersJA)) errors.push("whyItMattersJA");
  if (!nullableText(input.policyType)) errors.push("policyType");
  const domains = strings(input.policyDomainCodes);
  const regions = strings(input.affectedRegionCodes);
  if (domains.length === 0 && regions.length === 0) errors.push("policyDomainCodes or affectedRegionCodes");
  return errors;
}

export function isAutomaticallySelectedSignal(input: AnalysisDraftInput | PublicPolicyAnalysis): boolean {
  const status = "analysisStatus" in input ? input.analysisStatus : "automated_draft";
  return input.presentationTier === "signal"
    && status !== "unreviewed"
    && status !== "rejected"
    && signalFieldErrors(input).length === 0;
}

export function publicAnalysis(row: PolicyAnalysisRow, relations: PolicyCompanyRelation[] = []): PublicPolicyAnalysis {
  if (!analysisStatuses.has(row.analysis_status) || !presentationTiers.has(row.presentation_tier) || !marketModes.has(row.market_analysis_mode)) {
    throw new Error("Invalid persisted policy analysis");
  }
  return {
    analysisStatus: row.analysis_status,
    presentationTier: row.presentation_tier,
    canonicalTitleJA: row.canonical_title_ja,
    canonicalTitleEN: row.canonical_title_en,
    changeSummaryJA: row.change_summary_ja,
    whyItMattersJA: row.why_it_matters_ja,
    policyType: row.policy_type,
    policyDomainCodes: jsonStrings(row.policy_domain_codes_json),
    primaryAgencyCode: row.primary_agency_code,
    affectedRegionCodes: jsonStrings(row.affected_region_codes_json),
    affectedSectorCodes: jsonStrings(row.affected_sector_codes_json),
    affectedProductTerms: jsonStrings(row.affected_product_terms_json),
    marketAnalysisMode: row.market_analysis_mode,
    marketRelevanceReasonJA: row.market_relevance_reason_ja,
    noCompanyReasonJA: row.no_company_reason_ja,
    noMarketDataReasonJA: row.no_market_data_reason_ja,
    analysisVersion: row.analysis_version,
    reviewedAt: row.reviewed_at,
    publishedAt: row.published_at,
    companyRelations: relations.filter((relation) => relation.reviewStatus !== "rejected")
  };
}

export function defaultPublicAnalysis(event: PolicyEvent): PublicPolicyAnalysis {
  return {
    analysisStatus: "unreviewed",
    presentationTier: sourcePresentationTier(event.instrumentType),
    canonicalTitleJA: null,
    canonicalTitleEN: event.titleEN || null,
    changeSummaryJA: null,
    whyItMattersJA: null,
    policyType: typeof event.instrumentType === "string" ? event.instrumentType : null,
    policyDomainCodes: event.policyDomain?.slug ? [event.policyDomain.slug] : [],
    primaryAgencyCode: event.agency.code,
    affectedRegionCodes: [],
    affectedSectorCodes: [],
    affectedProductTerms: [],
    marketAnalysisMode: "unmapped",
    marketRelevanceReasonJA: "政策と市場の関連性を確認中です。",
    noCompanyReasonJA: null,
    noMarketDataReasonJA: null,
    analysisVersion: 0,
    reviewedAt: null,
    publishedAt: null,
    companyRelations: []
  };
}

export function relationFromRow(row: PolicyCompanyRelationRow): PolicyCompanyRelation {
  return {
    id: row.id,
    issuerID: row.issuer_id,
    issuerName: row.issuer_name,
    securityID: row.security_id,
    ticker: row.ticker,
    relationType: row.relation_type,
    evidenceDocumentID: row.evidence_document_id,
    evidenceReference: row.evidence_reference,
    evidenceSummaryJA: row.evidence_summary_ja,
    reviewStatus: row.review_status,
    reviewedAt: row.reviewed_at
  };
}

export function mergeAnalysis(event: PolicyEvent, analysis: PublicPolicyAnalysis): PolicyEvent {
  return { ...event, analysis };
}

export function isAnalysisVisible(status: AnalysisStatus, environment: string): boolean {
  void environment;
  if (status === "rejected" || status === "unreviewed") return false;
  return true;
}
