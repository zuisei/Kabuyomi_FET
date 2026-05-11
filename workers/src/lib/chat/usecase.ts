import type { z } from "zod";
import type { Env, FilingCacheRecord, UsageState } from "../../env";
import { resolveLlmProvider } from "../../clients/llm/provider";
import { resolveGeminiModel } from "../../clients/gemini/request";
import { resolveOpenAIChatModel } from "../../clients/llm/providers/openai/request";
import { ChatRequestSchema } from "../contracts";
import { consumeBillableCredits } from "../credit-operation";
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
  ensureChatQuotaAvailable,
  InsufficientCreditsError,
  loadUsage,
  readQuotaIdentity,
} from "../quota";
import { logErrorEvent, logEvent } from "../logging";
import { isCreditBillingEnabledForIdentity, type RemoteConfig } from "../remote-config";
import { buildChatResponse } from "./orchestrator";
import { formatChatAnswerForDisplay } from "./answer-format";
import { type ChatContextMessage, resolveContextualQuestion } from "./context";
import {
  buildAnswerQualityFlags,
  buildCompactChatQualityPipelinePayload,
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
  const lifecycleLogFields = buildChatLifecycleLogFields({
    identity,
    creditBillingEnabled,
    creditOperationId,
    filing: preparedFiling
  });
  let chatCharge: ChatChargeResult;
  try {
    chatCharge = await preflightChatCharge({
      identity,
      env,
      config,
      creditBillingEnabled,
      filingKey: preparedFiling.filingKey
    });
    logEvent("chat_credit_preflight_passed", {
      ...lifecycleLogFields,
      chargeStage: "preflight",
      creditsRemaining: chatCharge.creditsRemaining ?? chatCharge.usage.credits?.totalRemaining ?? null
    });
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      logEvent("chat_credit_preflight_failed", {
        ...lifecycleLogFields,
        chargeStage: "preflight",
        creditsRemaining: error.creditsRemaining,
        creditsRequired: error.creditsRequired,
        errorKind: "insufficient_credits"
      });
    }
    throw error;
  }
  const startedAt = Date.now();
  const resolvedQuestion = resolveContextualQuestion(payload.question, payload.conversationContext);
  const followupContext = summarizeFollowupContext(payload.conversationContext);
  const conversationContextSummary = summarizeConversationContext(payload.conversationContext);
  logEvent("chat_generation_started", {
    ...lifecycleLogFields,
    chargeStage: "generation",
    conversationContextCount: payload.conversationContext?.length ?? 0,
    conversationContextCharCount: countConversationContextChars(payload.conversationContext)
  });
  let answer: Awaited<ReturnType<typeof buildChatResponse>>;
  try {
    answer = await buildChatResponseBeforeCharge({
      filing: preparedFiling,
      question: resolvedQuestion,
      env,
      config,
      ctx,
      followupContext,
      conversationContextSummary
    });
    logEvent("chat_generation_succeeded", {
      ...lifecycleLogFields,
      chargeStage: "generation",
      responsePath: answer.responsePath ?? answer.debug?.responsePath ?? "fallback",
      chargeable: answer.chargeable !== false
    });
  } catch (error) {
    logErrorEvent("chat_generation_failed_before_charge", {
      ...lifecycleLogFields,
      chargeStage: "generation",
      errorKind: error instanceof Error ? error.name : "unknown",
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
  if (answer.chargeable !== false) {
    logEvent("chat_charge_commit_attempted", {
      ...lifecycleLogFields,
      chargeStage: "commit",
      creditsRequired: creditBillingEnabled ? CHAT_CREDIT_COST : null
    });
    try {
      chatCharge = await commitChatChargeAfterGeneration({
        identity,
        env,
        config,
        creditBillingEnabled,
        creditOperationId,
        filingKey: preparedFiling.filingKey
      });
      logEvent("chat_charge_commit_succeeded", {
        ...lifecycleLogFields,
        chargeStage: "commit",
        charged: true,
        creditDelta: chatCharge.creditsCharged ? -chatCharge.creditsCharged : null,
        creditsRemaining: chatCharge.creditsRemaining ?? chatCharge.usage.credits?.totalRemaining ?? null
      });
    } catch (error) {
      logErrorEvent("chat_charge_commit_failed", {
        ...lifecycleLogFields,
        chargeStage: "commit",
        errorKind: error instanceof InsufficientCreditsError ? "insufficient_credits" : error instanceof Error ? error.name : "unknown",
        creditsRemaining: error instanceof InsufficientCreditsError ? error.creditsRemaining : null,
        creditsRequired: error instanceof InsufficientCreditsError ? error.creditsRequired : creditBillingEnabled ? CHAT_CREDIT_COST : null
      });
      throw error;
    }
  } else {
    logEvent("chat_response_non_chargeable", {
      ...lifecycleLogFields,
      chargeStage: "commit",
      charged: false,
      responsePath: answer.responsePath ?? answer.debug?.responsePath ?? "fallback"
    });
  }
  const latencyMs = Date.now() - startedAt;
  const responsePath = resolveChatResponsePath(answer);
  const answerQualityFlags = buildAnswerQualityFlags(answer, {
    contextApplied: resolvedQuestion !== payload.question
  });
  const modelNameForLog = answer.debug?.geminiCalled === true || isRemoteModelResponsePath(responsePath) ? resolveSelectedChatModelName(env, answer.debug?.modelName) : null;

  logEvent("chat_request", {
    ticker: preparedFiling.ticker,
    filingKey: preparedFiling.filingKey,
    quotaSubjectSuffix: suffixForLog(identity.quotaSubject),
    identityKind: identity.identityKind,
    latencyMs,
    contextMessageCount: payload.conversationContext?.length ?? 0,
    conversationContextCharCount: countConversationContextChars(payload.conversationContext),
    contextApplied: resolvedQuestion !== payload.question,
    sourceCount: answer.sources.length,
    chargeStage: answer.chargeable === false ? "not_chargeable" : "committed",
    charged: answer.chargeable !== false,
    creditsCharged: chatCharge.creditsCharged ?? null,
    creditsRemaining: chatCharge.creditsRemaining ?? chatCharge.usage.credits?.totalRemaining ?? null
  });

  logEvent(
    "chat_quality_pipeline",
    buildChatDiagnosticsPayload({
      filing: preparedFiling,
      originalQuestion: payload.question,
      rewrittenQuestion: resolvedQuestion,
      answer,
      latencyMs,
      modelName: modelNameForLog,
      contextMessageCount: payload.conversationContext?.length ?? 0,
      contextMessageCharCount: countConversationContextChars(payload.conversationContext),
      env
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
  logEvent("chat_response_returned", {
    ...lifecycleLogFields,
    chargeStage: answer.chargeable === false ? "not_chargeable" : "committed",
    charged: answer.chargeable !== false,
    status: 200,
    responsePath: answer.responsePath,
    latencyMs,
    creditsRemaining: chatCharge.creditsRemaining ?? chatCharge.usage.credits?.totalRemaining ?? null
  });
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
  usage: UsageState;
  didMutate?: boolean;
  creditsCharged?: number;
  creditsRemaining?: number;
}

async function buildChatResponseBeforeCharge({
  filing,
  question,
  env,
  config,
  ctx,
  followupContext,
  conversationContextSummary
}: {
  filing: FilingCacheRecord;
  question: string;
  env: Env;
  config: RemoteConfig;
  ctx: Pick<ExecutionContext, "waitUntil">;
  followupContext: FollowupContextSummary;
  conversationContextSummary?: string;
}): ReturnType<typeof buildChatResponse> {
  const options: Parameters<typeof buildChatResponse>[4] = { executionContext: ctx };
  if (followupContext.previousQuestion || followupContext.previousAnswer) {
    options.followupContext = followupContext;
  }
  if (conversationContextSummary) {
    options.conversationContextSummary = conversationContextSummary;
  }
  return buildChatResponse(filing, question, env, config, {
    ...options
  });
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

function summarizeConversationContext(context: ChatContextMessage[] = []): string | undefined {
  const turns = context
    .slice(-8)
    .map((message) => {
      const roleLabel = message.role === "user" ? "ユーザー" : "アシスタント";
      const content = message.content.replace(/\s+/g, " ").trim();
      return content ? `${roleLabel}: ${content.slice(0, 520)}` : "";
    })
    .filter(Boolean);
  if (turns.length === 0) {
    return undefined;
  }
  return turns.join("\n").slice(0, 3_000);
}

async function preflightChatCharge({
  identity,
  env,
  config,
  creditBillingEnabled,
  filingKey
}: {
  identity: Awaited<ReturnType<typeof readQuotaIdentity>>;
  env: Env;
  config: RemoteConfig;
  creditBillingEnabled: boolean;
  filingKey: string;
}): Promise<ChatChargeResult> {
  if (!creditBillingEnabled) {
    return {
      usage: await ensureChatQuotaAvailable(identity, env, config),
      didMutate: false
    };
  }

  const usage = await loadUsage(identity, env, config);
  const creditsRemaining = usage.credits?.totalRemaining ?? 0;
  if (creditsRemaining < CHAT_CREDIT_COST) {
    throw new InsufficientCreditsError(CHAT_CREDIT_COST, creditsRemaining);
  }
  return {
    usage,
    didMutate: false,
    creditsCharged: 0,
    creditsRemaining
  };
}

async function commitChatChargeAfterGeneration({
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

function buildChatDiagnosticsPayload({
  filing,
  originalQuestion,
  rewrittenQuestion,
  answer,
  latencyMs,
  modelName,
  contextMessageCount,
  contextMessageCharCount,
  env
}: {
  filing: FilingCacheRecord;
  originalQuestion: string;
  rewrittenQuestion: string;
  answer: Awaited<ReturnType<typeof buildChatResponse>>;
  latencyMs: number;
  modelName: string | null;
  contextMessageCount: number;
  contextMessageCharCount: number;
  env: Env;
}): Record<string, unknown> {
  if (shouldUseVerboseChatDiagnostics(env)) {
    return {
      diagnosticsLevel: "verbose",
      ...buildChatQualityPipelinePayload({
        filing,
        originalQuestion,
        rewrittenQuestion,
        answer,
        latencyMs,
        modelName,
        contextMessageCount
      })
    };
  }

  return buildCompactChatQualityPipelinePayload({
    filing,
    answer,
    latencyMs,
    modelName,
    contextMessageCount,
    contextMessageCharCount,
    contextApplied: rewrittenQuestion !== originalQuestion
  });
}

function buildChatLifecycleLogFields({
  identity,
  creditBillingEnabled,
  creditOperationId,
  filing
}: {
  identity: Awaited<ReturnType<typeof readQuotaIdentity>>;
  creditBillingEnabled: boolean;
  creditOperationId: string;
  filing: FilingCacheRecord;
}): Record<string, unknown> {
  return {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    identityKind: identity.identityKind,
    quotaSubjectSuffix: suffixForLog(identity.quotaSubject),
    operationIdSuffix: suffixForLog(creditOperationId),
    creditBillingEnabled
  };
}

function countConversationContextChars(context: ChatContextMessage[] = []): number {
  return context.reduce((sum, message) => sum + message.content.length, 0);
}

function shouldUseVerboseChatDiagnostics(env: Env): boolean {
  const explicitLevel = (env as unknown as Record<string, string | undefined>).CHAT_DIAGNOSTICS_LEVEL;
  return shouldIncludeChatDebug(env) || explicitLevel === "verbose";
}

function suffixForLog(value: string | undefined, length = 8): string | null {
  if (!value) {
    return null;
  }
  return value.slice(-length);
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
