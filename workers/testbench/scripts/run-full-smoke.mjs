import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { computeReleaseCandidate } from "../../scripts/release-candidate.mjs";
import { verifyAcceptedReleaseEvidence } from "../../scripts/release-evidence.mjs";

const workersDir = resolve(new URL("../..", import.meta.url).pathname);
const defaultBaseURL = "https://kabuyomi-api-test.dznqjmctk7.workers.dev";
const args = process.argv.slice(2);
const checkOnly = args.includes("--check-only") || /^(1|true|yes)$/i.test(process.env.KABUYOMI_TESTBENCH_FULL_SMOKE_CHECK_ONLY ?? "");
const releaseVerify = args.includes("--release-verify");
const verifyManifestIfPresent = args.includes("--verify-manifest-if-present");
const runId = process.env.KABUYOMI_TESTBENCH_RUN_ID?.trim() || buildRunId();
const runPath = optionValue(args, "--run-path")
  ? resolveWorkersPath(optionValue(args, "--run-path"))
  : join(workersDir, "testbench/runs", `${runId}.jsonl`);
const humanReviewPacketPath = optionValue(args, "--human-review-packet")
  ? resolveWorkersPath(optionValue(args, "--human-review-packet"))
  : process.env.KABUYOMI_HUMAN_REVIEW_PACKET?.trim()
    ? resolveWorkersPath(process.env.KABUYOMI_HUMAN_REVIEW_PACKET)
    : join(workersDir, "testbench/runs", `${runId}-human-review.json`);
const releaseEvidenceManifestPath = process.env.KABUYOMI_RELEASE_EVIDENCE_MANIFEST?.trim()
  ? resolveWorkersPath(process.env.KABUYOMI_RELEASE_EVIDENCE_MANIFEST)
  : join(workersDir, "testbench/release-evidence/current.json");
const localCandidate = await computeReleaseCandidate({ workersDir });

const devVars = readDevVars(join(workersDir, ".dev.vars"));
const env = {
  ...devVars,
  ...process.env,
  KABUYOMI_TESTBENCH_BASE_URL: process.env.KABUYOMI_TESTBENCH_BASE_URL?.trim() || defaultBaseURL,
  KABUYOMI_TESTBENCH_COMPANY_SET:
    process.env.KABUYOMI_TESTBENCH_COMPANY_SET?.trim() || "testbench/company-sets/prompt-v2-expanded-multisector.json",
  KABUYOMI_TESTBENCH_QUESTIONS: process.env.KABUYOMI_TESTBENCH_QUESTIONS?.trim() || "testbench/questions/prompt-v2-smoke-10.jsonl",
  KABUYOMI_TESTBENCH_RUN_ID: runId,
  KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES:
    process.env.KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES?.trim() || "Q01,Q02,Q03,Q04,Q05,Q06,Q07,Q08,Q09,Q10",
  KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS: process.env.KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS?.trim() || "15",
  KABUYOMI_QUALITY_GATE_MIN_ROWS: process.env.KABUYOMI_QUALITY_GATE_MIN_ROWS?.trim() || "150",
  BENCHMARK_DEVICE_KEY_MODE: process.env.BENCHMARK_DEVICE_KEY_MODE?.trim() || "row",
  KABUYOMI_EXPECTED_RELEASE_CANDIDATE_ID: localCandidate.releaseCandidateId
};

if (verifyManifestIfPresent) {
  await verifyCommittedReleaseManifestIfPresent(releaseEvidenceManifestPath);
  process.exit(0);
}

if (releaseVerify) {
  verifyExistingReleaseEvidence(env, runPath, humanReviewPacketPath);
  process.exit(0);
}

if (!checkOnly && !env.KABUYOMI_TEST_AUTOMATION_SECRET?.trim()) {
  throw new Error(
    "KABUYOMI_TEST_AUTOMATION_SECRET is required for a live full-smoke run. " +
    "Provision it with npm run secrets:test:setup."
  );
}

console.log(`[full-smoke] runId=${runId}`);
console.log(`[full-smoke] baseURL=${env.KABUYOMI_TESTBENCH_BASE_URL}`);
console.log(`[full-smoke] questions=${env.KABUYOMI_TESTBENCH_QUESTIONS}`);
console.log(`[full-smoke] companySet=${env.KABUYOMI_TESTBENCH_COMPANY_SET}`);
console.log(`[full-smoke] releaseCandidateId=${localCandidate.releaseCandidateId}`);

preflightFullSmoke(env);

if (checkOnly) {
  console.log("[full-smoke] check-only passed; run and gate were not executed.");
  process.exit(0);
}

execFileSync("npm", ["run", "testbench:run"], {
  cwd: workersDir,
  env,
  stdio: "inherit"
});

if (!existsSync(runPath)) {
  throw new Error(`Expected testbench run output was not created: ${runPath}`);
}

execFileSync("npm", ["run", "testbench:gate", "--", runPath, "--allow-pending-human-review"], {
  cwd: workersDir,
  env,
  stdio: "inherit"
});

execFileSync("npm", ["run", "testbench:review-packet", "--", relative(workersDir, runPath), humanReviewPacketPath], {
  cwd: workersDir,
  env,
  stdio: "inherit"
});

