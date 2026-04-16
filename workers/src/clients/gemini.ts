import type {
  Env,
  FilingCacheRecord,
  MetricSnapshot,
  SourceChunkRecord,
  SummaryRecord
} from "../env";
import { ChatModelResponseSchema, SummaryResponseSchema } from "../lib/contracts";
import { logEvent } from "../lib/logging";

const DEFAULT_GEMINI_TIMEOUT_MS = 12_000;

interface SummaryPromptInput {
  filingKey: string;
  ticker: string;
  companyName: string;
  formType: "10-K" | "10-Q";
  filedAt: string;
  periodOfReport: string;
  metrics: MetricSnapshot[];
  sourceChunks: SourceChunkRecord[];
}

interface ChatPromptInput {
  filing: FilingCacheRecord;
  question: string;
}

export async function generateSummary(env: Env, input: SummaryPromptInput): Promise<SummaryRecord> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "missing_api_key" });
    return localSummaryFallback(input);
  }

  const prompt = [
    "You are a source-bound assistant for a Japanese SEC filing reader.",
    "Use only the provided source chunks and metric facts.",
    "Never mention stock prices, analyst estimates, or investment advice.",
    "Write every sentence in natural Japanese.",
    "Do not answer in English except for company names, product names, SEC form names, or sourceIds.",
    "Translate finance and supply-chain terminology into Japanese whenever a natural Japanese expression exists.",
    "Avoid parenthetical English unless it is necessary to disambiguate a proper noun or official product name.",
    "Return JSON with keys verdict, highlights, changes.",
    "Every highlight and change must include one or more sourceIds.",
    "",
    `Company: ${input.companyName} (${input.ticker})`,
    `Form: ${input.formType}`,
    `Filed At: ${input.filedAt}`,
    `Period Of Report: ${input.periodOfReport}`,
    "",
    "Metrics:",
    JSON.stringify(input.metrics),
    "",
    "Sources:",
    JSON.stringify(input.sourceChunks)
  ].join("\n");

  let response: unknown;
  try {
    response = await invokeGemini(env, prompt, "summary");
  } catch {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "request_failed" });
    return localSummaryFallback(input);
  }
  const normalized = normalizeSummaryResponse(response);
  if (!normalized) {
    logSchemaMismatch("summary", response);
    logEvent("gemini_fallback_used", { kind: "summary", reason: "schema_validation_failed" });
    return localSummaryFallback(input);
  }
  return {
    verdict: stripEnglishParentheticals(polishJapaneseText(normalized.verdict)),
    highlights: normalized.highlights.map((line) => ({
      ...line,
      text: stripEnglishParentheticals(polishJapaneseText(line.text))
    })),
    changes: normalized.changes.map((line) => ({
      ...line,
      text: stripEnglishParentheticals(polishJapaneseText(line.text))
    }))
  };
}

export async function generateChatAnswer(
  env: Env,
  input: ChatPromptInput
): Promise<{ answer: string; sourceIds: string[] }> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "missing_api_key" });
    return localChatFallback(input);
  }

  const prompt = [
    "You answer user questions strictly from the provided SEC filing context.",
    "If no material part of the answer is supported by the provided context, reply with: この filing の提供コンテキストでは確認できません。",
    "Never provide investment advice, price targets, or analyst comparisons.",
    "Write the answer in natural Japanese.",
    "Assume the user may be new to U.S. stocks and does not want to read English filings directly.",
    "Use simple Japanese first. Prefer everyday words over investor jargon whenever possible.",
    "Do not answer in English except for company names, product names, SEC form names, or sourceIds.",
    "Translate finance and supply-chain terminology into Japanese whenever a natural Japanese expression exists.",
    "If jargon is unavoidable, explain it briefly in plain Japanese in the same sentence.",
    "Avoid abbreviations like YoY, MD&A, capital allocation, or guidance unless you explain them in Japanese.",
    "Avoid parenthetical English unless it is necessary to disambiguate a proper noun or official product name.",
    "Do not just copy or lightly paraphrase a source chunk.",
    "Many users are investors. For investor-style questions, prioritize what investors usually care about: guidance and outlook, demand trends, segment or regional drivers, pricing and margins, cash-flow quality, capital allocation such as buybacks or dividends, and key risks.",
    "For analytical questions, answer in 3 to 5 short sentences: the plain-language takeaway first, then the most relevant filing-backed facts, then what to watch next, then any remaining limitation.",
    "If the exact question is broader than the filing but related facts exist, do not refuse immediately. Answer with the closest supported facts from the filing, then state what remains outside the filing.",
    "If the user asks about a driver, cause, or contributor but the provided support is only a metric, explain the observed change and clearly state that the driver cannot be isolated from that metric alone.",
    "If the user asks why the stock moved or what investors want to know, distinguish backward-looking results from forward-looking expectations.",
    "If the answer is only partially supported, say what is supported and what is still not confirmable from this filing context.",
    "Every supported answer must cite at least one SEC filing sourceId from the provided Sources list.",
    "Prefer concrete numbers such as YoY changes whenever they exist in the provided context.",
    "Return JSON with keys answer and sourceIds.",
    "Do not cite sourceIds that do not exist.",
    "",
    `Question: ${input.question}`,
    "",
    "Filing metadata:",
    JSON.stringify({
      filingKey: input.filing.filingKey,
      companyName: input.filing.companyName,
      ticker: input.filing.ticker,
      formType: input.filing.formType,
      filedAt: input.filing.filedAt,
      periodOfReport: input.filing.periodOfReport
    }),
    "",
    "Sources:",
    JSON.stringify(input.filing.sourceChunks)
  ].join("\n");

  let response: unknown;
  try {
    response = await invokeGemini(env, prompt, "chat");
  } catch {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "request_failed" });
    return localChatFallback(input);
  }
  const normalized = normalizeChatResponse(response);
  if (!normalized) {
    logSchemaMismatch("chat", response);
    logEvent("gemini_fallback_used", { kind: "chat", reason: "schema_validation_failed" });
    return localChatFallback(input);
  }
  return {
    ...recoverBroaderFallbackIfNeeded(input, {
      answer: stripEnglishParentheticals(polishJapaneseText(normalized.answer)),
      sourceIds: normalized.sourceIds
    })
  };
}

