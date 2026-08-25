import type { Env, FilingCacheRecord, FilingReference, MetricSnapshot, SourceChunkRecord } from "../../env";
import { generateModelSummary } from "../../clients/llm/provider";
import {
  buildPrimaryDocumentUrl,
  fetchFilingAssets,
  fetchMetricSnapshots,
  fetchPreparedFiling,
  loadQuarterlyNarrative
} from "../../clients/sec";
import { extractMDASectionWithDiagnostics, normalizeFilingText } from "../../extractors/mda";
import { AppError } from "../errors";
import { extractCompanyWebsiteUrl } from "./company-website";
import { logLlmUsage } from "../llm-usage";
import { logEvent } from "../logging";
import { metricLabel } from "../metrics";
import {
  quarterlyNarrativeSectionTitle,
  type QuarterlyNarrative
} from "./quarterly-narrative";
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
  let supplementalEvidenceText = "";
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
    supplementalEvidenceText = prepared?.supplementalEvidenceText ?? "";
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
    revenueDriverSearchText: html
      ? normalizeFilingText(html)
      : [extractedText, supplementalEvidenceText].filter(Boolean).join("\n\n"),
    marginDriverSearchText: html ? normalizeFilingText(html) : extractedText,
    primaryDocumentUrl
  });

  // 20-F は年 1 回しか出ない。会話が直近の四半期に答えられるよう、
  // 6-K の業績プレスリリースを**本文として**足す(2026-08-25)。
  // 数値は取り込まない — プレスリリースは現地通貨で、指標は USD で揃えてある。
  // 取れなくても取り込みは続ける。四半期が無いのは、資料が開けないより軽い。
  if (filing.formType === "20-F") {
    try {
      const quarterly = await loadQuarterlyNarrative(filing, env);
      if (quarterly) {
        sourceChunks.push(...buildQuarterlyNarrativeChunks(quarterly, sourceChunks.length));
        logEvent("quarterly_narrative_attached", {
          ticker: filing.ticker,
          accessionNumber: quarterly.accessionNumber,
          kind: quarterly.kind,
          quarter: quarterly.period.quarter,
          calendarYear: quarterly.period.calendarYear
        });
      }
    } catch (error) {
      logEvent("quarterly_narrative_skipped", {
        ticker: filing.ticker,
        failureClass: error instanceof Error ? error.name : typeof error
      });
    }
  }

  const summaryStartedAt = Date.now();
  // 以前は GEMINI_API_KEY を undefined にしてフォールバックへ落としていたが、
  // プロバイダが増えると成立しないため意図を引数で表す。
  const generatedSummary = await generateModelSummary(env, {
    filingKey,
    ticker: filing.ticker,
    companyName: filing.companyName,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    metrics,
    sourceChunks
  }, { forceFallback: summaryMode === "fallback_only" });
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

/// 6-K の本文を、引用できる単位に割って source chunk にする。
///
/// `sectionType` は `md_a` のまま。会話側の引用選択が全部この型で書かれており、
/// 新しい型を足すと**どの選択にも引っかからず、足した意味が無くなる**。
/// 年次報告書と取り違えられないための区別は、見出し・ラベル・出典 URL・
/// accession が担う(いずれも 6-K のものを持たせる)。
export function buildQuarterlyNarrativeChunks(
  narrative: QuarterlyNarrative,
  startIndex: number
): SourceChunkRecord[] {
  const title = quarterlyNarrativeSectionTitle(narrative);
  const paragraphs = splitMdaParagraphs(narrative.text).slice(0, 6);
  let offset = 0;

  return paragraphs.map((paragraph, index) => {
    const excerpt = paragraph.slice(0, 1_100);
    const chunk: SourceChunkRecord = {
      sourceId: `Q${index + 1}`,
      sectionType: "md_a",
      sectionTitle: title,
      sourceLabel: `6-K ${title}, filed ${narrative.filedAt}`,
      text: excerpt,
      startOffset: offset,
      endOffset: offset + excerpt.length,
      sourceUrl: narrative.documentUrl,
      filingAccessionNumber: narrative.accessionNumber,
      sortOrder: startIndex + index + 1
    };
    offset += paragraph.length;
    return chunk;
  });
}

