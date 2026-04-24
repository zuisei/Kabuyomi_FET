import { normalizeFilingText } from "../../extractors/mda";

const WEBSITE_HINT_RE =
  /available information|investor relations|our website|website|corporate website|investor information|information about us/i;
const BARE_URL_RE =
  /\b(?:https?:\/\/|www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>()\],;]*)?/gi;
const DOMAIN_ONLY_RE =
  /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>()\],;]*)?/gi;
const ANCHOR_RE =
  /<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
const BLOCKED_HOST_SUFFIXES = [
  "sec.gov",
  "xbrl.org",
  "fasb.org",
  "ifrs.org",
  "w3.org",
  "xml.org"
];
const BLOCKED_HOST_KEYWORDS = [
  "linkedin.",
  "facebook.",
  "instagram.",
  "twitter.",
  "x.com",
  "youtube.",
  "tiktok."
];
const BLOCKED_PATH_HINT_RE = /\.(?:xml|xsd|xsl|zip|jpg|jpeg|png|gif|svg|webp|css|js)(?:$|[?#])/i;
const COMPANY_STOPWORDS = new Set([
  "inc",
  "corp",
  "corporation",
  "company",
  "co",
  "holdings",
  "holding",
  "group",
  "plc",
  "ltd",
  "limited",
  "sa",
  "nv",
  "ag",
  "the",
  "and"
]);

export function extractCompanyWebsiteUrl(
  html: string,
  options: { companyName: string; primaryDocumentUrl?: string }
): string | undefined {
  const companyTokens = companyNameTokens(options.companyName);
  const candidates = new Map<string, number>();

  collectAnchorCandidates(html, options.primaryDocumentUrl, companyTokens, candidates);
  collectTextCandidates(html, options.primaryDocumentUrl, companyTokens, candidates);

  return [...candidates.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([url]) => url)[0];
}

function collectAnchorCandidates(
  html: string,
  primaryDocumentUrl: string | undefined,
  companyTokens: string[],
  candidates: Map<string, number>
) {
  for (const match of html.matchAll(ANCHOR_RE)) {
    const rawHref = match[1] ?? match[2] ?? match[3];
    const normalized = normalizeCandidateUrl(rawHref, primaryDocumentUrl);
    if (!normalized) {
      continue;
    }

    const anchorStart = match.index ?? 0;
    const anchorHtml = match[0] ?? "";
    const context = htmlSnippetToText(
      html.slice(Math.max(0, anchorStart - 160), Math.min(html.length, anchorStart + anchorHtml.length + 160))
    );
    const score = scoreCandidate(normalized, context, companyTokens, 45);
    if (score > 0) {
      retainHigherScore(candidates, normalized, score);
    }
  }
}

function collectTextCandidates(
  html: string,
  primaryDocumentUrl: string | undefined,
  companyTokens: string[],
  candidates: Map<string, number>
) {
  const text = normalizeFilingText(html);

  for (const match of text.matchAll(BARE_URL_RE)) {
    const normalized = normalizeCandidateUrl(match[0], primaryDocumentUrl);
    if (!normalized) {
      continue;
    }

    const score = scoreCandidate(normalized, surroundingContext(text, match.index ?? 0, match[0].length), companyTokens, 36);
    if (score > 0) {
      retainHigherScore(candidates, normalized, score);
    }
  }

  for (const match of text.matchAll(DOMAIN_ONLY_RE)) {
    const raw = match[0];
    if (raw.includes("@")) {
      continue;
    }

    const normalized = normalizeCandidateUrl(raw, primaryDocumentUrl);
    if (!normalized) {
      continue;
    }

    const score = scoreCandidate(normalized, surroundingContext(text, match.index ?? 0, raw.length), companyTokens, 28);
    if (score > 0) {
      retainHigherScore(candidates, normalized, score);
    }
  }
}

function retainHigherScore(candidates: Map<string, number>, url: string, score: number) {
  const existing = candidates.get(url) ?? Number.NEGATIVE_INFINITY;
  if (score > existing) {
    candidates.set(url, score);
  }
}

function scoreCandidate(urlString: string, context: string, companyTokens: string[], baseScore: number): number {
  let score = baseScore;
  const normalizedContext = context.toLowerCase();
  const url = new URL(urlString);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  if (WEBSITE_HINT_RE.test(normalizedContext)) {
    score += 28;
  }

  if (/(investor|investors|ir)\b/.test(`${host}${path}`)) {
    score += 18;
  }

  if (hostMatchesCompany(host, companyTokens)) {
    score += 18;
  }

  if (path === "/" || path === "") {
    score += 4;
  }

  return score;
}

function hostMatchesCompany(host: string, companyTokens: string[]): boolean {
  return companyTokens.some((token) => token.length >= 4 && host.includes(token));
}

function companyNameTokens(companyName: string): string[] {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !COMPANY_STOPWORDS.has(token));
}

function normalizeCandidateUrl(rawValue: string | null | undefined, primaryDocumentUrl: string | undefined): string | undefined {
  const trimmed = rawValue
    ?.trim()
    .replace(/^[("'[\s]+/, "")
    .replace(/[)"'\].,;:\s]+$/, "");
  if (!trimmed) {
    return undefined;
  }

  if (/^(mailto|tel|javascript):/i.test(trimmed)) {
    return undefined;
  }

  let parsed: URL;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      parsed = new URL(trimmed);
    } else if (looksLikeBareCompanyDomain(trimmed)) {
      parsed = new URL(`https://${trimmed}`);
    } else if (primaryDocumentUrl) {
      parsed = new URL(trimmed, primaryDocumentUrl);
    } else {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const host = parsed.hostname.toLowerCase();
  if (!host || isBlockedHost(host) || host.endsWith(".htm") || host.endsWith(".html")) {
    return undefined;
  }

  if (BLOCKED_PATH_HINT_RE.test(parsed.pathname)) {
    return undefined;
  }

  parsed.hash = "";
  return parsed.toString();
}

function looksLikeBareCompanyDomain(value: string): boolean {
  const normalized = value.toLowerCase();
  if (/^[a-z0-9_-]+\.html?(?:[?#].*)?$/i.test(normalized)) {
    return false;
  }

  return (
    /^www\.[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(value) ||
    /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:[/:?#].*)?$/i.test(value)
  );
}

function isBlockedHost(host: string): boolean {
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return true;
  }

  return BLOCKED_HOST_KEYWORDS.some((keyword) => host.includes(keyword));
}

function surroundingContext(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + length + 90);
  return text.slice(start, end);
}

function htmlSnippetToText(snippet: string): string {
  return snippet
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}
