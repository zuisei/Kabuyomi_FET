import type { Env, FilingCacheRecord, FilingReference, MetricSnapshot, SourceChunkRecord } from "../../env";
import { generateSummary } from "../../clients/gemini";
import { fetchFilingAssets } from "../../clients/sec";
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
  options: { summaryMode?: "default" | "fallback_only" } = {}
): Promise<FilingCacheRecord> {
  const startedAt = Date.now();
  const summaryMode = options.summaryMode ?? "default";
  const fetchStartedAt = Date.now();
  const { html, primaryDocumentUrl, metrics } = await fetchFilingAssets(filing, comparisonFiling, env);
  const fetchedAt = Date.now();
  const { result: extracted, diagnostics } = extractMDASectionWithDiagnostics(html, filing.formType);
  if (!extracted) {
    logEvent("extraction_failed", {
      ticker: filing.ticker,
      cik: filing.cik,
      formType: filing.formType,
      accessionNumber: filing.accessionNumber,
      summaryMode,
      fetchMs: fetchedAt - fetchStartedAt,
      ...diagnostics
    });
    throw new AppError(422, "Failed to extract MD&A section");
  }

  logEvent("extraction_succeeded", {
    ticker: filing.ticker,
      cik: filing.cik,
      formType: filing.formType,
      accessionNumber: filing.accessionNumber,
      tokenCount: extracted.tokenCount,
      summaryMode,
      fetchMs: fetchedAt - fetchStartedAt,
      ...diagnostics
    });

  const filingKey = `${config.extractorVersion}:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}`;
  const sourceChunks = buildSourceChunks(filing, extracted.text, metrics);
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
    fetchMs: fetchedAt - fetchStartedAt,
    summaryMs: finishedAt - summaryStartedAt,
    totalMs: finishedAt - startedAt,
    htmlChars: html.length,
    metricsCount: metrics.length,
    sourceChunkCount: sourceChunks.length,
    mdaChars: extracted.text.length,
    mdaTokenCount: extracted.tokenCount,
    primaryDocumentHost: safeUrlHost(primaryDocumentUrl),
    usedStartPattern: extracted.usedStartPattern,
    usedEndPattern: extracted.usedEndPattern,
    inputHtmlChars: diagnostics.inputHtmlChars,
    normalizedChars: diagnostics.normalizedChars,
    startMatchesCount: diagnostics.startMatchesCount,
    endMatchesCount: diagnostics.endMatchesCount,
    normalizeMs: diagnostics.normalizeMs,
    boundaryScanMs: diagnostics.boundaryScanMs,
    selectionMs: diagnostics.selectionMs,
    extractTotalMs: diagnostics.totalMs
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
    mdaText: extracted.text,
    mdaTokenCount: extracted.tokenCount,
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
