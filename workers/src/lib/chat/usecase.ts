import type { z } from "zod";
import type { Env, FilingCacheRecord } from "../../env";
import { resolveLlmProvider } from "../../clients/llm/provider";
import { resolveGeminiModel } from "../../clients/gemini/request";
import { resolveOpenAIChatModel } from "../../clients/llm/providers/openai/request";
import { ChatRequestSchema } from "../contracts";
import { consumeBillableCredits, refundBillableCredits } from "../credit-operation";
import {
  backfillMarginSourceAssets,
  backfillRevenueDriverSourceAssets,
  enqueueContentUpgrade,
  isMetricsOnlyRecord,
  needsMarginSourceBackfill,
  needsRevenueDriverSourceBackfill,
  upgradeMetricsOnlyRecord
} from "../filings/content-upgrade";
import {
  consumeChatQuota,
  readQuotaIdentity,
  refundChatQuota,
  type CreditMutationResult
} from "../quota";
import { logErrorEvent, logEvent } from "../logging";
import { isCreditBillingEnabledForIdentity, type RemoteConfig } from "../remote-config";
import { buildChatResponse } from "./orchestrator";
import { formatChatAnswerForDisplay } from "./answer-format";
import { type ChatContextMessage, resolveContextualQuestion } from "./context";
import {
  buildAnswerQualityFlags,
  buildChatQualityPipelinePayload,
  resolveChatResponsePath
} from "./diagnostics";

const CHAT_CREDIT_COST = 2;

function isRemoteModelResponsePath(responsePath: string | undefined): boolean {
  return responsePath === "gemini" || responsePath === "openai";
}

export type ChatRequestPayload = z.infer<typeof ChatRequestSchema>;

export async function answerChatUsecase({
  request,
  payload,
  filing,
  env,
  config,
  ctx
}: {
  request: Request;
  payload: ChatRequestPayload;
  filing: FilingCacheRecord;
  env: Env;
  config: RemoteConfig;
  ctx: Pick<ExecutionContext, "waitUntil">;
}): Promise<Record<string, unknown>> {
  const identity = await readQuotaIdentity(request, env, { requireDeviceKey: true });
  const preparedFiling = await prepareFilingForChat(filing, env, ctx);
  const creditOperationId = payload.operationId ?? crypto.randomUUID();
  const creditBillingEnabled = isCreditBillingEnabledForIdentity(config, identity);
  let chatCharge = await chargeChat({
    identity,
    env,
    config,
    creditBillingEnabled,
    creditOperationId,
    filingKey: preparedFiling.filingKey
  });
  const startedAt = Date.now();
  const resolvedQuestion = resolveContextualQuestion(payload.question, payload.conversationContext);
  const followupContext = summarizeFollowupContext(payload.conversationContext);
  const answer = await buildChatResponseWithRefund({
    filing: preparedFiling,
    question: resolvedQuestion,
    env,
    config,
    ctx,
    identity,
    creditBillingEnabled,
    chatCharge,
    creditOperationId,
    followupContext
  });
  const latencyMs = Date.now() - startedAt;
  const responsePath = resolveChatResponsePath(answer);
  const answerQualityFlags = buildAnswerQualityFlags(answer, {
    contextApplied: resolvedQuestion !== payload.question
  });
  const modelNameForLog = answer.debug?.geminiCalled === true || isRemoteModelResponsePath(responsePath) ? resolveSelectedChatModelName(env, answer.debug?.modelName) : null;

  if (answer.chargeable === false) {
    try {
      const refund = await refundChat({
        identity,
        env,
        config,
        creditBillingEnabled,
        chatCharge,
        creditOperationId,
        filingKey: preparedFiling.filingKey
      });
      chatCharge = chatChargeAfterRefund(refund, creditBillingEnabled);
      logEvent("chat_non_chargeable_refunded", {
        filingKey: preparedFiling.filingKey,
        quotaSubject: identity.quotaSubject,
        responsePath: answer.responsePath ?? "fallback",
        creditBillingEnabled
      });
    } catch (refundError) {
      logErrorEvent("chat_non_chargeable_refund_failed", {
        filingKey: preparedFiling.filingKey,
        quotaSubject: identity.quotaSubject,
        reason: refundError instanceof Error ? refundError.message : String(refundError)
      });
    }
  }

  logEvent("chat_request", {
    ticker: preparedFiling.ticker,
    filingKey: preparedFiling.filingKey,
    quotaSubject: identity.quotaSubject,
    identityKind: identity.identityKind,
    latencyMs,
    contextMessageCount: payload.conversationContext?.length ?? 0,
    contextApplied: resolvedQuestion !== payload.question,
    sourceCount: answer.sources.length
  });

  logEvent(
    "chat_quality_pipeline",
    buildChatQualityPipelinePayload({
      filing: preparedFiling,
      originalQuestion: payload.question,
      rewrittenQuestion: resolvedQuestion,
      answer,
      latencyMs,
      modelName: modelNameForLog,
      contextMessageCount: payload.conversationContext?.length ?? 0
    })
  );

  const modelName = isRemoteModelResponsePath(answer.responsePath) ? resolveSelectedChatModelName(env, answer.debug?.modelName) : null;
  const body: Record<string, unknown> = {
    answer: formatChatAnswerForDisplay(answer.answer),
    sources: answer.sources,
    responsePath: answer.responsePath,
    modelName,
    usage: { ...chatCharge.usage, creditBillingEnabled },
    creditsCharged: chatCharge.creditsCharged,
    creditsRemaining: chatCharge.creditsRemaining
  };
  if (shouldIncludeChatDebug(env)) {
    body.debug = {
      ...answer.debug,
      responsePath: answer.debug?.responsePath ?? answer.responsePath,
      sourceCount: answer.sources.length,
      sourceIds: answer.sources.map((source) => source.sourceId),
      contextApplied: resolvedQuestion !== payload.question,
      rewrittenQuestion: resolvedQuestion,
      modelName,
      answerQualityFlags
    };
  }
  return body;
}

