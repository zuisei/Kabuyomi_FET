import type { SourceChunkRecord } from "../../env";

export type SourceSectionFamily =
  | "mda"
  | "xbrl_metric"
  | "revenue_discussion"
  | "segment_revenue"
  | "revenue_note"
  | "context_window"
  | "hard_context_window"
  | "unknown";

const REVENUE_NOTE_PATTERN =
  /(disaggregated revenue|revenue by|net sales by|products and services performance|sales by category|contract with customer|remaining performance obligations)/i;
const SEGMENT_REVENUE_PATTERN =
  /(segment and revenue context|segment results|segment revenue|reportable segment|geographic segment|net sales by (?:category|segment|geographic|region)|walmart u\.s\.|walmart international|sam'?s club|upstream|downstream|energy products|chemical products|construction industries|resource industries|power & energy)/i;
const REVENUE_DRIVER_SIGNAL_PATTERN =
  /(net sales|revenue|sales|net interest income|noninterest income|product revenue|services revenue|comparable sales|traffic|ticket|commodity prices?|production volume|price realization|sales volume|orders|backlog).{0,180}(increase|decrease|growth|decline|higher|lower|primarily due|driven by|attributable to|resulted from|price|volume|mix|product revenue|services revenue|segment results|geographic|foreign exchange|commodity|production|traffic|ticket|ecommerce|e-commerce|orders|backlog)/i;

export function selectedSourceTypes(sources: SourceChunkRecord[]): string[] {
  return [...new Set(sources.map((source) => source.sectionType).filter(Boolean))];
}

export function selectedSourceSectionFamilies(sources: SourceChunkRecord[]): SourceSectionFamily[] {
  return [...new Set(sources.map(deriveSourceSectionFamily))];
}

export function deriveSourceSectionFamily(source: SourceChunkRecord): SourceSectionFamily {
  if (isMetricSource(source)) {
    return "xbrl_metric";
  }
  if (/^HARDCTX/i.test(source.sourceId)) {
    return "hard_context_window";
  }

  const text = sourceFamilyHaystack(source);
  if (REVENUE_NOTE_PATTERN.test(text)) {
    return "revenue_note";
  }
  if (SEGMENT_REVENUE_PATTERN.test(text)) {
    return "segment_revenue";
  }
  if (hasRevenueDriverSignal(source)) {
    return "revenue_discussion";
  }
  if (/^CTX/i.test(source.sourceId)) {
    return "context_window";
  }
  if (source.sectionType === "md_a") {
    return "mda";
  }
  return "unknown";
}

export function hasRevenueDriverSignal(source: SourceChunkRecord): boolean {
  return REVENUE_DRIVER_SIGNAL_PATTERN.test(sourceFamilyHaystack(source));
}

export function hasSegmentRevenueSignal(source: SourceChunkRecord): boolean {
  const text = sourceFamilyHaystack(source);
  return SEGMENT_REVENUE_PATTERN.test(text) || REVENUE_NOTE_PATTERN.test(text);
}

function isMetricSource(source: SourceChunkRecord): boolean {
  return source.sectionType === "xbrl_metric" || /xbrl/i.test(source.sourceLabel);
}

function sourceFamilyHaystack(source: SourceChunkRecord): string {
  return `${source.sourceLabel} ${source.sectionTitle} ${source.text}`.replace(/\s+/g, " ").trim();
}
