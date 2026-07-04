import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const workersDir = resolve(new URL("../..", import.meta.url).pathname);
const defaultBaseURL = "https://kabuyomi-api-test.dznqjmctk7.workers.dev";
const checkOnly = process.argv.includes("--check-only") || /^(1|true|yes)$/i.test(process.env.KABUYOMI_TESTBENCH_FULL_SMOKE_CHECK_ONLY ?? "");
const runId = process.env.KABUYOMI_TESTBENCH_RUN_ID?.trim() || buildRunId();
const runPath = join(workersDir, "testbench/runs", `${runId}.jsonl`);

const env = {
  ...process.env,
  KABUYOMI_TESTBENCH_BASE_URL: process.env.KABUYOMI_TESTBENCH_BASE_URL?.trim() || defaultBaseURL,
  KABUYOMI_TESTBENCH_COMPANY_SET:
    process.env.KABUYOMI_TESTBENCH_COMPANY_SET?.trim() || "testbench/company-sets/prompt-v2-expanded-multisector.json",
  KABUYOMI_TESTBENCH_QUESTIONS: process.env.KABUYOMI_TESTBENCH_QUESTIONS?.trim() || "testbench/questions/prompt-v2-smoke-10.jsonl",
  KABUYOMI_TESTBENCH_RUN_ID: runId,
  KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES:
    process.env.KABUYOMI_QUALITY_GATE_REQUIRED_TEMPLATES?.trim() || "Q01,Q02,Q03,Q04,Q05,Q06,Q07,Q08,Q09,Q10",
  KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS: process.env.KABUYOMI_QUALITY_GATE_MIN_COMPANY_TICKERS?.trim() || "10",
  KABUYOMI_QUALITY_GATE_MIN_ROWS: process.env.KABUYOMI_QUALITY_GATE_MIN_ROWS?.trim() || "150",
  BENCHMARK_DEVICE_KEY_MODE: process.env.BENCHMARK_DEVICE_KEY_MODE?.trim() || "row"
};

if (!env.KABUYOMI_TESTBENCH_DEVICE_KEY?.trim()) {
  env.KABUYOMI_TESTBENCH_DEVICE_KEY = "1e5200e1-9b6e-4970-a232-9ac542bb0827";
}
if (!env.KABUYOMI_TESTBENCH_DETACHED_ACCESS?.trim()) {
  env.KABUYOMI_TESTBENCH_DETACHED_ACCESS = "dev_unlimited";
}

console.log(`[full-smoke] runId=${runId}`);
console.log(`[full-smoke] baseURL=${env.KABUYOMI_TESTBENCH_BASE_URL}`);
console.log(`[full-smoke] questions=${env.KABUYOMI_TESTBENCH_QUESTIONS}`);
console.log(`[full-smoke] companySet=${env.KABUYOMI_TESTBENCH_COMPANY_SET}`);

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

execFileSync("npm", ["run", "testbench:gate", "--", runPath], {
  cwd: workersDir,
  env,
  stdio: "inherit"
});

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

function parseStringList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