export function buildSourceChunks(
  filing: FilingReference,
  mdaText: string,
  metrics: MetricSnapshot[],
  options: {
    revenueDriverSearchText?: string;
    marginDriverSearchText?: string;
    primaryDocumentUrl?: string;
  } = {}
): SourceChunkRecord[] {
  const chunks: SourceChunkRecord[] = [];
  const mdParagraphs = splitMdaParagraphs(mdaText);
  const revenueSearchText = options.revenueDriverSearchText ?? mdaText;
  const marginSearchText = options.marginDriverSearchText ?? revenueSearchText;
  const segmentRevenueComparison = buildEnergySegmentRevenueComparison(revenueSearchText);
  const revenueDriverParagraphs = selectRevenueDriverParagraphs(revenueSearchText);
  const marginDriverParagraphs = selectMarginDriverParagraphs(marginSearchText);
  const currentSourceUrl = options.primaryDocumentUrl ?? buildPrimaryDocumentUrl(filing);

  let mdOffset = 0;
  let sourceIndex = 1;

  if (segmentRevenueComparison) {
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "md_a",
      sectionTitle: "Segment revenue comparison",
      sourceLabel: `${filing.formType} Segment revenue comparison, filed ${filing.filedAt}`,
      text: segmentRevenueComparison,
      startOffset: 0,
      endOffset: segmentRevenueComparison.length,
      sourceUrl: currentSourceUrl,
      filingAccessionNumber: filing.accessionNumber,
      periodEnd: filing.periodOfReport,
      sortOrder: sourceIndex
    });
    sourceIndex += 1;
  }

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

  for (const paragraph of marginDriverParagraphs) {
    if (
      revenueDriverParagraphs.some((driverParagraph) =>
        isRevenueParagraphOverlap(normalizeForSourceDedup(paragraph), normalizeForSourceDedup(driverParagraph))
      )
    ) {
      continue;
    }
    const excerpt = paragraph.slice(0, 1_100);
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "md_a",
      sectionTitle: "Margin and profitability discussion",
      sourceLabel: `${filing.formType} Margin and profitability discussion, filed ${filing.filedAt}`,
      text: excerpt,
      startOffset: 0,
      endOffset: excerpt.length,
      sortOrder: sourceIndex
    });
    sourceIndex += 1;
    if (sourceIndex > 8) {
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
    if (
      marginDriverParagraphs.some((driverParagraph) =>
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
    const hasDistinctComparisonSource = metric.comparisonValue !== undefined && (
      (Boolean(metric.comparisonSourceUrl) && metric.comparisonSourceUrl !== currentSourceUrl)
      || (Boolean(metric.comparisonTagUsed) && metric.comparisonTagUsed !== metric.tagUsed)
      || (
        Boolean(metric.comparisonAccessionNumber)
        && metric.comparisonAccessionNumber !== filing.accessionNumber
      )
    );
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "xbrl_metric",
      sectionTitle: metricLabel(metric.logicalName),
      sourceLabel: `XBRL ${metricLabel(metric.logicalName)} (${metric.tagUsed})`,
      text: [
        `${metricLabel(metric.logicalName)}: ${metric.value} ${metric.unit}`,
        !hasDistinctComparisonSource && metric.comparisonValue !== undefined
          ? `比較値: ${metric.comparisonValue}`
          : null,
        !hasDistinctComparisonSource && metric.yoyPercent !== undefined
          ? `YoY: ${metric.yoyPercent.toFixed(1)}%`
          : null
      ]
        .filter(Boolean)
        .join(" / "),
      startOffset: 0,
      endOffset: 0,
      tagName: metric.tagUsed,
      sourceUrl: currentSourceUrl,
      filingAccessionNumber: filing.accessionNumber,
      metricRole: "current",
      periodEnd: metric.periodEnd,
      sortOrder: sourceIndex
    });
    sourceIndex += 1;

    if (hasDistinctComparisonSource) {
      const comparisonTag = metric.comparisonTagUsed ?? metric.tagUsed;
      chunks.push({
        sourceId: `S${sourceIndex}`,
        sectionType: "xbrl_metric",
        sectionTitle: `${metricLabel(metric.logicalName)}（比較期）`,
        sourceLabel: `XBRL ${metricLabel(metric.logicalName)} comparison (${comparisonTag})`,
        text: [
          `${metricLabel(metric.logicalName)}（比較期）: ${metric.comparisonValue} ${metric.unit}`,
          metric.comparisonPeriodEnd ? `period end: ${metric.comparisonPeriodEnd}` : null
        ]
          .filter(Boolean)
          .join(" / "),
        startOffset: 0,
        endOffset: 0,
        tagName: comparisonTag,
        sourceUrl: metric.comparisonSourceUrl,
        filingAccessionNumber: metric.comparisonAccessionNumber,
        metricRole: "comparison",
        periodEnd: metric.comparisonPeriodEnd,
        sortOrder: sourceIndex
      });
      sourceIndex += 1;
    }
  }

  return chunks;
}

