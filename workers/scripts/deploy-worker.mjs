import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeReleaseCandidate } from "./release-candidate.mjs";
import { verifyAcceptedReleaseEvidence } from "./release-evidence.mjs";

const workersDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function parseDeployRequest(args) {
  const [target, ...flags] = args;
  if (target !== "test" && target !== "production") {
    throw new Error("deploy_target_must_be_test_or_production");
  }
  const allowedFlags = new Set(["--dry-run", "--check-only"]);
  const unknown = flags.filter((flag) => !allowedFlags.has(flag));
  if (unknown.length > 0) throw new Error(`unsupported_deploy_flag:${unknown.join(",")}`);
  const dryRun = flags.includes("--dry-run");
  const checkOnly = flags.includes("--check-only");
  if (dryRun && checkOnly) throw new Error("dry_run_and_check_only_are_mutually_exclusive");
  return { target, dryRun, checkOnly };
}

export function buildWranglerDeployArgs({ target, dryRun, releaseCandidateId }) {
  const config = target === "test" ? "wrangler.test.toml" : "wrangler.toml";
  return [
    "deploy",
    "--config",
    config,
    "--var",
    `RELEASE_CANDIDATE_ID:${releaseCandidateId}`,
    ...(dryRun ? ["--dry-run"] : [])
  ];
}

export async function prepareDeploy(request, options = {}) {
  const candidate = await computeReleaseCandidate({ workersDir: options.workersDir ?? workersDir });
  let releaseEvidence = null;
  if (request.target === "production" && !request.dryRun) {
    const localWorkersDir = resolve(options.workersDir ?? workersDir);
    const manifestPath = resolve(
      options.manifestPath ??
      process.env.KABUYOMI_RELEASE_EVIDENCE_MANIFEST?.trim() ??
      join(localWorkersDir, "testbench/release-evidence/current.json")
    );
    releaseEvidence = await verifyAcceptedReleaseEvidence({
      workersDir: localWorkersDir,
      manifestPath,
      releaseCandidateId: candidate.releaseCandidateId,
      releaseGateStatePath: options.releaseGateStatePath
    });
  }
  return { request, candidate, releaseEvidence };
}

async function main() {
  const request = parseDeployRequest(process.argv.slice(2));
  const prepared = await prepareDeploy(request);
  const summary = {
    target: request.target,
    mode: request.checkOnly ? "check-only" : request.dryRun ? "dry-run" : "deploy",
    releaseCandidateId: prepared.candidate.releaseCandidateId,
    candidateFiles: prepared.candidate.files.length,
    productionReleaseGuard: request.target === "production" && !request.dryRun
      ? prepared.releaseEvidence?.ok === true ? "PASS" : "FAIL"
      : "NOT_REQUIRED"
  };
  console.log(`[deploy-worker] ${JSON.stringify(summary)}`);
  if (request.checkOnly) return;

  const finalCandidate = await computeReleaseCandidate({ workersDir });
  if (finalCandidate.releaseCandidateId !== prepared.candidate.releaseCandidateId) {
    throw new Error(
      `release_candidate_changed_after_guard:expected=${prepared.candidate.releaseCandidateId}:actual=${finalCandidate.releaseCandidateId}`
    );
  }

  const wranglerBin = join(workersDir, "node_modules/wrangler/bin/wrangler.js");
  execFileSync(process.execPath, [wranglerBin, ...buildWranglerDeployArgs({
    target: request.target,
    dryRun: request.dryRun,
    releaseCandidateId: prepared.candidate.releaseCandidateId
  })], {
    cwd: workersDir,
    env: process.env,
    stdio: "inherit"
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