function resolveSelectedChatModelName(env: Env, debugModelName?: string | null): string {
  if (debugModelName) {
    return debugModelName;
  }
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return resolveOpenAIChatModel(env);
  }
  return resolveGeminiModel(env);
}

interface ChatChargeResult {
  usage: Awaited<ReturnType<typeof consumeChatQuota>>;
  didMutate?: boolean;
  creditsCharged?: number;
  creditsRemaining?: number;
}

async function buildChatResponseWithRefund({
  filing,
  question,
  env,
  config,
  ctx,
  identity,
  creditBillingEnabled,
  chatCharge,
  creditOperationId,
  followupContext
}: {
  filing: FilingCacheRecord;
  question: string;
  env: Env;
  config: RemoteConfig;
  ctx: Pick<ExecutionContext, "waitUntil">;
  identity: Awaited<ReturnType<typeof readQuotaIdentity>>;
  creditBillingEnabled: boolean;
  chatCharge: ChatChargeResult;
  creditOperationId: string;
  followupContext: FollowupContextSummary;
}): ReturnType<typeof buildChatResponse> {
  try {
    const options: Parameters<typeof buildChatResponse>[4] = { executionContext: ctx };
    if (followupContext.previousQuestion || followupContext.previousAnswer) {
      options.followupContext = followupContext;
    }
    return await buildChatResponse(filing, question, env, config, {
      ...options
    });
  } catch (error) {
    return refundAfterChatGenerationFailure({
      error,
      filing,
      env,
      config,
      identity,
      creditBillingEnabled,
      chatCharge,
      creditOperationId
    });
  }
}

interface FollowupContextSummary {
  previousQuestion?: string;
  previousAnswer?: string;
}

function summarizeFollowupContext(context: ChatContextMessage[] = []): FollowupContextSummary {
  const previousQuestion = [...context].reverse().find((message) => message.role === "user")?.content?.trim();
  const previousAnswer = [...context].reverse().find((message) => message.role === "assistant")?.content?.trim();
  return {
    previousQuestion: previousQuestion ? previousQuestion.slice(0, 500) : undefined,
    previousAnswer: previousAnswer ? previousAnswer.slice(0, 1_500) : undefined
  };
}

async function refundAfterChatGenerationFailure({
  error,
  filing,
  env,
  config,
  identity,
  creditBillingEnabled,
  chatCharge,
  creditOperationId
}: {
  error: unknown;
  filing: FilingCacheRecord;
  env: Env;
  config: RemoteConfig;
  identity: Awaited<ReturnType<typeof readQuotaIdentity>>;
  creditBillingEnabled: boolean;
  chatCharge: ChatChargeResult;
  creditOperationId: string;
}): ReturnType<typeof buildChatResponse> {
  try {
    await refundChat({
      identity,
      env,
      config,
      creditBillingEnabled,
      chatCharge,
      creditOperationId,
      filingKey: filing.filingKey
    });
  } catch (refundError) {
    logErrorEvent("chat_quota_refund_failed", {
      filingKey: filing.filingKey,
      quotaSubject: identity.quotaSubject,
      reason: refundError instanceof Error ? refundError.message : String(refundError)
    });
  }
  throw error;
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
  env: Env;
  config: RemoteConfig;
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

  const credit = await consumeBillableCredits({
    identity,
    env,
    config,
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
    creditsCharged: credit.creditsCharged,
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
  env: Env;
  config: RemoteConfig;
  creditBillingEnabled: boolean;
  chatCharge: ChatChargeResult;
  creditOperationId: string;
  filingKey: string;
}): Promise<CreditMutationResult | Awaited<ReturnType<typeof refundChatQuota>>> {
  if (!creditBillingEnabled) {
    return refundChatQuota(identity, env, config, { operationId: creditOperationId });
  }

  return refundBillableCredits({
    identity,
    env,
    config,
    charge: {
      usage: chatCharge.usage,
      didMutate: chatCharge.didMutate,
      operationId: creditOperationId,
      creditsCharged: chatCharge.creditsCharged ?? 0,
      creditsRemaining: chatCharge.creditsRemaining
    },
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
  filing: FilingCacheRecord,
  env: Env,
  ctx: Pick<ExecutionContext, "waitUntil">
): Promise<FilingCacheRecord> {
  if (!isMetricsOnlyRecord(filing)) {
    if (isTestEnvironment(env) && needsRevenueDriverSourceBackfill(filing)) {
      try {
        filing = await backfillRevenueDriverSourceAssets(filing, env);
      } catch (error) {
        logErrorEvent("chat_revenue_driver_source_backfill_failed", {
          filingKey: filing.filingKey,
          ticker: filing.ticker,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (isTestEnvironment(env) && needsMarginSourceBackfill(filing)) {
      try {
        return await backfillMarginSourceAssets(filing, env);
      } catch (error) {
        logErrorEvent("chat_margin_source_backfill_failed", {
          filingKey: filing.filingKey,
          ticker: filing.ticker,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
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

function shouldIncludeChatDebug(env: Env): boolean {
  return env.KABUYOMI_ENV === "test" || env.ENVIRONMENT === "test";
}

function isTestEnvironment(env: Env): boolean {
  return env.KABUYOMI_ENV === "test" || env.ENVIRONMENT === "test";
}
