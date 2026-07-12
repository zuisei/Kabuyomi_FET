import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const releaseDirectory = resolve(repositoryRoot, "docs/release");
const gatePath = resolve(releaseDirectory, "RELEASE_GATE_STATE.json");
const finalReportPath = resolve(releaseDirectory, "FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md");
const currentTruthPath = resolve(releaseDirectory, "CURRENT_SHIPPING_TRUTH.md");
const parityReportPath = resolve(releaseDirectory, "FEATURE_PARITY_COMPATIBILITY_REPORT.md");
const historicalMarker = "Historical release evidence — not current shipping authority.";

const authoritativeTruthFiles = new Set([
  "CURRENT_SHIPPING_TRUTH.md",
  "FEATURE_PARITY_COMPATIBILITY_REPORT.md",
  "RELEASE_GATE_STATE.json",
  "FULL_PRODUCT_DISCOVERY_AND_REMEDIATION_REPORT.md",
]);

const requiredSections = [
  "starting commit",
  "starting working-tree state",
  "repository areas inspected",
  "complete feature matrix",
  "user-available production features",
  "test-only features",
  "disabled capabilities",
  "disconnected implementations",
  "defects discovered",
  "defects fixed",
  "architecture changes",
  "migrations added",
  "migrations applied to test",
  "migrations applied to production",
  "authentication behavior",
  "App Attest behavior",
  "startup UX behavior",
  "idempotency behavior",
  "credit-reservation behavior",
  "subscription principal behavior",
  "Apple notification behavior",
  "rewarded-ad behavior",
  "numeric-validation behavior",
  "remote-config behavior",
  "iOS and UI corrections",
  "test results",
  "test Worker deployment",
  "production Worker deployment",
  "external verification evidence",
  "remaining externally impossible checks",
  "final release decision",
];

const requiredFeatureDomains = [
  "ticker search and company navigation",
  "watchlist and recent companies",
  "filing retrieval and caching",
  "historical filings and comparisons",
  "source display and SEC navigation",
  "AI question answering",
  "follow-up context",
  "numeric validation",
  "source-ID validation",
  "fallback behavior",
  "quote translation",
  "request idempotency",
  "model-result replay",
  "credit reservations",
  "reservation expiry and recovery",
  "free welcome credits",
  "paid credits",
  "subscription credits",
  "rewarded-ad credits",
  "purchase verification",
  "refunds and revocations",
  "App Store Server Notifications",
  "appAccountToken ownership",
  "Sign in with Apple recovery",
  "installation identity",
  "Keychain persistence",
  "App Attest",
  "challenge and assertion replay protection",
  "legacy identity migration",
  "remote config",
  "emergency kill switches",
  "fail-closed behavior",
  "production logging and redaction",
  "iOS startup behavior",
  "credits UI",
  "subscription UI",
  "rewarded-ad UI",
  "recent conversation UI",
  "drawer search",
  "legal pages",
  "App Review consistency",
  "CI and required checks",
  "test migrations",
  "production migrations",
  "test deployment parity",
  "production deployment parity",
];

const allowedClassifications = new Set([
  "USER_AVAILABLE_PRODUCTION",
  "USER_AVAILABLE_TEST_ONLY",
  "IMPLEMENTED_CAPABILITY_DISABLED",
  "IMPLEMENTED_NOT_CONNECTED",
  "PARTIALLY_IMPLEMENTED",
  "TESTED_ONLY",
  "DEPLOYED_NOT_EXTERNALLY_VERIFIED",
  "BROKEN_OR_REGRESSED",
  "NOT_IMPLEMENTED",
  "STALE_DOCUMENTATION_ONLY",
]);

const errors = [];

function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/[‐‑‒–—−-]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function readRequiredText(path, label) {
  if (!existsSync(path)) {
    errors.push(`${label} is missing: ${path.replace(`${repositoryRoot}/`, "")}`);
    return null;
  }
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    errors.push(`${label} could not be read: ${error.message}`);
    return null;
  }
}

function parseGate() {
  const source = readRequiredText(gatePath, "release gate state");
  if (source === null) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    errors.push(`RELEASE_GATE_STATE.json is not valid JSON: ${error.message}`);
    return null;
  }
}

function validateDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    errors.push(`${field} must use YYYY-MM-DD`);
    return;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    errors.push(`${field} must be a real calendar date`);
  }
}