async function invokeGemini(env: Env, prompt: string, kind: "summary" | "chat"): Promise<unknown> {
  const model = resolveGeminiModel(env);
  const timeoutMs = resolveGeminiTimeoutMs(env);
  const responseJsonSchema = kind === "summary" ? summaryResponseJsonSchema() : chatResponseJsonSchema();
  const attempts = [
    { includeSchema: true, generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseJsonSchema } },
    { includeSchema: false, generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }
  ];

  for (const [index, attempt] of attempts.entries()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;

    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": env.GEMINI_API_KEY ?? ""
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: attempt.generationConfig
          }),
          signal: controller.signal
        }
      );
    } catch (error) {
      clearTimeout(timeout);
      const timedOut =
        (error instanceof Error && error.name === "AbortError") ||
        (error instanceof DOMException && error.name === "AbortError");
      logEvent("gemini_request_failed", {
        kind,
        model,
        includeSchema: attempt.includeSchema,
        timeoutMs,
        reason: timedOut ? "timeout" : "network_error"
      });
      if (attempts[index + 1]) {
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyPreview = (await response.text()).slice(0, 240);
      logEvent("gemini_request_failed", {
        kind,
        model,
        status: response.status,
        includeSchema: attempt.includeSchema,
        bodyPreview
      });
      if (attempt.includeSchema && attempts[index + 1]) {
        continue;
      }
      throw new Error(`Gemini request failed (${response.status})`);
    }

    logEvent("gemini_request_succeeded", {
      kind,
      model,
      status: response.status,
      includeSchema: attempt.includeSchema
    });

  const payload = await response.json<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>();
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    logEvent("gemini_response_preview", {
      kind,
      model,
      includeSchema: attempt.includeSchema,
      textPreview: text.slice(0, 240)
    });

    try {
      return parseJsonishText(text);
    } catch {
      logEvent("gemini_invalid_response", { kind, includeSchema: attempt.includeSchema });
      if (attempt.includeSchema && attempts[index + 1]) {
        continue;
      }
      return {};
    }
  }

  return {};
}

function resolveGeminiModel(env: Env): string {
  const raw = env.GEMINI_MODEL?.trim();
  if (!raw) {
    return "gemini-2.5-flash";
  }

  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function resolveGeminiTimeoutMs(env: Env): number {
  const parsed = Number.parseInt(env.GEMINI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GEMINI_TIMEOUT_MS;
}

function parseJsonishText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1]);
  }

  return JSON.parse(trimmed);
}

function normalizeSummaryResponse(payload: unknown): SummaryRecord | null {
  const parsed = SummaryResponseSchema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const verdict = firstString(payload.verdict, payload.conclusion, payload.summary, payload.headline);
  const highlights = normalizeSummaryLines(payload.highlights);
  const changes = normalizeSummaryLines(payload.changes);

  const normalized = {
    verdict,
    highlights,
    changes
  };

  const normalizedParsed = SummaryResponseSchema.safeParse(normalized);
  return normalizedParsed.success ? normalizedParsed.data : null;
}

