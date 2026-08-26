import { FederalRegisterAdapter, mapFederalRegisterDocument, type MappedFederalRegisterEvent } from "./adapters/federal-register.ts";
import { RegulationsGovAdapter } from "./adapters/regulations-gov.ts";
import { WhiteHouseAdapter, type WhiteHouseItem } from "./adapters/white-house.ts";
import { classifyDomain } from "./catalog.ts";
import { sourcePresentationTier } from "./editorial/analysis.ts";

export interface DiscoveryEnv {
  CORE: D1Database;
  OPS: D1Database;
  RAW: R2Bucket;
  ENVIRONMENT: string;
  REGULATIONS_GOV_API_KEY?: string;
  WHITE_HOUSE_MODIFIED_AT_OVERRIDES?: string;
}

export type DiscoverySummary = {
  source: string;
  discovered: number;
  published: number;
  failed: number;
  startedAt: string;
  completedAt: string;
  datasetRevision: string;
};

function bytesToUUID(bytes: Uint8Array): string {
  const value = new Uint8Array(bytes.slice(0, 16));
  value[6] = (value[6] & 0x0f) | 0x50;
  value[8] = (value[8] & 0x3f) | 0x80;
  const hex = [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function stableUUID(namespace: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${namespace}:${value}`));
  return bytesToUUID(new Uint8Array(digest));
}

function documentType(instrument: string): string {
  if (instrument === "final_rule" || instrument === "interim_final_rule") return "final_rule";
  if (instrument === "proposed_rule") return "proposed_rule";
  if (instrument === "correcting_amendment") return "correcting_amendment";
  if (["executive_order", "presidential_memorandum", "proclamation"].includes(instrument)) return "presidential_document";
  return "notice";
}

async function readModelForFederalRegister(item: MappedFederalRegisterEvent, detectedAt: string): Promise<Record<string, unknown>> {
  const eventID = await stableUUID("market-docket-event", `federal-register:${item.externalID}`);
  const documentID = await stableUUID("market-docket-document", `federal-register:${item.externalID}`);
  const timelineID = await stableUUID("market-docket-timeline", `federal-register:${item.externalID}:publication`);
  const metadataHash = await sha256(JSON.stringify(item));
  const availableAt = `${item.publicationDate}T00:00:00.000Z`;
  const titleJA = item.title;
  // Official English abstracts are source material, not Japanese copy. Keep them in bodyEN
  // and use an explicit holding message until an editorially reviewed translation exists.
  const summaryJA = "公式ソース確認済み・未分析。日本語要約は未作成のため、原文タイトルと公式資料を表示しています。";
  const document = {
    id: documentID,
    documentType: documentType(item.instrumentType),
    relationship: "primary",
    correctsDocumentID: null,
    documentNumber: item.externalID,
    publisherJA: item.agencyName,
    publisherEN: item.agencyName,
    titleJA,
    titleEN: item.title,
    officialURL: item.officialURL,
    govInfoPDFURL: item.govInfoPDFURL,
    publicInspectionPDFURL: item.publicInspectionPDFURL,
    docketIDs: item.docketIDs,
    regulationIDNumbers: item.rin,
    cfrReferences: item.cfr,
    publishedOn: item.publicationDate,
    effectiveOn: item.effectiveOn,
    applicableOn: null,
    commentsCloseOn: item.commentsCloseOn,
    sourceStatedAt: null,
    sourceStatedTimezone: null,
    firstObservedAt: detectedAt,
    ingestedAt: detectedAt,
    availableAt,
    availabilityBasis: "publication_date_only",
    timePrecision: "day",
    currentRevision: 1,
    contentHash: { algorithm: "sha256", value: metadataHash, scope: "official_metadata" },
    bodyJA: summaryJA,
    bodyEN: item.abstract ?? item.title
  };
  return {
    id: eventID,
    isSynthetic: false,
    lastActivityAt: availableAt,
    agency: { code: item.agencyCode, displayNameJA: item.agencyName, displayNameEN: item.agencyName },
    titleJA,
    titleEN: item.title,
    summaryJA,
    topics: [item.domainLabelJA, ...item.cfr.slice(0, 2)],
    tickers: [],
    category: item.category,
    status: item.instrumentType === "correcting_amendment" ? "corrected" : "published",
    timestampState: "systemDetectedOnly",
    analysisAnchor: "systemDetection",
    officialPublicationDate: item.publicationDate,
    publishedAt: null,
    detectedAt,
    revisedAt: null,
    sourceURL: item.officialURL,
    coverageState: "metadata_only",
    eventVerificationState: "source_verified",
    instrumentType: item.instrumentType,
    policyDomain: { slug: item.domainSlug, labelJA: item.domainLabelJA },
    documentInfo: { documentNumber: item.externalID, publisherJA: item.agencyName, publisherEN: item.agencyName, currentVersion: 1, contentHash: { algorithm: "sha256", value: metadataHash, scope: "official_metadata" } },
    timelineItems: [{
      id: timelineID,
      kind: "officialPublication",
      occurredAt: availableAt,
      titleJA: "Federal Register掲載",
      detailJA: "掲載日のみ確認済み。架空の公開時刻は付与していません。",
      sourceType: "official",
      verificationState: "automaticUnverified",
      documentVersion: 1,
      documentID
    }],
    exposures: [],
    marketSummaries: [],
    marketSeries: [],
    confounders: [],
    confounderReviewState: "unreviewed",
    importantClauses: [],
    documentVersions: [{ version: 1, publishedAt: availableAt, titleJA, bodyJA: summaryJA, bodyEN: item.abstract ?? item.title }],
    documents: [document],
    documentDiff: null,
    correctionNotes: []
  };
}

export function mergeAutomatedDiscoveryModel(
  automatic: Record<string, unknown>,
  prior: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!prior) return automatic;
  const editoriallyReviewed = new Set(["analyst_enriched", "market_mapped"]).has(String(prior.coverageState))
    || prior.eventVerificationState === "analyst_verified";
  const preserved = { ...automatic };
  if (editoriallyReviewed) {
    for (const key of ["summaryJA", "topics", "coverageState", "eventVerificationState", "policyDomain", "importantClauses"] as const) {
      if (prior[key] !== undefined) preserved[key] = prior[key];
    }
  }
  for (const key of ["tickers", "exposures", "marketSummaries", "marketSeries", "confounders", "correctionNotes"] as const) {
    if (Array.isArray(prior[key]) && prior[key].length > 0) preserved[key] = prior[key];
  }
  if (prior.confounderReviewState && prior.confounderReviewState !== "unreviewed") preserved.confounderReviewState = prior.confounderReviewState;
  return preserved;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function discoverFederalRegister(env: DiscoveryEnv, limit = 100): Promise<DiscoverySummary> {
  const startedAt = new Date().toISOString();
  const runID = crypto.randomUUID();
  await env.OPS.prepare("INSERT INTO ingestion_runs (id,trigger_kind,status,started_at,summary_json) VALUES (?,'cron_federal_register','running',?,NULL)").bind(runID, startedAt).run();
  try {
    const documents = await new FederalRegisterAdapter().discover(limit);
    const mapped = documents.map(mapFederalRegisterDocument);
    const automaticModels = await Promise.all(mapped.map((item) => readModelForFederalRegister(item, startedAt)));
    const priorModels = new Map<string, Record<string, unknown>>();
    for (const batch of chunks(automaticModels.map((model) => model.id as string), 80)) {
      if (batch.length === 0) continue;
      const rows = await env.CORE.prepare(`SELECT event_id,payload_json FROM event_read_models WHERE event_id IN (${batch.map(() => "?").join(",")}) AND published_at IS NOT NULL`)
        .bind(...batch).all<{ event_id: string; payload_json: string }>();
      for (const row of rows.results) priorModels.set(row.event_id, JSON.parse(row.payload_json) as Record<string, unknown>);
    }
    const models = automaticModels.map((model) => mergeAutomatedDiscoveryModel(model, priorModels.get(model.id as string)));
    const statements: D1PreparedStatement[] = [
      env.CORE.prepare("INSERT INTO sources (id,code,display_name,base_url,source_kind,active,created_at) VALUES ('source-federal-register','FEDERAL_REGISTER','Federal Register','https://www.federalregister.gov','official',1,?) ON CONFLICT(code) DO UPDATE SET active=1,display_name=excluded.display_name").bind(startedAt)
    ];
    for (let index = 0; index < mapped.length; index += 1) {
      const item = mapped[index];
      const model = models[index];
      const eventID = model.id as string;
      const policyDomain = model.policyDomain as { slug: string };
      const document = (model.documents as Array<Record<string, unknown>>)[0];
      const documentID = document.id as string;
      const sourceItemID = `source-federal-register:${item.externalID}`;
      const timeline = (model.timelineItems as Array<Record<string, unknown>>)[0];
      statements.push(
        env.CORE.prepare("INSERT INTO source_items (id,source_id,external_id,canonical_url,first_detected_at,last_detected_at,available_at) VALUES (?,'source-federal-register',?,?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET canonical_url=excluded.canonical_url,last_detected_at=excluded.last_detected_at,available_at=excluded.available_at").bind(sourceItemID, item.externalID, item.officialURL, startedAt, startedAt, document.availableAt),
        env.CORE.prepare("INSERT INTO policy_events (id,agency_code,title_ja,title_en,summary_ja,status,official_published_at,first_detected_at,last_activity_at,published_at,is_synthetic,created_at,updated_at,coverage_state,verification_state,domain_slug,instrument_type,time_precision) VALUES (?,?,?,?,?,?,NULL,?,?,?,0,?,?,?,?,?,?,'day') ON CONFLICT(id) DO UPDATE SET agency_code=excluded.agency_code,title_ja=excluded.title_ja,title_en=excluded.title_en,summary_ja=excluded.summary_ja,status=excluded.status,last_activity_at=excluded.last_activity_at,published_at=excluded.published_at,updated_at=excluded.updated_at,coverage_state=excluded.coverage_state,verification_state=excluded.verification_state,domain_slug=excluded.domain_slug,instrument_type=excluded.instrument_type,time_precision='day'").bind(eventID, item.agencyCode, model.titleJA, model.titleEN, model.summaryJA, model.status, startedAt, model.lastActivityAt, startedAt, startedAt, startedAt, model.coverageState, model.eventVerificationState, policyDomain.slug, item.instrumentType),
        env.CORE.prepare("INSERT INTO documents (id,source_item_id,document_number,publisher,title,official_url,current_revision_id,created_at,document_type,corrects_document_id,source_stated_at,source_stated_timezone,first_observed_at,ingested_at,published_on,effective_on,applicable_on,comments_close_on,available_at,availability_basis,govinfo_url,metadata_sha256) VALUES (?,?,?,?,?,?,NULL,?,?,NULL,NULL,NULL,?,?,?,?,NULL,?,?,'publication_date_only',?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,official_url=excluded.official_url,first_observed_at=COALESCE(documents.first_observed_at,excluded.first_observed_at),ingested_at=excluded.ingested_at,published_on=excluded.published_on,effective_on=excluded.effective_on,comments_close_on=excluded.comments_close_on,available_at=excluded.available_at,govinfo_url=excluded.govinfo_url,metadata_sha256=excluded.metadata_sha256").bind(documentID, sourceItemID, item.externalID, item.agencyName, item.title, item.officialURL, startedAt, document.documentType, startedAt, startedAt, item.publicationDate, item.effectiveOn, item.commentsCloseOn, document.availableAt, item.govInfoPDFURL, (document.contentHash as Record<string, unknown>).value),
        env.CORE.prepare("INSERT INTO event_documents (event_id,document_id,relationship) VALUES (?,?,'primary') ON CONFLICT(event_id,document_id) DO UPDATE SET relationship='primary'").bind(eventID, documentID),
        env.CORE.prepare("INSERT INTO timeline_entries (id,event_id,kind,occurred_at,available_at,title_ja,detail_ja,source_type,verification_state,document_revision_id) VALUES (?,?,?,?,?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET occurred_at=excluded.occurred_at,available_at=excluded.available_at,title_ja=excluded.title_ja,detail_ja=excluded.detail_ja,verification_state=excluded.verification_state").bind(timeline.id, eventID, timeline.kind, timeline.occurredAt, timeline.occurredAt, timeline.titleJA, timeline.detailJA, timeline.sourceType, timeline.verificationState),
        env.CORE.prepare("INSERT OR IGNORE INTO policy_analyses (id,event_id,analysis_status,presentation_tier,canonical_title_en,policy_type,policy_domain_codes_json,primary_agency_code,affected_region_codes_json,affected_sector_codes_json,affected_product_terms_json,market_analysis_mode,editorial_priority,analysis_version,created_at,updated_at) VALUES (?,?,'unreviewed',?,?,?,?,?,'[]','[]','[]','unmapped',0,1,?,?)").bind(`${eventID}:analysis:1`, eventID, sourcePresentationTier(item.instrumentType), model.titleEN, item.instrumentType, JSON.stringify([policyDomain.slug]), item.agencyCode, startedAt, startedAt),
        env.CORE.prepare("INSERT INTO event_read_models (event_id,schema_version,payload_json,source_updated_at,generated_at,published_at) VALUES (?,4,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET schema_version=4,payload_json=excluded.payload_json,source_updated_at=excluded.source_updated_at,generated_at=excluded.generated_at,published_at=excluded.published_at").bind(eventID, JSON.stringify(model), startedAt, startedAt, startedAt)
      );
      for (const docketID of item.docketIDs) {
        statements.push(
          env.CORE.prepare("INSERT INTO dockets (id,source_code,official_url,last_verified_at) VALUES (?,'REGULATIONS_GOV',?,?) ON CONFLICT(id) DO UPDATE SET official_url=excluded.official_url,last_verified_at=excluded.last_verified_at").bind(docketID, `https://www.regulations.gov/docket/${encodeURIComponent(docketID)}`, startedAt),
          env.CORE.prepare("INSERT OR IGNORE INTO event_dockets (event_id,docket_id) VALUES (?,?)").bind(eventID, docketID)
        );
      }
    }
    const documentIDs = new Map(mapped.map((item, index) => [item.externalID, ((models[index].documents as Array<Record<string, unknown>>)[0].id as string)]));
    for (const item of mapped) {
      const lower = item.title.toLowerCase();
      const relationship = lower.includes("correction") ? "corrects"
        : lower.includes("withdrawal") ? "rescinds"
        : lower.includes("supersed") ? "supersedes"
        : lower.includes("amendment") ? "amends" : null;
      if (!relationship) continue;
      const candidates = mapped.filter((candidate) => candidate.externalID !== item.externalID && candidate.agencyCode === item.agencyCode);
      const target = candidates.find((candidate) => item.docketIDs.some((docket) => candidate.docketIDs.includes(docket)))
        ?? candidates.find((candidate) => item.cfr.some((reference) => candidate.cfr.includes(reference)))
        ?? candidates[0];
      if (!target) continue;
      const confidence = item.docketIDs.some((docket) => target.docketIDs.includes(docket)) ? 0.9
        : item.cfr.some((reference) => target.cfr.includes(reference)) ? 0.55 : 0.2;
      const relationID = await stableUUID("market-docket-document-relationship", `${item.externalID}:${relationship}:${target.externalID}`);
      statements.push(env.CORE.prepare("INSERT INTO document_relationships (id,from_document_id,to_document_id,relationship,confidence,review_state,created_at) VALUES (?,?,?,?,?,'candidate',?) ON CONFLICT(from_document_id,to_document_id,relationship) DO UPDATE SET confidence=excluded.confidence").bind(relationID, documentIDs.get(item.externalID), documentIDs.get(target.externalID), relationship, confidence, startedAt));
    }
    for (const batch of chunks(statements, 80)) await env.CORE.batch(batch);
    const completedAt = new Date().toISOString();
    const summary = { source: "federal-register", discovered: mapped.length, published: mapped.length, failed: 0, startedAt, completedAt, datasetRevision: startedAt };
    await env.OPS.batch([
      env.OPS.prepare("UPDATE ingestion_runs SET status='completed',completed_at=?,summary_json=? WHERE id=?").bind(completedAt, JSON.stringify(summary), runID),
      env.OPS.prepare("INSERT INTO source_health (source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json) VALUES ('FEDERAL_REGISTER','healthy',0,?,NULL,?,?) ON CONFLICT(source_code) DO UPDATE SET state='healthy',consecutive_failures=0,last_success_at=excluded.last_success_at,next_check_at=excluded.next_check_at,detail_json=excluded.detail_json").bind(completedAt, new Date(Date.now() + 15 * 60_000).toISOString(), JSON.stringify({ discovered: mapped.length }))
    ]);
    return summary;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await env.OPS.batch([
      env.OPS.prepare("UPDATE ingestion_runs SET status='failed',completed_at=?,summary_json=? WHERE id=?").bind(completedAt, JSON.stringify({ error: message }), runID),
      env.OPS.prepare("INSERT INTO source_health (source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json) VALUES ('FEDERAL_REGISTER','degraded',1,NULL,?,?,?) ON CONFLICT(source_code) DO UPDATE SET state='degraded',consecutive_failures=source_health.consecutive_failures+1,last_failure_at=excluded.last_failure_at,next_check_at=excluded.next_check_at,detail_json=excluded.detail_json").bind(completedAt, new Date(Date.now() + 30 * 60_000).toISOString(), JSON.stringify({ error: message }))
    ]);
    throw error;
  }
}

