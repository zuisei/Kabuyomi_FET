import { RELEASE_CANDIDATE_ID_PATTERN, assertReleaseCandidateId } from "../../scripts/release-candidate.mjs";

export function evaluateReleaseCandidateRows(rows, expectedReleaseCandidateId) {
  const errors = [];
  let expected = null;
  try {
    expected = assertReleaseCandidateId(expectedReleaseCandidateId, "expected_release_candidate_id");
  } catch (error) {
    errors.push(error.message);
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    errors.push("release_candidate_rows_empty");
    return { ok: false, expectedReleaseCandidateId: expected, observedReleaseCandidateIds: [], errors };
  }

  const observed = new Set();
  rows.forEach((row, index) => {
    const candidate = String(row?.releaseCandidateId ?? "").trim().toLowerCase();
    const rowLabel = String(row?.caseId ?? `row-${index + 1}`);
    if (!RELEASE_CANDIDATE_ID_PATTERN.test(candidate)) {
      errors.push(`${rowLabel}:release_candidate_id_missing_or_invalid`);
      return;
    }
    observed.add(candidate);
    if (expected && candidate !== expected) {
      errors.push(`${rowLabel}:release_candidate_id_mismatch`);
    }
  });
  if (observed.size !== 1) {
    errors.push(`release_candidate_id_count_must_equal_1:observed=${observed.size}`);
  }

  return {
    ok: errors.length === 0,
    expectedReleaseCandidateId: expected,
    observedReleaseCandidateIds: [...observed].sort(),
    errors
  };
}