function validateGate(gate) {
  if (gate === null) {
    return;
  }
  if (gate.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }
  if (typeof gate.phase !== "string" || gate.phase.trim() === "") {
    errors.push("phase must be a non-empty string");
  }
  validateDate(gate.asOf, "asOf");
  for (const field of ["auditSnapshot", "lastValidatedCommit"]) {
    if (!/^[0-9a-f]{40}$/.test(gate[field] ?? "")) {
      errors.push(`${field} must be a full 40-character lowercase commit SHA`);
    }
  }
  if (typeof gate.validationScope !== "string" || gate.validationScope.trim() === "") {
    errors.push("validationScope must be a non-empty string");
  }
  if (!/^(?:GO(?:_[A-Z0-9]+)*|CONDITIONAL_GO|HOLD|NO_GO)$/.test(gate.releaseDecision ?? "")) {
    errors.push("releaseDecision must be GO, GO_<QUALIFIER>, CONDITIONAL_GO, HOLD, or NO_GO");
  }

  if (!Array.isArray(gate.openP0Ids)) {
    errors.push("openP0Ids must be an array");
  } else {
    const invalid = gate.openP0Ids.filter((id) => typeof id !== "string" || id.trim() === "");
    if (invalid.length > 0) {
      errors.push("openP0Ids must contain only non-empty strings");
    }
    if (new Set(gate.openP0Ids).size !== gate.openP0Ids.length) {
      errors.push("openP0Ids must not contain duplicates");
    }
    if (gate.openP0Ids.length > 0 && !new Set(["HOLD", "NO_GO"]).has(gate.releaseDecision)) {
      errors.push("releaseDecision must be HOLD or NO_GO while P0 findings are open");
    }
  }

  if (
    gate.lastValidatedTestCounts === null
    || typeof gate.lastValidatedTestCounts !== "object"
    || Array.isArray(gate.lastValidatedTestCounts)
    || Object.keys(gate.lastValidatedTestCounts).length === 0
  ) {
    errors.push("lastValidatedTestCounts must be a non-empty object");
  } else {
    for (const [name, result] of Object.entries(gate.lastValidatedTestCounts)) {
      if (result === null || typeof result !== "object" || Array.isArray(result)) {
        errors.push(`lastValidatedTestCounts.${name} must be an object`);
        continue;
      }
      if (typeof result.status !== "string" || result.status.trim() === "") {
        errors.push(`lastValidatedTestCounts.${name}.status must be a non-empty string`);
      } else if (/^FAIL(?:ED|URE)?(?:_|$)/i.test(result.status)) {
        errors.push(`lastValidatedTestCounts.${name}.status records a failure: ${result.status}`);
      }
      for (const [field, value] of Object.entries(result)) {
        if (typeof value === "number" && /(?:failures?|failed|errors?)$/i.test(field) && value !== 0) {
          errors.push(`lastValidatedTestCounts.${name}.${field} must be 0, found ${value}`);
        }
      }
    }
  }

  if (!Array.isArray(gate.lastBenchmarkArtifactIds) || gate.lastBenchmarkArtifactIds.length === 0) {
    errors.push("lastBenchmarkArtifactIds must be a non-empty array");
  } else if (
    gate.lastBenchmarkArtifactIds.some((id) => typeof id !== "string" || id.trim() === "")
    || new Set(gate.lastBenchmarkArtifactIds).size !== gate.lastBenchmarkArtifactIds.length
  ) {
    errors.push("lastBenchmarkArtifactIds must contain unique non-empty strings");
  }
  if (!Array.isArray(gate.missingHardGates)) {
    errors.push("missingHardGates must be an array, even when empty");
  }
}

function parseNumberedHeadings(report) {
  const headings = new Map();
  const lines = report.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^##\s+(\d+)\.\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }
    const number = Number(match[1]);
    const entries = headings.get(number) ?? [];
    entries.push({ title: match[2], line: index });
    headings.set(number, entries);
  }
  return { headings, lines };
}

function validateFinalReport(report, gate) {
  if (report === null) {
    return;
  }
  const { headings, lines } = parseNumberedHeadings(report);
  for (const [index, requiredTitle] of requiredSections.entries()) {
    const number = index + 1;
    const matches = headings.get(number) ?? [];
    if (matches.length === 0) {
      errors.push(`final report is missing heading: ## ${number}. ${requiredTitle}`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`final report repeats numbered heading ${number}`);
    }
    if (normalizeLabel(matches[0].title) !== normalizeLabel(requiredTitle)) {
      errors.push(`final report heading ${number} must be "${requiredTitle}", found "${matches[0].title}"`);
    }
  }
  const unexpected = [...headings.keys()].filter((number) => number < 1 || number > requiredSections.length);
  if (unexpected.length > 0) {
    errors.push(`final report has unexpected top-level numbered headings: ${unexpected.sort((a, b) => a - b).join(", ")}`);
  }

  const matrixStart = headings.get(4)?.[0]?.line;
  const matrixEnd = headings.get(5)?.[0]?.line;
  if (matrixStart !== undefined && matrixEnd !== undefined && matrixEnd > matrixStart) {
    const rowsByNumber = new Map();
    for (const line of lines.slice(matrixStart + 1, matrixEnd)) {
      if (!/^\s*\|/.test(line)) {
        continue;
      }
      const cells = line.split("|").map((cell) => cell.trim());
      if (cells[0] === "") cells.shift();
      if (cells.at(-1) === "") cells.pop();
      const number = Number(cells[0]);
      if (!Number.isInteger(number) || number < 1 || number > requiredFeatureDomains.length) {
        continue;
      }
      const entries = rowsByNumber.get(number) ?? [];
      entries.push(cells);
      rowsByNumber.set(number, entries);
    }

    for (const [index, requiredDomain] of requiredFeatureDomains.entries()) {
      const number = index + 1;
      const rows = rowsByNumber.get(number) ?? [];
      if (rows.length === 0) {
        errors.push(`feature matrix is missing row ${number}: ${requiredDomain}`);
        continue;
      }
      if (rows.length > 1) {
        errors.push(`feature matrix repeats row ${number}`);
      }
      const row = rows[0];
      if (normalizeLabel(row[1]) !== normalizeLabel(requiredDomain)) {
        errors.push(`feature matrix row ${number} must be "${requiredDomain}", found "${row[1] ?? ""}"`);
      }
      const classification = row
        .map((cell) => cell.replace(/^`+|`+$/g, ""))
        .find((cell) => allowedClassifications.has(cell));
      if (!classification) {
        errors.push(`feature matrix row ${number} must contain one exact allowed classification`);
      }
    }
    if (rowsByNumber.size !== requiredFeatureDomains.length) {
      errors.push(`feature matrix must contain 46 uniquely numbered rows; found ${rowsByNumber.size}`);
    }
  }

  const decisionStart = headings.get(31)?.[0]?.line;
  if (decisionStart !== undefined && gate !== null) {
    const decisionSection = lines.slice(decisionStart + 1).join("\n");
    const decisionMatch = decisionSection.match(/^\s*(?:[-*]\s*)?`?releaseDecision`?\s*:\s*`?([A-Z][A-Z0-9_]*)`?\s*$/m);
    if (!decisionMatch) {
      errors.push("final report section 31 must include an exact `releaseDecision: VALUE` line");
    } else if (decisionMatch[1] !== gate.releaseDecision) {
      errors.push(`final report releaseDecision (${decisionMatch[1]}) does not match RELEASE_GATE_STATE.json (${gate.releaseDecision})`);
    }
  }
}

