import type { Env, FilingCacheRecord, FilingReference, MetricSnapshot, SourceChunkRecord } from "../../env";
import { generateSummary } from "../../clients/gemini";
import { buildPrimaryDocumentUrl, fetchFilingAssets, fetchMetricSnapshots } from "../../clients/sec";
import { extractMDASectionWithDiagnostics } from "../../extractors/mda";
import { AppError } from "../errors";
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
    const fetched = await fetchFilingAssets(filing, comparisonFiling, env);
    html = fetched.html;
    primaryDocumentUrl = fetched.primaryDocumentUrl;
    metrics = fetched.metrics;
    const fetchedAt = Date.now();
    const { result: extracted, diagnostics } = extractMDASectionWithDiagnostics(html, filing.formType);
    if (!extracted) {
      logEvent("extraction_failed", {
        ticker: filing.ticker,
        cik: filing.cik,
        formType: filing.formType,
        accessionNumber: filing.accessionNumber,
        summaryMode,
        contentMode,
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
      fetchMs: fetchedAt - fetchStartedAt,
      ...diagnostics
    });
  }
  const fetchedAt = Date.now();

  const filingKey = `${config.extractorVersion}:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}`;
  const sourceChunks = buildSourceChunks(filing, extractedText, metrics);
  const summaryEnv = summaryMode === "fallback_only" ? ({ ...env, GEMINI_API_KEY: undefined } as Env) : env;
  const summaryStartedAt = Date.now();
  const summary = await generateSummary(summaryEnv, {
    filingKey,
    ticker: filing.ticker,
    companyName: filing.companyName,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    metrics,
    sourceChunks
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
    totalMs: finishedAt - startedAt,
    htmlChars: html.length,
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
    mdaText: extractedText,
    mdaTokenCount: extractedTokenCount,
    metrics,
    sourceChunks,
    summary,
    generatedAt: new Date().toISOString(),
    extractorVersion: config.extractorVersion,
    promptVersion: config.promptVersion
  };
}

export function buildSourceChunks(
  filing: FilingReference,
  mdaText: string,
  metrics: MetricSnapshot[]
): SourceChunkRecord[] {
  const chunks: SourceChunkRecord[] = [];
  const mdParagraphs = splitMdaParagraphs(mdaText);

  let mdOffset = 0;
  let sourceIndex = 1;

  for (const paragraph of mdParagraphs) {
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
