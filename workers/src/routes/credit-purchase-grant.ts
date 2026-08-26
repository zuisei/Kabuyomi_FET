import { CreditPurchaseGrantRequestSchema } from "../lib/contracts";
import { verifyCreditPurchaseWithApple } from "../lib/apple-store-server";
import { assertPurchasedCreditGrantsEnabled, grantPurchasedCredits, readQuotaIdentity } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { json } from "../lib/response";
import { resolveAccountCredential } from "../lib/account-recovery";
import { AppError } from "../lib/errors";
import { hashForLog, logWarnEvent, suffixForLog } from "../lib/logging";
import type { VerifiedAppleEnvironment } from "../lib/apple-signed-data";
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
  if (!isCreditGrantEnvironmentAccepted(verified.verificationEnvironment, env.APPLE_APP_STORE_SERVER_ENVIRONMENT)) {
    logWarnEvent("credit_purchase_grant_rejected_non_production_environment", {
      quotaSubjectHash: hashForLog(identity.quotaSubject),
      transactionIdSuffix: suffixForLog(verified.transactionId),
      productId: payload.productId,
      verificationEnvironment: verified.verificationEnvironment,
      configuredEnvironment: env.APPLE_APP_STORE_SERVER_ENVIRONMENT ?? null
    });
    throw new AppError(
      403,
      "Sandbox purchases cannot be granted on this deployment",
      "This deployment verifies against Apple production; the transaction was only found in sandbox."
    );
  }
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

/**
 * APPLE_APP_STORE_SERVER_ENVIRONMENT is "auto" in production, so a transaction
 * Apple's production endpoint does not recognise is retried against sandbox and
 * verifies there. TestFlight Release builds call the production API while
 * StoreKit hands them sandbox transactions, so an ordinary TestFlight purchase
 * used to mint free production credits.
 *
 * A deployment configured explicitly for "sandbox" — the test worker — is meant
 * to take sandbox transactions, so it still does. "auto" and "production" are
 * production postures and only accept production transactions.
 *
 * Cost of this gate: buying credits from a TestFlight build no longer grants
 * anything. The purchase and the server's refusal are still exercised; only the
 * grant is lost. End-to-end grant testing needs a build pointed at the test
 * worker.
 */
export function isCreditGrantEnvironmentAccepted(
  verificationEnvironment: VerifiedAppleEnvironment,
  configuredEnvironment: string | undefined
): boolean {
  if (verificationEnvironment === "production") {
    return true;
  }
  return configuredEnvironment?.trim().toLowerCase() === "sandbox";
}
