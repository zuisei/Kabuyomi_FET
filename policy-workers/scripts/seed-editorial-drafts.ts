import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { accessHeaders } from "./access-headers.ts";

type Relation = {
  issuerName: string;
  ticker?: string;
  exchange?: string;
  relationType: string;
  evidenceReference: string;
  evidenceSummaryJA: string;
};

type DatasetEvent = {
  eventID: string;
  documentNumber: string;
  officialURL: string;
  caseTags: string[];
  analysis: Record<string, unknown>;
  companyRelations?: Relation[];
};

type Dataset = {
  datasetVersion: string;
  generatedBy: string;
  analysisStatus: string;
  humanReviewed: boolean;
  note: string;
  events: DatasetEvent[];
};

function keychainPassword(service: string): string | undefined {
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-a", process.env.MD_KEYCHAIN_ACCOUNT ?? "0xt4", "-s", service, "-w"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch { return undefined; }
}

const environment = (process.argv[2] ?? process.env.MD_ENVIRONMENT ?? "preview").toLowerCase();
if (!new Set(["preview", "testflight", "production"]).has(environment)) throw new Error("Usage: seed-editorial-drafts.ts preview|testflight|production");
process.env.MD_ENVIRONMENT = environment;
const prefix = environment === "production" ? "MarketDocketProduction" : environment === "testflight" ? "MarketDocketTestFlight" : "MarketDocketPreview";
const suffix = environment === "production" ? "prod" : environment;
const publicURL = `https://md-api-${suffix}.dznqjmctk7.workers.dev`;
const adminURL = `https://md-admin-${suffix}.dznqjmctk7.workers.dev`;
const token = process.env.MD_ADMIN_TOKEN ?? keychainPassword(`${prefix}Admin`);
if (!token) throw new Error(`${prefix}Admin token is unavailable`);

const dataset = JSON.parse(await readFile(new URL("../editorial/real-policy-analysis-2026-07-21.json", import.meta.url), "utf8")) as Dataset;
if (dataset.analysisStatus !== "automated_draft" || dataset.humanReviewed !== false || dataset.events.length !== 10) {
  throw new Error("Editorial dataset must contain exactly 10 automated drafts and must not claim human review");
}

async function parse(response: Response): Promise<any> {
  const body = await response.text();
  let value: any;
  try { value = body ? JSON.parse(body) : null; }
  catch { throw new Error(`Non-JSON response ${response.status}: ${body.slice(0, 300)}`); }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

async function publicGet(path: string): Promise<any> {
  return parse(await fetch(publicURL + path, { headers: { accept: "application/json", "cache-control": "no-cache" } }));
}

async function admin(path: string, method: "POST" | "PUT", body: unknown): Promise<any> {
  return parse(await fetch(adminURL + path, {
    method,
    headers: { ...accessHeaders(), authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body)
  }));
}

async function adminGet(path: string): Promise<any> {
  return parse(await fetch(adminURL + path, {
    headers: { ...accessHeaders(), authorization: `Bearer ${token}`, accept: "application/json" }
  }));
}

const results: Array<Record<string, unknown>> = [];
const seededItems: DatasetEvent[] = [];
const draftMatches = (current: Record<string, any> | undefined, expected: Record<string, unknown>): boolean => {
  if (!current || current.analysisStatus !== "automated_draft") return false;
  const normalize = (value: unknown): unknown => value == null ? null : value;
  return Object.entries(expected).filter(([key]) => key !== "editorialPriority").every(([key, value]) =>
    JSON.stringify(normalize(current[key])) === JSON.stringify(normalize(value))
  );
};

for (const item of dataset.events) {
  const beforeResponse = await fetch(publicURL + `/v1/events/${item.eventID}`, { headers: { accept: "application/json", "cache-control": "no-cache" } });
  if (beforeResponse.status === 404 && environment === "production") {
    results.push({ eventID: item.eventID, documentNumber: item.documentNumber, analysisAction: "not_discovered", companyCandidatesCreated: 0, caseTags: item.caseTags });
    continue;
  }
  const before = await parse(beforeResponse);
  const preview = environment === "production" ? await adminGet(`/admin/events/${item.eventID}/analysis-preview`) : null;
  const current = (preview?.analysis ?? before.data.analysis) as Record<string, any> | undefined;
  const expectedTitle = item.analysis.canonicalTitleJA;
  let analysisAction = "unchanged";
  if (draftMatches(current, item.analysis)) {
    analysisAction = "already_seeded";
  } else {
    if (current && new Set(["editorial_reviewed", "published"]).has(current.analysisStatus)) {
      throw new Error(`Refusing to replace human-reviewed analysis for ${item.eventID}`);
    }
    await admin(`/admin/events/${item.eventID}/analysis-drafts`, "POST", {
      ...item.analysis,
      generatedBy: dataset.generatedBy,
      note: `${dataset.note} Dataset ${dataset.datasetVersion}`
    });
    analysisAction = "created_automated_draft";
  }

  const evidence = await publicGet(`/v1/events/${item.eventID}/evidence`);
  const documents = evidence.data.documents as Array<Record<string, any>>;
  const normalizedNumber = item.documentNumber.replace(/^FR Doc\.\s*/i, "");
  const evidenceDocument = documents.find((document) => String(document.documentNumber).includes(normalizedNumber))
    ?? documents.find((document) => document.relationship === "primary")
    ?? documents[0];
  if (!evidenceDocument) throw new Error(`Evidence document missing for ${item.eventID}`);

  let relationCount = 0;
  if (item.companyRelations?.length) {
    const refreshed = environment === "production"
      ? await adminGet(`/admin/events/${item.eventID}/analysis-preview`)
      : await publicGet(`/v1/events/${item.eventID}`);
    const existing = ((environment === "production" ? refreshed.analysis : refreshed.data.analysis)?.companyRelations ?? []) as Array<Record<string, any>>;
    for (const relation of item.companyRelations) {
      const duplicate = existing.some((candidate) => relation.ticker
        ? candidate.ticker === relation.ticker
        : candidate.issuerName === relation.issuerName);
      if (duplicate) continue;
      await admin(`/admin/events/${item.eventID}/company-relations`, "POST", {
        ...relation,
        evidenceDocumentID: evidenceDocument.id,
        generatedBy: dataset.generatedBy
      });
      relationCount += 1;
    }
  }
  results.push({ eventID: item.eventID, documentNumber: item.documentNumber, analysisAction, companyCandidatesCreated: relationCount, caseTags: item.caseTags });
  seededItems.push(item);
}

const verified = [];
for (const item of seededItems) {
  const response = environment === "production"
    ? await adminGet(`/admin/events/${item.eventID}/analysis-preview`)
    : await publicGet(`/v1/events/${item.eventID}`);
  const analysis = (environment === "production" ? response.analysis : response.data.analysis) as Record<string, any>;
  if (analysis.analysisStatus !== "automated_draft" || analysis.canonicalTitleJA !== item.analysis.canonicalTitleJA) {
    throw new Error(`${environment === "production" ? "Admin" : "Public"} verification failed for ${item.eventID}`);
  }
  verified.push({
    eventID: item.eventID,
    tier: analysis.presentationTier,
    status: analysis.analysisStatus,
    marketMode: analysis.marketAnalysisMode,
    companyCandidates: analysis.companyRelations.length
  });
}

process.stdout.write(JSON.stringify({ environment, datasetVersion: dataset.datasetVersion, results, verified }, null, 2) + "\n");