export function hasStrongRevenueDriverSource(source: SourceChunkRecord): boolean {
  return source.sectionType !== "xbrl_metric" &&
    hasPeriodSpecificRevenueDriverText(`${source.sourceLabel} ${source.sectionTitle} ${source.text}`);
}

export function hasStrongMarginDriverSource(source: SourceChunkRecord): boolean {
  return source.sectionType !== "xbrl_metric" &&
    hasPeriodSpecificMarginDriverText(`${source.sourceLabel} ${source.sectionTitle} ${source.text}`);
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
  const hasCausalLanguage = /(driven by|due to|primarily due to|reflect(?:ing|ed|s)|attributable to|resulted from|resulting in|because of|partially offset|offset by|as a result)/i.test(normalized);
  const hasSectorDriver =
    /(net interest income|noninterest revenue|noninterest income|markets revenue|investment banking fees|card services|commodity prices?|crude demand|natural gas prices?|production volumes?|refining margins?|chemical margins?|upstream|downstream|vehicle deliveries|deliveries|automotive revenues?|automotive sales|vehicle pricing|average selling price|energy generation|energy storage|services and other|sales volume|price realization|backlog|dealer inventory|equipment to end users|end-market demand|comparable sales|traffic|average ticket|transactions?|ecommerce|e-commerce|membership|unit volumes|iphone|product launches?|geographic segments?|services net sales|services revenue|product net sales|product revenue)/i.test(normalized);
  const hasCurrentPeriodCue = /(202[0-9]|fiscal|year ended|three months ended|quarter|current year|compared with|compared to|前年比|前年同期比|%)/i.test(normalized);
  const hasCategoryMovementTable =
    /(?:products and services performance|sales by category|net sales by category)/i.test(normalized) &&
    /(?:net sales|revenue)/i.test(normalized) &&
    (normalized.match(/\$?\d[\d,.%]*/g)?.length ?? 0) >= 6;
  if (hasEnergyRevenueDriverTerm(normalized) && !hasCurrentPeriodEnergyResultContext(normalized)) {
    return false;
  }

  const hasStrongDriverExplanation = hasRevenueMovement && hasCausalLanguage && hasSectorDriver;
  return (hasCategoryMovementTable || ((hasCurrentPeriodCue || hasStrongDriverExplanation) && ((hasRevenueMovement && (hasCausalLanguage || hasSectorDriver)) || (hasCausalLanguage && hasSectorDriver)))) &&
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

function buildEnergySegmentRevenueComparison(text: string): string | null {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const noteStart = collapsed.search(/Note\s+\d+\.\s+Disclosures about Segments and Related Information/i);
  if (noteStart < 0) {
    return null;
  }

  const segmentSection = collapsed.slice(noteStart, noteStart + 40_000);
  if (!/Upstream\s+Energy Products\s+Chemical Products\s+Specialty Products/i.test(segmentSection)) {
    return null;
  }

  const rows = [...segmentSection.matchAll(
    /Three Months Ended\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})\s+Revenues and other income\s+Sales and other operating revenue\s+((?:\(?[\d,]+\)?\s+){8}\(?[\d,]+\)?)(?=\s|$)/gi
  )]
    .map((match) => ({
      period: match[1] ?? "",
      values: parseSegmentRevenueRow(match[2] ?? "")
    }))
    .filter((row): row is { period: string; values: number[] } => row.values !== null);
  if (rows.length < 2) {
    return null;
  }

  const ordered = rows
    .map((row) => ({ ...row, year: Number(row.period.match(/20\d{2}/)?.[0] ?? 0) }))
    .filter((row) => row.year > 0)
    .sort((left, right) => right.year - left.year);
  const current = ordered[0];
  const comparison = ordered.find((row) => row.year < (current?.year ?? 0));
  if (!current || !comparison) {
    return null;
  }

  const segmentLabels = ["Upstream", "Energy Products", "Chemical Products", "Specialty Products"];
  const changes = segmentLabels.map((label, index) => {
    const currentValue = current.values[index * 2]! + current.values[index * 2 + 1]!;
    const comparisonValue = comparison.values[index * 2]! + comparison.values[index * 2 + 1]!;
    return {
      label,
      currentValue,
      comparisonValue,
      change: currentValue - comparisonValue
    };
  });
  const largestIncrease = [...changes].sort((left, right) => right.change - left.change)[0];
  const largestOffset = [...changes].sort((left, right) => left.change - right.change)[0];
  if (!largestIncrease || largestIncrease.change <= 0 || !largestOffset || largestOffset.change >= 0) {
    return null;
  }

  const otherSignals = changes
    .filter((entry) => entry.label !== largestIncrease.label && entry.label !== largestOffset.label)
    .map((entry) => {
      const comparisonMagnitude = Math.max(1, Math.abs(entry.comparisonValue));
      if (Math.abs(entry.change) / comparisonMagnitude < 0.001) {
        return `${entry.label} was essentially flat`;
      }
      return `${entry.label} ${entry.change > 0 ? "increased" : "decreased"}`;
    });

  return [
    `Reportable-segment sales and other operating revenue comparison for the three months ended ${current.period} versus ${comparison.period}:`,
    `${largestIncrease.label} increased and was the largest positive segment change;`,
    `${largestOffset.label} decreased and was the largest offset;`,
    `${otherSignals.join("; ")}.`,
    "This observed segment sales bridge does not establish price, production-volume, commodity-market, foreign-exchange, cost, or earnings causality."
  ].join(" ");
}

