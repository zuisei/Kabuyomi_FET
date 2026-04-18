import type { Env, FilingCacheRecord } from "../../env";
import { findTrustedWebSupplement, type WebSupplementRecord } from "../../clients/web-search";
import { logEvent } from "../logging";
import type { RemoteConfig } from "../remote-config";
import { CONTEXT_UNAVAILABLE_ANSWER, ensureFilingGroundedResponse, type ChatResponsePayload } from "./grounding";

export async function maybeAppendWebSupplement(
  filing: FilingCacheRecord,
  question: string,
  response: ChatResponsePayload,
  env: Env,
  config?: Pick<RemoteConfig, "webSupplementEnabled">
): Promise<ChatResponsePayload> {
  if (response.answer === CONTEXT_UNAVAILABLE_ANSWER) {
    return response;
  }

  if (config?.webSupplementEnabled === false) {
    return response;
  }

  if (!shouldUseWebSupplement(question, response.answer)) {
    return response;
  }

  const supplement = await findTrustedWebSupplement(filing, question, env);
  if (!supplement) {
    return response;
  }

  const webSentence = buildWebSupplementSentence(supplement, question);
  if (!webSentence) {
    return response;
  }

  logEvent("chat_web_supplement_used", {
    filingKey: filing.filingKey,
    ticker: filing.ticker,
    publisher: supplement.publisher || "unknown",
    sourceStrength: supplement.evidenceStrength
  });

  const stockReactionAnswer = buildStockReactionMergedAnswer(response.answer, supplement, question);
  if (stockReactionAnswer) {
    return ensureFilingGroundedResponse({
      answer: stockReactionAnswer,
      sources: [
        ...response.sources,
        buildWebSupplementSource(supplement)
      ]
    });
  }

  return ensureFilingGroundedResponse({
    answer: `${response.answer} ${webSentence}`,
    sources: [
      ...response.sources,
      buildWebSupplementSource(supplement)
    ]
  });
}

function shouldUseWebSupplement(question: string, answer: string): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  const asksGrowthDrivers =
    /(支え|押し上げ|牽引|ドライバー|contributors?|drivers?)/.test(normalized) ||
    (/(主因|要因|理由|背景)/.test(normalized) && /(売上|増収|成長|growth|revenue|需要|株価|市場|反応)/.test(normalized));
  const asksBroadContext =
    /(株価|shareprice|stockprice|買いか|売りか|投資判断|おすすめ|今後|この先|見通し|予想|guidance|outlook|最近|直近|市場|反応|ニュース|報道|話題|関税|tariff|還元|自社株買い|buyback|repurchase|配当|dividend|capital allocation|株主還元|リスク|懸念|逆風|risk)/.test(
      normalized
    );

  return (
    asksBroadContext ||
    asksGrowthDrivers ||
    answer.includes("この filing だけでは") ||
    answer.includes("断定できません") ||
    answer.includes("切り分けられません")
  );
}

function buildStockReactionMergedAnswer(
  filingAnswer: string,
  supplement: WebSupplementRecord,
  question: string
): string | null {
  if (!isStockReactionQuestion(question)) {
    return null;
  }

  const reaction = extractStockReaction(supplement);
  if (!reaction) {
    return null;
  }

  const miniChart = buildStockReactionMiniChart(supplement);
  const trimmedFilingAnswer = trimStockContextLimitation(filingAnswer);
  return `${reaction}${miniChart ? ` ${miniChart}` : ""} ${trimmedFilingAnswer} ${buildStrengthExplanation(supplement, {
    article: "値動き自体は外部報道ベースで、なぜそう見られたかの整理は filing ベースです。",
    snippet:
      "値動き自体は検索 snippet ベースの弱い外部補足で、なぜそう見られたかの整理は filing ベースです。"
  })}`;
}