function normalizeChatResponse(payload: unknown): { answer: string; sourceIds: string[] } | null {
  const parsed = ChatModelResponseSchema.safeParse(payload);
  if (parsed.success) {
    return parsed.data;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const answer = firstString(payload.answer, payload.text, payload.response);
  const sourceIds = normalizeSourceIds(payload.sourceIds ?? payload.sources ?? payload.citations ?? payload.sourceId);
  const normalized = { answer, sourceIds };
  const normalizedParsed = ChatModelResponseSchema.safeParse(normalized);
  return normalizedParsed.success ? normalizedParsed.data : null;
}

function normalizeSummaryLines(value: unknown): Array<{ text: string; sourceIds: string[] }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [];
    }

    if (!isRecord(item)) {
      return [];
    }

    const text = firstString(item.text, item.summary, item.change, item.highlight);
    const sourceIds = normalizeSourceIds(item.sourceIds ?? item.sources ?? item.citations ?? item.sourceId);
    if (!text || sourceIds.length === 0) {
      return [];
    }

    return [{ text, sourceIds }];
  });
}

function normalizeSourceIds(value: unknown): string[] {
  if (typeof value === "string") {
    return value ? [value] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item === "string") {
      return item ? [item] : [];
    }

    if (!isRecord(item)) {
      return [];
    }

    return firstString(item.sourceId, item.id, item.source_id) ? [firstString(item.sourceId, item.id, item.source_id)!] : [];
  });
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function logSchemaMismatch(kind: "summary" | "chat", payload: unknown) {
  logEvent("gemini_schema_mismatch", {
    kind,
    keys: isRecord(payload) ? Object.keys(payload).slice(0, 12) : [],
    payloadType: Array.isArray(payload) ? "array" : typeof payload
  });
}

function summaryResponseJsonSchema() {
  return {
    type: "object",
    properties: {
      verdict: { type: "string" },
      highlights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            sourceIds: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["text", "sourceIds"]
        }
      },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            sourceIds: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["text", "sourceIds"]
        }
      }
    },
    required: ["verdict", "highlights", "changes"]
  };
}