export async function whiteHouseReadModel(item: WhiteHouseItem, detectedAt: string): Promise<Record<string, unknown>> {
  const eventID = await stableUUID("market-docket-event", `white-house:${item.id}`);
  const documentID = await stableUUID("market-docket-document", `white-house:${item.id}`);
  const timelineID = await stableUUID("market-docket-timeline", `white-house:${item.id}:publication`);
  const revisionOneBody = JSON.stringify({ id: item.id, title: item.title, url: item.url, publishedAt: item.publishedAt });
  const revisionTwoBody = item.modifiedAt ? JSON.stringify({ id: item.id, title: item.title, url: item.url, publishedAt: item.publishedAt, modifiedAt: item.modifiedAt }) : null;
  const revisionOneHash = await sha256(revisionOneBody);
  const revisionTwoHash = revisionTwoBody ? await sha256(revisionTwoBody) : null;
  const metadataHash = revisionTwoHash ?? revisionOneHash;
  const domain = classifyDomain(item.title, ["The White House", "Executive Office of the President"]);
  const publishedOn = item.publishedAt.slice(0, 10);
  const slug = new URL(item.url).pathname.split("/").filter(Boolean).at(-1) ?? eventID;
  const documentNumber = `WH-${publishedOn.replaceAll("-", "")}-${slug}`;
  const summaryJA = "公式ソース確認済み・分析中。利用者向け日本語要約は編集レイヤーで作成します。";
  const document = {
    id: documentID,
    documentType: "presidential_document",
    relationship: "primary",
    correctsDocumentID: null,
    documentNumber,
    publisherJA: "ホワイトハウス",
    publisherEN: "The White House",
    titleJA: item.title,
    titleEN: item.title,
    officialURL: item.url,
    govInfoPDFURL: null,
    publicInspectionPDFURL: null,
    docketIDs: [],
    regulationIDNumbers: [],
    cfrReferences: [],
    publishedOn,
    effectiveOn: null,
    applicableOn: null,
    commentsCloseOn: null,
    sourceStatedAt: item.publishedAt,
    sourceStatedTimezone: "UTC",
    firstObservedAt: detectedAt,
    ingestedAt: detectedAt,
    availableAt: item.publishedAt,
    availabilityBasis: "source_stated",
    timePrecision: "exact",
    currentRevision: item.modifiedAt ? 2 : 1,
    contentHash: { algorithm: "sha256", value: metadataHash, scope: "official_feed_metadata" },
    bodyJA: summaryJA,
    bodyEN: item.title
  };
  return {
    id: eventID,
    isSynthetic: false,
    lastActivityAt: item.modifiedAt ?? item.publishedAt,
    agency: { code: "WH", displayNameJA: "ホワイトハウス", displayNameEN: "The White House" },
    titleJA: item.title,
    titleEN: item.title,
    summaryJA,
    topics: [domain.labelJA, "大統領令"],
    tickers: [],
    category: domain.swiftValue,
    status: item.modifiedAt ? "revised" : "published",
    timestampState: "officialExact",
    analysisAnchor: "officialPublication",
    officialPublicationDate: publishedOn,
    publishedAt: item.publishedAt,
    detectedAt,
    revisedAt: item.modifiedAt ?? null,
    sourceURL: item.url,
    coverageState: "metadata_only",
    eventVerificationState: "source_verified",
    instrumentType: "executive_order",
    policyDomain: { slug: domain.slug, labelJA: domain.labelJA },
    documentInfo: { documentNumber, publisherJA: "ホワイトハウス", publisherEN: "The White House", currentVersion: item.modifiedAt ? 2 : 1, contentHash: { algorithm: "sha256", value: metadataHash, scope: "official_feed_metadata" } },
    timelineItems: [{
      id: timelineID,
      kind: "officialPublication",
      occurredAt: item.publishedAt,
      titleJA: "大統領文書を公開",
      detailJA: "公式フィード記載の公開時刻を使用しています。",
      sourceType: "official",
      verificationState: "automaticUnverified",
      documentVersion: 1,
      documentID
    }, ...(item.modifiedAt ? [{
      id: await stableUUID("market-docket-timeline", `white-house:${item.id}:revision:2`),
      kind: "documentRevision",
      occurredAt: item.modifiedAt,
      titleJA: "同一ページの更新を検知",
      detailJA: "公式ページのdateModifiedが公開時刻より後であることを記録しました。",
      sourceType: "official",
      verificationState: "automaticUnverified",
      documentVersion: 2,
      documentID
    }] : [])],
    exposures: [],
    marketSummaries: [],
    marketSeries: [],
    confounders: [],
    confounderReviewState: "unreviewed",
    importantClauses: [],
    documentVersions: [
      { version: 1, publishedAt: item.publishedAt, titleJA: item.title, bodyJA: summaryJA, bodyEN: item.title },
      ...(item.modifiedAt ? [{ version: 2, publishedAt: item.modifiedAt, titleJA: item.title, bodyJA: "公式ページの更新時刻を検知しました。内容差分は編集確認待ちです。", bodyEN: item.title }] : [])
    ],
    documents: [document],
    documentDiff: null,
    correctionNotes: []
  };
}