function parseSegmentRevenueRow(raw: string): number[] | null {
  const values = raw.trim().split(/\s+/).map((token) => {
    const negative = /^\([\d,]+\)$/.test(token);
    const parsed = Number(token.replace(/[(),]/g, ""));
    return negative ? -parsed : parsed;
  });
  return values.length === 9 && values.every(Number.isFinite) ? values : null;
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

function selectMarginDriverParagraphs(text: string): string[] {
  const candidates = splitMarginSearchParagraphs(text)
    .map((paragraph, index) => ({ paragraph, index, score: marginDriverParagraphScore(paragraph) }))
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

function splitMarginSearchParagraphs(text: string): string[] {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const paragraphs = text
    .split(/\n{2,}|(?<=\.)\s+(?=(?:Gross margin|Automotive gross margin|Operating margin|Operating income|Segment operating profit|Net income|Provision for credit losses|Refining margins|Chemical margins|Upstream earnings|Downstream earnings)\b)/i)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length >= 80 && paragraph.length <= 4_000)
    .filter((paragraph) => !looksLikeTocParagraph(paragraph));
  if (paragraphs.length > 0) {
    return paragraphs;
  }

  const chunks: string[] = [];
  const pattern = /gross margin|automotive gross margin|operating margin|operating income|segment operating profit|cost of sales|cost of revenue|operating expenses?|noninterest expense|provision for credit losses|credit loss expense|vehicle pricing|average selling price|production costs?|warranty|restructuring|deliveries|price realization|manufacturing cost|markdown|shrink|inventory|refining margins?|chemical margins?|upstream earnings|downstream earnings|depreciation|depletion/gi;
  for (const match of collapsed.matchAll(pattern)) {
    const center = match.index ?? 0;
    const start = Math.max(0, center - 800);
    const end = Math.min(collapsed.length, center + 1_400);
    chunks.push(collapsed.slice(start, end).trim());
  }
  return chunks;
}

function marginDriverParagraphScore(paragraph: string): number {
  if (!hasPeriodSpecificMarginDriverText(paragraph)) {
    return 0;
  }
  let score = 0;
  if (/(gross margin|operating margin|profit margin|gross profit|operating income|segment operating profit|net income)/i.test(paragraph)) score += 45;
  if (/(cost of sales|cost of revenue|operating expenses?|noninterest expense|provision for credit losses|credit loss expense|production costs?|manufacturing costs?|warranty|markdowns?|shrink|inventory|fulfillment costs?|labor costs?|wage|refining margins?|chemical margins?|depreciation|depletion|impairment|restructuring)/i.test(paragraph)) score += 45;
  if (/(increased|decreased|improved|declined|higher|lower|up|down|compared|%)/i.test(paragraph)) score += 30;
  if (/(driven by|primarily due to|reflecting|reflected|attributable to|resulted from|partially offset|offset by|because|expected|expects|outlook|continue|continued|temporary|one-time|uncertain|risk)/i.test(paragraph)) score += 45;
  if (/(products? gross margin|services gross margin|product mix|services mix|r&d|research and development|sg&a|sga|tariff|foreign exchange)/i.test(paragraph)) score += 30;
  if (/(gross margin rate|markdowns?|shrink|inventory|fulfillment|wage|labor|fuel|operating expense leverage|operating expense deleverage)/i.test(paragraph)) score += 35;
  if (/(price realization|price-cost|manufacturing costs?|volume leverage|cost absorption|dealer inventory|segment operating profit)/i.test(paragraph)) score += 35;
  if (/(refining margins?|chemical margins?|upstream earnings|downstream earnings|production costs?|operating expenses?)/i.test(paragraph)) score += 35;
  if (/(automotive gross margin|vehicle pricing|average selling price|deliveries|production costs?|warranty|restructuring|energy generation|energy storage|services and other)/i.test(paragraph)) score += 35;
  if (isMarginDriverDistractor(paragraph)) score -= 140;
  return score;
}

function hasPeriodSpecificMarginDriverText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (isMarginDriverDistractor(normalized)) {
    return false;
  }
  if (isTableOnlyMarginText(normalized)) {
    return false;
  }
  const hasMarginTerm =
    /(gross margin|automotive gross margin|operating margin|profit margin|gross profit|operating income|segment operating profit|net income|cost of sales|cost of revenue|operating expenses?|noninterest expense|provision for credit losses|credit loss expense|production costs?|manufacturing costs?|warranty|markdowns?|shrink|inventory|fulfillment costs?|labor costs?|wage|refining margins?|chemical margins?|depreciation|depletion|impairment|restructuring)/i.test(normalized);
  const hasPeriodMovement =
    /(increased|decreased|improved|declined|higher|lower|up|down|compared|year ended|three months ended|quarter|fiscal|202[0-9]|%)/i.test(normalized);
  const hasCausalOrDurability =
    /(driven by|primarily due to|reflecting|reflected|attributable to|resulted from|partially offset|offset by|because|expected|expects|outlook|continue|continued|temporary|one-time|uncertain|risk|headwind|tailwind|normalization|structural)/i.test(normalized);
  const hasSectorMarginSignal =
    /(products? gross margin|services gross margin|automotive gross margin|product mix|services mix|vehicle pricing|average selling price|deliveries|warranty|r&d|research and development|sg&a|sga|tariff|foreign exchange|gross margin rate|markdowns?|shrink|inventory|fulfillment|wage|labor|fuel|price realization|price-cost|manufacturing costs?|volume leverage|cost absorption|dealer inventory|refining margins?|chemical margins?|upstream earnings|downstream earnings|production costs?)/i.test(normalized);
  return hasMarginTerm && hasPeriodMovement && (hasCausalOrDurability || hasSectorMarginSignal);
}

