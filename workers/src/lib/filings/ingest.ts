import type { Env, FilingCacheRecord, FilingReference, MetricSnapshot, SourceChunkRecord } from "../../env";
import { generateSummary } from "../../clients/gemini";
import { buildPrimaryDocumentUrl, fetchFilingAssets, fetchMetricSnapshots, fetchPreparedFiling } from "../../clients/sec";
import { extractMDASectionWithDiagnostics, normalizeFilingText } from "../../extractors/mda";
import { AppError } from "../errors";
import { extractCompanyWebsiteUrl } from "./company-website";
import { logLlmUsage } from "../llm-usage";
import { logEvent } from "../logging";
import { metricLabel } from "../metrics";
import type { RemoteConfig } from "../remote-config";

export async function ingestFiling(
  filing: FilingReference,
  comparisonFiling: FilingReference | null,
  env: Env,
  config: RemoteConfig,
  options: { summaryMode?: "default" | "fallback_only"; contentMode?: "full" | "metrics_only" } = {}
): Promise<FilingCacheRecord> {
  const startedAt = Date.now();
  const summaryMode = options.summaryMode ?? "default";
  const contentMode = options.contentMode ?? "full";
  const fetchStartedAt = Date.now();
  let metrics: MetricSnapshot[];
  let primaryDocumentUrl: string;
  let companyWebsiteUrl: string | undefined;
  let html = "";
  let extractedText = "";
  let extractedTokenCount = 0;
  let extractionDiagnostics = {
    inputHtmlChars: 0,
    normalizedChars: 0,
    startMatchesCount: 0,
    endMatchesCount: 0,
    sanitizeMs: 0,
    domParseMs: 0,
    textReadMs: 0,
    cleanupMs: 0,
    normalizeMs: 0,
    boundaryScanMs: 0,
    selectionMs: 0,
    totalMs: 0
  };
  let usedStartPattern = "";
  let usedEndPattern = "";

  if (contentMode === "metrics_only") {
    metrics = await fetchMetricSnapshots(filing, comparisonFiling, env);
    primaryDocumentUrl = buildPrimaryDocumentUrl(filing);
    logEvent("extraction_skipped", {
      ticker: filing.ticker,
      cik: filing.cik,
      formType: filing.formType,
      accessionNumber: filing.accessionNumber,
      summaryMode,
      contentMode
    });
  } else {
    const prepared = await fetchPreparedFiling(filing, comparisonFiling, env);
    const fetched = prepared ? null : await fetchFilingAssets(filing, comparisonFiling, env);
    html = fetched?.html ?? "";
    primaryDocumentUrl = prepared?.primaryDocumentUrl ?? fetched!.primaryDocumentUrl;
    if (fetched) {
      companyWebsiteUrl = extractCompanyWebsiteUrl(html, {
        companyName: filing.companyName,
        primaryDocumentUrl
      });
    }
    metrics = prepared?.metrics ?? fetched!.metrics;
    const fetchedAt = Date.now();
    const { result: extracted, diagnostics } = prepared
      ? {
          result: {
            text: prepared.mdaText,
            tokenCount: prepared.mdaTokenCount,
            usedStartPattern: prepared.usedStartPattern,
            usedEndPattern: prepared.usedEndPattern
          },
          diagnostics: prepared.diagnostics
        }
      : extractMDASectionWithDiagnostics(html, filing.formType);
    if (!extracted) {
      logEvent("extraction_failed", {
        ticker: filing.ticker,
        cik: filing.cik,
        formType: filing.formType,
        accessionNumber: filing.accessionNumber,
        summaryMode,
        contentMode,
        preparedByFetcher: Boolean(prepared),
        fetchMs: fetchedAt - fetchStartedAt,
        ...diagnostics
      });
      throw new AppError(422, "Failed to extract MD&A section");
    }

    extractedText = extracted.text;
    extractedTokenCount = extracted.tokenCount;
    extractionDiagnostics = diagnostics;
    usedStartPattern = extracted.usedStartPattern;
    usedEndPattern = extracted.usedEndPattern;

    logEvent("extraction_succeeded", {
      ticker: filing.ticker,
      cik: filing.cik,
      formType: filing.formType,
      accessionNumber: filing.accessionNumber,
      tokenCount: extracted.tokenCount,
      summaryMode,
      contentMode,
      preparedByFetcher: Boolean(prepared),
      fetchMs: fetchedAt - fetchStartedAt,
      ...diagnostics
    });
  }
  const fetchedAt = Date.now();

  const filingKey = `${config.extractorVersion}:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}`;
  const sourceChunks = buildSourceChunks(filing, extractedText, metrics, {
    revenueDriverSearchText: html ? normalizeFilingText(html) : extractedText
  });
  const summaryEnv = summaryMode === "fallback_only" ? ({ ...env, GEMINI_API_KEY: undefined } as Env) : env;
  const summaryStartedAt = Date.now();
  const generatedSummary = await generateSummary(summaryEnv, {
    filingKey,
    ticker: filing.ticker,
    companyName: filing.companyName,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    metrics,
    sourceChunks
  });
  logLlmUsage(generatedSummary.llmUsage, {
    aiTask: "summary",
    route: "filing_ingest",
    ticker: filing.ticker,
    filingKey,
    responsePath: generatedSummary.provider
  });
  const finishedAt = Date.now();

  logEvent("filing_ingest_completed", {
    filingKey,
    ticker: filing.ticker,
    formType: filing.formType,
    summaryMode,
    contentMode,
    fetchMs: fetchedAt - fetchStartedAt,
    summaryMs: finishedAt - summaryStartedAt,
    summaryProvider: generatedSummary.provider,
    totalMs: finishedAt - startedAt,
    htmlChars: html.length,
    preparedByFetcher: html.length === 0 && extractedText.length > 0,
    metricsCount: metrics.length,
    sourceChunkCount: sourceChunks.length,
    mdaChars: extractedText.length,
    mdaTokenCount: extractedTokenCount,
    primaryDocumentHost: safeUrlHost(primaryDocumentUrl),
    usedStartPattern,
    usedEndPattern,
    inputHtmlChars: extractionDiagnostics.inputHtmlChars,
    normalizedChars: extractionDiagnostics.normalizedChars,
    startMatchesCount: extractionDiagnostics.startMatchesCount,
    endMatchesCount: extractionDiagnostics.endMatchesCount,
    normalizeMs: extractionDiagnostics.normalizeMs,
    boundaryScanMs: extractionDiagnostics.boundaryScanMs,
    selectionMs: extractionDiagnostics.selectionMs,
    extractTotalMs: extractionDiagnostics.totalMs
  });

  return {
    filingKey,
    ticker: filing.ticker,
    companyName: filing.companyName,
    cik: filing.cik,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    primaryDocumentUrl,
    companyWebsiteUrl,
    mdaText: extractedText,
    mdaTokenCount: extractedTokenCount,
    metrics,
    sourceChunks,
    summary: generatedSummary.summary,
    summaryProvider: generatedSummary.provider,
    contentMode,
    generatedAt: new Date().toISOString(),
    extractorVersion: config.extractorVersion,
    promptVersion: config.promptVersion
  };
}

