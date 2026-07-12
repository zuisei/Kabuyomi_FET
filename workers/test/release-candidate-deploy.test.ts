import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// @ts-ignore Node release tooling is plain ESM.
const candidateModule = await import("../scripts/release-candidate.mjs");
// @ts-ignore Node release tooling is plain ESM.
const deployModule = await import("../scripts/deploy-worker.mjs");
// @ts-ignore Node release tooling is plain ESM.
const evidenceModule = await import("../scripts/release-evidence.mjs");
// @ts-ignore Node release tooling is plain ESM.
const rowEvidence = await import("../testbench/scripts/release-candidate-evidence.mjs");

const temporaryDirectories: string[] = [];
const candidateA = "a".repeat(64);
const candidateB = "b".repeat(64);
const runSha = "c".repeat(64);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("Worker release candidate binding", () => {
  it("is deterministic and excludes secrets, generated bundles, and benchmark runs", async () => {
    const workersDir = await makeCandidateFixture();
    const first = await candidateModule.computeReleaseCandidate({ workersDir });
    await writeFixture(workersDir, ".dev.vars", "SECRET=changed");
    await writeFixture(workersDir, "testbench/runs/run.jsonl", "{\"secret\":true}\n");
    await writeFixture(workersDir, "dist/index.js", "generated");
    const second = await candidateModule.computeReleaseCandidate({ workersDir });

    expect(second.releaseCandidateId).toBe(first.releaseCandidateId);
    expect(second.files.every((entry: any) => !/\.dev\.vars|testbench\/runs|dist\//.test(entry.path))).toBe(true);
  });

  it.each([
    "src/index.ts",
    "d1/migrations/0001.sql",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "wrangler.toml",
    "wrangler.test.toml",
    "../shared/product-catalog.json"
  ])("changes the digest when deploy input %s changes", async (path) => {
    const workersDir = await makeCandidateFixture();
    const before = await candidateModule.computeReleaseCandidate({ workersDir });
    await writeFixture(workersDir, path, `changed:${path}`);
    const after = await candidateModule.computeReleaseCandidate({ workersDir });
    expect(after.releaseCandidateId).not.toBe(before.releaseCandidateId);
  });

  it("injects the computed candidate and rejects command-line override attempts", () => {
    expect(deployModule.buildWranglerDeployArgs({
      target: "production",
      dryRun: false,
      releaseCandidateId: candidateA
    })).toEqual([
      "deploy", "--config", "wrangler.toml", "--var", `RELEASE_CANDIDATE_ID:${candidateA}`
    ]);
    expect(() => deployModule.parseDeployRequest(["production", "--var", `RELEASE_CANDIDATE_ID:${candidateB}`]))
      .toThrow(/unsupported_deploy_flag/);
  });

  it("rejects missing, mixed, and stale candidate IDs in release rows", () => {
    const rows = [
      { caseId: "AAPL-Q01", releaseCandidateId: candidateA },
      { caseId: "AAPL-Q02", releaseCandidateId: candidateB },
      { caseId: "AAPL-Q03", releaseCandidateId: null }
    ];
    const result = rowEvidence.evaluateReleaseCandidateRows(rows, candidateA);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "AAPL-Q02:release_candidate_id_mismatch",
      "AAPL-Q03:release_candidate_id_missing_or_invalid",
      "release_candidate_id_count_must_equal_1:observed=2"
    ]));
  });

  it("requires an accepted manifest, exact candidate, passing gate, and GO decision", () => {
    const manifest = {
      version: evidenceModule.RELEASE_EVIDENCE_MANIFEST_VERSION,
      status: "accepted",
      releaseDecision: "GO",
      releaseCandidateId: candidateA,
      runPath: "testbench/runs/release.jsonl",
      humanReviewPacketPath: "testbench/runs/release-human-review.json",
      qualityGateEvidencePath: "testbench/runs/release-gate.json"
    };
    expect(evidenceModule.validateReleaseEvidenceManifest(manifest, candidateA)).toEqual([]);
    expect(evidenceModule.validateReleaseEvidenceManifest({
      ...manifest,
      status: "pending",
      releaseDecision: "HOLD",
      releaseCandidateId: candidateB
    }, candidateA)).toEqual(expect.arrayContaining([
      "manifest_status_must_be_accepted",
      "manifest_release_decision_must_be_GO",
      "manifest_release_candidate_id_mismatch"
    ]));

    const gate = {
      version: evidenceModule.QUALITY_GATE_EVIDENCE_VERSION,
      status: "RELEASE_QUALITY_PASS",
      releaseProfile: "standard-release-profile-v1",
      releaseCandidateId: candidateA,
      runSha256: runSha,
      gate: { ok: true },
      humanReview: { ok: true, sourceRunSha256: runSha }
    };
    expect(evidenceModule.validateQualityGateEvidence(gate, {
      releaseCandidateId: candidateA,
      runSha256: runSha
    })).toEqual([]);
    expect(evidenceModule.validateQualityGateEvidence({
      ...gate,
      status: "FAILED",
      releaseCandidateId: candidateB,
      gate: { ok: false }
    }, {
      releaseCandidateId: candidateA,
      runSha256: runSha
    })).toEqual(expect.arrayContaining([
      "quality_gate_evidence_status_must_pass",
      "quality_gate_release_candidate_id_mismatch",
      "quality_gate_not_accepted"
    ]));
  });
});

async function makeCandidateFixture(): Promise<string> {
  const repositoryDir = await mkdtemp(join(tmpdir(), "kabuyomi-release-candidate-"));
  temporaryDirectories.push(repositoryDir);
  const workersDir = join(repositoryDir, "workers");
  for (const [path, contents] of Object.entries({
    "src/index.ts": "export default {};",
    "d1/migrations/0001.sql": "CREATE TABLE release_test(id TEXT);",
    "package.json": "{}",
    "package-lock.json": "{}",
    "tsconfig.json": "{}",
    "wrangler.toml": "name='production'",
    "wrangler.test.toml": "name='test'",
    "../shared/product-catalog.json": "{}"
  })) {
    await writeFixture(workersDir, path, contents);
  }
  return workersDir;
}

async function writeFixture(workersDir: string, path: string, contents: string): Promise<void> {
  const absolutePath = join(workersDir, path);
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, contents);
}
