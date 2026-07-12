import type { Env, FilingCacheRecord } from "../../env";
import type { ChatFallbackReason, GeminiChatAnswer, GeminiInvocationUsage } from "../../clients/gemini/types";
import { resolveLlmProvider } from "../../clients/llm/provider";
import { CONTEXT_UNAVAILABLE_ANSWER } from "./grounding";
import { shouldRecoverFromWeakModelSources, type DeterministicChatAnswer } from "./deterministic";
import type { QuestionIntent } from "./intent";

export type ChatContentMode = "full" | "metrics_only";
export type ChatContextMode = "standard" | "expanded" | "compact";

export function shouldLetModelTryBeforeDeterministic(
  env: Env,
  deterministic: DeterministicChatAnswer | null
): boolean {
  return (
    hasConfiguredChatModel(env) &&
    (
      deterministic?.strategy === "revenue_drivers" ||
      deterministic?.strategy === "margin_snapshot"
    )
  );
}

function hasConfiguredChatModel(env: Env): boolean {
  const provider = resolveLlmProvider(env);
  if (provider === "openai") {
    return Boolean(env.OPENAI_API_KEY);
  }
  if (provider === "disabled") {
    return false;
  }
  return Boolean(env.GEMINI_API_KEY);
}

export function chooseRetryReason({
  filing,
  question,
  modelResponse,
  approvedSourceIds
}: {
  filing: FilingCacheRecord;
  question: string;
  modelResponse: GeminiChatAnswer;
  approvedSourceIds: string[];
}): ChatFallbackReason | null {
  if (modelResponse.fallbackReason) {
    return modelResponse.fallbackReason;
  }

  if (modelResponse.sourceIds.length > 0 && approvedSourceIds.length !== modelResponse.sourceIds.length) {
    return "invalid_source_id";
  }

  if (approvedSourceIds.length === 0) {
    return modelResponse.answer === CONTEXT_UNAVAILABLE_ANSWER ? "no_sources" : "invalid_source_id";
  }

  if (shouldRecoverFromWeakModelSources(filing, question, approvedSourceIds)) {
    return "weak_grounding";
  }

  return null;
}

export function shouldRetryModelAnswer(
  modelResponse: GeminiChatAnswer,
  retryReason: ChatFallbackReason | null,
  options: { questionIntent?: QuestionIntent; question?: string } = {}
): boolean {
  if (!retryReason || (modelResponse.retryAttempt ?? 0) >= 1) {
    return false;
  }

  if (modelResponse.geminiCalled === false) {
    return false;
  }

  if (retryReason === "invalid_source_id") {
    return true;
  }

  if (isTemporarilyRetryDisabledIntent(options.questionIntent, options.question ?? "")) {
    return false;
  }

  return retryReason !== "gemini_timeout" && retryReason !== "gemini_api_error" && retryReason !== "metrics_only_insufficient";
}

export function retryBlockedReasonForQuestion(
  retryReason: ChatFallbackReason | null,
  questionIntent: QuestionIntent,
  question: string
): string | null {
  if (!retryReason) {
    return null;
  }

  if (retryReason === "gemini_timeout") {
    return "first_call_timeout";
  }

  if (retryReason === "gemini_api_error") {
    return "first_call_api_error";
  }

  if (retryReason === "metrics_only_insufficient") {
    return "metrics_only_insufficient";
  }

  if (retryReason === "invalid_source_id") {
    return null;
  }

  if (isTemporarilyRetryDisabledIntent(questionIntent, question)) {
    return "hard_intent_retry_disabled";
  }

  return null;
}

export function isTemporarilyRetryDisabledIntent(questionIntent: QuestionIntent | undefined, question: string): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();

  if (
    /(売上|収益|sales|revenue)/.test(normalized) &&
    /(主因|要因|原因|理由|なぜ|driver|cause|why)/.test(normalized)
  ) {
    return true;
  }

  if (
    /(一時|一過性|継続|続|構造|temporary|transitory|recurring|sustain|continue)/.test(normalized) &&
    /(要因|原因|理由|影響|それ|その|これ|この|変化|driver|cause|factor|売上|利益率|margin)/.test(normalized)
  ) {
    return true;
  }

  return (
    (questionIntent === "margin_profitability" || questionIntent === "mda_summary") &&
    /(一時|一過性|継続|続|構造|temporary|transitory|recurring|sustain|continue)/.test(normalized)
  );
}