console.log("[full-smoke] PENDING_HUMAN_REVIEW");
console.log(`[full-smoke] reviewPacket=${humanReviewPacketPath}`);
console.log("[full-smoke] This run is not release-complete. Review every row, seal the packet, then use --release-verify.");

function buildRunId() {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-prompt-v2-full-smoke`;
}

function preflightFullSmoke(env) {
  const errors = [];
  const questionsPath = resolveWorkersPath(env.KABUYOMI_TESTBENCH_QUESTIONS);
  const companySetPath = resolveWorkersPath(env.KABUYOMI_TESTBENCH_COMPANY_SET);
  const requiredTemplates = parseStringList(env.KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES);
  const minCompanyTickers = Number.parseInt(env.KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS, 10);
  const minRows = Number.parseInt(env.KABUYOMI_QUALITY_GATE_MIN_ROWS, 10);

  const questions = readJsonl(questionsPath, "questions", errors);
  const companySet = readJson(companySetPath, "company set", errors);
  const observedTemplates = new Set(questions.map((row) => row.templateId).filter((value) => typeof value === "string"));
  const missingTemplates = requiredTemplates.filter((template) => !observedTemplates.has(template));
  if (missingTemplates.length > 0) {
    errors.push(`required templates missing from questions file: ${missingTemplates.join(", ")}`);
  }
  if (!Number.isFinite(minCompanyTickers) || minCompanyTickers < 0) {
    errors.push(`KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS must be a non-negative integer, got ${env.KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS}`);
  }
  if (!Number.isFinite(minRows) || minRows < 0) {
    errors.push(`KABUYOMI_QUALITY_GATE_MIN_ROWS must be a non-negative integer, got ${env.KABUYOMI_QUALITY_GATE_MIN_ROWS}`);
  }
  if (!Array.isArray(companySet?.tickers) || companySet.tickers.length === 0) {
    errors.push("company set must contain a non-empty tickers array");
  } else if (Number.isFinite(minCompanyTickers) && companySet.tickers.length < minCompanyTickers) {
    errors.push(`company set has ${companySet.tickers.length} tickers, below required ${minCompanyTickers}`);
  }
  const expectedRows = Array.isArray(companySet?.tickers) ? questions.length * companySet.tickers.length : 0;
  if (Number.isFinite(minRows) && expectedRows < minRows) {
    errors.push(`full-smoke input would produce ${expectedRows} rows, below required ${minRows}`);
  }
  if (env.KABUYOMI_TESTBENCH_LIMIT?.trim() && !/^(1|true|yes)$/i.test(env.KABUYOMI_TESTBENCH_FULL_SMOKE_ALLOW_LIMIT ?? "")) {
    errors.push("KABUYOMI_TESTBENCH_LIMIT is set; unset it for final full-smoke evidence or set KABUYOMI_TESTBENCH_FULL_SMOKE_ALLOW_LIMIT=1");
  }

  if (errors.length > 0) {
    console.error("[full-smoke] preflight failed:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`[full-smoke] preflight templates=${[...observedTemplates].sort().join(", ")}`);
  console.log(`[full-smoke] preflight tickers=${companySet.tickers.length}`);
  console.log(`[full-smoke] preflight expectedRows=${expectedRows}`);
}

function verifyExistingReleaseEvidence(env, existingRunPath, packetPath) {
  if (!existsSync(existingRunPath)) {
    throw new Error(`Release run does not exist: ${existingRunPath}`);
  }
  if (!existsSync(packetPath)) {
    throw new Error(`Human review packet does not exist: ${packetPath}`);
  }
  execFileSync("npm", [
    "run",
    "testbench:gate",
    "--",
    existingRunPath,
    "--human-review-packet",
    packetPath,
    "--standard-release-profile"
  ], {
    cwd: workersDir,
    env,
    stdio: "inherit"
  });
  console.log("[full-smoke] RELEASE_COMPLETE");
  console.log(`[full-smoke] run=${existingRunPath}`);
  console.log(`[full-smoke] humanReviewPacket=${packetPath}`);
  console.log("[full-smoke] calibratedAlternative=complete_human_review_v2");
}

async function verifyCommittedReleaseManifestIfPresent(manifestPath) {
  if (!existsSync(manifestPath)) {
    console.log(`[full-smoke] no committed accepted release manifest at ${manifestPath}`);
    console.log("[full-smoke] PENDING_HUMAN_REVIEW (static release evidence not yet committed)");
    return;
  }
  const result = await verifyAcceptedReleaseEvidence({
    workersDir,
    manifestPath,
    releaseCandidateId: localCandidate.releaseCandidateId
  });
  console.log(`[full-smoke] RELEASE_COMPLETE manifest=${result.manifestPath}`);
  console.log(`[full-smoke] releaseCandidateId=${result.releaseCandidateId}`);
}

function resolveWorkersPath(value) {
  return resolve(workersDir, value);
}

function readJson(path, label, errors) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(`${label}: failed to read ${path}: ${error.message}`);
    return null;
  }
}

function readJsonl(path, label, errors) {
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          errors.push(`${label}: invalid JSON at ${path}:${index + 1}: ${error.message}`);
          return {};
        }
      });
  } catch (error) {
    errors.push(`${label}: failed to read ${path}: ${error.message}`);
    return [];
  }
}

function readDevVars(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = parseDevVarValue(match[2]);
  }
  return values;
}

function parseDevVarValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseStringList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionValue(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : null;
}
