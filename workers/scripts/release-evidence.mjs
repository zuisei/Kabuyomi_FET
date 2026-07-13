import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { assertReleaseCandidateId } from "./release-candidate.mjs";
import {
  buildBenchmarkSummary,
  evaluateQualityGate,
  qualityGateThresholdsFromEnv
} from "../testbench/scripts/benchmark-quality.mjs";
import {
  evaluateHumanReviewPacket,
  verifySourceRunDigest
} from "../testbench/scripts/human-review-gate.mjs";
import { evaluateReleaseCandidateRows } from "../testbench/scripts/release-candidate-evidence.mjs";
import {
  applyStandardReleaseProfile,
  STANDARD_RELEASE_PROFILE
} from "../testbench/scripts/standard-release-profile.mjs";

export const RELEASE_EVIDENCE_MANIFEST_VERSION = "testbench-release-evidence-v2";
export const QUALITY_GATE_EVIDENCE_VERSION = "testbench-quality-gate-evidence-v2";

export async function verifyAcceptedReleaseEvidence(options) {
  const workersDir = resolve(options.workersDir);
  const repositoryDir = resolve(workersDir, "..");
  const expectedCandidate = assertReleaseCandidateId(options.releaseCandidateId, "local_release_candidate_id");
  const authoritativeCandidate = assertReleaseCandidateId(
    options.authoritativeReleaseCandidateId ?? expectedCandidate,
    "authoritative_release_candidate_id"
  );
  const manifestPath = resolve(options.manifestPath);
  const gateStatePath = resolve(options.releaseGateStatePath ?? resolve(repositoryDir, "docs/release/RELEASE_GATE_STATE.json"));
  const manifest = await readJson(manifestPath, "release_evidence_manifest");
  const errors = [];
  errors.push(...validateReleaseEvidenceManifest(manifest, expectedCandidate));

  const runPath = resolveManifestEvidencePath(workersDir, manifest.runPath, "runPath", errors);
  const packetPath = resolveManifestEvidencePath(workersDir, manifest.humanReviewPacketPath, "humanReviewPacketPath", errors);
  const qualityGatePath = resolveManifestEvidencePath(workersDir, manifest.qualityGateEvidencePath, "qualityGateEvidencePath", errors);
  if (errors.length > 0) throw releaseEvidenceError(errors);

  const runContents = await readFile(runPath, "utf8").catch((error) => {
    throw releaseEvidenceError([`release_run_unreadable:${error.message}`]);
  });
  const rows = parseJsonl(runContents, errors);
  const runSha256 = createHash("sha256").update(runContents).digest("hex");
  const candidateRows = evaluateReleaseCandidateRows(rows, expectedCandidate);
  errors.push(...candidateRows.errors);

  const packet = await readJson(packetPath, "human_review_packet");
  const source = await verifySourceRunDigest(packet, runPath);
  const review = evaluateHumanReviewPacket(packet, {
    expectedRows: STANDARD_RELEASE_PROFILE.expectedRows,
    expectedTickerCount: STANDARD_RELEASE_PROFILE.tickers.length,
    expectedTemplateCount: STANDARD_RELEASE_PROFILE.templates.length,
    expectedTickers: [...STANDARD_RELEASE_PROFILE.tickers],
    expectedTemplates: [...STANDARD_RELEASE_PROFILE.templates],
    sourceRows: rows
  });
  if (!source.ok) errors.push(`human_review_source_invalid:${source.error}`);
  errors.push(...review.errors.map((error) => `human_review:${error}`));

  const calibratedAlternative = review.ok && source.ok ? {
    type: "complete_human_review_v2",
    verified: true,
    reviewedRows: review.reviewedRows,
    sourceRunSha256: source.sha256,
    reviewContentSha256: review.reviewContentSha256,
    reviewer: review.reviewer,
    signedAt: review.signedAt
  } : null;
  const summary = buildBenchmarkSummary(rows, { calibratedAlternative });
  const thresholds = applyStandardReleaseProfile(qualityGateThresholdsFromEnv({}));
  const recomputedGate = evaluateQualityGate(summary, thresholds);
  if (!recomputedGate.ok) {
    errors.push(...recomputedGate.failures.map((failure) => `recomputed_quality_gate:${failure}`));
  }

  const gateEvidence = await readJson(qualityGatePath, "quality_gate_evidence");
  errors.push(...validateQualityGateEvidence(gateEvidence, {
    releaseCandidateId: expectedCandidate,
    runSha256
  }));
  if (!samePath(gateEvidence.runPath, runPath, workersDir)) errors.push("quality_gate_run_path_mismatch");
  if (!samePath(gateEvidence.humanReviewPacketPath, packetPath, workersDir)) errors.push("quality_gate_packet_path_mismatch");

  const gateState = await readJson(gateStatePath, "release_gate_state");
  if (gateState.releaseDecision !== "GO") errors.push("authoritative_release_decision_must_be_GO");
  if (String(gateState.releaseCandidateId ?? "").toLowerCase() !== authoritativeCandidate) {
    errors.push("authoritative_release_candidate_id_mismatch");
  }

  if (errors.length > 0) throw releaseEvidenceError(errors);
  return {
    ok: true,
    releaseCandidateId: expectedCandidate,
    releaseDecision: "GO",
    manifestPath,
    runPath,
    runSha256,
    humanReviewPacketPath: packetPath,
    qualityGateEvidencePath: qualityGatePath,
    releaseGateStatePath: gateStatePath,
    rows: rows.length,
    reviewer: review.reviewer,
    signedAt: review.signedAt
  };
}

