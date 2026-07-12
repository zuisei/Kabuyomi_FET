import type { z } from "zod";
import type { Env, FilingCacheRecord } from "../../env";
import { resolveLlmProvider } from "../../clients/llm/provider";
import { resolveGeminiModel } from "../../clients/gemini/request";
import { resolveOpenAIChatModel } from "../../clients/llm/providers/openai/request";
import { ChatRequestSchema } from "../contracts";
import {
  backfillMarginSourceAssets,
  backfillRevenueDriverSourceAssets,
  enqueueContentUpgrade,
  isMetricsOnlyRecord,
  needsMarginSourceBackfill,
  needsRevenueDriverSourceBackfill,
  upgradeMetricsOnlyRecord
} from "../filings/content-upgrade";
import { type QuotaIdentity } from "../quota";
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

export const CHAT_CREDIT_COST = 2;

function isRemoteModelResponsePath(responsePath: string | undefined): boolean {
  return responsePath === "gemini" || responsePath === "openai";
}

export type ChatRequestPayload = z.infer<typeof ChatRequestSchema>;

export async function answerChatUsecase({
  payload,
  filing,
  identity,
  operationId,
  env,
  config,
  ctx
}: {
  payload: ChatRequestPayload;
  filing: FilingCacheRecord;
  identity: QuotaIdentity;
  operationId: string;
  env: Env;
  config: RemoteConfig;
  ctx: Pick<ExecutionContext, "waitUntil">;
}): Promise<Record<string, unknown>> {
  const preparedFiling = await prepareFilingForChat(filing, env, ctx);
  const creditBillingEnabled = isCreditBillingEnabledForIdentity(config, identity);
  const lifecycleLogFields = buildChatLifecycleLogFields({
    identity,
    creditBillingEnabled,
    operationId,
    filing: preparedFiling
  });
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
    answer = await buildChatResponseForExecution({
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
      errorKind: error instanceof Error ? error.name : typeof error
    });
    throw error;
  }
  if (answer.chargeable === false) {
    logEvent("chat_response_non_chargeable", {
      ...lifecycleLogFields,
      chargeStage: "generation",
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
    chargeStage: answer.chargeable === false ? "not_chargeable" : "reserved",
    chargeable: answer.chargeable !== false
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

  const modelName = isRemoteModelResponsePath(responsePath) ? resolveSelectedChatModelName(env, answer.debug?.modelName) : null;
  const body: Record<string, unknown> = {
    answer: formatChatAnswerForDisplay(answer.answer),
    sources: answer.sources,
    responsePath,
    modelName,
    chargeable: answer.chargeable !== false
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
  logEvent("chat_generation_prepared", {
    ...lifecycleLogFields,
    chargeStage: answer.chargeable === false ? "not_chargeable" : "reserved",
    chargeable: answer.chargeable !== false,
    responsePath: answer.responsePath,
    latencyMs
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

async function buildChatResponseForExecution({
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
  operationId,
  filing
}: {
  identity: QuotaIdentity;
  creditBillingEnabled: boolean;
  operationId: string;
  filing: FilingCacheRecord;
}): Record<string, unknown> {
  return {
    ticker: filing.ticker,
    filingKey: filing.filingKey,
    identityKind: identity.identityKind,
    quotaSubjectSuffix: suffixForLog(identity.quotaSubject),
    operationIdSuffix: suffixForLog(operationId),
    creditBillingEnabled
  };
}

function countConversationContextChars(context: ChatContextMessage[] = []): number {
  return context.reduce((sum, message) => sum + message.content.length, 0);
}

function shouldUseVerboseChatDiagnostics(env: Env): boolean {
  const explicitLevel = (env as unknown as Record<string, string | undefined>).CHAT_DIAGNOSTICS_LEVEL;
  // Verbose diagnostics include raw questions, model previews, and filing
  // excerpts. They are useful for the isolated test Worker, but must never be
  // enabled in production by a stray runtime variable.
  return shouldIncludeChatDebug(env) && explicitLevel !== "compact";
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
    if (needsRevenueDriverSourceBackfill(filing)) {
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
    if (needsMarginSourceBackfill(filing)) {
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
