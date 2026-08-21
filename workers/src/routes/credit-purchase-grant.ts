import { CreditPurchaseGrantRequestSchema } from "../lib/contracts";
import { verifyCreditPurchaseWithApple } from "../lib/apple-store-server";
import { assertPurchasedCreditGrantsEnabled, grantPurchasedCredits, readQuotaIdentity } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import { resolveAccountCredential } from "../lib/account-recovery";
import type { RouteHandler } from "./types";

const CREDIT_PURCHASE_GRANT_PAYLOAD_MAX_BYTES = 20_480;

export const handleCreditPurchaseGrantRoute: RouteHandler = async ({ request, url, env, config }) => {
  const isCreditPurchaseCompleteRoute =
    url.pathname === "/v1/ios/purchases/credits/complete" || url.pathname === "/v1/credits/purchase-grant";
  if (!(request.method === "POST" && isCreditPurchaseCompleteRoute)) {
    return null;
  }

  // Check before contacting Apple so a disabled purchase path cannot perform
  // avoidable external work, and grantPurchasedCredits checks the same gate
  // again immediately before any D1 or Durable Object mutation.
  assertPurchasedCreditGrantsEnabled(config);

  const payload = await parseJsonBody(request, CreditPurchaseGrantRequestSchema, {
    invalidMessage: "Invalid credit purchase payload",
    maxBytes: CREDIT_PURCHASE_GRANT_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Credit purchase payload is too large"
  });
  let identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  let appAccountToken: string | undefined;
  if (config.consumablePurchasesEnabled && config.accountRecoveryReady) {
    const account = await resolveAccountCredential(request, env);
    appAccountToken = account.appAccountToken;
    identity = {
      quotaSubject: account.accountPrincipal,
      plan: "free",
      identityKind: "account"
    };
  }
  const verified = await verifyCreditPurchaseWithApple(env, { ...payload, appAccountToken });
  const result = await grantPurchasedCredits(identity, env, config, {
    productId: payload.productId,
    transactionId: verified.transactionId,
    originalTransactionId: verified.originalTransactionId,
    purchasedAt: payload.purchasedAt,
    verificationEnvironment: verified.verificationEnvironment
  });

  return json({
    status: result.didMutate ? "granted" : "already_granted",
    transactionId: result.transactionId,
    productId: result.productId,
    creditsPurchased: result.creditsPurchased,
    creditsGranted: result.creditsGranted,
    creditsAppliedToRefundDebt: result.creditsAppliedToRefundDebt,
    creditsRemaining: result.creditsRemaining,
    transactionStatus: result.transactionStatus,
    didMutate: result.didMutate,
    usage: result.usage
  });
};