export function buildSourceChunks(
  filing: FilingReference,
  mdaText: string,
  metrics: MetricSnapshot[],
  options: { revenueDriverSearchText?: string } = {}
): SourceChunkRecord[] {
  const chunks: SourceChunkRecord[] = [];
  const mdParagraphs = splitMdaParagraphs(mdaText);
  const revenueDriverParagraphs = selectRevenueDriverParagraphs(options.revenueDriverSearchText ?? mdaText);

  let mdOffset = 0;
  let sourceIndex = 1;

  for (const paragraph of revenueDriverParagraphs) {
    const excerpt = paragraph.slice(0, 1_100);
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "md_a",
      sectionTitle: "Revenue driver discussion",
      sourceLabel: `${filing.formType} Revenue driver discussion, filed ${filing.filedAt}`,
      text: excerpt,
      startOffset: 0,
      endOffset: excerpt.length,
      sortOrder: sourceIndex
    });
    sourceIndex += 1;
    if (sourceIndex > 4) {
      break;
    }
  }

  for (const paragraph of mdParagraphs) {
    if (
      revenueDriverParagraphs.some((driverParagraph) =>
        normalizeForSourceDedup(driverParagraph).includes(normalizeForSourceDedup(paragraph).slice(0, 180)) ||
        normalizeForSourceDedup(paragraph).includes(normalizeForSourceDedup(driverParagraph).slice(0, 180))
      )
    ) {
      mdOffset += paragraph.length + 2;
      continue;
    }
    const excerpt = paragraph.slice(0, 900);
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "md_a",
      sectionTitle: filing.formType === "10-K" ? "Item 7" : "Part I, Item 2",
      sourceLabel: `${filing.formType} ${filing.formType === "10-K" ? "Item 7" : "Part I Item 2"}, filed ${filing.filedAt}`,
      text: excerpt,
      startOffset: mdOffset,
      endOffset: mdOffset + excerpt.length,
      sortOrder: sourceIndex
    });
    mdOffset += paragraph.length + 2;
    sourceIndex += 1;
    if (sourceIndex > 8) {
      break;
    }
  }

  for (const metric of metrics) {
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "xbrl_metric",
      sectionTitle: metricLabel(metric.logicalName),
      sourceLabel: `XBRL ${metricLabel(metric.logicalName)} (${metric.tagUsed})`,
      text: [
        `${metricLabel(metric.logicalName)}: ${metric.value} ${metric.unit}`,
        metric.comparisonValue !== undefined ? `比較値: ${metric.comparisonValue}` : null,
        metric.yoyPercent !== undefined ? `YoY: ${metric.yoyPercent.toFixed(1)}%` : null
      ]
        .filter(Boolean)
        .join(" / "),
      startOffset: 0,
      endOffset: 0,
      tagName: metric.tagUsed,
      sortOrder: sourceIndex
    });
    sourceIndex += 1;
  }

  return chunks;
}