function requiresHistoricalMarker(fileName) {
  return /^(?:PR\d|V1_|RC_FINAL_|FULL_REMEDIATION_|PROMPT_V2_|TEST_WORKER_DEPLOY_)/.test(fileName)
    || fileName === "RELEASE_TRUTH.md"
    || fileName === "TESTFLIGHT_READINESS_CHECKLIST.md";
}

function validateHistoricalReports() {
  const releaseFiles = readdirSync(releaseDirectory).filter((fileName) => fileName.endsWith(".md"));
  const contradictoryClaimPatterns = [
    /\breleaseDecision\s*:/i,
    /\bRC READY\b/i,
    /\bPRODUCTION DEPLOYED\s*-\s*SMOKE PASSED\b/i,
    /\bRELEASE CANDIDATE\s*-/i,
    /\bMAIN INTEGRATED\s*-/i,
    /RELEASE_TRUTH\.md.{0,160}(?:source of truth|current shipping truth)/is,
  ];

  for (const fileName of releaseFiles) {
    const content = readFileSync(resolve(releaseDirectory, fileName), "utf8");
    if (authoritativeTruthFiles.has(fileName)) {
      if (content.includes(historicalMarker)) {
        errors.push(`authoritative truth file must not be marked historical: docs/release/${fileName}`);
      }
      continue;
    }
    const markedHistorical = content.includes(historicalMarker);
    if (requiresHistoricalMarker(fileName) && !markedHistorical) {
      errors.push(`stale release report lacks the historical banner: docs/release/${fileName}`);
    }
    if (!markedHistorical && contradictoryClaimPatterns.some((pattern) => pattern.test(content))) {
      errors.push(`non-authoritative document makes an active release/shipping claim without a historical banner: docs/release/${fileName}`);
    }
  }

  const readme = readRequiredText(resolve(repositoryRoot, "README.md"), "README");
  if (readme && /Current v1 release truth lives at\s+`docs\/release\/RELEASE_TRUTH\.md`/i.test(readme)) {
    errors.push("README.md still names historical RELEASE_TRUTH.md as current release truth");
  }
  const documentationIndex = readRequiredText(resolve(repositoryRoot, "docs/INDEX.md"), "documentation index");
  if (documentationIndex) {
    for (const line of documentationIndex.split(/\r?\n/)) {
      const activeReference = line.match(
        /^\|\s*active[^|]*\|\s*\[[^\]]+\]\((?:\.\/)?release\/([^)]+\.md)\)/i,
      );
      if (!activeReference) {
        continue;
      }
      const targetPath = resolve(releaseDirectory, activeReference[1]);
      if (existsSync(targetPath) && readFileSync(targetPath, "utf8").includes(historicalMarker)) {
        errors.push(`docs/INDEX.md labels historical release report as active: docs/release/${activeReference[1]}`);
      }
    }
  }
}

const gate = parseGate();
validateGate(gate);

const finalReport = readRequiredText(finalReportPath, "final implementation report");
readRequiredText(currentTruthPath, "current shipping truth");
readRequiredText(parityReportPath, "feature parity report");
validateFinalReport(finalReport, gate);
validateHistoricalReports();

if (errors.length > 0) {
  console.error("[release-gate] validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `[release-gate] validated ${requiredSections.length} final-report sections, `
  + `${requiredFeatureDomains.length} feature domains, historical-report isolation, `
  + `and releaseDecision=${gate.releaseDecision}.`,
);
