import { AppError } from "../lib/errors";
import { loadFilingPrepJob } from "../lib/filings/prep-job-store";
import { readQuotaIdentity } from "../lib/quota";
import { badRequest, json, notFound } from "../lib/response";
import type { RouteHandler } from "./types";

const FILING_PREP_JOB_PREFIX = "/v1/filing-prep/jobs/";

export const handleFilingPrepJobRoute: RouteHandler = async ({ request, url, env }) => {
  if (!(request.method === "GET" && url.pathname.startsWith(FILING_PREP_JOB_PREFIX))) {
    return null;
  }

  const jobId = decodeURIComponent(url.pathname.slice(FILING_PREP_JOB_PREFIX.length));
  if (!jobId) {
    return badRequest("Filing prep job id is required");
  }

  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const job = await loadFilingPrepJob(env, jobId, identity);
  if (!job) {
    return notFound("Filing prep job not found");
  }

  if (job.quotaSubject !== identity.quotaSubject) {
    throw new AppError(404, "Filing prep job not found");
  }

  return json({ job });
};