function isTableOnlyMarginText(text: string): boolean {
  const numberTokens = text.match(/\$?\d[\d,.%]*/g)?.length ?? 0;
  return numberTokens >= 8 &&
    /\b(?:three months ended|year ended|gross margin percentage|dollars in millions|percentage of total net sales|total gross margin|operating expenses?)\b/i.test(text) &&
    !/(primarily due to|driven by|attributable to|resulted from|because|reflect(?:ed|ing)|expected|outlook|continue|continued|risk|uncertain|temporary|one-time|restructuring|impairment|headwind|tailwind)/i.test(text);
}

function isMarginDriverDistractor(text: string): boolean {
  return /(item 2\. properties|headquarters|office locations?|square footage|available information|corporate website|forward-looking statements|proved reserves?|reserve disclosures?|long[- ]term commodity outlook|store footprint|opened our first|business description|table of contents)/i.test(text) &&
    !/(gross margin|operating margin|operating income|segment operating profit|cost|expense|provision|refining margins?|chemical margins?|markdown|shrink|inventory)/i.test(text);
}

function chunkRevenueSearchText(text: string): string[] {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const chunks: string[] = [];
  const pattern = /total net revenue|net revenue|sales and revenues|sales and other operating revenue|net sales|automotive revenues?|automotive sales|vehicle deliveries|deliveries|energy generation|energy storage|services and other|comparable sales|upstream earnings|downstream earnings|energy products sales|record crude demand|refining margins|production volumes|sales volume|price realization|net interest income|noninterest revenue|investment banking fees/gi;
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
  if (/(commodity prices?|crude demand|natural gas prices?|production volumes?|refining margins?|chemical margins?|upstream earnings|downstream earnings|energy products sales|upstream|downstream)/i.test(paragraph)) score += 40;
  if (/(vehicle deliveries|deliveries|automotive revenues?|automotive sales|vehicle pricing|average selling price|energy generation|energy storage|services and other|automotive gross margin)/i.test(paragraph)) score += 40;
  if (/(sales volume|price realization|backlog|dealer inventory|equipment to end users|end-market demand)/i.test(paragraph)) score += 40;
  if (/(comparable sales|traffic|average ticket|transactions?|ecommerce|e-commerce|membership|unit volumes)/i.test(paragraph)) score += 40;
  if (isRevenueDriverDistractor(paragraph)) score -= 120;
  return score;
}

