export type IngestTimePrecision = "exact" | "minute" | "hour" | "day";

export type ProcessorIngestInput = {
  sourceCode: "BIS" | "WH" | "USTR" | "DOC" | "FR" | "GOVINFO";
  externalID: string;
  sourceURL: string;
  eventID: string;
  documentID: string;
  documentNumber: string;
  revisionNumber: number;
  documentType: "final_rule" | "correcting_amendment" | "notice" | "other";
  relationship: "primary" | "corrects" | "related";
  correctsDocumentID?: string;
  titleJA: string;
  titleEN: string;
  publisherJA: string;
  publisherEN: string;
  publishedOn: string;
  effectiveOn?: string;
  applicableOn?: string;
  commentsCloseOn?: string;
  sourceStatedAt?: string;
  sourceStatedTimezone?: string;
  availableAt: string;
  availabilityBasis: "source_stated" | "first_observed" | "publication_date_only" | "manual_estimate";
  timePrecision?: IngestTimePrecision;
  bodyText: string;
  rawBodyBase64?: string;
  contentType?: string;
  displayBodyJA: string;
  displayBodyEN: string;
  changeSummaryJA?: string;
  firstObservedAt: string;
};

export type EventModel = Record<string, any>;

const agencyNames: Record<string, { displayNameJA: string; displayNameEN: string }> = {
  BIS: { displayNameJA: "米国商務省産業安全保障局", displayNameEN: "Bureau of Industry and Security" },
  WH: { displayNameJA: "ホワイトハウス", displayNameEN: "The White House" },
  USTR: { displayNameJA: "米国通商代表部", displayNameEN: "Office of the United States Trade Representative" },
  DOC: { displayNameJA: "米国商務省", displayNameEN: "U.S. Department of Commerce" },
  FR: { displayNameJA: "連邦官報", displayNameEN: "Federal Register" },
  GOVINFO: { displayNameJA: "GovInfo", displayNameEN: "GovInfo" }
};

export function resolvedTimePrecision(input: Pick<ProcessorIngestInput, "availabilityBasis" | "timePrecision">): IngestTimePrecision {
  return input.availabilityBasis === "publication_date_only" ? "day" : (input.timePrecision ?? "exact");
}

export function buildReadModel(input: ProcessorIngestInput, prior: EventModel | null, rawHash: string): EventModel {
  const firstObservedAt = input.firstObservedAt;
  const timePrecision = resolvedTimePrecision(input);
  const document = {
    id: input.documentID,
    documentType: input.documentType,
    relationship: input.relationship,
    correctsDocumentID: input.correctsDocumentID ?? null,
    documentNumber: input.documentNumber,
    publisherJA: input.publisherJA,
    publisherEN: input.publisherEN,
    titleJA: input.titleJA,
    titleEN: input.titleEN,
    officialURL: input.sourceURL,
    publishedOn: input.publishedOn,
    effectiveOn: input.effectiveOn ?? null,
    applicableOn: input.applicableOn ?? null,
    commentsCloseOn: input.commentsCloseOn ?? null,
    sourceStatedAt: input.sourceStatedAt ?? null,
    sourceStatedTimezone: input.sourceStatedTimezone ?? null,
    firstObservedAt,
    ingestedAt: firstObservedAt,
    availableAt: input.availableAt,
    availabilityBasis: input.availabilityBasis,
    timePrecision,
    currentRevision: input.revisionNumber,
    contentHash: { algorithm: "sha256", value: rawHash },
    bodyJA: input.displayBodyJA,
    bodyEN: input.displayBodyEN
  };
  const timelineItem = {
    id: input.documentID,
    kind: input.documentType === "correcting_amendment" ? "correction" : input.revisionNumber > 1 ? "documentRevision" : "officialPublication",
    occurredAt: input.availableAt,
    titleJA: input.documentType === "correcting_amendment" ? "訂正文書が公開" : input.revisionNumber > 1 ? "同一文書の更新版が公開" : "原規則が公開",
    detailJA: input.availabilityBasis === "publication_date_only" ? `${input.publishedOn}掲載。公式資料の記載時刻にはタイムゾーンがないため、日単位で表示します。` : (input.changeSummaryJA ?? input.displayBodyJA),
    sourceType: "official",
    verificationState: "humanVerified",
    documentID: input.documentID
  };
  const documents = [...(prior?.documents ?? []).filter((item: EventModel) => item.id !== input.documentID), document].sort((a, b) => Date.parse(a.availableAt) - Date.parse(b.availableAt));
  const timelineItems = [...(prior?.timelineItems ?? []).filter((item: EventModel) => item.documentID !== input.documentID), timelineItem].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const primary = documents.find((item: EventModel) => item.relationship === "primary") ?? documents[0];
  const correction = documents.find((item: EventModel) => item.documentType === "correcting_amendment");
  const lastActivityAt = documents.map((item: EventModel) => item.availableAt).sort().at(-1) ?? input.availableAt;
  const primaryPublishedAt = primary?.timePrecision === "day" ? null : (primary?.availableAt ?? input.availableAt);
  const correctionPublishedAt = correction?.timePrecision === "day" ? null : correction?.availableAt;
  const sourceHasOfficialTime = primary?.availabilityBasis === "source_stated" && primary?.timePrecision !== "day";
  return {
    id: input.eventID,
    isSynthetic: false,
    lastActivityAt,
    agency: { code: input.sourceCode, ...agencyNames[input.sourceCode] },
    titleJA: prior?.titleJA ?? input.titleJA,
    titleEN: prior?.titleEN ?? input.titleEN,
    summaryJA: prior?.summaryJA || input.displayBodyJA,
    topics: prior?.topics ?? ["輸出管理", "核不拡散", "中国", "マカオ"],
    tickers: prior?.tickers ?? [],
    category: "semiconductorExportControls",
    status: correction ? "corrected" : input.revisionNumber > 1 ? "revised" : "published",
    timestampState: sourceHasOfficialTime ? "officialExact" : "systemDetectedOnly",
    analysisAnchor: sourceHasOfficialTime ? "officialPublication" : "systemDetection",
    officialPublicationDate: primary?.publishedOn ?? input.publishedOn,
    publishedAt: primaryPublishedAt,
    detectedAt: prior?.detectedAt ?? firstObservedAt,
    revisedAt: correction ? correctionPublishedAt : (input.revisionNumber > 1 && timePrecision !== "day" ? input.availableAt : null),
    sourceURL: primary?.officialURL ?? input.sourceURL,
    documentInfo: {
      documentNumber: primary?.documentNumber ?? input.documentNumber,
      publisherJA: primary?.publisherJA ?? input.publisherJA,
      publisherEN: primary?.publisherEN ?? input.publisherEN,
      currentVersion: primary?.currentRevision ?? input.revisionNumber,
      contentHash: primary?.contentHash ?? { algorithm: "sha256", value: rawHash }
    },
    timelineItems,
    coverageState: prior?.coverageState ?? "content_fetched",
    eventVerificationState: prior?.eventVerificationState ?? "source_verified",
    importantClauses: prior?.importantClauses ?? [],
    exposures: prior?.exposures ?? [],
    marketSummaries: prior?.marketSummaries ?? [],
    marketSeries: prior?.marketSeries ?? [],
    confounders: prior?.confounders ?? [],
    confounderReviewState: prior?.confounderReviewState ?? "unreviewed",
    documents,
    documentVersions: prior?.documentVersions ?? [],
    documentDiff: null,
    correctionNotes: correction ? [{ id: correction.id, occurredAt: correction.availableAt, detailJA: "原規則とは別の公式訂正文書として関連付けています。" }] : []
  };
}