function buildWebSupplementSentence(supplement: WebSupplementRecord, question: string): string | null {
  const haystack = `${supplement.title} ${supplement.snippet}`.toLowerCase();
  const normalizedQuestion = question.replace(/\s+/g, "").toLowerCase();
  const asksStockContext =
    /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
      normalizedQuestion
    ) ||
    (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalizedQuestion) &&
      /(株|株価|市場|stock|share)/.test(normalizedQuestion));
  const asksContrastiveReaction =
    /(株価|市場|反応|上げ|上が|下げ|下が|好感|嫌気)/.test(normalizedQuestion) &&
    (/(なのに|にもかかわらず|のに)/.test(normalizedQuestion) ||
      /(不確実|不透明|懸念|逆風|弱い|悪い|微妙|risk|uncertain|uncertainty)/.test(normalizedQuestion));
  const isOfficialSupplement = /investor relations|newsroom/i.test(supplement.publisher);
  const points: string[] = [];
  const pushPoint = (point: string) => {
    if (!points.includes(point)) {
      points.push(point);
    }
  };

  if (/forecast|guidance|outlook/.test(haystack) && /beat|above|stronger than expected/.test(haystack)) {
    pushPoint("会社見通しが市場予想より強い方向");
  } else if (/forecast|guidance|outlook/.test(haystack)) {
    pushPoint("会社見通し");
  }

  if (/shares? up|shares? rise|shares? rose|stock rises?|sending shares up|stock jumps?/.test(haystack)) {
    pushPoint("市場では株価上昇で反応した");
  } else if (/shares? down|shares? fall|shares? fell|stock falls?|sending shares down|stock drops?/.test(haystack)) {
    pushPoint("市場では株価下落で反応した");
  }

  if (/tariff/.test(haystack)) {
    pushPoint("関税コストや関税リスク");
  }

  if (/margin|pricing|gross margin|profitability|cost pressure/.test(haystack)) {
    pushPoint("利益率や値付け");
  }

  if (/cash flow|free cash flow|liquidity/.test(haystack)) {
    pushPoint("現金を生み出す力");
  }

  if (/buyback|share repurchase|repurchased/.test(haystack)) {
    pushPoint("自社株買い");
  }

  if (/dividend/.test(haystack)) {
    pushPoint("配当");
  }

  if (/capital allocation|capital return/.test(haystack)) {
    pushPoint("会社のお金の使い方");
  }

  if (/ai investment|ai roll-out|artificial intelligence|open to m&a/.test(haystack)) {
    pushPoint("AI投資やAI戦略");
  }

  if (/china/.test(haystack) && /(miss|fell short|weak|decline|disappoint)/.test(haystack)) {
    pushPoint("中国売上の弱さ");
  }
  if (/china/.test(haystack) && /(rebound|recover|improv|strong)/.test(haystack)) {
    pushPoint("中国需要の持ち直し");
  }
  if (/iphone/.test(haystack)) {
    pushPoint("iPhone需要");
  }
  if (/\bservices?\b/.test(haystack)) {
    pushPoint("サービス事業の伸び");
  }
  if (/\bcloud\b/.test(haystack)) {
    pushPoint("クラウド事業の伸び");
  }
  if (/subscription/.test(haystack)) {
    pushPoint("サブスクリプション収益");
  }
  if (/advertising|ads\b/.test(haystack)) {
    pushPoint("広告事業");
  }
  if (/pricing|price hikes?|higher prices?/.test(haystack)) {
    pushPoint("値上げ効果");
  }
  if (/strong demand|resilient demand|healthy demand|demand rebound/.test(haystack)) {
    pushPoint("需要の強さ");
  }
  if (/enterprise/.test(haystack)) {
    pushPoint("企業向け需要");
  }
  if (/risk|uncertainty|macro|slowdown|pressure|weakness/.test(haystack)) {
    pushPoint("景気や需要の不確実性");
  }
  if (/driven by|powered by|boosted by|helped by/.test(haystack) && points.length === 0) {
    pushPoint("事業別の伸び要因");
  }

  if (asksStockContext && isOfficialSupplement) {
    return null;
  }

  if (points.length === 0) {
    return null;
  }

  if (asksContrastiveReaction) {
    return buildStrengthExplanation(supplement, {
      article: `外部補足では ${supplement.publisher} が、${points.join("、")}に触れており、市場は懸念よりこちらを強く見た可能性があります。これは filing 外の補足です。`,
      snippet: `検索 snippet の弱い外部補足では ${supplement.publisher} が、${points.join("、")}に触れています。記事本文までは確認できていないため、SEC 根拠より弱い補足として扱ってください。`
    });
  }

  return buildStrengthExplanation(supplement, {
    article: `外部補足では ${supplement.publisher} が、${points.join("、")}に触れています。これは filing 外の補足です。`,
    snippet: `検索 snippet の弱い外部補足では ${supplement.publisher} が、${points.join("、")}に触れています。記事本文までは確認できていないため、SEC 根拠より弱い補足として扱ってください。`
  });
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trimEnd()}...`;
}

function buildWebSupplementSource(supplement: WebSupplementRecord) {
  const labelPrefix =
    supplement.evidenceStrength === "supplement_article"
      ? "External supplement"
      : "Weak external supplement (search snippet)";
  const excerptPrefix = supplement.evidenceStrength === "supplement_article" ? "" : "Search snippet: ";

  return {
    sourceId: "W1",
    sourceKind: "web_supplement" as const,
    sourceStrength: supplement.evidenceStrength,
    sectionType: "web_search",
    sourceLabel: `${labelPrefix} · ${supplement.publisher} · ${truncateText(supplement.title, 80)}`,
    excerpt: truncateText(`${excerptPrefix}${supplement.snippet || supplement.title}`, 220)
  };
}

function buildStrengthExplanation(
  supplement: WebSupplementRecord,
  copy: { article: string; snippet: string }
): string {
  return supplement.evidenceStrength === "supplement_article" ? copy.article : copy.snippet;
}

function isStockReactionQuestion(question: string): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return (
    /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
      normalized
    ) ||
    /(株価|shareprice|stockprice|市場|反応|上げ|上が|下げ|下が|好感|嫌気|marketreaction)/.test(normalized)
  );
}

function extractStockReaction(supplement: WebSupplementRecord): string | null {
  const haystack = `${supplement.title} ${supplement.snippet}`;
  const lower = haystack.toLowerCase();
  const risePattern =
    /(?:shares?|stock)\s+(?:rose|rise|rises|up|gained|gain|gains|jumped|jump|jumps|climbed|climb|climbs)\s+(?:as much as\s+|about\s+|around\s+|more than\s+|nearly\s+)?(\d+(?:\.\d+)?)%/i;
  const fallPattern =
    /(?:shares?|stock)\s+(?:fell|fall|falls|down|dropped|drop|drops|slid|slide|slides|declined|decline|declines)\s+(?:as much as\s+|about\s+|around\s+|more than\s+|nearly\s+)?(\d+(?:\.\d+)?)%/i;

  const riseMatch = haystack.match(risePattern);
  if (riseMatch?.[1]) {
    return `外部報道ベースでは、決算後に株価は ${riseMatch[1]}% 上昇で反応しています。`;
  }

  const fallMatch = haystack.match(fallPattern);
  if (fallMatch?.[1]) {
    return `外部報道ベースでは、決算後に株価は ${fallMatch[1]}% 下落で反応しています。`;
  }

  if (/shares? up|shares? rise|shares? rose|stock rises?|sending shares up|stock jumps?/.test(lower)) {
    return "外部報道ベースでは、決算後に株価は上昇で反応しています。";
  }

  if (/shares? down|shares? fall|shares? fell|stock falls?|sending shares down|stock drops?/.test(lower)) {
    return "外部報道ベースでは、決算後に株価は下落で反応しています。";
  }

  return null;
}

function buildStockReactionMiniChart(supplement: WebSupplementRecord): string | null {
  const haystack = `${supplement.title} ${supplement.snippet}`;
  const risePattern =
    /(?:shares?|stock)\s+(?:rose|rise|rises|up|gained|gain|gains|jumped|jump|jumps|climbed|climb|climbs)\s+(?:as much as\s+|about\s+|around\s+|more than\s+|nearly\s+)?(\d+(?:\.\d+)?)%/i;
  const fallPattern =
    /(?:shares?|stock)\s+(?:fell|fall|falls|down|dropped|drop|drops|slid|slide|slides|declined|decline|declines)\s+(?:as much as\s+|about\s+|around\s+|more than\s+|nearly\s+)?(\d+(?:\.\d+)?)%/i;

  const riseMatch = haystack.match(risePattern);
  if (riseMatch?.[1]) {
    return `反応チャート: ${formatMiniReactionBar(Number(riseMatch[1]))}`;
  }

  const fallMatch = haystack.match(fallPattern);
  if (fallMatch?.[1]) {
    return `反応チャート: ${formatMiniReactionBar(-Number(fallMatch[1]))}`;
  }

  return null;
}

function formatMiniReactionBar(percent: number): string {
  const magnitude = Math.min(Math.max(Math.round(Math.abs(percent)), 1), 5);
  const filled = "▆".repeat(magnitude);
  const empty = "·".repeat(5 - magnitude);

  if (percent < 0) {
    return `${filled}${empty} ↘ ${Math.abs(percent).toFixed(1)}%`;
  }

  return `${empty}${filled} ↗ ${percent.toFixed(1)}%`;
}

function trimStockContextLimitation(answer: string): string {
  return answer
    .replace(/株の強弱をみるには、実際の株価推移や決算後ニュースも併せて確認する必要があります。?/g, "")
    .replace(/まず決算で確認できる数字を押さえ、そのうえで株価推移や決算後ニュースを別で見るのが安全です。?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