function isRevenueDriverDistractor(text: string): boolean {
  return /(item 2\. properties|headquarters|office locations?|square footage|available information|corporate website|risk factors|forward-looking statements|proved reserves?|reserve disclosures?|production sharing contracts?|energy transition|opened our first|began our first international initiative|store footprint|remodeling existing locations)/i.test(text) &&
    !/(total net revenue|net revenue|net sales|sales and revenues|comparable sales|sales volume|price realization|net interest income|noninterest revenue|refining margins|production volumes)/i.test(text);
}

function hasEnergyRevenueDriverTerm(text: string): boolean {
  return /(commodity prices?|crude|oil prices?|brent|natural gas prices?|liquids?|gas production|production volumes?|refining margins?|refinery margins?|chemical margins?|upstream|downstream|energy products sales|production sharing contracts?|proved reserves?)/i.test(text);
}

function hasCurrentPeriodEnergyResultContext(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  const hasEnergyResultMetric =
    /(sales and other operating revenue|revenue|sales|earnings|operating results?|upstream earnings|downstream earnings|energy products sales).{0,240}(increase|decrease|up|down|higher|lower|decline|growth|compared|affected|impact|reflected|reflecting|driven|due to|resulting)/i.test(normalized) ||
    /(increase|decrease|up|down|higher|lower|decline|growth|compared|affected|impact|reflected|reflecting|driven|due to|resulting).{0,240}(sales and other operating revenue|revenue|sales|earnings|operating results?|upstream earnings|downstream earnings|energy products sales)/i.test(normalized);
  const hasCurrentPeriodCue = /(202[0-9]|fiscal|year ended|three months ended|quarter|current year|compared with|compared to|%)/i.test(normalized);
  const hasResultDriver =
    /(crude prices?|oil prices?|brent|natural gas prices?|price realizations?|production volumes?|liquids?|gas production|refining margins?|refinery margins?|chemical margins?|upstream|downstream|volume\/mix|volume mix|price mix)/i.test(normalized);
  const isBroadOnly =
    /(proved reserves?|reserve disclosures?|long[- ]term|over the long term|market supply and demand|general economic activities|levels of prosperity|technology advances|consumer preference|government policies|production sharing contracts?|price effects on production sharing contracts|energy transition|risk factors?)/i.test(normalized) &&
    !/(sales and other operating revenue|revenue|earnings|operating results?).{0,240}(increase|decrease|up|down|higher|lower|decline|growth|affected|impact|reflected|reflecting|driven|due to|resulting)/i.test(normalized);

  const hasStrongEnergyResultExplanation = hasEnergyResultMetric && hasResultDriver;
  return (hasCurrentPeriodCue || hasStrongEnergyResultExplanation) && hasEnergyResultMetric && hasResultDriver && !isBroadOnly;
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
