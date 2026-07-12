import { isDeepStrictEqual } from "node:util";

export function projectRunRowForReview(row) {
  const projection = {
    runId: row?.runId,
    appVersion: row?.appVersion,
    baseURL: row?.baseURL,
    rowStartedAt: row?.rowStartedAt,
    caseId: row?.caseId,
    ticker: row?.ticker,
    templateId: row?.templateId,
    intent: row?.intent,
    question: row?.question,
    filingKey: row?.filingKey,
    selectedSourceIds: row?.selectedSourceIds ?? [],
    selectedSourceLabels: row?.selectedSourceLabels ?? [],
    selectedSourceExcerpts: row?.selectedSourceExcerpts ?? [],
    sources: row?.sources ?? [],
    expectedChecklist: row?.expectedChecklist ?? row?.goldChecklist ?? [],
    answer: row?.answer,
    responsePath: row?.responsePath,
    fallbackKind: row?.fallbackKind,
    fallbackKindSource: row?.fallbackKindSource,
    fallbackCategory: row?.fallbackCategory,
    fallbackUserReason: row?.fallbackUserReason,
    fallbackReason: row?.fallbackReason,
    evidenceFallbackUsed: row?.evidenceFallbackUsed,
    responsePathFallbackButKindNone: row?.responsePathFallbackButKindNone,
    numericAlignmentStatus: row?.numericAlignmentStatus,
    numericAlignmentClaimCount: row?.numericAlignmentClaimCount,
    numericAlignmentVerifiedClaimCount: row?.numericAlignmentVerifiedClaimCount,
    numericAlignmentBlockedClaimCount: row?.numericAlignmentBlockedClaimCount,
    numericAlignmentMatchedFactIds: row?.numericAlignmentMatchedFactIds ?? [],
    numericAlignmentFinalSurfaceChecked: row?.numericAlignmentFinalSurfaceChecked,
    numericAlignmentFinalSurfaceStatus: row?.numericAlignmentFinalSurfaceStatus,
    numericAlignmentFinalSurfaceClaimCount: row?.numericAlignmentFinalSurfaceClaimCount,
    numericAlignmentFinalSurfaceVerifiedClaimCount: row?.numericAlignmentFinalSurfaceVerifiedClaimCount,
    numericAlignmentFinalSurfaceBlockedClaimCount: row?.numericAlignmentFinalSurfaceBlockedClaimCount,
    numericAlignmentFinalSurfaceAnswerHash: row?.numericAlignmentFinalSurfaceAnswerHash,
    sourceRepairLabels: row?.sourceRepairLabels ?? [],
    semanticQualityLabels: row?.semanticQualityLabels ?? [],
    flags: unique([
      ...(row?.failureLabelsObserved ?? []),
      ...(row?.numericAlignmentLabels ?? []),
      ...(row?.answerQualityFlags ?? []),
      ...(row?.finalizerGuardLabels ?? []),
      ...(row?.languageGuardViolationLabels ?? []),
      ...(row?.semanticQualityLabels ?? [])
    ])
  };
  return JSON.parse(JSON.stringify(projection));
}

export function createPendingReview() {
  return {
    reviewer: null,
    reviewedAt: null,
    result: "pending",
    numericAndPeriodCorrect: null,
    sourceClaimsSupported: null,
    intentComplete: null,
    languageNatural: null,
    fallbackTaxonomyHonest: null,
    failureLabels: [],
    notes: null
  };
}

export function createReviewPacketRow(row) {
  return {
    ...projectRunRowForReview(row),
    review: createPendingReview()
  };
}

export function compareReviewRowsToSourceRows(packetRows, sourceRows) {
  const errors = [];
  if (!Array.isArray(sourceRows)) {
    return ["source_run_rows_required_for_projection_verification"];
  }
  if (!Array.isArray(packetRows)) {
    return ["packet_rows_missing_for_projection_verification"];
  }
  if (packetRows.length !== sourceRows.length) {
    errors.push("source_run_projection_row_count_mismatch");
  }

  const length = Math.max(packetRows.length, sourceRows.length);
  for (let index = 0; index < length; index += 1) {
    const packetRow = packetRows[index];
    const sourceRow = sourceRows[index];
    const caseId = String(packetRow?.caseId ?? sourceRow?.caseId ?? `row_${index + 1}`).trim();
    if (!packetRow || !sourceRow) {
      errors.push(`${caseId}:source_run_projection_missing_row`);
      continue;
    }
    const { review: _review, ...packetProjection } = packetRow;
    const expectedProjection = projectRunRowForReview(sourceRow);
    if (!isDeepStrictEqual(packetProjection, expectedProjection)) {
      errors.push(`${caseId}:source_run_projection_mismatch`);
    }
  }
  return errors;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