export function retryContextMode(retryReason: ChatFallbackReason): ChatContextMode {
  switch (retryReason) {
    case "no_sources":
    case "weak_grounding":
    case "low_quality_answer":
    case "invalid_source_id":
      return "expanded";
    case "schema_invalid":
    case "json_parse_failed":
    case "deterministic_repair":
      return "standard";
    case "gemini_timeout":
    case "gemini_api_error":
    case "metrics_only_insufficient":
      return "compact";
  }
}

export function shouldPreferDeterministicBusinessOverview(answer: string, usedRemoteModel: boolean): boolean {
  if (!usedRemoteModel) {
    return true;
  }

  return (
    answer === CONTEXT_UNAVAILABLE_ANSWER ||
    /売上高は|revenue|net sales|前年同期比|一般的な注意書き|案内文|材料としては弱め|選択された資料だけ|この資料だけ|会社固有の売上要因|製品・サービスの提供|製品やサービスの提供|商品販売|売上高を通じて/i.test(answer) ||
    /petrochemical|Compute\s*&\s*Networking|Graphics|MEMORY/i.test(answer) ||
    /主な収益源は.+事業による売上|主に.+売上を(?:上げ|得|稼)/.test(answer) ||
    /^(?:この会社|同社)?は?主に[^。]{2,40}(?:販売|製品|サービス|小売事業|事業)[^。]{0,30}(?:収益を得|儲けて|儲けています)|^主な収益源は[^。]{2,40}売上高です/.test(answer.trim()) ||
    /^主な収益源は[^。]{2,60}(?:販売|売上)です。?$/.test(answer.trim()) ||
    /^(?:この会社の)?主な収益源は[^。]{2,80}販売です。?$/.test(answer.trim()) ||
    /^(?:同社|[A-Z][A-Za-z .,&'-]+)?は?主に[^。]{2,60}売上を通じて収益を(?:上げ|得)ています。?$/.test(answer.trim()) ||
    /^[A-Z][A-Za-z .,&'-]+は主に[^。]{2,50}販売から収益を得ています。?$/.test(answer.trim()) ||
    /historically experienced higher net sales|forward-looking statements|available information|investor relations website/i.test(
      answer
    )
  );
}

export function shouldPreferDeterministicRevenueDrivers(
  answer: string,
  usedRemoteModel: boolean,
  fallbackReason?: ChatFallbackReason | null
): boolean {
  if (!usedRemoteModel) {
    return true;
  }

  return (
    fallbackReason === "low_quality_answer" ||
    /会社固有の売上要因までは(?:十分に)?(?:断定|特定|追いきれ)|売上以外の損益項目だけでは、売上要因として扱いません|確認すべき箇所は、経営陣による業績説明|次に見るなら、経営陣による業績説明/.test(answer)
  );
}

export function shouldPreferDeterministicMarginSnapshot(
  answer: string,
  usedRemoteModel: boolean,
  fallbackReason?: ChatFallbackReason | null
): boolean {
  if (!usedRemoteModel) {
    return true;
  }

  return (
    fallbackReason === "low_quality_answer" ||
    /具体的な(?:利益率)?要因は十分に特定できません|利益の動きは、費用・評価損益・税金の内訳確認が必要|判断には、コスト、構成、価格改定、営業費用、引当/.test(answer)
  );
}

export function fallbackReasonForNoSources(
  modelResponse: GeminiChatAnswer,
  contentMode: ChatContentMode
): ChatFallbackReason {
  if (modelResponse.fallbackReason) {
    return modelResponse.fallbackReason;
  }

  return contentMode === "metrics_only" ? "metrics_only_insufficient" : "no_sources";
}

export function fallbackReasonForMissingValidSourceIds(
  modelResponse: GeminiChatAnswer,
  contentMode: ChatContentMode
): ChatFallbackReason {
  if (modelResponse.sourceIds.length > 0) {
    return "invalid_source_id";
  }

  return fallbackReasonForNoSources(modelResponse, contentMode);
}

export function combineLlmUsage(
  first: GeminiInvocationUsage[] | undefined,
  second: GeminiInvocationUsage[] | undefined
): GeminiInvocationUsage[] | undefined {
  const combined = [...(first ?? []), ...(second ?? [])];
  return combined.length > 0 ? combined : undefined;
}
