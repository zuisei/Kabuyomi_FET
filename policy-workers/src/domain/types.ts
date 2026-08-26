import type { PublicPolicyAnalysis } from "../editorial/analysis.ts";
import type { PublicTranslation } from "../translation/model.ts";

export type TimelineItem = {
  id: string;
  kind: string;
  occurredAt: string;
  titleJA: string;
  detailJA: string;
  documentVersion?: number;
  documentID?: string;
};

export type DocumentVersion = {
  version: number;
  publishedAt: string;
  titleJA: string;
  bodyJA: string;
  bodyEN: string;
};

export type DocumentType = "final_rule" | "proposed_rule" | "presidential_document" | "correcting_amendment" | "notice" | "other";
export type DocumentRelationship = "primary" | "corrects" | "related";
export type AvailabilityBasis = "source_stated" | "first_observed" | "publication_date_only" | "manual_estimate";

export type PolicyDocument = {
  id: string;
  documentType: DocumentType;
  relationship: DocumentRelationship;
  correctsDocumentID: string | null;
  documentNumber: string;
  publisherJA: string;
  publisherEN: string;
  titleJA: string;
  titleEN: string;
  officialURL: string;
  publishedOn: string | null;
  effectiveOn: string | null;
  applicableOn: string | null;
  commentsCloseOn?: string | null;
  sourceStatedAt: string | null;
  sourceStatedTimezone: string | null;
  firstObservedAt: string;
  ingestedAt: string;
  availableAt: string;
  availabilityBasis: AvailabilityBasis;
  timePrecision: "exact" | "minute" | "hour" | "day";
  currentRevision: number;
  contentHash: ContentHash;
  bodyJA: string;
  bodyEN: string;
  govInfoPDFURL?: string | null;
  publicInspectionPDFURL?: string | null;
  docketIDs?: string[];
  regulationIDNumbers?: string[];
  cfrReferences?: string[];
};

export type MarketPoint = {
  timestamp: string;
  normalizedSecurityPrice: number;
  normalizedBenchmarkPrice: number;
  abnormalReturnPoints: number;
  volumeRatio: number;
};

export type AvailableRecord = { occurredAt: string; [key: string]: unknown };
export type ImportantClause = { id: string; textJA: string; sourceURL?: string | null };
export type MarketSummary = { availableAt: string; [key: string]: unknown };
export type AgencyCode = string;
export type ContentHash = { algorithm: "sha256"; value: string };

export type PolicyEvent = {
  id: string;
  isSynthetic: boolean;
  lastActivityAt: string;
  agency: { code: AgencyCode; displayNameJA: string; displayNameEN: string };
  titleJA: string;
  titleEN: string;
  summaryJA: string;
  topics: string[];
  tickers: string[];
  status: string;
  publishedAt: string | null;
  revisedAt: string | null;
  documentInfo?: { documentNumber: string; contentHash: ContentHash; [key: string]: unknown };
  timelineItems: TimelineItem[];
  documentVersions?: DocumentVersion[];
  documents?: PolicyDocument[];
  marketSeries: MarketPoint[];
  marketSummaries: MarketSummary[];
  confounders: AvailableRecord[];
  confounderReviewState?: "unreviewed" | "verified_none" | "candidate" | "verified";
  importantClauses?: ImportantClause[];
  correctionNotes: AvailableRecord[];
  coverageState?: string;
  eventVerificationState?: string;
  instrumentType?: string;
  policyDomain?: { slug: string; labelJA: string };
  analysis?: PublicPolicyAnalysis;
  translation?: PublicTranslation;
  [key: string]: unknown;
};

export type EventSummary = {
  id: string;
  agency: PolicyEvent["agency"];
  titleJA: string;
  titleEN: string;
  summaryJA: string;
  topics: string[];
  tickers: string[];
  status: string;
  lastActivityAt: string;
  publishedAt: string | null;
  revisedAt: string | null;
  hasMarketData: boolean;
  marketEvaluationAvailableAt: string | null;
  timelineItemCount: number;
  updateCount: number;
  relatedDocumentCount: number;
  hasCorrectionDocument: boolean;
  confounderCount: number;
  coverageState: string;
  verificationState: string;
  instrumentType: string;
  domain: { slug: string; labelJA: string } | null;
  analysis: PublicPolicyAnalysis;
  translation: PublicTranslation | null;
  legalDates: Array<{
    kind: "comments_close" | "effective" | "applicable";
    date: string;
    documentID: string;
    documentNumber: string | null;
    officialURL: string;
  }>;
  publicationGrouping: {
    documentNumber: string | null;
    docketIDs: string[];
    regulationIDNumbers: string[];
    cfrReferences: string[];
  } | null;
};

export type ReplaySnapshot = {
  eventId: string;
  asOf: string;
  timelineItems: TimelineItem[];
  documentVersion: DocumentVersion | null;
  documents: PolicyDocument[];
  marketSeries: MarketPoint[];
  marketSummaries: MarketSummary[];
  confounders: AvailableRecord[];
  correctionNotes: AvailableRecord[];
  laterFactCount: number;
};