export function hasStrongRevenueDriverSource(source: SourceChunkRecord): boolean {
  return source.sectionType !== "xbrl_metric" &&
    hasPeriodSpecificRevenueDriverText(`${source.sourceLabel} ${source.sectionTitle} ${source.text}`);
}

export function hasPeriodSpecificRevenueDriverText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  if (isRevenueDriverDistractor(normalized)) {
    return false;
  }
  const hasRevenueMovement =
    /(total net revenue|net revenue|net sales|sales and revenues|sales|revenue|comparable sales).{0,220}(up|down|increase|decrease|growth|decline|higher|lower|compared|%)/i.test(normalized) ||
    /(up|down|increase|decrease|growth|decline|higher|lower).{0,220}(total net revenue|net revenue|net sales|sales and revenues|sales|revenue|comparable sales)/i.test(normalized);
  const hasCausalLanguage = /(driven by|due to|primarily due to|reflecting|reflected|attributable to|resulted from|resulting in|because of|partially offset|offset by|as a result)/i.test(normalized);
  const hasSectorDriver =
    /(net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|card services|commodity prices?|crude demand|natural gas prices?|production volumes?|refining margins?|chemical margins?|upstream|downstream|sales volume|price realization|backlog|dealer inventory|equipment to end users|end-market demand|comparable sales|traffic|average ticket|transactions?|ecommerce|e-commerce|membership|unit volumes|iphone|product launches?|geographic segments?|services net sales|services revenue|product net sales|product revenue)/i.test(normalized);
  const hasCurrentPeriodCue = /(202[0-9]|fiscal|year ended|three months ended|quarter|current year|compared with|compared to|前年比|前年同期比|%)/i.test(normalized);

  const hasStrongDriverExplanation = hasRevenueMovement && hasCausalLanguage && hasSectorDriver;
  return (hasCurrentPeriodCue || hasStrongDriverExplanation) && ((hasRevenueMovement && (hasCausalLanguage || hasSectorDriver)) || (hasCausalLanguage && hasSectorDriver)) &&
    !/item 2\. properties|headquarters|office building|square footage|opened our first|began our first international|store footprint|corporate website|available information/i.test(lower);
}

function selectRevenueDriverParagraphs(text: string): string[] {
  const candidates = splitRevenueSearchParagraphs(text)
    .map((paragraph, index) => ({ paragraph, index, score: revenueDriverParagraphScore(paragraph) }))
    .filter((entry) => entry.score >= 80)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeForSourceDedup(candidate.paragraph);
    if (selected.some((paragraph) => isRevenueParagraphOverlap(normalized, normalizeForSourceDedup(paragraph)))) {
      continue;
    }
    selected.push(candidate.paragraph);
    if (selected.length >= 4) {
      break;
    }
  }
  return selected;
}