function chatResponseJsonSchema() {
  return {
    type: "object",
    properties: {
      answer: { type: "string" },
      sourceIds: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["answer", "sourceIds"]
  };
}

function localSummaryFallback(input: SummaryPromptInput): SummaryRecord {
  const highlightSources = input.sourceChunks.filter((chunk) => chunk.sectionType === "md_a").slice(0, 2);
  const changeSources = input.sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric").slice(0, 2);
  const headlineMetric = input.metrics.find((metric) => metric.yoyPercent !== undefined) ?? input.metrics[0];
  const verdict = headlineMetric
    ? `${input.companyName}の最新${input.formType}では、${metricLabel(
        headlineMetric.logicalName
      )}を中心に提出資料ベースで確認できます。`
    : `${input.companyName}の最新${input.formType}を日本語で確認できます。`;

  return {
    verdict,
    highlights: highlightSources.map((source) => ({
      text: source.text.slice(0, 120).trim(),
      sourceIds: [source.sourceId]
    })),
    changes: changeSources.map((source) => ({
      text: source.text.slice(0, 120).trim(),
      sourceIds: [source.sourceId]
    }))
  };
}

function localChatFallback(input: ChatPromptInput): { answer: string; sourceIds: string[] } {
  const profile = analyzeQuestion(input.question);
  const questionTerms = extractQuestionTerms(input.question, profile);

  const scored = input.filing.sourceChunks
    .map((source) => ({
      source,
      score: scoreSourceChunk(input.filing, source, profile, questionTerms)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.source.sortOrder - right.source.sortOrder;
    });

  const matches = scored.filter((item) => item.score > 0);
  if (matches.length === 0) {
    const closestFallback = buildClosestContextFallbackAnswer(input.filing, profile);
    if (closestFallback) {
      return closestFallback;
    }

    return {
      answer: "この filing の提供コンテキストでは確認できません。",
      sourceIds: input.filing.sourceChunks.slice(0, 1).map((source) => source.sourceId)
    };
  }

  const metricFallback = buildMetricFallbackAnswer(input.filing, profile, matches.map((item) => item.source));
  if (metricFallback) {
    return metricFallback;
  }

  const narrativeFallback = buildNarrativeFallbackAnswer(profile, matches.map((item) => item.source));
  if (narrativeFallback) {
    return narrativeFallback;
  }

  const best = matches[0].source;
  return {
    answer: `提出資料では「${truncateExcerpt(best.text, 150)}」と触れています。少なくとも、この論点に関係する記述はここです。`,
    sourceIds: [best.sourceId]
  };
}

function recoverBroaderFallbackIfNeeded(
  input: ChatPromptInput,
  response: { answer: string; sourceIds: string[] }
): { answer: string; sourceIds: string[] } {
  if (response.answer !== "この filing の提供コンテキストでは確認できません。" || response.sourceIds.length > 0) {
    const profile = analyzeQuestion(input.question);
    if (shouldRecoverFromWeakNarrative(input.filing, profile, response.sourceIds)) {
      return localChatFallback(input);
    }
    return response;
  }

  const fallback = localChatFallback(input);
  if (fallback.answer === "この filing の提供コンテキストでは確認できません。") {
    return response;
  }

  return fallback;
}

type QuestionProfile = {
  normalized: string;
  asksCause: boolean;
  asksChange: boolean;
  asksDetail: boolean;
  asksImpact: boolean;
  asksGuidance: boolean;
  asksMarketReaction: boolean;
  asksCapitalAllocation: boolean;
  asksRevenue: boolean;
  asksProfitability: boolean;
  asksProfit: boolean;
  asksCashFlow: boolean;
  asksRisk: boolean;
  asksTariff: boolean;
  asksRegion: boolean;
  asksProductMix: boolean;
  asksStockPrice: boolean;
  asksRecommendation: boolean;
  asksForecast: boolean;
};

function analyzeQuestion(question: string): QuestionProfile {
  const normalized = question.replace(/\s+/g, "").toLowerCase();

  return {
    normalized,
    asksCause: /(主因|要因|理由|なぜ|支え|ドライバ|牽引)/.test(normalized),
    asksChange: /(変化|推移|どう|どこ|何が|増え|減っ|伸び|鈍化|改善|悪化|動き)/.test(normalized),
    asksDetail: /(詳しく|詳細|内訳|背景|深掘り)/.test(normalized),
    asksImpact: /(影響|インパクト|重し|追い風)/.test(normalized),
    asksGuidance: /(ガイダンス|見通し|予想|guidance|outlook|来期|次四半期|通期|下期)/.test(normalized),
    asksMarketReaction: /(株価|市場|反応|好感|嫌気|織り込|織込|shareprice|stockprice|marketreaction)/.test(normalized),
    asksCapitalAllocation: /(還元|自社株買い|buyback|repurchase|配当|dividend|capitalallocation|株主還元)/.test(
      normalized
    ),
    asksRevenue: /(売上|sales|revenue)/.test(normalized),
    asksProfitability: /(利益率|マージン|採算|粗利)/.test(normalized),
    asksProfit: /(利益|純利益|営業利益|eps)/.test(normalized),
    asksCashFlow: /(キャッシュフロー|cf|cashflow|cash flow|現金|お金.*稼|稼げてる)/.test(normalized),
    asksRisk: /(リスク|懸念|警戒|逆風|不確実|不透明)/.test(normalized),
    asksTariff: /(関税|tariff)/.test(normalized),
    asksRegion: /(地域|国別|中国|米州|欧州|アジア|japan|china|europe)/.test(normalized),
    asksProductMix: /(製品|サービス|iphone|mac|ipad|wearables|mix)/.test(normalized),
    asksStockPrice: /(株価|shareprice|stockprice|price target|目標株価)/.test(normalized),
    asksRecommendation: /(買いか|売りか|買うべき|売るべき|おすすめ|投資判断)/.test(normalized),
    asksForecast: /(今後|見通し|予想|guidance|来期|次四半期|outlook)/.test(normalized)
  };
}

function extractQuestionTerms(question: string, profile?: QuestionProfile): string[] {
  const normalized = question.toLowerCase().trim();
  const whitespaceTerms = normalized
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{Letter}\p{Number}]/gu, ""))
    .filter((term) => term.length >= 2);

  if (whitespaceTerms.length > 1) {
    return whitespaceTerms;
  }

  const compact = normalized.replace(/[\s。、，,.!?！？:："'“”‘’()\[\]{}]/gu, "");
  const fragments = new Set<string>();

  for (let index = 0; index < compact.length; index += 1) {
    for (let size = 2; size <= 4; size += 1) {
      const fragment = compact.slice(index, index + size);
      if (fragment.length === size) {
        fragments.add(fragment);
      }
    }
  }

  const terms = new Set<string>([...fragments, ...whitespaceTerms]);
  const effectiveProfile = profile ?? analyzeQuestion(question);
  for (const alias of additionalQuestionTerms(effectiveProfile)) {
    terms.add(alias);
  }

  return [...terms];
}

function additionalQuestionTerms(profile: QuestionProfile): string[] {
  const aliases = new Set<string>();

  if (profile.asksRevenue) {
    aliases.add("売上高");
    aliases.add("revenue");
    aliases.add("sales");
  }

  if (profile.asksProfitability) {
    aliases.add("利益率");
    aliases.add("margin");
    aliases.add("gross margin");
    aliases.add("operating margin");
  }

  if (profile.asksProfit) {
    aliases.add("営業利益");
    aliases.add("純利益");
    aliases.add("net income");
    aliases.add("operating income");
    aliases.add("eps");
  }

  if (profile.asksCashFlow) {
    aliases.add("営業cf");
    aliases.add("operating cash flow");
    aliases.add("cash flow");
  }

  if (profile.asksGuidance) {
    aliases.add("guidance");
    aliases.add("outlook");
    aliases.add("forecast");
    aliases.add("expect");
  }

  if (profile.asksTariff) {
    aliases.add("tariff");
    aliases.add("tariffs");
  }

  if (profile.asksRisk) {
    aliases.add("risk");
    aliases.add("adverse");
  }

  if (profile.asksImpact) {
    aliases.add("impact");
    aliases.add("effects");
  }

  if (profile.asksMarketReaction) {
    aliases.add("market reaction");
    aliases.add("shares");
    aliases.add("sentiment");
  }

  if (profile.asksRegion) {
    aliases.add("regional");
    aliases.add("geographic");
    aliases.add("greater china");
    aliases.add("europe");
    aliases.add("japan");
  }

  if (profile.asksProductMix) {
    aliases.add("services");
    aliases.add("service");
    aliases.add("iphone");
    aliases.add("mac");
    aliases.add("ipad");
    aliases.add("wearables");
  }

  if (profile.asksCapitalAllocation) {
    aliases.add("buyback");
    aliases.add("share repurchase");
    aliases.add("dividend");
    aliases.add("capital allocation");
    aliases.add("liquidity");
  }

  return [...aliases];
}

function scoreSourceChunk(
  filing: FilingCacheRecord,
  source: SourceChunkRecord,
  profile: QuestionProfile,
  questionTerms: string[]
): number {
  const haystacks = [
    source.text.toLowerCase(),
    source.sectionTitle.toLowerCase(),
    source.sourceLabel.toLowerCase(),
    source.tagName?.toLowerCase() ?? ""
  ];

  let score = questionTerms.reduce(
    (sum, term) => sum + (haystacks.some((haystack) => haystack.includes(term)) ? 1 : 0),
    0
  );

  const relevantMetric = findRelevantMetric(filing, profile);
  if (relevantMetric && source.sectionType === "xbrl_metric" && source.tagName === relevantMetric.tagUsed) {
    score += 3;
  }

  if (
    source.sectionType === "md_a" &&
    (profile.asksCause ||
      profile.asksImpact ||
      profile.asksRisk ||
      profile.asksGuidance ||
      profile.asksCapitalAllocation ||
      profile.asksMarketReaction)
  ) {
    score += 1;
  }

  return score;
}

function buildMetricFallbackAnswer(
  filing: FilingCacheRecord,
  profile: QuestionProfile,
  sources: SourceChunkRecord[]
): { answer: string; sourceIds: string[] } | null {
  const metric = findRelevantMetric(filing, profile);
  if (!metric) {
    return null;
  }

  const metricSource = sources.find(
    (source) => source.sectionType === "xbrl_metric" && source.tagName === metric.tagUsed
  ) ?? filing.sourceChunks.find((source) => source.sectionType === "xbrl_metric" && source.tagName === metric.tagUsed);

  if (!metricSource) {
    return null;
  }

  const supportingNarrative = selectSupportingNarrative(filing, profile, sources) ?? selectFallbackNarrative(filing, profile);
  const needsContextLead =
    profile.asksStockPrice ||
    profile.asksRecommendation ||
    profile.asksMarketReaction ||
    profile.asksForecast ||
    profile.asksGuidance ||
    profile.asksCapitalAllocation;
  const needsContextTail =
    profile.asksStockPrice ||
    profile.asksRecommendation ||
    profile.asksMarketReaction ||
    profile.asksForecast ||
    profile.asksGuidance;
  const answerParts = [buildMetricObservation(metric)];
  const sourceIds = [metricSource.sourceId];

  if (needsContextLead) {
    answerParts.unshift(buildClosestContextLead(profile));
  }

  if (supportingNarrative) {
    sourceIds.push(supportingNarrative.sourceId);
    if (profile.asksTariff) {
      answerParts.push(buildTariffNarrativeSentence(supportingNarrative));
    } else {
      answerParts.push(`関連記述では「${truncateExcerpt(supportingNarrative.text, 110)}」と触れています。`);
    }
    if (profile.asksMarketReaction || profile.asksGuidance || profile.asksCapitalAllocation) {
      answerParts.push(buildMetricLimitation(metric, profile));
    }
  } else if (
    profile.asksCause ||
    profile.asksImpact ||
    profile.asksDetail ||
    profile.asksMarketReaction ||
    profile.asksGuidance ||
    profile.asksCapitalAllocation
  ) {
    answerParts.push(buildMetricLimitation(metric, profile));
  }

  if (needsContextTail) {
    answerParts.push(buildClosestContextLimitation(profile));
  }

  return {
    answer: answerParts.join(" "),
    sourceIds: [...new Set(sourceIds)]
  };
}

function buildClosestContextFallbackAnswer(
  filing: FilingCacheRecord,
  profile: QuestionProfile
): { answer: string; sourceIds: string[] } | null {
  const metric = selectFallbackMetric(filing, profile);
  const narrative = selectFallbackNarrative(filing, profile);
  const sourceIds = [metric ? findMetricSourceIdByTag(filing, metric.tagUsed) : undefined, narrative?.sourceId]
    .filter((value): value is string => Boolean(value));

  if (sourceIds.length === 0) {
    return null;
  }

  const answerParts = [buildClosestContextLead(profile)];

  if (metric) {
    answerParts.push(`提出資料でまず確認できるのは、${buildMetricObservation(metric)}`);
  }

  if (narrative) {
    answerParts.push(`関連記述では「${truncateExcerpt(polishJapaneseText(narrative.text), 120)}」と触れています。`);
  }

  answerParts.push(buildClosestContextLimitation(profile));

  return {
    answer: answerParts.join(" "),
    sourceIds: [...new Set(sourceIds)]
  };
}

function buildNarrativeFallbackAnswer(
  profile: QuestionProfile,
  sources: SourceChunkRecord[]
): { answer: string; sourceIds: string[] } | null {
  const narrative = sources.find((source) => source.sectionType === "md_a");
  if (!narrative) {
    return null;
  }

  if (profile.asksTariff) {
    return {
      answer: buildTariffNarrativeSentence(narrative),
      sourceIds: [narrative.sourceId]
    };
  }

  return {
    answer: `提出資料では「${truncateExcerpt(narrative.text, 150)}」と説明しています。少なくとも、この論点に関する根拠はこの記述です。`,
    sourceIds: [narrative.sourceId]
  };
}

function findRelevantMetric(
  filing: FilingCacheRecord,
  profile: QuestionProfile
): MetricSnapshot | undefined {
  if (profile.asksRevenue) {
    return filing.metrics.find((metric) => metric.logicalName === "revenue");
  }

  if (profile.asksProfitability) {
    return filing.metrics.find((metric) => metric.logicalName === "operatingIncome")
      ?? filing.metrics.find((metric) => metric.logicalName === "netIncome");
  }

  if (profile.asksCashFlow) {
    return filing.metrics.find((metric) => metric.logicalName === "operatingCashFlow");
  }

  if (profile.asksCapitalAllocation) {
    return filing.metrics.find((metric) => metric.logicalName === "operatingCashFlow")
      ?? filing.metrics.find((metric) => metric.logicalName === "netIncome");
  }

  if (profile.asksGuidance || profile.asksMarketReaction) {
    return filing.metrics.find((metric) => metric.logicalName === "revenue")
      ?? filing.metrics.find((metric) => metric.logicalName === "operatingIncome");
  }

  if (profile.asksProfit) {
    return filing.metrics.find((metric) => metric.logicalName === "operatingIncome")
      ?? filing.metrics.find((metric) => metric.logicalName === "netIncome")
      ?? filing.metrics.find((metric) => metric.logicalName === "epsBasic");
  }

  return undefined;
}

function selectFallbackMetric(filing: FilingCacheRecord, profile: QuestionProfile): MetricSnapshot | undefined {
  if (profile.asksCapitalAllocation) {
    return filing.metrics.find((metric) => metric.logicalName === "operatingCashFlow" && metric.yoyPercent !== undefined)
      ?? filing.metrics.find((metric) => metric.logicalName === "operatingCashFlow")
      ?? filing.metrics.find((metric) => metric.logicalName === "netIncome" && metric.yoyPercent !== undefined);
  }

  if (profile.asksProfitability) {
    return filing.metrics.find((metric) => metric.logicalName === "operatingIncome" && metric.yoyPercent !== undefined)
      ?? filing.metrics.find((metric) => metric.logicalName === "netIncome" && metric.yoyPercent !== undefined);
  }

  return filing.metrics.find((metric) => metric.logicalName === "revenue" && metric.yoyPercent !== undefined)
    ?? filing.metrics.find((metric) => metric.logicalName === "operatingIncome" && metric.yoyPercent !== undefined)
    ?? filing.metrics.find((metric) => metric.logicalName === "netIncome" && metric.yoyPercent !== undefined)
    ?? filing.metrics.find((metric) => metric.yoyPercent !== undefined)
    ?? filing.metrics[0];
}

function selectFallbackNarrative(
  filing: FilingCacheRecord,
  profile: QuestionProfile
): SourceChunkRecord | undefined {
  if (profile.asksRevenue && (profile.asksCause || profile.asksChange || profile.asksRegion || profile.asksProductMix)) {
    return findNarrativeChunk(
      filing.sourceChunks,
      (chunk) =>
        chunk.sectionType === "md_a" &&
        /higher net sales|net sales increased|primarily due to|due to higher net sales|iphone|services|greater china|americas|europe|japan|rest of asia pacific/i.test(
          chunk.text
        )
    ) ?? filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a");
  }

  if (profile.asksTariff) {
    return findNarrativeChunk(filing.sourceChunks, (chunk) => chunk.sectionType === "md_a" && /tariff|関税/i.test(chunk.text));
  }

  if (profile.asksGuidance) {
    return (
      findNarrativeChunk(
        filing.sourceChunks,
        (chunk) => chunk.sectionType === "md_a" && /guidance|outlook|expect|demand|pipeline|pricing|margin/i.test(chunk.text)
      ) ?? filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a")
    );
  }

  if (profile.asksCapitalAllocation) {
    return (
      findNarrativeChunk(
        filing.sourceChunks,
        (chunk) =>
          chunk.sectionType === "md_a" &&
          /dividend|share repurchase|buyback|repurchase|capital allocation|liquidity|cash|debt/i.test(chunk.text)
      ) ?? filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a")
    );
  }

  if (profile.asksMarketReaction) {
    return (
      findNarrativeChunk(
        filing.sourceChunks,
        (chunk) =>
          chunk.sectionType === "md_a" && /demand|pricing|margin|guidance|outlook|market|macro|china|services|ai/i.test(chunk.text)
      ) ?? filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a")
    );
  }

  if (profile.asksRisk) {
    return (
      findNarrativeChunk(
        filing.sourceChunks,
        (chunk) => chunk.sectionType === "md_a" && /risk|adverse|懸念|逆風/i.test(chunk.text)
      ) ?? filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a")
    );
  }

  return filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a");
}

function selectSupportingNarrative(
  filing: FilingCacheRecord,
  profile: QuestionProfile,
  sources: SourceChunkRecord[]
): SourceChunkRecord | undefined {
  const narrativeSources = sources.filter((source) => source.sectionType === "md_a");
  if (narrativeSources.length === 0) {
    return undefined;
  }

  return selectFallbackNarrative(
    {
      ...filing,
      sourceChunks: narrativeSources
    },
    profile
  ) ?? narrativeSources[0];
}

function findNarrativeChunk(
  chunks: SourceChunkRecord[],
  predicate: (chunk: SourceChunkRecord) => boolean
): SourceChunkRecord | undefined {
  return chunks.find(predicate);
}

function shouldRecoverFromWeakNarrative(
  filing: FilingCacheRecord,
  profile: QuestionProfile,
  sourceIds: string[]
): boolean {
  if (
    !(
      (profile.asksRevenue && profile.asksCause) ||
      profile.asksMarketReaction ||
      profile.asksGuidance ||
      profile.asksForecast ||
      profile.asksCapitalAllocation
    )
  ) {
    return false;
  }

  const citedNarratives = sourceIds
    .map((sourceId) => filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId))
    .filter((chunk): chunk is SourceChunkRecord => chunk !== undefined && chunk.sectionType === "md_a");

  return citedNarratives.length > 0 && citedNarratives.every(isLowSignalNarrative);
}

