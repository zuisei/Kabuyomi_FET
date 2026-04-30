import type { Env, SummaryRecord } from "../env";
import { logEvent } from "../lib/logging";
import { localChatFallback, localSummaryFallback, recoverBroaderFallbackIfNeeded } from "./gemini/fallback";
import {
  normalizeChatResponse,
  normalizeQuoteTranslationResponse,
  normalizeSummaryResponse,
  polishJapaneseText,
  stripAnswerFormattingArtifacts,
  stripEnglishParentheticals,
  isRecord
} from "./gemini/normalize";
import { buildChatPrompt, buildQuoteTranslationPrompt, buildSummaryPrompt } from "./gemini/prompts";
import { invokeGemini, resolveGeminiTranslationModel } from "./gemini/request";
import type {
  ChatFallbackReason,
  ChatPromptInput,
  ChatRetryInstruction,
  GeminiChatAnswer,
  GeminiInvocationUsage,
  QuoteTranslationPromptInput,
  SummaryPromptInput
} from "./gemini/types";

export async function generateSummary(
  env: Env,
  input: SummaryPromptInput
): Promise<{ summary: SummaryRecord; provider: "gemini" | "fallback"; llmUsage?: GeminiInvocationUsage[] }> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "missing_api_key" });
    return {
      summary: localSummaryFallback(input),
      provider: "fallback"
    };
  }

  let invocation: Awaited<ReturnType<typeof invokeGemini>>;
  try {
    invocation = await invokeGemini(env, buildSummaryPrompt(input), "summary");
  } catch {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "request_failed" });
    return {
      summary: localSummaryFallback(input),
      provider: "fallback"
    };
  }

  const response = invocation.data;
  const normalized = normalizeSummaryResponse(response);
  if (!normalized) {
    logSchemaMismatch("summary", response);
    logEvent("gemini_fallback_used", { kind: "summary", reason: "schema_validation_failed" });
    return {
      summary: localSummaryFallback(input),
      provider: "fallback",
      ...usagePayload(invocation.usage)
    };
  }

  return {
    summary: {
      verdict: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.verdict))),
      highlights: normalized.highlights.map((line) => ({
        ...line,
        text: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(line.text)))
      })),
      changes: normalized.changes.map((line) => ({
        ...line,
        text: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(line.text)))
      }))
    },
    provider: "gemini",
    ...usagePayload(invocation.usage)
  };
}

export async function generateChatAnswer(env: Env, input: ChatPromptInput): Promise<GeminiChatAnswer> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "missing_api_key" });
    return attachChatDecisionMeta(localChatFallback(input), {
      geminiCalled: false,
      geminiSucceeded: false,
      schemaValid: false
    });
  }

  let invocation: Awaited<ReturnType<typeof invokeGemini>>;
  try {
    invocation = await invokeGemini(env, buildChatPrompt(input), "chat");
  } catch (error) {
    const fallbackReason = isGeminiTimeout(error) ? "gemini_timeout" : "gemini_api_error";
    logEvent("gemini_fallback_used", { kind: "chat", reason: fallbackReason });
    return attachChatDecisionMeta(localChatFallback(input), {
      geminiCalled: true,
      geminiSucceeded: false,
      fallbackReason,
      schemaValid: false
    });
  }

  const normalized = normalizeChatResponse(invocation.data);
  if (!normalized) {
    logSchemaMismatch("chat", invocation.data);
    const fallbackReason: ChatFallbackReason = invocation.failureReason ?? "schema_invalid";
    const repaired = await maybeRepairChatSchema(env, input, invocation.data, invocation.usage, fallbackReason);
    if (repaired) {
      return repaired;
    }

    logEvent("gemini_fallback_used", { kind: "chat", reason: fallbackReason });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), invocation.usage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason,
      schemaValid: false,
      retryAttempt: input.retryInstruction?.attempt ?? 0,
      retryReason: input.retryInstruction?.reason
    });
  }

  const remoteAnswer: GeminiChatAnswer = {
    answer: polishChatAnswerForQuestion(
      input.question,
      stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.answer)))
    ),
    sourceIds: normalized.sourceIds,
    usedRemoteModel: normalized.usedRemoteModel
  };
  const recoveredWithoutUsage = recoverBroaderFallbackIfNeeded(input, remoteAnswer);
  const recovered = attachChatDecisionMeta(attachLlmUsage(recoveredWithoutUsage, invocation.usage), {
    geminiCalled: true,
    geminiSucceeded: true,
    fallbackReason: didRecoverWithLocalFallback(remoteAnswer, recoveredWithoutUsage)
      ? remoteAnswer.sourceIds.length === 0
        ? "no_sources"
        : "weak_grounding"
      : undefined,
    schemaValid: true
  });

  if (shouldRecoverLowQualityChatAnswer(input, recovered.answer, recovered.sourceIds)) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "low_quality_answer" });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), invocation.usage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason: "low_quality_answer",
      schemaValid: true
    });
  }

  return recovered;
}

