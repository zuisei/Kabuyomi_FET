import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const companySetPath = join(rootDir, "company-sets/minimal-5.json");
const questionsPath = join(rootDir, "questions/core-12.jsonl");

const errors = [];
const companySet = await readJson(companySetPath, "company set", errors);
const questions = await readJsonl(questionsPath, "questions", errors);

if (companySet) {
  if (!Array.isArray(companySet.tickers) || companySet.tickers.length === 0) {
    errors.push("company-sets/minimal-5.json: tickers must be a non-empty array");
  } else {
    for (const ticker of companySet.tickers) {
      if (typeof ticker !== "string" || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) {
        errors.push(`company-sets/minimal-5.json: invalid ticker ${String(ticker)}`);
      }
    }
  }
}

const seenTemplateIds = new Set();
for (const [index, question] of questions.entries()) {
  const lineNumber = index + 1;
  requireString(question, "templateId", lineNumber, errors);
  requireString(question, "question", lineNumber, errors);
  requireString(question, "intent", lineNumber, errors);
  requireStringArray(question, "expectedSourceSections", lineNumber, errors);
  requireStringArray(question, "goldChecklist", lineNumber, errors);
  requireStringArray(question, "mustAvoid", lineNumber, errors);

  if (typeof question.templateId === "string") {
    if (seenTemplateIds.has(question.templateId)) {
      errors.push(`questions/core-12.jsonl line ${lineNumber}: duplicate templateId ${question.templateId}`);
    }
    seenTemplateIds.add(question.templateId);
  }

  if (question.followupOf !== undefined && typeof question.followupOf !== "string") {
    errors.push(`questions/core-12.jsonl line ${lineNumber}: followupOf must be a string when present`);
  }
}

for (const question of questions) {
  if (typeof question.followupOf === "string" && !seenTemplateIds.has(question.followupOf)) {
    errors.push(`questions/core-12.jsonl ${question.templateId}: followupOf references unknown ${question.followupOf}`);
  }
}

if (questions.length !== 12) {
  errors.push(`questions/core-12.jsonl: expected 12 templates, found ${questions.length}`);
}

if (errors.length > 0) {
  console.error("Testbench validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Testbench validation passed: ${companySet.tickers.length} default tickers, ${questions.length} question templates.`);

async function readJson(path, label, errors) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    errors.push(`${label}: failed to read ${path}: ${error.message}`);
    return null;
  }
}

async function readJsonl(path, label, errors) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    errors.push(`${label}: failed to read ${path}: ${error.message}`);
    return [];
  }

  return raw
    .split(/\r?\n/)
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, index }) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        errors.push(`${path} line ${index + 1}: invalid JSON (${error.message})`);
        return {};
      }
    });
}

function requireString(row, field, lineNumber, errors) {
  if (typeof row[field] !== "string" || row[field].trim().length === 0) {
    errors.push(`questions/core-12.jsonl line ${lineNumber}: ${field} is required`);
  }
}

function requireStringArray(row, field, lineNumber, errors) {
  if (!Array.isArray(row[field]) || row[field].length === 0 || row[field].some((value) => typeof value !== "string")) {
    errors.push(`questions/core-12.jsonl line ${lineNumber}: ${field} must be a non-empty string array`);
  }
}