function isLowSignalNarrative(chunk: SourceChunkRecord): boolean {
  return /available information|investor relations website|corporate website|securities and exchange commission|should be read in conjunction/i.test(
    chunk.text
  );
}

function buildClosestContextLead(profile: QuestionProfile): string {
  if (profile.asksStockPrice || profile.asksRecommendation || profile.asksMarketReaction) {
    return "株価が上がるか下がるか自体は、この filing だけでは決められません。";
  }

  if (profile.asksForecast || profile.asksGuidance) {
    return "この filing だけで、この先を言い切ることはできません。";
  }

  if (profile.asksCapitalAllocation) {
    return "配当や自社株買いが十分かどうかを、この filing だけで言い切ることはできません。";
  }

  return "この質問にそのまま答える根拠は、この filing では十分ではありません。";
}

function buildClosestContextLimitation(profile: QuestionProfile): string {
  if (profile.asksStockPrice || profile.asksRecommendation || profile.asksMarketReaction) {
    return "ただ、株価を見る前に、まず決算書で確認できる変化はここです。";
  }

  if (profile.asksForecast || profile.asksGuidance) {
    return "この先を言い切るには追加情報が必要ですが、足元で確認できる変化はここです。";
  }

  if (profile.asksCapitalAllocation) {
    return "会社のお金の使い方を判断するには追加情報が必要ですが、前提として確認できる変化はここです。";
  }

  return "論点を filing に寄せれば、ここからさらに深掘りできます。";
}

