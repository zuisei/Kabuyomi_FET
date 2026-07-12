import { EvalCreditGrantRequestSchema } from "../lib/contracts";
import { AppError } from "../lib/errors";
import { isAuthorizedEvalRequest } from "../lib/internal-auth";
import { grantEvalCredits, readQuotaIdentity } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json, unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

const EVAL_CREDIT_GRANT_PAYLOAD_MAX_BYTES = 2_048;
const EVAL_DEVICE_KEY_PATTERN = /^eval-[a-z0-9][a-z0-9._:-]{0,126}$/i;

export const handleInternalEvalCreditGrantRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/internal/eval/credits/grant")) {
    return null;
  }

  if (!isAuthorizedEvalRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  if (config.emergencyPaidGrantsDisabled) {
    return unavailable("Eval credit grants are temporarily unavailable");
  }

  const payload = await parseJsonBody(request, EvalCreditGrantRequestSchema, {
    invalidMessage: "Invalid eval credit grant payload",
    maxBytes: EVAL_CREDIT_GRANT_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Eval credit grant payload is too large"
  });

  if (!EVAL_DEVICE_KEY_PATTERN.test(payload.deviceKey)) {
    throw new AppError(400, "Eval device key is required");
  }

  const identityRequest = new Request(request.url, {
    headers: { "x-device-key": payload.deviceKey }
  });
  const identity = await readQuotaIdentity(identityRequest, env, { requireDeviceKey: true });
  const result = await grantEvalCredits(identity, env, config, {
    deviceKey: payload.deviceKey,
    credits: payload.credits,
    referenceId: payload.referenceId
  });

  return json({
    operationId: result.operationId,
    referenceId: result.referenceId,
    deviceKey: payload.deviceKey,
    creditsGranted: result.creditsGranted,
    creditsRemaining: result.creditsRemaining,
    didMutate: result.didMutate,
    usage: result.usage
  });
};
