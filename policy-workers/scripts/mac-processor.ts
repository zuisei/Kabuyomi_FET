import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { accessHeaders } from "./access-headers.ts";
import { buildReadModel, type EventModel, type ProcessorIngestInput as IngestInput } from "../src/processor/read-model.ts";

type ClaimedJob = { jobID: string; runID: string; leaseExpiresAt: string; input: IngestInput };

function keychainPassword(service: string): string | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    return execFileSync("/usr/bin/security", ["find-generic-password", "-a", process.env.MD_KEYCHAIN_ACCOUNT ?? "0xt4", "-s", service, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return undefined; }
}

const environment = process.env.MD_ENVIRONMENT?.toLowerCase() ?? "preview";
if (!new Set(["preview", "testflight", "production"]).has(environment)) throw new Error("MD_ENVIRONMENT must be preview, testflight, or production");
const environmentSuffix = environment === "production" ? "prod" : environment;
const baseURL = (process.env.MD_ADMIN_URL ?? `https://md-admin-${environmentSuffix}.dznqjmctk7.workers.dev`).replace(/\/$/, "");
const keychainPrefix = environment === "production" ? "MarketDocketProduction" : environment === "testflight" ? "MarketDocketTestFlight" : "MarketDocketPreview";
const token = process.env.MD_ADMIN_TOKEN ?? keychainPassword(`${keychainPrefix}Admin`);
const processorID = process.env.MD_PROCESSOR_ID ?? `mac-${hostname()}`;
if (!token) throw new Error("Admin token is required in the environment or macOS Keychain");

function headers(): Record<string, string> {
  return {
    ...accessHeaders(),
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/json"
  };
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(baseURL + path, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } });
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[ \t]+$/g, "")).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function lineDiff(before: string, after: string): { deleted: string[]; added: string[] } {
  const oldLines = new Set(before.split("\n").map((line) => line.trim()).filter(Boolean));
  const newLines = new Set(after.split("\n").map((line) => line.trim()).filter(Boolean));
  return {
    deleted: [...oldLines].filter((line) => !newLines.has(line)).slice(0, 40),
    added: [...newLines].filter((line) => !oldLines.has(line)).slice(0, 40)
  };
}

async function priorModel(eventID: string): Promise<EventModel | null> {
  const response = await api(`/admin/events/${eventID}/latest-model`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`latest model failed: ${response.status} ${await response.text()}`);
  return (await response.json() as { model: EventModel }).model;
}

async function processOne(): Promise<boolean> {
  const claimResponse = await api("/admin/jobs/claim", { method: "POST", body: JSON.stringify({ processorID, leaseSeconds: 600 }) });
  if (claimResponse.status === 204) return false;
  if (!claimResponse.ok) throw new Error(`claim failed: ${claimResponse.status} ${await claimResponse.text()}`);
  const job = await claimResponse.json() as ClaimedJob;
  try {
    const rawBytes = job.input.rawBodyBase64 ? Buffer.from(job.input.rawBodyBase64, "base64") : Buffer.from(job.input.bodyText, "utf8");
    const rawHash = sha256(rawBytes);
    const normalizedText = normalize(job.input.bodyText);
    const normalizedHash = sha256(normalizedText);
    const prior = await priorModel(job.input.eventID);
    const model = buildReadModel(job.input, prior, rawHash);
    const sameDocument = prior?.documents?.find((item: EventModel) => item.id === job.input.documentID);
    const diff = sameDocument && job.input.revisionNumber > 1 ? lineDiff(sameDocument.bodyEN ?? "", job.input.displayBodyEN) : undefined;
    const diffBody = diff ? JSON.stringify(diff) : undefined;
    const response = await api(`/admin/jobs/${job.jobID}/complete`, {
      method: "POST",
      body: JSON.stringify({
        processorID,
        rawSHA256: rawHash,
        normalizedSHA256: normalizedHash,
        diffSHA256: diffBody ? sha256(diffBody) : undefined,
        normalizedText,
        diff,
        eventReadModel: model
      })
    });
    if (!response.ok) throw new Error(`complete failed: ${response.status} ${await response.text()}`);
    process.stdout.write(JSON.stringify(await response.json()) + "\n");
    return true;
  } catch (error) {
    await api(`/admin/jobs/${job.jobID}/fail`, { method: "POST", body: JSON.stringify({ processorID, error: String(error) }) });
    throw error;
  }
}

const mode = process.argv[2] ?? "once";
if (mode === "once") {
  if (!await processOne()) process.stdout.write("no queued job\n");
} else if (mode === "drain") {
  while (await processOne()) { /* drain eligible jobs */ }
} else {
  throw new Error("Usage: mac-processor.ts [once|drain]");
}
