import type { Env, FilingCacheRecord } from "../../env";
import type { RemoteConfig } from "../remote-config";
import { attachChatDebug } from "./response-payload";
import {
  attachCurrentFilingSourceUrls,
  ensureFilingGroundedResponse,
  type ChatResponseDebug,
  type ChatResponsePayload,
  type ChatResponsePath
} from "./grounding";
import type { ChatTimingTracker } from "./timing";
import { maybeAppendWebSupplement } from "./web-supplement";

type ChatResponseDebugInput = Omit<ChatResponseDebug, "sourceCount" | "sourceIds">;

export async function finalizeChatResponse({
  filing,
  question,
  response,
  responsePath,
  debug,
  env,
  config,
  timings,
  includeWebSupplement = true,
  attachSourceUrls = true
}: {
  filing: FilingCacheRecord;
  question: string;
  response: ChatResponsePayload;
  responsePath: ChatResponsePath;
  debug: ChatResponseDebugInput;
  env: Env;
  config: RemoteConfig;
  timings: ChatTimingTracker;
  includeWebSupplement?: boolean;
  attachSourceUrls?: boolean;
}): Promise<ChatResponsePayload> {
  const grounded = ensureFilingGroundedResponse(response);
  const supplemented = includeWebSupplement
    ? await timings.timeAsync("webSupplementMs", () =>
      maybeAppendWebSupplement(
        filing,
        question,
        grounded,
        env,
        config
      )
    )
    : grounded;
  const responseWithUrls = attachSourceUrls
    ? timings.timeSync("groundingMs", () => attachCurrentFilingSourceUrls(supplemented, filing.primaryDocumentUrl))
    : supplemented;

  return attachChatDebug(
    {
      ...responseWithUrls,
      responsePath
    },
    {
      ...debug,
      responsePath,
      ...timings.snapshot()
    }
  );
}
