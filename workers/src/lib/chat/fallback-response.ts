import type { Env, FilingCacheRecord } from "../../env";
import { generateChatAnswer } from "../../clients/gemini";
import type { ChatContextPack } from "./context-pack";
import { CONTEXT_UNAVAILABLE_ANSWER, type ChatResponsePayload } from "./grounding";
import { buildSourceLookup, mapSourceIdsToSecFilingSources } from "./source-validation";

export async function buildLocalFallbackResponse({
  filing,
  question,
  env,
  validSourceIds,
  contextPack
}: {
  filing: FilingCacheRecord;
  question: string;
  env: Env;
  validSourceIds: Set<string>;
  contextPack?: ChatContextPack;
}): Promise<ChatResponsePayload | null> {
  const fallback = await generateChatAnswer(
    env,
    { filing, question, questionIntent: contextPack?.questionIntent, contextPack },
    { forceFallback: true }
  );
  const approvedSourceIds = fallback.sourceIds.filter((sourceId) => validSourceIds.has(sourceId));

  if (approvedSourceIds.length === 0) {
    if (fallback.answer === CONTEXT_UNAVAILABLE_ANSWER) {
      return {
        answer: fallback.answer,
        sources: []
      };
    }

    return null;
  }

  const sourceById = buildSourceLookup(filing, contextPack);
  return {
    answer: fallback.answer,
    sources: mapSourceIdsToSecFilingSources(approvedSourceIds, sourceById)
  };
}