function buildMetricObservation(metric: MetricSnapshot): string {
  const label = metricLabel(metric.logicalName);
  const current = formatMetricValue(metric.value, metric.unit);

  if (metric.yoyPercent !== undefined) {
    return `${label}は ${current} で、前年同期比 ${formatYoYDelta(metric.yoyPercent)} です。`;
  }

  if (metric.comparisonValue !== undefined) {
    return `${label}は ${current} で、比較値は ${formatMetricValue(metric.comparisonValue, metric.unit)} です。`;
  }

  return `${label}は ${current} です。`;
}

function findMetricSourceIdByTag(filing: FilingCacheRecord, tagUsed: string): string | undefined {
  return filing.sourceChunks.find(
    (chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === tagUsed
  )?.sourceId;
}

function buildMetricLimitation(metric: MetricSnapshot, profile: QuestionProfile): string {
  const label = metricLabel(metric.logicalName);

  if (profile.asksCause && profile.asksRevenue) {
    return `ただし、この数値だけでは、どの事業や地域が${label}を押し上げたかまでは分かりません。`;
  }

  if (profile.asksMarketReaction) {
    return "ただし、この数値だけでは市場が何を一番評価したかまでは分かりません。";
  }

  if (profile.asksGuidance) {
    return "ただし、この数値だけでは会社の先の見通しまでは言い切れません。";
  }

  if (profile.asksCapitalAllocation) {
    return "ただし、この数値だけでは配当や自社株買いが十分かまでは言い切れません。";
  }

  if (profile.asksCause || profile.asksImpact) {
    return `ただし、この数値だけでは ${label} が動いた理由までは断定できません。`;
  }

  if (profile.asksDetail) {
    return `この数値から変化自体は確認できますが、内訳まではこの metric 単体では分かりません。`;
  }

  return `この数値から少なくとも変化の方向は確認できます。`;
}

function buildTariffNarrativeSentence(source: SourceChunkRecord): string {
  const localized = polishJapaneseText(source.text);
  const mentionsSupplyChain = /サプライチェーン/i.test(localized);
  const mentionsPricing = /pricing|価格/i.test(source.text);
  const mentionsGrossMargin = /粗利益率/i.test(localized);
  const impacted: string[] = ["事業"];

  if (mentionsSupplyChain) {
    impacted.push("サプライチェーン");
  }
  if (mentionsPricing) {
    impacted.push("価格設定");
  }
  if (mentionsGrossMargin) {
    impacted.push("粗利益率");
  }

  return `提出資料では、関税やその他の措置が ${impacted.join("、")} に重要な悪影響を及ぼし得ると説明しています。`;
}

function truncateExcerpt(text: string, limit: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit).trimEnd()}...`;
}

function formatMetricValue(value: number, unit: string): string {
  if (unit === "USD") {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000_000) {
      return `${formatCompactNumber(value / 1_000_000_000_000)}兆ドル`;
    }
    if (abs >= 100_000_000) {
      return `${formatCompactNumber(value / 100_000_000)}億ドル`;
    }
  }

  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)} ${unit}`.trim();
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  }).format(value);
}

