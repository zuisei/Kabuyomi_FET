import { events } from "./fixture.ts";
import { policyDomains, instrumentTypes } from "./catalog.ts";
import { replaySnapshot } from "./domain/replay.ts";
import type { EventSummary, PolicyEvent } from "./domain/types.ts";
import { matchesSearchText } from "./search.ts";
import {
  applyLatestTranslations,
  publicTranslationRequestStatus,
  requestPublicTranslation
} from "./translation/service.ts";
import {
  defaultPublicAnalysis,
  isAnalysisVisible,
  isAutomaticallySelectedSignal,
  mergeAnalysis,
  publicAnalysis,
  relationFromRow,
  sourcePresentationTier,
  type PolicyAnalysisRow,
  type PolicyCompanyRelation,
  type PolicyCompanyRelationRow
} from "./editorial/analysis.ts";

export interface Env {
  CORE: D1Database;
  OPS: D1Database;
  RAW: R2Bucket;
  DERIVED: R2Bucket;
  TEMP: R2Bucket;
  ENVIRONMENT: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  PUBLIC_RATE_LIMITER?: RateLimit;
  TRANSLATION_REQUEST_RATE_LIMITER?: RateLimit;
  TRANSLATION_REALTIME_CUTOFF?: string;
  TRANSLATION_ADMIN?: Fetcher;
  TRANSLATION_TRIGGER_TOKEN?: string;
}

const baseHeaders = {
    "content-type": "application/json; charset=utf-8",
  "cache-control": "no-cache, must-revalidate",
  "x-content-type-options": "nosniff"
};

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

type DataMode = "synthetic" | "live" | "mixed";
type ResponseMetadata = { workerVersion: string; datasetRevision: string; buildTime: string; environment: string };

function json(request: Request, body: unknown, status = 200, cache = true, dataMode: DataMode = "synthetic", metadata?: ResponseMetadata, extra: Record<string, unknown> = {}): Response {
  const encoded = JSON.stringify({ data_mode: dataMode, data: body, ...extra });
  const etag = `W/\"${stableHash(encoded)}\"`;
  const headers = {
    ...baseHeaders,
    etag,
    "x-md-data-mode": dataMode,
    "x-md-schema-version": "6",
    ...(cache ? {} : { "cache-control": "no-store" })
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : encoded, { status, headers });
}

export function summaryForEvent(event: PolicyEvent): EventSummary {
  const primaryDocument = event.documents?.find((document) => document.relationship === "primary") ?? event.documents?.[0];
  const correctionDocument = event.documents?.find((document) => document.documentType === "correcting_amendment");
  const analysis = event.analysis ?? defaultPublicAnalysis(event);
  const rawLegalDates = (event.documents ?? []).flatMap((document) => [
    ...(document.commentsCloseOn ? [{
      kind: "comments_close" as const,
      date: document.commentsCloseOn,
      documentID: document.id,
      documentNumber: document.documentNumber || null,
      officialURL: document.officialURL
    }] : []),
    ...(document.effectiveOn ? [{
      kind: "effective" as const,
      date: document.effectiveOn,
      documentID: document.id,
      documentNumber: document.documentNumber || null,
      officialURL: document.officialURL
    }] : []),
    ...(document.applicableOn ? [{
      kind: "applicable" as const,
      date: document.applicableOn,
      documentID: document.id,
      documentNumber: document.documentNumber || null,
      officialURL: document.officialURL
    }] : [])
  ]);
  const legalDates = Array.from(
    new Map(rawLegalDates.map((item) => [`${item.kind}:${item.date}:${item.documentID}`, item])).values()
  ).sort((left, right) => left.date.localeCompare(right.date) || left.kind.localeCompare(right.kind));
  return {
    id: event.id,
    agency: event.agency,
    titleJA: event.titleJA,
    titleEN: event.titleEN,
    summaryJA: event.summaryJA,
    topics: event.topics,
    tickers: event.tickers,
    status: event.status,
    lastActivityAt: event.lastActivityAt,
    publishedAt: primaryDocument?.timePrecision === "day" ? null : event.publishedAt,
    revisedAt: correctionDocument?.timePrecision === "day" ? null : event.revisedAt,
    hasMarketData: event.marketSeries.length > 0,
    marketEvaluationAvailableAt: event.marketSummaries[0]?.availableAt ?? null,
    timelineItemCount: event.timelineItems.length,
    updateCount: event.timelineItems.length,
    relatedDocumentCount: event.documents?.length ?? (event.documentInfo ? 1 : 0),
    hasCorrectionDocument: event.documents?.some((document) => document.documentType === "correcting_amendment") ?? false,
    confounderCount: event.confounders.length,
    coverageState: typeof event.coverageState === "string" ? event.coverageState : "analyst_enriched",
    verificationState: typeof event.eventVerificationState === "string" ? event.eventVerificationState : "analyst_verified",
    instrumentType: typeof event.instrumentType === "string" ? event.instrumentType : "notice",
    domain: event.policyDomain ?? null,
    analysis,
    translation: event.translation ?? null,
    legalDates,
    publicationGrouping: primaryDocument ? {
      documentNumber: primaryDocument.documentNumber || null,
      docketIDs: primaryDocument.docketIDs ?? [],
      regulationIDNumbers: primaryDocument.regulationIDNumbers ?? [],
      cfrReferences: primaryDocument.cfrReferences ?? []
    } : null
  };
}

