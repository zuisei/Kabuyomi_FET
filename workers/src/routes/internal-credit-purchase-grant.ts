import { InternalCreditPurchaseGrantRequestSchema } from "../lib/contracts";
import { isAuthorizedInternalRequest } from "../lib/internal-auth";
import { grantPurchasedCredits, readQuotaIdentity, type QuotaIdentity } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import type { RouteHandler } from "./types";

const INTERNAL_CREDIT_PURCHASE_GRANT_PAYLOAD_MAX_BYTES = 4_096;

export const handleInternalCreditPurchaseGrantRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/internal/credits/purchase-grant")) {
    return null;
  }

  if (!isAuthorizedInternalRequest(request, env)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await parseJsonBody(request, InternalCreditPurchaseGrantRequestSchema, {
    invalidMessage: "Invalid credit purchase payload",
    maxBytes: INTERNAL_CREDIT_PURCHASE_GRANT_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Credit purchase payload is too large"
  });
  const identity = payload.quotaSubject
    ? identityFromQuotaSubject(payload.quotaSubject)
    : await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const result = await grantPurchasedCredits(identity, env, config, payload);

  return json({
    status: result.didMutate ? "granted" : "already_granted",
    transactionId: result.transactionId,
    productId: result.productId,
    creditsGranted: result.creditsGranted,
    creditsRemaining: result.creditsRemaining,
    transactionStatus: result.transactionStatus,
    didMutate: result.didMutate,
    usage: result.usage
  });
};

function identityFromQuotaSubject(quotaSubject: string): QuotaIdentity {
  const plan = quotaSubject.startsWith("pro_max:")
    ? "pro_max"
    : quotaSubject.startsWith("pro:")
      ? "pro"
      : quotaSubject.startsWith("lite:")
        ? "lite"
        : "free";

  return {
    quotaSubject,
    plan,
    identityKind: "entitlement"
  };
}