function formatYoYDelta(yoyPercent: number): string {
  const formatted = `${Math.abs(yoyPercent).toFixed(1)}%`;
  return `${formatted}${yoyPercent >= 0 ? "増" : "減"}`;
}

function polishJapaneseText(text: string): string {
  return text
    .replace(/U\.S\.\s*関税/gi, "米国の関税")
    .replace(/\bU\.S\.\s*Tariffs?\b/gi, "米国の関税")
    .replace(/\bTariffs?\b/g, "関税")
    .replace(/\brare earths?\b/gi, "希土類")
    .replace(/\bsupply chain\b/gi, "サプライチェーン")
    .replace(/\bgross margin\b/gi, "粗利益率")
    .replace(/\bServices\b/g, "サービス");
}

function stripEnglishParentheticals(text: string): string {
  return text
    .replace(/([一-龠ぁ-んァ-ンーa-zA-Z0-9]+)（[A-Za-z][A-Za-z0-9 .,'/-]*）/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([、。])/g, "$1");
}

function metricLabel(metric: MetricSnapshot["logicalName"]): string {
  const labels: Record<MetricSnapshot["logicalName"], string> = {
    revenue: "売上高",
    netIncome: "純利益",
    epsBasic: "EPS",
    operatingIncome: "営業利益",
    operatingCashFlow: "営業CF"
  };

  return labels[metric];
}