export async function verifyAcceptedReleaseEvidenceOrApprovedWaiver(options) {
  try {
    const evidence = await verifyAcceptedReleaseEvidence(options);
    return { ...evidence, waiverApplied: false, evidenceCandidateId: evidence.releaseCandidateId };
  } catch (error) {
    if (
      error?.code !== "PRODUCTION_RELEASE_GUARD_FAILED"
      || error.errors?.length !== 1
      || error.errors[0] !== "manifest_release_candidate_id_mismatch"
    ) {
      throw error;
    }
  }

  const workersDir = resolve(options.workersDir);
  const repositoryDir = resolve(workersDir, "..");
  const currentCandidate = assertReleaseCandidateId(options.releaseCandidateId, "local_release_candidate_id");
  const manifestPath = resolve(options.manifestPath);
  const gateStatePath = resolve(options.releaseGateStatePath ?? resolve(repositoryDir, "docs/release/RELEASE_GATE_STATE.json"));
  const manifest = await readJson(manifestPath, "release_evidence_manifest");
  const gateState = await readJson(gateStatePath, "release_gate_state");
  const evidenceCandidate = assertReleaseCandidateId(
    manifest.releaseCandidateId,
    "waived_quality_release_candidate_id"
  );
  const waiverErrors = validateOneTimeQualityRerunWaiver(gateState.oneTimeQualityRerunWaiver, {
    currentCandidate,
    evidenceCandidate,
    approvedAt: gateState.asOf
  });
  if (waiverErrors.length > 0) {
    throw releaseEvidenceError(waiverErrors.map((entry) => `quality_waiver:${entry}`));
  }

  const priorEvidence = await verifyAcceptedReleaseEvidence({
    ...options,
    releaseCandidateId: evidenceCandidate,
    authoritativeReleaseCandidateId: currentCandidate
  });
  return {
    ...priorEvidence,
    releaseCandidateId: currentCandidate,
    evidenceCandidateId: evidenceCandidate,
    waiverApplied: true,
    waiverScope: gateState.oneTimeQualityRerunWaiver.scope
  };
}

