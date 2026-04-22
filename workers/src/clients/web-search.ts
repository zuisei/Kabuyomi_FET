import type { Env, FilingCacheRecord } from "../env";
import { logEvent } from "../lib/logging";

const SEARCH_TIMEOUT_MS = 6_000;
const SEARCH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

export interface WebSupplementRecord {
  title: string;
  url: string;
  snippet: string;
  publisher: string;
  evidenceStrength: "supplement_article" | "supplement_snippet";
}

export async function findTrustedWebSupplement(
  filing: FilingCacheRecord,
  question: string,
  env: Env
): Promise<WebSupplementRecord | null> {
  const profile = analyzeWebIntent(question);
  if (!profile.shouldSearch) {
    return null;
  }

  let fallbackCandidate: WebSupplementRecord | null = null;

  for (const query of buildSearchQueries(filing, profile)) {
    const searchHtml = await fetchText(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      env,
      "web_search_query"
    );
    if (!searchHtml) {
      continue;
    }

    const candidates = parseDuckDuckGoResults(searchHtml)
      .filter((candidate) => isTrustedWebResult(candidate.url))
      .filter((candidate) => isUsableTrustedResult(candidate, profile))
      .sort((left, right) => scoreResult(right, profile) - scoreResult(left, profile))
      .slice(0, 4);

    if (candidates.length === 0) {
      logEvent("web_supplement_empty", { query });
      continue;
    }

    for (const candidate of candidates) {
      const enriched = await enrichResult(candidate, env);
      if (enriched.snippet) {
        logEvent("web_supplement_found", {
          query,
          publisher: enriched.publisher,
          hostname: safeHostname(enriched.url)
        });
        return enriched;
      }
    }

    if (!fallbackCandidate && candidates[0]) {
      fallbackCandidate = candidates[0];
    }
  }

  return fallbackCandidate;
}

type WebIntentProfile = {
  shouldSearch: boolean;
  asksDrivers: boolean;
  asksStockPrice: boolean;
  asksStockContext: boolean;
  asksRecommendation: boolean;
  asksForecast: boolean;
  asksMargins: boolean;
  asksCashFlow: boolean;
  asksCapitalAllocation: boolean;
  asksRisk: boolean;
  asksCurrentContext: boolean;
  asksTariff: boolean;
};

function analyzeWebIntent(question: string): WebIntentProfile {
  const normalized = question.replace(/\s+/g, "").toLowerCase();

  const asksDrivers =
    /(支え|押し上げ|牽引|ドライバー|contributors?|drivers?|growthdrivers?|revenuegrowth)/.test(normalized) ||
    (/(主因|要因|原因|理由|背景)/.test(normalized) && /(売上|増収|成長|growth|revenue|需要|株価|市場|反応)/.test(normalized));
  const asksStockPrice = /(株価|shareprice|stockprice|株価反応|marketreaction)/.test(normalized);
  const asksStockContext =
    /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
      normalized
    ) ||
    (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalized) &&
      /(株|株価|市場|stock|share)/.test(normalized));
  const asksRecommendation = /(買いか|売りか|買うべき|売るべき|おすすめ|投資判断)/.test(normalized);
  const asksForecast = /(今後|この先|見通し|予想|guidance|outlook|来期|次四半期)/.test(normalized);
  const asksMargins = /(利益率|マージン|粗利|採算|pricing|margin)/.test(normalized);
  const asksCashFlow = /(キャッシュフロー|cf|cash flow|free cash flow)/.test(normalized);
  const asksCapitalAllocation = /(還元|自社株買い|buyback|repurchase|配当|dividend|capital allocation|株主還元)/.test(
    normalized
  );
  const asksRisk = /(リスク|懸念|逆風|警戒|不確実|不透明|risk|macro|uncertain|uncertainty)/.test(normalized);
  const asksCurrentContext = /(最近|直近|足元|市場|反応|ニュース|報道|話題|いま|今は)/.test(normalized);
  const asksTariff = /(関税|tariff)/.test(normalized);

  return {
    shouldSearch:
      asksDrivers ||
      asksStockPrice ||
      asksStockContext ||
      asksRecommendation ||
      asksForecast ||
      asksMargins ||
      asksCashFlow ||
      asksCapitalAllocation ||
      asksRisk ||
      asksCurrentContext ||
      asksTariff,
    asksDrivers,
    asksStockPrice,
    asksStockContext,
    asksRecommendation,
    asksForecast,
    asksMargins,
    asksCashFlow,
    asksCapitalAllocation,
    asksRisk,
    asksCurrentContext,
    asksTariff
  };
}

