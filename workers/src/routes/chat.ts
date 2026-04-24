import { listTickersByCik } from "../clients/sec";
import { resolveGeminiModel } from "../clients/gemini/request";
import { ChatRequestSchema } from "../lib/contracts";
import { enqueueContentUpgrade, isMetricsOnlyRecord, upgradeMetricsOnlyRecord } from "../lib/filings/content-upgrade";
import { isCurrentCacheRecord, loadFilingByKey } from "../lib/filings/cache";
import { buildChatResponse } from "../lib/pipeline";
import { consumeChatQuota, ensureCompanyAccessAllowed, readQuotaIdentity, refundChatQuota } from "../lib/quota";
import { parseJsonBody } from "../lib/request";
import { logErrorEvent, logEvent } from "../lib/logging";
import { json, notFound, unavailable } from "../lib/response";
import { STARTER_TICKERS } from "../lib/starter-tickers";
import type { RouteHandler } from "./types";

const CHAT_PAYLOAD_MAX_BYTES = 4_096;

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
    const relatedTickers = await listTickersByCik(requestedFiling.cik, env);
    await ensureCompanyAccessAllowed(identity, requestedFiling.ticker, STARTER_TICKERS, env, config, { relatedTickers });
    requestedFiling = await prepareFilingForChat(requestedFiling, env, ctx);
    const usage = await consumeChatQuota(identity, env, config);
    const startedAt = Date.now();
    const answer = await (async () => {
      try {
        return await buildChatResponse(requestedFiling, payload.question, env, config, {
          executionContext: ctx
        });
      } catch (error) {
        try {
          await refundChatQuota(identity, env, config);
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

    logEvent("chat_request", {
      filingKey: requestedFiling.filingKey,
      quotaSubject: identity.quotaSubject,
      identityKind: identity.identityKind,
      latencyMs: Date.now() - startedAt,
      sourceCount: answer.sources.length
    });

    return json({
      answer: answer.answer,
      sources: answer.sources,
      responsePath: answer.responsePath,
      modelName: answer.responsePath === "gemini" ? resolveGeminiModel(env) : null,
      usage
    });
  } catch (error) {
    logErrorEvent("chat_request_failed", {
      filingKey: payload.filingKey,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};

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
