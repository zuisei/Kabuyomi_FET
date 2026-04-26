import { resolveGeminiModel } from "../clients/gemini/request";
import { ChatRequestSchema } from "../lib/contracts";
import { formatChatAnswerForDisplay } from "../lib/chat/answer-format";
import { resolveContextualQuestion } from "../lib/chat/context";
import { enqueueContentUpgrade, isMetricsOnlyRecord, upgradeMetricsOnlyRecord } from "../lib/filings/content-upgrade";
import { isCurrentCacheRecord, loadFilingByKey } from "../lib/filings/cache";
import { buildChatResponse } from "../lib/pipeline";
import {
  consumeChatQuota,
  consumeCredit,
  InsufficientCreditsError,
  readQuotaIdentity,
  refundChatQuota,
  refundCredit,
  type CreditMutationResult
} from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { logErrorEvent, logEvent } from "../lib/logging";
import { isCreditBillingEnabledForIdentity } from "../lib/remote-config";
import { json, notFound, unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

const CHAT_PAYLOAD_MAX_BYTES = 4_096;
const CHAT_CREDIT_COST = 2;

export const handleChatRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/chat")) {
    return null;
  }

  if (!config.chatEnabled) {
    return unavailable("Chat is temporarily disabled");
  }

  const payload = await parseJsonBody(request, ChatRequestSchema, {
    invalidMessage: "Invalid chat payload",
    maxBytes: CHAT_PAYLOAD_MAX_BYTES,
    tooLargeMessage: "Chat payload is too large"
  });

  try {
    let requestedFiling = await loadFilingByKey(payload.filingKey, env);
    if (!requestedFiling || !isCurrentCacheRecord(requestedFiling, config)) {
      return notFound("Filing cache not found");
    }

    const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
    requestedFiling = await prepareFilingForChat(requestedFiling, env, ctx);
    const creditOperationId = payload.operationId ?? crypto.randomUUID();
    const creditBillingEnabled = isCreditBillingEnabledForIdentity(config, identity);
    let chatCharge = await chargeChat({
      identity,
      env,
      config,
      creditBillingEnabled,
      creditOperationId,
      filingKey: requestedFiling.filingKey
    });
    const startedAt = Date.now();
    const resolvedQuestion = resolveContextualQuestion(payload.question, payload.conversationContext);
    const answer = await (async () => {
      try {
        return await buildChatResponse(requestedFiling, resolvedQuestion, env, config, {
          executionContext: ctx
        });
      } catch (error) {
        try {
          await refundChat({
            identity,
            env,
            config,
            creditBillingEnabled,
            chatCharge,
            creditOperationId,
            filingKey: requestedFiling.filingKey
          });
        } catch (refundError) {
          logErrorEvent("chat_quota_refund_failed", {
            filingKey: requestedFiling.filingKey,
            quotaSubject: identity.quotaSubject,
            reason: refundError instanceof Error ? refundError.message : String(refundError)
          });
        }
        throw error;
      }
    })();

    if (answer.chargeable === false) {
      try {
        const refund = await refundChat({
          identity,
          env,
          config,
          creditBillingEnabled,
          chatCharge,
          creditOperationId,
          filingKey: requestedFiling.filingKey
        });
        chatCharge = chatChargeAfterRefund(refund, creditBillingEnabled);
        logEvent("chat_non_chargeable_refunded", {
          filingKey: requestedFiling.filingKey,
          quotaSubject: identity.quotaSubject,
          responsePath: answer.responsePath ?? "fallback",
          creditBillingEnabled
        });
      } catch (refundError) {
        logErrorEvent("chat_non_chargeable_refund_failed", {
          filingKey: requestedFiling.filingKey,
          quotaSubject: identity.quotaSubject,
          reason: refundError instanceof Error ? refundError.message : String(refundError)
        });
      }
    }

    logEvent("chat_request", {
      filingKey: requestedFiling.filingKey,
      quotaSubject: identity.quotaSubject,
      identityKind: identity.identityKind,
      latencyMs: Date.now() - startedAt,
      contextMessageCount: payload.conversationContext?.length ?? 0,
      contextApplied: resolvedQuestion !== payload.question,
      sourceCount: answer.sources.length
    });

    return json({
      answer: formatChatAnswerForDisplay(answer.answer),
      sources: answer.sources,
      responsePath: answer.responsePath,
      modelName: answer.responsePath === "gemini" ? resolveGeminiModel(env) : null,
      usage: { ...chatCharge.usage, creditBillingEnabled },
      creditsCharged: chatCharge.creditsCharged,
      creditsRemaining: chatCharge.creditsRemaining
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      return json(
        {
          error: "insufficient_credits",
          creditsRequired: error.creditsRequired,
          creditsRemaining: error.creditsRemaining
        },
        { status: error.status }
      );
    }

    logErrorEvent("chat_request_failed", {
      filingKey: payload.filingKey,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

interface ChatChargeResult {
  usage: Awaited<ReturnType<typeof consumeChatQuota>>;
  didMutate?: boolean;
  creditsCharged?: number;
  creditsRemaining?: number;
}

async function chargeChat({
  identity,
  env,
  config,
  creditBillingEnabled,
  creditOperationId,
  filingKey
}: {
  identity: Awaited<ReturnType<typeof readQuotaIdentity>>;
  env: Parameters<typeof consumeChatQuota>[1];
  config: Parameters<typeof consumeChatQuota>[2];
  creditBillingEnabled: boolean;
  creditOperationId: string;
  filingKey: string;
}): Promise<ChatChargeResult> {
  if (!creditBillingEnabled) {
    return {
      usage: await consumeChatQuota(identity, env, config),
      didMutate: true
    };
  }

  const credit = await consumeCredit(identity, env, config, {
    operationId: creditOperationId,
    creditsRequired: CHAT_CREDIT_COST,
    reference: {
      type: "chat",
      id: filingKey
    }
  });
  return {
    usage: credit.usage,
    didMutate: credit.didMutate,
    creditsCharged: credit.creditsCharged ?? 0,
    creditsRemaining: credit.creditsRemaining
  };
}

async function refundChat({
  identity,
  env,
  config,
  creditBillingEnabled,
  chatCharge,
  creditOperationId,
  filingKey
}: {
  identity: Awaited<ReturnType<typeof readQuotaIdentity>>;
  env: Parameters<typeof consumeChatQuota>[1];
  config: Parameters<typeof consumeChatQuota>[2];
  creditBillingEnabled: boolean;
  chatCharge: ChatChargeResult;
  creditOperationId: string;
  filingKey: string;
}): Promise<CreditMutationResult | Awaited<ReturnType<typeof refundChatQuota>>> {
  if (!creditBillingEnabled) {
    return refundChatQuota(identity, env, config);
  }

  const creditsCharged = chatCharge.creditsCharged ?? 0;
  if (creditsCharged <= 0) {
    return {
      usage: chatCharge.usage,
      didMutate: false,
      operationId: `refund:${creditOperationId}`,
      creditsRefunded: 0,
      creditsRemaining: chatCharge.creditsRemaining ?? chatCharge.usage.credits?.totalRemaining ?? 0
    };
  }

  return refundCredit(identity, env, config, {
    originalOperationId: creditOperationId,
    refundOperationId: `refund:${creditOperationId}`,
    credits: creditsCharged,
    reference: {
      type: "chat",
      id: filingKey
    }
  });
}

function chatChargeAfterRefund(
  refund: CreditMutationResult | Awaited<ReturnType<typeof refundChatQuota>>,
  creditBillingEnabled: boolean
): ChatChargeResult {
  if (!creditBillingEnabled) {
    return {
      usage: refund as Awaited<ReturnType<typeof refundChatQuota>>,
      didMutate: true
    };
  }

  const creditRefund = refund as CreditMutationResult;
  return {
    usage: creditRefund.usage,
    didMutate: creditRefund.didMutate,
    creditsCharged: 0,
    creditsRemaining: creditRefund.creditsRemaining
  };
}

async function prepareFilingForChat(
  filing: NonNullable<Awaited<ReturnType<typeof loadFilingByKey>>>,
  env: Parameters<typeof upgradeMetricsOnlyRecord>[1],
  ctx: Pick<ExecutionContext, "waitUntil">
): Promise<NonNullable<Awaited<ReturnType<typeof loadFilingByKey>>>> {
  if (!isMetricsOnlyRecord(filing)) {
    return filing;
  }

  try {
    const upgraded = await upgradeMetricsOnlyRecord(filing, env);
    if (upgraded) {
      return upgraded;
    }
  } catch (error) {
    logErrorEvent("chat_metrics_only_upgrade_failed", {
      filingKey: filing.filingKey,
      ticker: filing.ticker,
      reason: error instanceof Error ? error.message : String(error)
    });
  }

  enqueueContentUpgrade(filing, env, ctx);
  return filing;
}
