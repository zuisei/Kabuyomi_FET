import type { Env } from "../env";
import {
  consumeCredit,
  refundCredit,
  type CreditMutationResult,
  type QuotaIdentity
} from "./quota";
import type { RemoteConfig } from "./remote-config";

export interface CreditOperationReference {
  type: string;
  id: string;
}

export interface CreditChargeResult {
  usage: CreditMutationResult["usage"];
  didMutate?: boolean;
  operationId: string;
  creditsCharged: number;
  creditsRemaining?: number;
}

export async function consumeBillableCredits({
  identity,
  env,
  config,
  operationId,
  creditsRequired,
  reference
}: {
  identity: QuotaIdentity;
  env: Env;
  config: RemoteConfig;
  operationId: string;
  creditsRequired: number;
  reference: CreditOperationReference;
}): Promise<CreditChargeResult> {
  const credit = await consumeCredit(identity, env, config, {
    operationId,
    creditsRequired,
    reference
  });

  return {
    usage: credit.usage,
    didMutate: credit.didMutate,
    operationId,
    creditsCharged: credit.creditsCharged ?? 0,
    creditsRemaining: credit.creditsRemaining
  };
}

export async function refundBillableCredits({
  identity,
  env,
  config,
  charge,
  reference
}: {
  identity: QuotaIdentity;
  env: Env;
  config: RemoteConfig;
  charge: CreditChargeResult;
  reference: CreditOperationReference;
}): Promise<CreditMutationResult> {
  if (charge.creditsCharged <= 0) {
    return {
      usage: charge.usage,
      didMutate: false,
      operationId: `refund:${charge.operationId}`,
      creditsRefunded: 0,
      creditsRemaining: charge.creditsRemaining ?? charge.usage.credits?.totalRemaining ?? 0
    };
  }

  return refundCredit(identity, env, config, {
    originalOperationId: charge.operationId,
    refundOperationId: `refund:${charge.operationId}`,
    credits: charge.creditsCharged,
    reference
  });
}