function buildSearchQueries(filing: FilingCacheRecord, profile: WebIntentProfile): string[] {
  const base = `${filing.companyName} ${filing.ticker}`;
  const filedAt = filing.filedAt;

  if (profile.asksDrivers) {
    return [
      `${base} ${filedAt} Reuters earnings`,
      `${base} latest earnings Reuters news`,
      `${base} ${filedAt} investor relations earnings`
    ];
  }

  if (profile.asksStockContext) {
    return [
      `${base} ${filedAt} Reuters shares after earnings`,
      `${base} ${filedAt} Reuters stock reaction`,
      `${base} recent stock performance Reuters earnings`
    ];
  }

  if (profile.asksStockPrice || profile.asksRecommendation) {
    return [
      `${base} ${filedAt} Reuters earnings stock`,
      `${base} earnings outlook Reuters stock`
    ];
  }

  if (profile.asksForecast) {
    return [
      `${base} ${filedAt} Reuters guidance`,
      `${base} guidance Reuters earnings`
    ];
  }

  if (profile.asksMargins) {
    return [
      `${base} ${filedAt} Reuters margin demand pricing`,
      `${base} earnings margin Reuters`
    ];
  }

  if (profile.asksCapitalAllocation || profile.asksCashFlow) {
    return [
      `${base} ${filedAt} Reuters buyback dividend cash flow`,
      `${base} investor relations buyback dividend cash flow`
    ];
  }

  if (profile.asksRisk) {
    return [
      `${base} ${filedAt} Reuters risk earnings`,
      `${base} latest earnings Reuters news risk`
    ];
  }

  if (profile.asksTariff) {
    return [
      `${base} ${filedAt} Reuters tariffs earnings`,
      `${base} tariffs Reuters earnings`
    ];
  }

  return [
    `${base} ${filedAt} Reuters earnings`,
    `${base} latest earnings Reuters news`
  ];
}

async function fetchText(url: string, env: Env, eventName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": SEARCH_USER_AGENT,
        accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      logEvent(eventName, { url, status: response.status, outcome: "http_error" });
      return null;
    }

    return await response.text();
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown";
    logEvent(eventName, { url, outcome: "failed", reason, hasGemini: Boolean(env.GEMINI_API_KEY) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseDuckDuckGoResults(html: string): WebSupplementRecord[] {
  const titleMatches = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippetMatches = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi)];
  const count = Math.min(titleMatches.length, snippetMatches.length);
  const results: WebSupplementRecord[] = [];

  for (let index = 0; index < count; index += 1) {
    const href = titleMatches[index]?.[1];
    const titleHtml = titleMatches[index]?.[2];
    const snippetHtml = snippetMatches[index]?.[1];
    const url = unwrapDuckDuckGoUrl(href);
    if (!url) {
      continue;
    }

    const title = cleanHtmlFragment(titleHtml);
    const snippet = cleanHtmlFragment(snippetHtml);
    if (!title || !snippet) {
      continue;
    }

    results.push({
      title,
      url,
      snippet,
      publisher: inferPublisher(url, title),
      evidenceStrength: "supplement_snippet"
    });
  }

  return results;
}

function unwrapDuckDuckGoUrl(rawHref?: string): string | null {
  if (!rawHref) {
    return null;
  }

  const href = rawHref.startsWith("//") ? `https:${rawHref}` : rawHref;
  try {
    const parsed = new URL(href);
    const redirected = parsed.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : href;
  } catch {
    return null;
  }
}

function cleanHtmlFragment(fragment?: string): string {
  if (!fragment) {
    return "";
  }

  return decodeHtmlEntities(fragment)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function isTrustedWebResult(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    return (
      hostname.endsWith("reuters.com") ||
      hostname.endsWith("apnews.com") ||
      hostname.endsWith("cnbc.com") ||
      hostname.endsWith("bloomberg.com") ||
      hostname.endsWith("bnnbloomberg.ca") ||
      hostname.endsWith("ft.com") ||
      hostname.startsWith("investor.") ||
      hostname.startsWith("ir.") ||
      pathname.includes("/investor") ||
      pathname.includes("/newsroom/")
    );
  } catch {
    return false;
  }
}

