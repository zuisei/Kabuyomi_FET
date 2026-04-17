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
    publisher: supplement.publisher || "unknown"
  });

  return ensureFilingGroundedResponse({
    answer: `${response.answer} ${webSentence}`,
    sources: [
      ...response.sources,
      {
        sourceId: "W1",
        sourceKind: "web_supplement",
        sectionType: "web_search",
        sourceLabel: `${supplement.publisher} · ${truncateText(supplement.title, 80)}`,
        excerpt: truncateText(supplement.snippet || supplement.title, 220)
      }
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

function buildWebSupplementSentence(supplement: WebSupplementRecord, question: string): string | null {
  const haystack = `${supplement.title} ${supplement.snippet}`.toLowerCase();
  const normalizedQuestion = question.replace(/\s+/g, "").toLowerCase();
  const asksContrastiveReaction =
    /(株価|市場|反応|上げ|上が|下げ|下が|好感|嫌気)/.test(normalizedQuestion) &&
    (/(なのに|にもかかわらず|のに)/.test(normalizedQuestion) ||
      /(不確実|不透明|懸念|逆風|弱い|悪い|微妙|risk|uncertain|uncertainty)/.test(normalizedQuestion));
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

  if (/shares? up|stock rises?|sending shares up|stock jumps?/.test(haystack)) {
    pushPoint("市場では株価上昇で反応した");
  } else if (/shares? down|stock falls?|sending shares down|stock drops?/.test(haystack)) {
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

  if (points.length === 0) {
    if (!supplement.publisher) {
      return null;
    }

    return `外部補足では ${supplement.publisher} が、この論点に関する報道を出しています。これは filing 外の補足です。`;
  }

  if (asksContrastiveReaction) {
    return `外部補足では ${supplement.publisher} が、${points.join("、")}に触れており、市場は懸念よりこちらを強く見た可能性があります。これは filing 外の補足です。`;
  }

  return `外部補足では ${supplement.publisher} が、${points.join("、")}に触れています。これは filing 外の補足です。`;
}

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit).trimEnd()}...`;
}