export function eventByID(records: PolicyEvent[], id: string): PolicyEvent | undefined {
  const normalized = id.toLowerCase();
  return records.find((event) => event.id.toLowerCase() === normalized);
}

export function recordUpdatedAt(event: PolicyEvent): string {
  const candidates = [
    event.lastActivityAt,
    event.translation?.translatedAt,
    event.analysis?.reviewedAt,
    event.analysis?.publishedAt,
    ...((event.analysis?.companyRelations ?? []).map((relation) => relation.reviewedAt)),
    ...event.marketSummaries.map((summary) => typeof summary.availableAt === "string" ? summary.availableAt : null)
  ].filter((value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  return candidates.sort().at(-1) ?? event.lastActivityAt;
}

export function marketPayloadForEvent(event: PolicyEvent): Record<string, unknown> {
  const provenance = event.marketProvenance as { provider?: string; licenseMode?: string; attribution?: string; delayStatus?: string } | undefined;
  const hasMarket = event.marketSeries.length > 0;
  return {
    series: event.marketSeries,
    evaluations: event.marketSummaries,
    provider: provenance?.provider ?? (hasMarket && event.isSynthetic ? "fixture" : "market-disabled"),
    licenseMode: provenance?.licenseMode ?? (hasMarket && event.isSynthetic ? "synthetic" : "market_disabled"),
    attribution: provenance?.attribution ?? (hasMarket && event.isSynthetic ? "デモデータ" : "市場データ提供元未設定"),
    delayStatus: provenance?.delayStatus ?? (hasMarket && event.isSynthetic ? "synthetic" : "unavailable")
  };
}

function detailForEvent(event: PolicyEvent): Record<string, unknown> {
  const { documentInfo, documentVersions, documents, documentDiff, timelineItems, marketSeries, correctionNotes, ...detail } = event;
  return detail;
}

function dataModeFor(records: PolicyEvent[], environment = "local"): DataMode {
  const synthetic = records.some((event) => event.isSynthetic);
  const live = records.some((event) => !event.isSynthetic);
  if (synthetic && live) return "mixed";
  if (live) return "live";
  if (synthetic) return "synthetic";
  return ["testflight", "production"].includes(environment.toLowerCase()) ? "live" : "synthetic";
}

type AvailableEvents = { records: PolicyEvent[]; datasetRevision: string };

async function editorialDataForEvents(env: Env, eventIDs: string[]): Promise<{
  analyses: Map<string, PolicyAnalysisRow>;
  relations: Map<string, PolicyCompanyRelation[]>;
  latestUpdate: string | null;
}> {
  if (eventIDs.length === 0) return { analyses: new Map(), relations: new Map(), latestUpdate: null };
  const statuses = "'automated_draft','editorial_reviewed','published'";
  const [analysisResult, relationResult] = await Promise.all([
    env.CORE.prepare(`SELECT * FROM policy_analyses WHERE analysis_status IN (${statuses}) ORDER BY event_id,analysis_version DESC`).all<PolicyAnalysisRow>(),
    env.CORE.prepare(`SELECT relation.id,relation.event_id,relation.issuer_id,issuer.legal_name AS issuer_name,
      relation.security_id,security.ticker,relation.relation_type,relation.evidence_document_id,
      relation.evidence_reference,relation.evidence_summary_ja,relation.review_status,relation.reviewed_at
      FROM policy_company_relations relation
      JOIN issuers issuer ON issuer.id=relation.issuer_id
      LEFT JOIN securities security ON security.id=relation.security_id
      WHERE relation.review_status<>'rejected'
      ORDER BY relation.event_id,relation.created_at`).all<PolicyCompanyRelationRow>()
  ]);
  const eventSet = new Set(eventIDs);
  const analyses = new Map<string, PolicyAnalysisRow>();
  let latestUpdate: string | null = null;
  for (const row of analysisResult.results) {
    if (!eventSet.has(row.event_id) || analyses.has(row.event_id) || !isAnalysisVisible(row.analysis_status, env.ENVIRONMENT)) continue;
    analyses.set(row.event_id, row);
    if (!latestUpdate || row.updated_at > latestUpdate) latestUpdate = row.updated_at;
  }
  const relations = new Map<string, PolicyCompanyRelation[]>();
  for (const row of relationResult.results) {
    if (!eventSet.has(row.event_id)) continue;
    if (env.ENVIRONMENT.toLowerCase() === "production" && row.review_status !== "approved") continue;
    const values = relations.get(row.event_id) ?? [];
    values.push(relationFromRow(row));
    relations.set(row.event_id, values);
  }
  return { analyses, relations, latestUpdate };
}

type DocumentRelationshipCandidate = {
  id: string;
  fromDocumentID: string;
  fromDocumentNumber: string | null;
  toDocumentID: string;
  toDocumentNumber: string | null;
  relationship: string;
  confidence: number | null;
  reviewState: string;
};

async function relationshipCandidatesForEvent(env: Env, eventID: string): Promise<DocumentRelationshipCandidate[]> {
  const rows = await env.CORE.prepare(`
    SELECT DISTINCT
      relationship.id,
      relationship.from_document_id AS fromDocumentID,
      source_document.document_number AS fromDocumentNumber,
      relationship.to_document_id AS toDocumentID,
      target_document.document_number AS toDocumentNumber,
      relationship.relationship,
      relationship.confidence,
      relationship.review_state AS reviewState
    FROM document_relationships relationship
    JOIN documents source_document ON source_document.id = relationship.from_document_id
    JOIN documents target_document ON target_document.id = relationship.to_document_id
    WHERE relationship.from_document_id IN (SELECT document_id FROM event_documents WHERE event_id = ?)
       OR relationship.to_document_id IN (SELECT document_id FROM event_documents WHERE event_id = ?)
    ORDER BY relationship.confidence DESC, relationship.created_at DESC
  `).bind(eventID, eventID).all<DocumentRelationshipCandidate>();
  return rows.results;
}

async function availableEvents(env: Env): Promise<AvailableEvents> {
  const rows = await env.CORE.prepare("SELECT payload_json, source_updated_at FROM event_read_models WHERE published_at IS NOT NULL ORDER BY source_updated_at DESC").all<{ payload_json: string; source_updated_at: string }>();
  const live = rows.results.flatMap((row) => {
    try { return [JSON.parse(row.payload_json) as PolicyEvent]; }
    catch { return []; }
  });
  const permitsFixtureFallback = ["local", "preview"].includes(env.ENVIRONMENT.toLowerCase());
  const baseRecords = live.length > 0 ? live : permitsFixtureFallback ? events : [];
  const translatedRecords = live.length > 0 ? await applyLatestTranslations(env, baseRecords) : baseRecords;
  const editorial = await editorialDataForEvents(env, translatedRecords.map((event) => event.id));
  const records = translatedRecords.map((event) => {
    const persisted = editorial.analyses.get(event.id);
    const embedded = event.analysis && isAnalysisVisible(event.analysis.analysisStatus, env.ENVIRONMENT)
      ? event.analysis
      : defaultPublicAnalysis(event);
    const selectedAnalysis = persisted
      ? publicAnalysis(persisted, editorial.relations.get(event.id) ?? [])
      : embedded;
    const sourceSafeAnalysis = selectedAnalysis.presentationTier === "signal" && !isAutomaticallySelectedSignal(selectedAnalysis)
      ? { ...selectedAnalysis, presentationTier: "monitor" as const }
      : selectedAnalysis;
    const analysis = env.ENVIRONMENT.toLowerCase() === "production" && sourceSafeAnalysis.analysisStatus === "unreviewed"
      ? { ...sourceSafeAnalysis, presentationTier: sourcePresentationTier(event.instrumentType) }
      : sourceSafeAnalysis;
    return mergeAnalysis(event, analysis);
  });
  return {
    records,
    datasetRevision: [
      ...rows.results.map((row) => row.source_updated_at),
      ...translatedRecords.map((event) => event.translation?.translatedAt).filter((value): value is string => typeof value === "string"),
      ...(editorial.latestUpdate ? [editorial.latestUpdate] : [])
    ].sort().at(-1)
      ?? (permitsFixtureFallback ? "synthetic-fixture-v1" : "empty-live-dataset")
  };
}

function responseMetadata(env: Env, datasetRevision: string): ResponseMetadata {
  return {
    workerVersion: env.CF_VERSION_METADATA?.id ?? "local",
    buildTime: env.CF_VERSION_METADATA?.timestamp ?? "local",
    datasetRevision,
    environment: env.ENVIRONMENT
  };
}

function error(request: Request, status: number, code: string, message: string): Response {
  return json(request, { error: { code, message } }, status, false);
}

export async function publicRequestAllowed(request: Request, limiter?: RateLimit): Promise<boolean> {
  if (!limiter) return true;
  const actor = request.headers.get("cf-connecting-ip")?.trim();
  if (!actor) return true;
  const result = await limiter.limit({ key: `public-api:${actor}` });
  return result.success;
}

export async function translationRequestAllowed(request: Request, limiter?: RateLimit): Promise<boolean> {
  if (!limiter) return true;
  const actor = request.headers.get("cf-connecting-ip")?.trim();
  if (!actor) return true;
  const result = await limiter.limit({ key: `translation-request:${actor}` });
  return result.success;
}

function rateLimitError(request: Request): Response {
  const response = error(request, 429, "rate_limited", "Public API request limit exceeded");
  response.headers.set("retry-after", "60");
  response.headers.set("x-ratelimit-policy", "300;w=60");
  return response;
}

function translationRateLimitError(request: Request): Response {
  const response = error(request, 429, "translation_rate_limited", "Too many translation requests");
  response.headers.set("retry-after", "60");
  response.headers.set("x-ratelimit-policy", "5;w=60");
  return response;
}

export async function triggerImmediateTranslation(env: Env, eventID: string): Promise<boolean> {
  const token = env.TRANSLATION_TRIGGER_TOKEN?.trim();
  if (!env.TRANSLATION_ADMIN || !token) return false;
  try {
    const response = await env.TRANSLATION_ADMIN.fetch(new Request("https://translation-admin.internal/internal/translations/realtime/run", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-md-translation-trigger": token
      },
      body: JSON.stringify({ eventID })
    }));
    if (!response.ok) {
      console.error("Immediate translation trigger was rejected", { eventID, status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.error("Immediate translation trigger failed", {
      eventID,
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

function routeId(pathname: string, suffix = ""): string | null {
  const pattern = suffix ? new RegExp(`^/v1/events/([^/]+)/${suffix}$`) : /^\/v1\/events\/([^/]+)$/;
  return pathname.match(pattern)?.[1] ?? null;
}

export function filterEvents(records: PolicyEvent[], url: URL): PolicyEvent[] {
  const value = (name: string): string | null => url.searchParams.get(name) ?? url.searchParams.get(`filter[${name}]`);
  const q = (value("q") ?? "").trim();
  const agency = value("agency");
  const domain = value("domain");
  const instrument = value("instrument");
  const verification = value("verification");
  const ticker = value("ticker");
  const topic = value("topic");
  const status = value("status");
  const market = value("market");
  const tier = value("tier");
  const region = value("region");
  const marketMode = value("market_mode");
  const precision = value("time_precision");
  const correction = value("correction");
  const updatedSince = value("updated_since");
  const updatedSinceTime = updatedSince ? Date.parse(updatedSince) : Number.NaN;
  const from = value("date_from");
  const to = value("date_to");
  return records.filter((event) => {
    const documentSearch = (event.documents ?? []).flatMap((document) => [
      document.documentNumber,
      ...(document.docketIDs ?? []),
      ...(document.regulationIDNumbers ?? []),
      ...(document.cfrReferences ?? [])
    ]).join(" ");
    const analysis = event.analysis ?? defaultPublicAnalysis(event);
    const analysisText = [analysis.canonicalTitleJA, analysis.canonicalTitleEN, analysis.changeSummaryJA, analysis.whyItMattersJA,
      ...analysis.policyDomainCodes, ...analysis.affectedRegionCodes, ...analysis.affectedSectorCodes, ...analysis.affectedProductTerms,
      ...analysis.companyRelations.flatMap((relation) => [relation.issuerName, relation.ticker ?? "", relation.evidenceSummaryJA])].filter(Boolean).join(" ");
    const text = `${event.titleJA} ${event.titleEN} ${event.summaryJA} ${analysisText} ${event.agency.code} ${event.agency.displayNameJA} ${event.agency.displayNameEN} ${event.topics.join(" ")} ${event.tickers.join(" ")} ${event.documentInfo?.documentNumber ?? ""} ${documentSearch}`;
    return matchesSearchText(text, q)
      && (!agency || event.agency.code === agency)
      && (!domain || event.policyDomain?.slug === domain)
      && (!instrument || event.instrumentType === instrument)
      && (!verification || event.eventVerificationState === verification)
      && (!ticker || event.tickers.includes(ticker))
      && (!topic || event.topics.includes(topic))
      && (!status || event.status === status)
      && (!market || (market === "available" ? event.marketSeries.length > 0 : event.marketSeries.length === 0))
      && (!tier || analysis.presentationTier === tier)
      && (!region || analysis.affectedRegionCodes.includes(region))
      && (!marketMode || analysis.marketAnalysisMode === marketMode)
      && (!precision || (event.documents ?? []).some((document) => document.timePrecision === precision))
      && (!correction || (correction === "true" ? event.documents?.some((document) => document.documentType === "correcting_amendment") === true : true))
      && (!updatedSince || (!Number.isNaN(updatedSinceTime) && Date.parse(recordUpdatedAt(event)) > updatedSinceTime))
      && (!from || event.lastActivityAt >= `${from}T00:00:00.000Z`)
      && (!to || event.lastActivityAt <= `${to}T23:59:59.999Z`);
  });
}

function paginate<T>(records: T[], url: URL): { page: T[]; pagination: Record<string, unknown> } {
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? url.searchParams.get("page[size]") ?? 50) || 50, 1), 100);
  const offset = Math.max(Number(url.searchParams.get("cursor") ?? 0) || 0, 0);
  const next = offset + limit < records.length ? String(offset + limit) : null;
  return { page: records.slice(offset, offset + limit), pagination: { total: records.length, limit, cursor: String(offset), nextCursor: next } };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const translationID = routeId(url.pathname, "translation");
    const translationMutation = request.method === "POST" && translationID !== null;
    if (request.method !== "GET" && request.method !== "HEAD" && !translationMutation) {
      return error(request, 405, "method_not_allowed", "This public API mutation is not supported");
    }
    if (!(await publicRequestAllowed(request, env.PUBLIC_RATE_LIMITER))) return rateLimitError(request);
    if (translationMutation && !(await translationRequestAllowed(request, env.TRANSLATION_REQUEST_RATE_LIMITER))) {
      return translationRateLimitError(request);
    }
    if (translationMutation && !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return error(request, 415, "json_required", "Translation requests require application/json");
    }

    if (url.pathname === "/v1/health") {
      try {
        const [core, ops, available, sourceHealth] = await Promise.all([
          env.CORE.prepare("SELECT 1 AS ok").first(), env.OPS.prepare("SELECT 1 AS ok").first(), availableEvents(env),
          env.OPS.prepare("SELECT state,COUNT(*) AS count FROM source_health GROUP BY state").all()
        ]);
        const mode = dataModeFor(available.records, env.ENVIRONMENT);
        const metadata = responseMetadata(env, available.datasetRevision);
        return json(request, { status: "ok", dataMode: mode, schemaVersion: 6, eventCount: available.records.length, core: core?.ok === 1, ops: ops?.ok === 1 }, 200, false, mode, metadata);
      } catch {
        return error(request, 503, "dependency_unavailable", "Database health check failed");
      }
    }

    const available = await availableEvents(env);
    const records = available.records;
    const metadata = responseMetadata(env, available.datasetRevision);
    const mode = dataModeFor(records, env.ENVIRONMENT);
    const byId = (id: string): PolicyEvent | undefined => eventByID(records, id);

    if (translationID) {
      const event = byId(translationID);
      if (!event) return error(request, 404, "event_not_found", "Policy event was not found");
      if (event.isSynthetic) return error(request, 409, "translation_unavailable", "Synthetic events are not sent for translation");
      if (translationMutation) {
        let status = await requestPublicTranslation(env, event.id);
        if (status.state === "queued" || status.state === "retry") {
          await triggerImmediateTranslation(env, event.id);
          status = await publicTranslationRequestStatus(env, event.id);
        }
        const responseStatus = status.state === "translated" ? 200 : status.state === "unavailable" ? 409 : 202;
        return json(request, status, responseStatus, false, mode, metadata);
      }
      return json(request, await publicTranslationRequestStatus(env, event.id), 200, false, mode, metadata);
    }

    if (url.pathname === "/v1/events" || url.pathname === "/v1/search") {
      const usesUpdateOrder = url.searchParams.has("updated_since") || url.searchParams.has("filter[updated_since]");
      const filtered = filterEvents(records, url).sort((left, right) => usesUpdateOrder
        ? recordUpdatedAt(right).localeCompare(recordUpdatedAt(left))
        : right.lastActivityAt.localeCompare(left.lastActivityAt));
      const result = paginate(filtered.map(summaryForEvent), url);
      return json(request, result.page, 200, true, mode, metadata, { pagination: result.pagination });
    }

    const replayId = routeId(url.pathname, "replay");
    if (replayId) {
      const event = byId(replayId);
      if (!event) return error(request, 404, "event_not_found", "Policy event was not found");
      const asOf = url.searchParams.get("as_of");
      if (!asOf) return error(request, 400, "missing_as_of", "as_of is required");
      try { return json(request, replaySnapshot(event, asOf), 200, true, event.isSynthetic ? "synthetic" : "live", metadata); }
      catch { return error(request, 400, "invalid_as_of", "as_of must be an ISO-8601 timestamp"); }
    }

    const evidenceId = routeId(url.pathname, "evidence");
    if (evidenceId) {
      const event = byId(evidenceId);
      if (!event) return error(request, 404, "event_not_found", "Policy event was not found");
      const relationshipCandidates = event.isSynthetic ? [] : await relationshipCandidatesForEvent(env, event.id);
      return json(request, { documents: event.documents ?? [], documentInfo: event.documentInfo, documentVersions: event.documentVersions ?? [], documentDiff: event.documentDiff, relationshipCandidates, exposures: event.exposures, confounders: event.confounders, correctionNotes: event.correctionNotes }, 200, true, event.isSynthetic ? "synthetic" : "live", metadata);
    }

    const marketId = routeId(url.pathname, "market");
    if (marketId) {
      const event = byId(marketId);
      if (!event) return error(request, 404, "event_not_found", "Policy event was not found");
      return json(request, marketPayloadForEvent(event), 200, true, event.isSynthetic ? "synthetic" : "live", metadata);
    }

    const eventId = routeId(url.pathname);
    if (eventId) {
      const event = byId(eventId);
      return event ? json(request, detailForEvent(event), 200, true, event.isSynthetic ? "synthetic" : "live", metadata) : error(request, 404, "event_not_found", "Policy event was not found");
    }

    if (url.pathname === "/v1/taxonomy") {
      return json(request, {
        domains: policyDomains.map(({ slug, labelJA }) => ({ slug, labelJA })),
        instruments: instrumentTypes,
        agencies: [...new Set(records.map((event) => event.agency.code))].sort(),
        topics: [...new Set(records.flatMap((event) => event.topics))].sort(),
        tickers: [...new Set(records.flatMap((event) => event.tickers))].sort()
      }, 200, true, mode, metadata);
    }

    const securityID = url.pathname.match(/^\/v1\/securities\/([^/]+)$/)?.[1];
    if (securityID) {
      const row = await env.CORE.prepare("SELECT id,ticker,exchange,security_class,is_benchmark,active FROM securities WHERE id=? OR ticker=? COLLATE NOCASE LIMIT 1").bind(securityID, securityID).first();
      return row ? json(request, row, 200, true, mode, metadata) : error(request, 404, "security_not_found", "Security was not found");
    }

    return error(request, 404, "route_not_found", "Route was not found");
  }
} satisfies ExportedHandler<Env>;