export async function checkWhiteHouse(env: DiscoveryEnv): Promise<{ count: number; checkedAt: string }> {
  const checkedAt = new Date().toISOString();
  try {
    let items = await new WhiteHouseAdapter().discover(20);
    let overrides: Record<string, string> = {};
    try { overrides = JSON.parse(env.WHITE_HOUSE_MODIFIED_AT_OVERRIDES ?? "{}") as Record<string, string>; }
    catch { throw new Error("WHITE_HOUSE_MODIFIED_AT_OVERRIDES must be valid JSON"); }
    items = items.map((item) => {
      if (item.modifiedAt) return item;
      const value = overrides[item.id] ?? overrides[item.url];
      if (!value) return item;
      const modified = new Date(value);
      if (Number.isNaN(modified.getTime()) || modified.toISOString() <= item.publishedAt) throw new Error(`Invalid White House modifiedAt override for ${item.id}`);
      return { ...item, modifiedAt: modified.toISOString() };
    });
    const models = await Promise.all(items.map((item) => whiteHouseReadModel(item, checkedAt)));
    const statements: D1PreparedStatement[] = [
      env.CORE.prepare("INSERT INTO sources (id,code,display_name,base_url,source_kind,active,created_at) VALUES ('source-white-house','WHITE_HOUSE','The White House','https://www.whitehouse.gov','official',1,?) ON CONFLICT(code) DO UPDATE SET active=1,display_name=excluded.display_name").bind(checkedAt)
    ];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const model = models[index];
      const eventID = model.id as string;
      const document = (model.documents as Array<Record<string, unknown>>)[0];
      const documentID = document.id as string;
      const domain = model.policyDomain as { slug: string };
      const sourceItemID = `source-white-house:${documentID}`;
      const currentRevision = Number(document.currentRevision);
      const revisionBodies = [
        JSON.stringify({ id: item.id, title: item.title, url: item.url, publishedAt: item.publishedAt }),
        ...(item.modifiedAt ? [JSON.stringify({ id: item.id, title: item.title, url: item.url, publishedAt: item.publishedAt, modifiedAt: item.modifiedAt })] : [])
      ];
      const revisionHashes = await Promise.all(revisionBodies.map(sha256));
      const revisionIDs = await Promise.all(revisionBodies.map((_body, revisionIndex) => stableUUID("market-docket-revision", `white-house:${item.id}:${revisionIndex + 1}`)));
      const storageIDs = revisionHashes.map((_hash, revisionIndex) => `raw-${documentID}-r${revisionIndex + 1}`);
      const objectKeys = revisionHashes.map((hash, revisionIndex) => `v1/documents/${documentID}/revisions/${revisionIndex + 1}/raw/${hash}`);
      await Promise.all(revisionBodies.map((body, revisionIndex) => env.RAW.put(objectKeys[revisionIndex], body, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { sha256: revisionHashes[revisionIndex], sourceURL: item.url, revision: String(revisionIndex + 1) }
      })));
      statements.push(
        ...revisionBodies.map((body, revisionIndex) => env.CORE.prepare("INSERT INTO storage_objects (id,bucket_role,object_key,sha256,content_type,byte_length,created_at,state,source_job_id,updated_at) VALUES (?,'raw',?,?,?,? ,?,'ready',NULL,?) ON CONFLICT(id) DO UPDATE SET object_key=excluded.object_key,sha256=excluded.sha256,byte_length=excluded.byte_length,state='ready',updated_at=excluded.updated_at").bind(storageIDs[revisionIndex], objectKeys[revisionIndex], revisionHashes[revisionIndex], "application/json; charset=utf-8", new TextEncoder().encode(body).byteLength, checkedAt, checkedAt)),
        env.CORE.prepare("INSERT INTO source_items (id,source_id,external_id,canonical_url,first_detected_at,last_detected_at,available_at) VALUES (?,'source-white-house',?,?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET canonical_url=excluded.canonical_url,last_detected_at=excluded.last_detected_at,available_at=excluded.available_at").bind(sourceItemID, item.id, item.url, checkedAt, checkedAt, item.publishedAt),
        env.CORE.prepare("INSERT INTO policy_events (id,agency_code,title_ja,title_en,summary_ja,status,official_published_at,first_detected_at,last_activity_at,published_at,is_synthetic,created_at,updated_at,coverage_state,verification_state,domain_slug,instrument_type,time_precision) VALUES (?,'WH',?,?,?,?,?,?,?, ?,0,?,?, 'metadata_only','source_verified',?,'executive_order','exact') ON CONFLICT(id) DO UPDATE SET title_en=excluded.title_en,status=excluded.status,last_activity_at=excluded.last_activity_at,updated_at=excluded.updated_at,official_published_at=excluded.official_published_at,time_precision='exact'").bind(eventID, model.titleJA, model.titleEN, model.summaryJA, model.status, item.publishedAt, checkedAt, model.lastActivityAt, checkedAt, checkedAt, checkedAt, domain.slug),
        env.CORE.prepare("INSERT INTO documents (id,source_item_id,document_number,publisher,title,official_url,current_revision_id,created_at,document_type,corrects_document_id,source_stated_at,source_stated_timezone,first_observed_at,ingested_at,published_on,effective_on,applicable_on,comments_close_on,available_at,availability_basis,metadata_sha256) VALUES (?,?,?,?,?,?,NULL,?,'presidential_document',NULL,?,'UTC',?,?,?,NULL,NULL,NULL,?,'source_stated',?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,official_url=excluded.official_url,source_stated_at=excluded.source_stated_at,first_observed_at=COALESCE(documents.first_observed_at,excluded.first_observed_at),ingested_at=excluded.ingested_at,available_at=excluded.available_at,metadata_sha256=excluded.metadata_sha256").bind(documentID, sourceItemID, document.documentNumber, "The White House", item.title, item.url, checkedAt, item.publishedAt, checkedAt, checkedAt, document.publishedOn, item.publishedAt, (document.contentHash as Record<string, unknown>).value),
        ...revisionBodies.map((_body, revisionIndex) => env.CORE.prepare("INSERT INTO document_revisions (id,document_id,revision_number,raw_object_id,normalized_object_id,official_published_at,first_detected_at,available_at,time_precision,content_sha256,created_at) VALUES (?,?,?, ?,NULL,?,?,?,?,?,?) ON CONFLICT(document_id,revision_number) DO UPDATE SET raw_object_id=excluded.raw_object_id,official_published_at=excluded.official_published_at,first_detected_at=MIN(document_revisions.first_detected_at,excluded.first_detected_at),available_at=excluded.available_at,time_precision='exact',content_sha256=excluded.content_sha256").bind(revisionIDs[revisionIndex], documentID, revisionIndex + 1, storageIDs[revisionIndex], revisionIndex === 0 ? item.publishedAt : item.modifiedAt, checkedAt, revisionIndex === 0 ? item.publishedAt : item.modifiedAt, "exact", revisionHashes[revisionIndex], checkedAt)),
        env.CORE.prepare("UPDATE documents SET current_revision_id=? WHERE id=?").bind(revisionIDs[currentRevision - 1], documentID),
        env.CORE.prepare("INSERT INTO event_documents (event_id,document_id,relationship) VALUES (?,?,'primary') ON CONFLICT(event_id,document_id) DO UPDATE SET relationship='primary'").bind(eventID, documentID),
        ...(model.timelineItems as Array<Record<string, unknown>>).map((timelineItem, timelineIndex) => env.CORE.prepare("INSERT INTO timeline_entries (id,event_id,kind,occurred_at,available_at,title_ja,detail_ja,source_type,verification_state,document_revision_id) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET occurred_at=excluded.occurred_at,available_at=excluded.available_at,title_ja=excluded.title_ja,detail_ja=excluded.detail_ja,document_revision_id=excluded.document_revision_id").bind(timelineItem.id, eventID, timelineItem.kind, timelineItem.occurredAt, timelineItem.occurredAt, timelineItem.titleJA, timelineItem.detailJA, timelineItem.sourceType, timelineItem.verificationState, revisionIDs[timelineIndex] ?? revisionIDs.at(-1))),
        env.CORE.prepare("INSERT OR IGNORE INTO policy_analyses (id,event_id,analysis_status,presentation_tier,canonical_title_en,policy_type,policy_domain_codes_json,primary_agency_code,affected_region_codes_json,affected_sector_codes_json,affected_product_terms_json,market_analysis_mode,editorial_priority,analysis_version,created_at,updated_at) VALUES (?,?,'unreviewed',?,?,'executive_order',?,'WH','[]','[]','[]','unmapped',0,1,?,?)").bind(`${eventID}:analysis:1`, eventID, sourcePresentationTier("executive_order"), item.title, JSON.stringify([domain.slug]), checkedAt, checkedAt),
        env.CORE.prepare("INSERT INTO event_read_models (event_id,schema_version,payload_json,source_updated_at,generated_at,published_at) VALUES (?,4,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET schema_version=4,payload_json=excluded.payload_json,source_updated_at=excluded.source_updated_at,generated_at=excluded.generated_at,published_at=excluded.published_at").bind(eventID, JSON.stringify(model), checkedAt, checkedAt, checkedAt)
      );
    }
    for (const batch of chunks(statements, 80)) await env.CORE.batch(batch);
    await env.OPS.prepare("INSERT INTO source_health (source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json) VALUES ('WHITE_HOUSE','healthy',0,?,NULL,?,?) ON CONFLICT(source_code) DO UPDATE SET state='healthy',consecutive_failures=0,last_success_at=excluded.last_success_at,next_check_at=excluded.next_check_at,detail_json=excluded.detail_json").bind(checkedAt, new Date(Date.now() + 60 * 60_000).toISOString(), JSON.stringify({ discovered: items.length, feed: "presidential-actions", modifiedMetadataOverrides: items.filter((item) => overrides[item.id] || overrides[item.url]).length })).run();
    return { count: items.length, checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.OPS.prepare("INSERT INTO source_health (source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json) VALUES ('WHITE_HOUSE','degraded',1,NULL,?,?,?) ON CONFLICT(source_code) DO UPDATE SET state='degraded',consecutive_failures=source_health.consecutive_failures+1,last_failure_at=excluded.last_failure_at,next_check_at=excluded.next_check_at,detail_json=excluded.detail_json").bind(checkedAt, new Date(Date.now() + 60 * 60_000).toISOString(), JSON.stringify({ error: message })).run();
    throw error;
  }
}

