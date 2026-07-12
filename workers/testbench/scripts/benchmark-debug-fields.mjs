export function extractBenchmarkProofFields(debug = {}) {
  return {
    semanticQualityLabels: debug.semanticQualityLabels ?? [],
    numericAlignmentInitialStatus: debug.numericAlignmentInitialStatus ?? null,
    numericAlignmentClaimBindings: debug.numericAlignmentClaimBindings ?? [],
    numericAlignmentFinalSurfaceChecked: debug.numericAlignmentFinalSurfaceChecked ?? false,
    numericAlignmentFinalSurfaceStatus: debug.numericAlignmentFinalSurfaceStatus ?? null,
    numericAlignmentFinalSurfaceClaimCount: debug.numericAlignmentFinalSurfaceClaimCount ?? null,
    numericAlignmentFinalSurfaceVerifiedClaimCount: debug.numericAlignmentFinalSurfaceVerifiedClaimCount ?? null,
    numericAlignmentFinalSurfaceBlockedClaimCount: debug.numericAlignmentFinalSurfaceBlockedClaimCount ?? null,
    numericAlignmentFinalSurfaceAnswerHash: debug.numericAlignmentFinalSurfaceAnswerHash ?? null
  };
}
