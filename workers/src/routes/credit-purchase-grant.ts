import { CreditPurchaseGrantRequestSchema } from "../lib/contracts";
import { verifyCreditPurchaseWithApple } from "../lib/apple-store-server";
import { grantPurchasedCredits, readQuotaIdentity } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import type { RouteHandler } from "./types";

const CREDIT_PURCHASE_GRANT_PAYLOAD_MAX_BYTES = 20_480;

export const handleCreditPurchaseGrantRoute: RouteHandler = async ({ request, url, env, config }) => {
  const isCreditPurchaseCompleteRoute =
    url.pathname === "/v1/ios/purchases/credits/complete" || url.pathname === "/v1/credits/purchase-grant";
  if (!(request.method === "POST" && isCreditPurchaseCompleteRoute)) {
    return null;
  }

  const payload = await parseJsonBody(request, CreditPurchaseGrantRequestSchema, {
    invalidMessage: "Invalid credit purchase payload",
    maxBytes: CREDIT_PURCHASE_GRANT_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Credit purchase payload is too large"
  });
  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const verified = await verifyCreditPurchaseWithApple(env, payload);
  const result = await grantPurchasedCredits(identity, env, config, {
    productId: payload.productId,
    transactionId: verified.transactionId,
    originalTransactionId: verified.originalTransactionId,
    purchasedAt: payload.purchasedAt
  });

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