function isUsableTrustedResult(result: WebSupplementRecord, profile: WebIntentProfile): boolean {
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();

  if (/stock analysis|stock price|latest news|prediction|dividend history/.test(haystack)) {
    if (!(profile.asksCapitalAllocation && /dividend history/.test(haystack))) {
      return false;
    }
  }

  try {
    const url = new URL(result.url);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    if (
      pathname.startsWith("/quote/") ||
      pathname.startsWith("/quotes/") ||
      pathname.startsWith("/stock/") ||
      pathname.startsWith("/stocks/") ||
      pathname.startsWith("/data/") ||
      pathname.includes("/markets/companies/")
    ) {
      return false;
    }

    if (hostname.endsWith("reuters.com")) {
      if (pathname.startsWith("/company/") || pathname.includes("/markets/companies/")) {
        return false;
      }
      if (!pathname.includes("/business/") && !pathname.includes("/world/") && !pathname.match(/\/\d{4}\-\d{2}\-\d{2}\//)) {
        return false;
      }
    }

    if (hostname.endsWith("cnbc.com") && pathname.startsWith("/quotes/")) {
      return false;
    }

    if (
      (hostname.endsWith("bloomberg.com") || hostname.endsWith("bnnbloomberg.ca")) &&
      (pathname.startsWith("/quote/") || pathname.startsWith("/markets/stocks/"))
    ) {
      return false;
    }

    if (hostname.endsWith("ft.com") && pathname.startsWith("/data/")) {
      return false;
    }

    const isOfficial =
      hostname.startsWith("investor.") ||
      hostname.startsWith("ir.") ||
      pathname.includes("/investor") ||
      pathname.includes("/newsroom/");

    if (isOfficial) {
      if (profile.asksCapitalAllocation) {
        return /dividend|buyback|repurchase|cash|capital|shareholder|capital return|earnings/.test(haystack);
      }

      if (profile.asksCashFlow) {
        return /cash|cash flow|free cash flow|liquidity/.test(haystack);
      }

      if (profile.asksDrivers) {
        return /driven by|powered by|boosted by|helped by|demand|growth|iphone|services|cloud|advertising|subscription|china|rebound|pricing|segment|region/.test(
          haystack
        );
      }

      if (profile.asksForecast) {
        return /forecast|guidance|outlook|expect|stronger than expected|above expectations/.test(haystack);
      }

      if (profile.asksMargins) {
        return /margin|pricing|profitability|gross margin|cost pressure/.test(haystack);
      }

      if (profile.asksRisk) {
        return /risk|uncertainty|macro|tariff|pressure|weakness/.test(haystack);
      }

      if (profile.asksStockContext || profile.asksStockPrice || profile.asksRecommendation) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

function scoreResult(result: WebSupplementRecord, profile: WebIntentProfile): number {
  const haystack = `${result.title} ${result.snippet}`.toLowerCase();
  let score = 0;

  if (result.publisher === "Reuters") {
    score += 4;
  }
  if (result.publisher.includes("Investor") || result.publisher.includes("Newsroom")) {
    score += 3;
  }
  if (profile.asksStockContext || profile.asksStockPrice || profile.asksRecommendation) {
    if (/shares? up|shares? down|stock|forecast|outlook|beats estimates|misses estimates/.test(haystack)) {
      score += 3;
    }
  }
  if (
    profile.asksDrivers &&
    /(driven by|powered by|boosted by|helped by|strong demand|services growth|cloud growth|advertising growth|subscription growth|rebound in china|pricing)/.test(
      haystack
    )
  ) {
    score += 4;
  }
  if (profile.asksForecast && /forecast|guidance|outlook/.test(haystack)) {
    score += 3;
  }
  if (profile.asksMargins && /margin|pricing|cost pressure|profitability|gross margin/.test(haystack)) {
    score += 3;
  }
  if (profile.asksCashFlow && /cash flow|free cash flow|liquidity/.test(haystack)) {
    score += 3;
  }
  if (profile.asksCapitalAllocation && /buyback|share repurchase|dividend|capital return|capital allocation/.test(haystack)) {
    score += 4;
  }
  if (profile.asksRisk && /risk|macro|tariff|uncertainty|pressure|weakness/.test(haystack)) {
    score += 2;
  }
  if (profile.asksTariff && /tariff/.test(haystack)) {
    score += 3;
  }
  if (profile.asksCurrentContext && /latest|recent|today|quarter|earnings/.test(haystack)) {
    score += 1;
  }
  if (/stock analysis|stock price|latest news/.test(haystack)) {
    score -= 3;
  }

  return score;
}

async function enrichResult(result: WebSupplementRecord, env: Env): Promise<WebSupplementRecord> {
  const pageHtml = await fetchText(result.url, env, "web_supplement_fetch");
  if (!pageHtml) {
    return result;
  }

  const description = extractMetaDescription(pageHtml);
  const title = extractTitle(pageHtml) ?? result.title;

  return {
    ...result,
    title: cleanHtmlFragment(title),
    snippet: description ? cleanHtmlFragment(description) : result.snippet,
    evidenceStrength: "supplement_article"
  };
}

function extractMetaDescription(html: string): string | null {
  const patterns = [
    /<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i,
    /<meta[^>]+name="description"[^>]+content="([^"]+)"/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtmlEntities(match[1]);
    }
  }

  return null;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1]) : null;
}

function inferPublisher(rawUrl: string, title: string): string {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    if (hostname.endsWith("reuters.com")) {
      return "Reuters";
    }
    if (hostname.endsWith("apnews.com")) {
      return "AP";
    }
    if (hostname.endsWith("cnbc.com")) {
      return "CNBC";
    }
    if (hostname.endsWith("bloomberg.com") || hostname.endsWith("bnnbloomberg.ca")) {
      return "Bloomberg";
    }
    if (hostname.endsWith("ft.com")) {
      return "Financial Times";
    }
    if (hostname.startsWith("investor.") || hostname.startsWith("ir.") || pathname.includes("/investor")) {
      return "Investor Relations";
    }
    if (pathname.includes("/newsroom/")) {
      const hostnameLabel = hostname.replace(/^www\./, "").split(".")[0];
      const brand = hostnameLabel ? hostnameLabel.charAt(0).toUpperCase() + hostnameLabel.slice(1) : "";
      return brand ? `${brand} Newsroom` : "Company Newsroom";
    }

    return hostname.replace(/^www\./, "");
  } catch {
    return "Web";
  }
}

function safeHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "unknown";
  }
}