export async function checkRegulationsGov(env: DiscoveryEnv): Promise<{ state: "healthy" | "missing_credentials"; count: number; checkedAt: string }> {
  const checkedAt = new Date().toISOString();
  if (!env.REGULATIONS_GOV_API_KEY) {
    await env.OPS.prepare("INSERT INTO source_health (source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json) VALUES ('REGULATIONS_GOV','missing_credentials',0,NULL,NULL,?,?) ON CONFLICT(source_code) DO UPDATE SET state='missing_credentials',consecutive_failures=0,next_check_at=excluded.next_check_at,detail_json=excluded.detail_json")
      .bind(new Date(Date.now() + 60 * 60_000).toISOString(), JSON.stringify({ requiredSecret: "REGULATIONS_GOV_API_KEY", demoKeyAllowed: false })).run();
    return { state: "missing_credentials", count: 0, checkedAt };
  }
  try {
    const items = await new RegulationsGovAdapter(env.REGULATIONS_GOV_API_KEY).discover(20);
    await env.OPS.prepare("INSERT INTO source_health (source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json) VALUES ('REGULATIONS_GOV','healthy',0,?,NULL,?,?) ON CONFLICT(source_code) DO UPDATE SET state='healthy',consecutive_failures=0,last_success_at=excluded.last_success_at,next_check_at=excluded.next_check_at,detail_json=excluded.detail_json")
      .bind(checkedAt, new Date(Date.now() + 60 * 60_000).toISOString(), JSON.stringify({ discovered: items.length, mode: "credentialed_api" })).run();
    return { state: "healthy", count: items.length, checkedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.OPS.prepare("INSERT INTO source_health (source_code,state,consecutive_failures,last_success_at,last_failure_at,next_check_at,detail_json) VALUES ('REGULATIONS_GOV','degraded',1,NULL,?,?,?) ON CONFLICT(source_code) DO UPDATE SET state='degraded',consecutive_failures=source_health.consecutive_failures+1,last_failure_at=excluded.last_failure_at,next_check_at=excluded.next_check_at,detail_json=excluded.detail_json")
      .bind(checkedAt, new Date(Date.now() + 60 * 60_000).toISOString(), JSON.stringify({ error: message })).run();
    throw error;
  }
}