function splitRevenueSearchParagraphs(text: string): string[] {
  const searchableText = text.replace(/Walmart U\.S\./gi, "Walmart US");
  const paragraphs = searchableText
    .split(/\n{2,}|(?<=\.)\s+(?=(?:Total net revenue|Net revenue|Net sales|Sales and revenues|Comparable sales|Record crude demand|Industry refining margins|Total sales and revenues)\b)/i)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length >= 80 && paragraph.length <= 4_000)
    .filter((paragraph) => !looksLikeTocParagraph(paragraph));
  return paragraphs.length > 0 ? paragraphs : chunkRevenueSearchText(text);
}

function chunkRevenueSearchText(text: string): string[] {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  const pattern = /total net revenue|net revenue|sales and revenues|net sales|comparable sales|record crude demand|refining margins|production volumes|sales volume|price realization|net interest income|noninterest revenue|investment banking fees/gi;
  for (const match of collapsed.matchAll(pattern)) {
    const center = match.index ?? 0;
    const start = Math.max(0, center - 800);
    const end = Math.min(collapsed.length, center + 1_400);
    chunks.push(collapsed.slice(start, end).trim());
  }
  return chunks;
}

function revenueDriverParagraphScore(paragraph: string): number {
  if (!hasPeriodSpecificRevenueDriverText(paragraph)) {
    return 0;
  }
  let score = 0;
  if (/(total net revenue|net revenue|net sales|sales and revenues|total sales and revenues|comparable sales)/i.test(paragraph)) score += 45;
  if (/(increased|decreased|up|down|higher|lower|growth|decline|%|compared)/i.test(paragraph)) score += 35;
  if (/(driven by|primarily due to|reflecting|reflected|attributable to|resulted from|partially offset|offset by)/i.test(paragraph)) score += 45;
  if (/(net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|card services)/i.test(paragraph)) score += 40;
  if (/(commodity prices?|crude demand|natural gas prices?|production volumes?|refining margins?|chemical margins?|upstream|downstream)/i.test(paragraph)) score += 40;
  if (/(sales volume|price realization|backlog|dealer inventory|equipment to end users|end-market demand)/i.test(paragraph)) score += 40;
  if (/(comparable sales|traffic|average ticket|transactions?|ecommerce|e-commerce|membership|unit volumes)/i.test(paragraph)) score += 40;
  if (isRevenueDriverDistractor(paragraph)) score -= 120;
  return score;
}

function isRevenueDriverDistractor(text: string): boolean {
  return /(item 2\. properties|headquarters|office locations?|square footage|available information|corporate website|risk factors|forward-looking statements|opened our first|began our first international initiative|store footprint|remodeling existing locations)/i.test(text) &&
    !/(total net revenue|net revenue|net sales|sales and revenues|comparable sales|sales volume|price realization|net interest income|noninterest revenue|refining margins|production volumes)/i.test(text);
}

function isRevenueParagraphOverlap(left: string, right: string): boolean {
  return left.includes(right.slice(0, 220)) || right.includes(left.slice(0, 220));
}

function normalizeForSourceDedup(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function splitMdaParagraphs(mdaText: string): string[] {
  const paragraphs = mdaText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .filter((paragraph) => !looksLikeTocParagraph(paragraph));

  if (paragraphs.length >= 2) {
    return paragraphs;
  }

  const collapsed = mdaText.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < collapsed.length && chunks.length < 8) {
    let end = Math.min(cursor + 1_100, collapsed.length);
    if (end < collapsed.length) {
      const boundary = Math.max(
        collapsed.lastIndexOf(". ", end),
        collapsed.lastIndexOf("; ", end),
        collapsed.lastIndexOf("? ", end),
        collapsed.lastIndexOf("! ", end)
      );
      if (boundary > cursor + 200) {
        end = boundary + 1;
      }
    }

    const candidate = collapsed.slice(cursor, end).trim();
    if (candidate && !looksLikeTocParagraph(candidate)) {
      chunks.push(candidate);
    }
    cursor = end;
  }

  return chunks;
}

function looksLikeTocParagraph(paragraph: string): boolean {
  const sample = paragraph.slice(0, 320);
  const itemMentions = [...sample.matchAll(/item\s+\d/gi)].length;
  return /table of contents/i.test(sample) || /pagepart/i.test(sample) || itemMentions >= 3;
}

function safeUrlHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