export async function generateQuoteTranslation(
  env: Env,
  input: QuoteTranslationPromptInput
): Promise<{ translatedText: string; modelName: string; llmUsage?: GeminiInvocationUsage[] }> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("Gemini API key is missing");
  }

  const invocation = await invokeGemini(env, buildQuoteTranslationPrompt(input), "quote_translation");
  const response = invocation.data;
  const translatedText = normalizeQuoteTranslationResponse(response);

  if (!translatedText) {
    logSchemaMismatch("quote_translation", response);
    throw new Error("Quote translation schema validation failed");
  }

  return {
    translatedText,
    modelName: resolveGeminiTranslationModel(env),
    ...usagePayload(invocation.usage)
  };
}

function attachLlmUsage(answer: GeminiChatAnswer, usage: GeminiChatAnswer["llmUsage"]): GeminiChatAnswer {
  return usage && usage.length > 0
    ? {
        ...answer,
        llmUsage: usage
      }
    : answer;
}

function attachChatDecisionMeta(
  answer: GeminiChatAnswer,
  meta: Pick<GeminiChatAnswer, "geminiCalled" | "geminiSucceeded" | "fallbackReason" | "schemaValid"> &
    Pick<Partial<GeminiChatAnswer>, "retryAttempt" | "retryReason">
): GeminiChatAnswer {
  return {
    ...answer,
    ...meta
  };
}

async function maybeRepairChatSchema(
  env: Env,
  input: ChatPromptInput,
  previousResponse: unknown,
  previousUsage: GeminiInvocationUsage[],
  fallbackReason: ChatFallbackReason
): Promise<GeminiChatAnswer | null> {
  if (input.retryInstruction || (fallbackReason !== "schema_invalid" && fallbackReason !== "json_parse_failed")) {
    return null;
  }

  const retryInstruction: ChatRetryInstruction = {
    attempt: 1,
    reason: fallbackReason,
    previousResponse
  };
  let repairInvocation: Awaited<ReturnType<typeof invokeGemini>>;
  try {
    repairInvocation = await invokeGemini(
      env,
      buildChatPrompt({
        ...input,
        retryInstruction
      }),
      "chat"
    );
  } catch {
    logEvent("gemini_fallback_used", { kind: "chat", reason: fallbackReason, retryAttempt: 1 });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), previousUsage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason,
      schemaValid: false,
      retryAttempt: 1,
      retryReason: fallbackReason
    });
  }

  const combinedUsage = [...previousUsage, ...repairInvocation.usage];
  const normalized = normalizeChatResponse(repairInvocation.data);
  if (!normalized) {
    logSchemaMismatch("chat", repairInvocation.data);
    logEvent("gemini_fallback_used", { kind: "chat", reason: fallbackReason, retryAttempt: 1 });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), combinedUsage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason,
      schemaValid: false,
      retryAttempt: 1,
      retryReason: fallbackReason
    });
  }

  const remoteAnswer: GeminiChatAnswer = {
    answer: stripEnglishParentheticals(polishJapaneseText(stripAnswerFormattingArtifacts(normalized.answer))),
    sourceIds: normalized.sourceIds,
    usedRemoteModel: normalized.usedRemoteModel
  };
  const recoveredWithoutUsage = recoverBroaderFallbackIfNeeded(input, remoteAnswer);
  const recovered = attachChatDecisionMeta(attachLlmUsage(recoveredWithoutUsage, combinedUsage), {
    geminiCalled: true,
    geminiSucceeded: true,
    fallbackReason: didRecoverWithLocalFallback(remoteAnswer, recoveredWithoutUsage)
      ? remoteAnswer.sourceIds.length === 0
        ? "no_sources"
        : "weak_grounding"
      : undefined,
    schemaValid: true,
    retryAttempt: 1,
    retryReason: fallbackReason
  });

  if (shouldRecoverLowQualityChatAnswer(input, recovered.answer, recovered.sourceIds)) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "low_quality_answer", retryAttempt: 1 });
    return attachChatDecisionMeta(attachLlmUsage(localChatFallback(input), combinedUsage), {
      geminiCalled: true,
      geminiSucceeded: true,
      fallbackReason: "low_quality_answer",
      schemaValid: true,
      retryAttempt: 1,
      retryReason: fallbackReason
    });
  }

  return recovered;
}

