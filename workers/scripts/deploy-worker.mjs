import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeReleaseCandidate } from "./release-candidate.mjs";
import { verifyAcceptedReleaseEvidenceOrApprovedWaiver } from "./release-evidence.mjs";

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

/// iOS のビルド番号が Worker の App Attest allowlist に入っているか照合する。
/// 入っていないと、提出は通るのに新規インストールだけが黙って
/// restricted_installation に落ちる(エラーは表示されない)。
export function assertAppAttestBundleVersionCovered(allowlist, iosBuildNumber) {
  const allowed = String(allowlist ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const build = String(iosBuildNumber ?? "").trim();
  if (!build) throw new Error("ios_build_number_unreadable");
  if (!allowed.includes(build)) {
    throw new Error(
      `app_attest_bundle_version_not_covered:ios_build=${build},allowlist=${allowed.join("|") || "empty"}`
    );
  }
}

function readIosBuildNumber(repositoryDir) {
  const projectPath = join(repositoryDir, "ios/project.yml");
  const match = readFileSync(projectPath, "utf8").match(/^\s*CURRENT_PROJECT_VERSION:\s*(\S+)/mu);
  return match?.[1];
}

function readWranglerBundleVersions(workersDirPath, target) {
  const configPath = join(workersDirPath, target === "test" ? "wrangler.test.toml" : "wrangler.toml");
  const match = readFileSync(configPath, "utf8").match(/^APP_ATTEST_ALLOWED_BUNDLE_VERSIONS\s*=\s*"([^"]*)"/mu);
  return match?.[1];
}

export async function prepareDeploy(request, options = {}) {
  const candidate = await computeReleaseCandidate({ workersDir: options.workersDir ?? workersDir });
  let releaseEvidence = null;
  if (request.target === "production" && !request.dryRun) {
    const localWorkersDir = resolve(options.workersDir ?? workersDir);
    assertAppAttestBundleVersionCovered(
      readWranglerBundleVersions(localWorkersDir, request.target),
      readIosBuildNumber(resolve(localWorkersDir, ".."))
    );
    const manifestPath = resolve(
      options.manifestPath ??
      process.env.KABUYOMI_RELEASE_EVIDENCE_MANIFEST?.trim() ??
      join(localWorkersDir, "testbench/release-evidence/current.json")
    );
    // マニフェストが現行 candidate に追いついていない場合に限り、
    // RELEASE_GATE_STATE.json に記録されたリリースオーナー承認の免除を受け付ける。
    // 以前は厳格版だけを呼んでいたため、免除時はこのスクリプトを迂回して
    // wrangler を直接叩くしかなく、デプロイの記録が残らなかった。
    releaseEvidence = await verifyAcceptedReleaseEvidenceOrApprovedWaiver({
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
