import { resolveGeminiModel } from "../clients/gemini/request";
import { ChatRequestSchema } from "../lib/contracts";
import { isCurrentCacheRecord, loadFilingByKey } from "../lib/filings/cache";
import { buildChatResponse } from "../lib/pipeline";
import { consumeChatQuota, ensureCompanyAccessAllowed, readQuotaIdentity, refundChatQuota } from "../lib/quota";
import { logErrorEvent, logEvent } from "../lib/logging";
import { badRequest, json, notFound, unavailable } from "../lib/response";
import { STARTER_TICKERS } from "../lib/starter-tickers";
import type { RouteHandler } from "./types";

export const handleChatRoute: RouteHandler = async ({ request, url, env, config, ctx }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/chat")) {
    return null;
  }

  if (!config.chatEnabled) {
    return unavailable("Chat is temporarily disabled");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return badRequest("Invalid chat payload");
  }

  const parsed = ChatRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return badRequest("Invalid chat payload");
  }

  try {
    const requestedFiling = await loadFilingByKey(parsed.data.filingKey, env);
    if (!requestedFiling || !isCurrentCacheRecord(requestedFiling, config)) {
      return notFound("Filing cache not found");
    }

    const identity = await readQuotaIdentity(request, env, {
      requireDeviceKey: true,
      allowDebugUnlimited: true
    });
    await ensureCompanyAccessAllowed(identity, requestedFiling.ticker, STARTER_TICKERS, env, config);
    const usage = await consumeChatQuota(identity, env, config);
    const startedAt = Date.now();
    const answer = await (async () => {
      try {
        return await buildChatResponse(requestedFiling, parsed.data.question, env, config);
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
      filingKey: parsed.data.filingKey,
      reason: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
};