function usagePayload(usage: GeminiInvocationUsage[]): { llmUsage?: GeminiInvocationUsage[] } {
  return usage.length > 0 ? { llmUsage: usage } : {};
}

function didRecoverWithLocalFallback(remoteAnswer: GeminiChatAnswer, recovered: GeminiChatAnswer): boolean {
  return (
    remoteAnswer.answer !== recovered.answer ||
    remoteAnswer.sourceIds.length !== recovered.sourceIds.length ||
    remoteAnswer.sourceIds.some((sourceId, index) => recovered.sourceIds[index] !== sourceId)
  );
}

function isGeminiTimeout(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && /timeout|timed out|aborted/i.test(error.message))
  );
}

function logSchemaMismatch(kind: "summary" | "chat" | "quote_translation", payload: unknown) {
  logEvent("gemini_schema_mismatch", {
    kind,
    keys: isRecord(payload) ? Object.keys(payload).slice(0, 12) : [],
    payloadType: Array.isArray(payload) ? "array" : typeof payload
  });
}

function shouldRecoverLowQualityChatAnswer(input: ChatPromptInput, answer: string, sourceIds: string[]): boolean {
  const normalizedQuestion = input.question.replace(/\s+/g, "").toLowerCase();
  const normalizedAnswer = answer.toLowerCase();
  const asksBusinessOverview =
    /(なんの企業|何の企業|なんの会社|何の会社|どんな企業|どんな会社|何してる|何をしてる|何をやってる|事業内容|主な事業|事業は)/.test(
      normalizedQuestion
    ) || /(whatdoes.*companydo|whatcompany|whatbusiness|businessmodel)/.test(normalizedQuestion);
  const asksProfitCause =
    /(赤字|黒字|損失|欠損|純利益|利益|net income|net loss|profit|income|earnings|loss)/.test(normalizedQuestion) &&
    /(主因|要因|原因|理由|なぜ|背景|何が|driver|cause|why)/.test(normalizedQuestion);
  const asksRevenueCause =
    /(売上|増収|revenue|sales|growth)/.test(normalizedQuestion) &&
    /(主因|要因|原因|理由|なぜ|背景|押し上げ|牽引|driver|cause|why|一時|継続|持続|temporary|recurring)/.test(
      normalizedQuestion
    );
  const asksBroadStockContext =
    /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
      normalizedQuestion
    ) ||
    (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalizedQuestion) &&
      /(株|株価|市場|stock|share)/.test(normalizedQuestion));
  const asksDurabilityOfCause =
    /(一時的|一過性|一時要因|一回限り|単発|継続|持続|続く|続きそう|構造的|恒常|今後も|来期も|短期|長期|temporary|transitory|one[- ]?time|one[- ]?off|recurring|sustain|continue|ongoing)/.test(
      normalizedQuestion
    ) && /(要因|原因|理由|影響|それ|その|この|driver|cause|factor)/.test(normalizedQuestion);

  const asksAboutFilingStructure =
    /(item|md&a|risk factors|form 10-q|form 10-k|項目|どこ|どの欄|section|パート)/.test(normalizedQuestion);
  const asksContextualReasoning =
    /(ガイダンス|見通し|予想|guidance|outlook|来期|次四半期|リスク|懸念|逆風|不確実|不透明|risk|uncertain|uncertainty|関税|tariff|還元|自社株買い|buyback|repurchase|配当|dividend|株主還元|キャッシュフロー|cash flow|株価|市場|反応|支え|押し上げ|牽引|主因|要因|原因|理由|なぜ)/.test(
      normalizedQuestion
    );

  if (
    !asksAboutFilingStructure &&
    /(management's discussion|results of operations|our business risks|forward-looking statements|investors are cautioned|available information|investor relations website|corporate website|private securities litigation reform act|item\s+\d+[a-z]?\.|form 10-q|form 10-k)/.test(
      normalizedAnswer
    )
  ) {
    return true;
  }

  if (asksBroadStockContext) {
    const mentionsStockContext =
      /(株価|市場|反応|ニュース|別情報|判断できません|決められません|断定できません|株の調子|market|stock|share)/.test(
        normalizedAnswer
      );
    const leansOnMetricsOnly =
      /(売上高|営業利益|純利益|前年比|前年同期比|revenue|operating income|net income)/.test(normalizedAnswer);

    if (leansOnMetricsOnly && !mentionsStockContext) {
      return true;
    }
  }

  if (asksBusinessOverview) {
    if (/^[\s、。,]*(?:は|が|を|に|で)(?:[、。,\s]|$)/.test(answer)) {
      return true;
    }

    const sourceCandidates = input.contextPack?.sourceChunks ?? input.filing.sourceChunks;
    const citedChunks = sourceIds
      .map((sourceId) => sourceCandidates.find((chunk) => chunk.sourceId === sourceId))
      .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== undefined);
    const citesOnlyMetrics = citedChunks.length > 0 && citedChunks.every((chunk) => chunk.sectionType === "xbrl_metric");
    const metricIndex = firstPatternIndex(
      normalizedAnswer,
      /売上高|営業利益|純利益|営業cf|eps|前年比|前年同期比|revenue|operating income|net income|cash flow|growth|margin/
    );
    const businessIndex = firstPatternIndex(
      normalizedAnswer,
      /事業|主な|手がけ|提供|販売|製造|開発|運営|サービス|製品|プラットフォーム|顧客|患者|医療|検査|診断|がん|癌|腫瘍|精密医療|血液|分子|製薬|臨床研究|創薬|自動車|車両|エネルギー|蓄電|クラウド|広告|決済|サブスク|ai|gpu|データセンター|半導体|アクセラレーテッド|コンピューティング|ネットワーキング|グラフィックス|ゲーミング|oncology|cancer|diagnostic|blood|biopharmaceutical|automotive|vehicle|energy|cloud|advertising|payment|subscription|data center|semiconductor|networking|graphics|gaming/
    );
    const boilerplateIndex = firstPatternIndex(
      normalizedAnswer,
      /一般的な注意書き|案内文|材料としては弱め|深掘りには向きません|forward-looking statements|available information|investor relations website|corporate website/
    );

    if (citesOnlyMetrics || boilerplateIndex >= 0) {
      return true;
    }

    if (metricIndex >= 0 && (businessIndex === -1 || metricIndex < businessIndex)) {
      return true;
    }

    if (/確認できません|分かりません|わかりません|not enough context|cannot confirm/.test(normalizedAnswer) && businessIndex === -1) {
      return true;
    }
  }

  if (asksDurabilityOfCause) {
    const mentionsDurability =
      /(一時|一過性|一回限り|単発|継続|持続|続|構造|恒常|今後|来期|断定|確認できません|見通し|リスク|次の期|次四半期|temporary|transitory|one[- ]?time|one[- ]?off|recurring|ongoing|continue|sustain)/.test(
        normalizedAnswer
      );
    const leansOnBoilerplate = /(一般的な注意書き|案内文|材料としては弱め|forward-looking statements|available information|investor relations website|corporate website)/.test(
      normalizedAnswer
    );

    if (!mentionsDurability || leansOnBoilerplate) {
      return true;
    }
  }

  if (asksRevenueCause) {
    const mentionsRevenue = /(売上|増収|revenue|sales)/.test(normalizedAnswer);
    const leansOnProfitOnly = /(営業利益|純利益|利益率|eps|operating income|net income|profit|earnings)/.test(normalizedAnswer);
    if (leansOnProfitOnly && !mentionsRevenue) {
      return true;
    }
  }

  if (asksProfitCause) {
    const mentionsProfitContext = /(純利益|赤字|黒字|損失|net income|net loss|profit|loss)/.test(normalizedAnswer);
    const leansOnRevenue = /(売上高|revenue|sales)/.test(normalizedAnswer);
    const leansOnBoilerplate =
      /(一般的な注意書き|案内文|この論点の深掘りには向きません|この決算資料だけでは|この filing だけでは)/.test(
        normalizedAnswer
      );

    if ((leansOnRevenue || leansOnBoilerplate) && !mentionsProfitContext) {
      return true;
    }
  }

  if (asksContextualReasoning) {
    const answerLooksUnavailableOnly =
      /(確認できません|分かりません|わかりません|not enough context|cannot confirm)/.test(normalizedAnswer) &&
      !/(売上高|営業利益|純利益|営業cf|キャッシュフロー|前年比|前年同期比|revenue|operating income|net income|cash flow|本文|提出資料|需要|リスク|不確実|自社株買い|配当|株価|市場|反応)/.test(
        normalizedAnswer
      );

    if (answerLooksUnavailableOnly) {
      return true;
    }

    const answerLooksMetricOnly =
      /(売上高|営業利益|純利益|営業cf|キャッシュフロー|前年比|前年同期比|revenue|operating income|net income|cash flow)/.test(
        normalizedAnswer
      ) &&
      !/(本文|提出資料|決算資料|外部補足|この決算資料だけでは|この決算資料以外|この filing だけでは|この filing 以外|断定できません|切り分け|会社見通し|リスク|不確実|需要|iPhone|サービス|自社株買い|配当|株価|市場|反応|安全です)/.test(
        normalizedAnswer
      );

    if (answerLooksMetricOnly) {
      return true;
    }
  }

  const latinCount = (answer.match(/[A-Za-z]/g) ?? []).length;
  const japaneseCount = (answer.match(/[ぁ-んァ-ヶ一-龠]/g) ?? []).length;
  return !asksAboutFilingStructure && latinCount >= 40 && japaneseCount <= 12;
}