export function validateOneTimeQualityRerunWaiver(waiver, expected) {
  const errors = [];
  if (waiver?.status !== "APPROVED_BY_RELEASE_OWNER") {
    errors.push("status_must_be_approved_by_release_owner");
  }
  if (waiver?.approvedAt !== expected.approvedAt || !/^\d{4}-\d{2}-\d{2}$/u.test(waiver?.approvedAt ?? "")) {
    errors.push("approved_at_must_match_release_gate_date");
  }
  if (String(waiver?.deployedCandidateId ?? "").toLowerCase() !== expected.currentCandidate) {
    errors.push("deployed_candidate_id_mismatch");
  }
  if (String(waiver?.lastQualityCandidateId ?? "").toLowerCase() !== expected.evidenceCandidate) {
    errors.push("last_quality_candidate_id_mismatch");
  }
  if (expected.currentCandidate === expected.evidenceCandidate) {
    errors.push("waiver_requires_distinct_candidates");
  }
  if (typeof waiver?.scope !== "string" || waiver.scope.trim() === "") {
    errors.push("scope_must_be_non_empty");
  }
  if (waiver?.normalDeployGuardExpectedToFailUntilRefreshed !== true) {
    errors.push("normal_deploy_guard_failure_must_be_acknowledged");
  }
  return errors;
}

export function validateReleaseEvidenceManifest(manifest, expectedCandidate) {
  const errors = [];
  if (manifest?.version !== RELEASE_EVIDENCE_MANIFEST_VERSION) errors.push("manifest_version_must_be_v2");
  if (manifest?.status !== "accepted") errors.push("manifest_status_must_be_accepted");
  if (manifest?.releaseDecision !== "GO") errors.push("manifest_release_decision_must_be_GO");
  if (String(manifest?.releaseCandidateId ?? "").toLowerCase() !== expectedCandidate) {
    errors.push("manifest_release_candidate_id_mismatch");
  }
  for (const field of ["runPath", "humanReviewPacketPath", "qualityGateEvidencePath"]) {
    if (typeof manifest?.[field] !== "string" || !manifest[field].trim()) errors.push(`manifest_${field}_missing`);
  }
  return errors;
}

export function validateQualityGateEvidence(evidence, expected) {
  const errors = [];
  if (evidence?.version !== QUALITY_GATE_EVIDENCE_VERSION) errors.push("quality_gate_evidence_version_must_be_v2");
  if (evidence?.status !== "RELEASE_QUALITY_PASS") errors.push("quality_gate_evidence_status_must_pass");
  if (evidence?.releaseProfile !== STANDARD_RELEASE_PROFILE.version) errors.push("quality_gate_release_profile_mismatch");
  if (evidence?.releaseCandidateId !== expected.releaseCandidateId) errors.push("quality_gate_release_candidate_id_mismatch");
  if (evidence?.runSha256 !== expected.runSha256) errors.push("quality_gate_run_sha256_mismatch");
  if (evidence?.gate?.ok !== true) errors.push("quality_gate_not_accepted");
  if (evidence?.humanReview?.ok !== true) errors.push("quality_gate_human_review_not_accepted");
  if (evidence?.humanReview?.sourceRunSha256 !== expected.runSha256) {
    errors.push("quality_gate_human_review_run_sha256_mismatch");
  }
  return errors;
}

function resolveManifestEvidencePath(workersDir, value, label, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`manifest_${label}_missing`);
    return null;
  }
  if (isAbsolute(value)) {
    errors.push(`manifest_${label}_must_be_relative`);
    return null;
  }
  const path = resolve(workersDir, value);
  const allowedRoot = resolve(workersDir, "testbench");
  const pathFromAllowedRoot = relative(allowedRoot, path);
  if (!pathFromAllowedRoot || pathFromAllowedRoot === ".." || pathFromAllowedRoot.startsWith(`..${sep}`)) {
    errors.push(`manifest_${label}_outside_testbench`);
    return null;
  }
  return path;
}

function parseJsonl(contents, errors) {
  const rows = [];
  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      errors.push(`release_run_invalid_json:${index + 1}:${error.message}`);
    }
  }
  if (rows.length === 0) errors.push("release_run_empty");
  return rows;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw releaseEvidenceError([`${label}_unreadable:${error.message}`]);
  }
}

function samePath(recorded, expected, workersDir) {
  if (typeof recorded !== "string" || !recorded.trim()) return false;
  return resolve(workersDir, recorded) === resolve(expected);
}

function releaseEvidenceError(errors) {
  const error = new Error(`production_release_guard_failed:${errors.join(",")}`);
  error.code = "PRODUCTION_RELEASE_GUARD_FAILED";
  error.errors = errors;
  return error;
}
