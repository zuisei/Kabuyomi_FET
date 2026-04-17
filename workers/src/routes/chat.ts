import { ChatRequestSchema } from "../lib/contracts";
import { buildChatResponse, loadFilingByKey } from "../lib/pipeline";
import { consumeChatQuota, ensureChatQuotaAvailable, readQuotaIdentity } from "../lib/quota";
import { logEvent } from "../lib/logging";
import { badRequest, json, notFound, unavailable } from "../lib/response";
import type { RouteHandler } from "./types";

export const handleChatRoute: RouteHandler = async ({ request, url, env, config }) => {
  if (!(request.method === "POST" && url.pathname === "/v1/chat")) {
    return null;
  }

  if (!config.chatEnabled) {
    return unavailable("Chat is temporarily disabled");
  }

  const parsed = ChatRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return badRequest("Invalid chat payload");
  }

  const filing = await loadFilingByKey(parsed.data.filingKey, env);
  if (!filing) {
    return notFound("Filing cache not found");
  }

  const identity = await readQuotaIdentity(request, { requireDeviceKey: true });
  await ensureChatQuotaAvailable(identity, env, config);
  const startedAt = Date.now();
  const answer = await buildChatResponse(filing, parsed.data.question, env, config);
  const usage = await consumeChatQuota(identity, env, config);

  logEvent("chat_request", {
    filingKey: parsed.data.filingKey,
    quotaSubject: identity.quotaSubject,
    latencyMs: Date.now() - startedAt,
    sourceCount: answer.sources.length
  });

  return json({
    answer: answer.answer,
    sources: answer.sources,
    usage
  });
};