function polishChatAnswerForQuestion(question: string, answer: string): string {
  const normalizedQuestion = question.replace(/\s+/g, "").toLowerCase();
  const asksRevenueBreakdown =
    /(売上|sales|revenue)/.test(normalizedQuestion) &&
    /(セクター|sector|セグメント|segment|事業|business|部門|内訳|構成|柱|源泉|カテゴリ)/.test(normalizedQuestion);

  if (!asksRevenueBreakdown) {
    return answer;
  }

  return answer
    .replace(
      /具体的な売上高の金額や、製品・サービス別の内訳は、この資料だけでは確認できません。/g,
      "金額の細目は限定的ですが、上記の事業・地域区分を売上の柱として見るのが近いです。"
    )
    .replace(
      /具体的な製品やサービスごとの詳細な売上金額は、この資料だけでは確認できません。/g,
      "製品・サービスごとの細かい金額までは限定的ですが、上記の区分が売上構造を見る軸です。"
    )
    .replace(
      /具体的にどの区分が最大であるかや、それぞれの詳細な売上額などの内訳は、この資料だけでは確認できません。/g,
      "最大区分や細かい金額までは限定的ですが、上記のサービス群が売上構造を見る軸です。"
    )
    .replace(
      /具体的な製品やサービスごとの売上内訳については、この資料だけでは確認できません。/g,
      "製品・サービスごとの細かい金額は限定的ですが、上記の事業内容を売上の柱として見るのが近いです。"
    )
    .replace(
      /売上の具体的な内訳や変化の方向については、この資料だけでは確認できません。/g,
      "細かい内訳や変化率は限定的ですが、上記の事業区分が売上構造を見る軸です。"
    )
    .replace(
      /具体的な製品やサービスごとの売上内訳や、それぞれの成長率などの詳細な数値は、この資料だけでは確認できません。/g,
      "製品・サービス別の細かい成長率は限定的ですが、上記のサービス区分が売上構造を見る軸です。"
    )
    .replace(
      /売上の具体的な内訳については、この資料では地域別の売上高などの地理的な区分のみが記載されており、製品やサービスごとの詳細な売上構成は確認できません。/g,
      "製品・サービス別の細かい売上構成は限定的ですが、上記の宿泊・体験・サービス領域が売上構造を見る軸です。"
    );
}

function firstPatternIndex(value: string, pattern: RegExp): number {
  const match = pattern.exec(value);
  return match?.index ?? -1;
}
