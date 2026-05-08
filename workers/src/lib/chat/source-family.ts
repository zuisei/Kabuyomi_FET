import type { SourceChunkRecord } from "../../env";

export type SourceSectionFamily =
  | "mda"
  | "xbrl_metric"
  | "revenue_discussion"
  | "segment_revenue"
  | "revenue_note"
  | "margin_discussion"
  | "cost_discussion"
  | "profitability_discussion"
  | "bank_profitability_discussion"
  | "energy_margin_discussion"
  | "retail_margin_discussion"
  | "industrial_margin_discussion"
  | "context_window"
  | "hard_context_window"
  | "unknown";

const REVENUE_NOTE_PATTERN =
  /(disaggregated revenue|revenue by|net sales by|products and services performance|sales by category|contract with customer|remaining performance obligations)/i;
const SEGMENT_REVENUE_PATTERN =
  /(segment and revenue context|segment results|segment revenue|reportable segment|geographic segment|net sales by (?:category|segment|geographic|region)|walmart u\.s\.|walmart international|sam'?s club|upstream|downstream|energy products|chemical products|construction industries|resource industries|power & energy)/i;
const REVENUE_DRIVER_SIGNAL_PATTERN =
  /(total net revenue|net sales|revenue|sales|net interest income|noninterest income|noninterest revenue|markets revenue|investment banking fees|product revenue|services revenue|comparable sales|traffic|average ticket|transactions?|commodity prices?|production volumes?|refining margins?|price realization|sales volume|equipment to end users|orders|backlog).{0,180}(increase|decrease|growth|decline|higher|lower|primarily due|driven by|attributable to|resulted from|reflecting|price|volume|mix|product revenue|services revenue|segment results|geographic|foreign exchange|commodity|production|traffic|ticket|ecommerce|e-commerce|orders|backlog)/i;
const BANK_PROFITABILITY_PATTERN =
  /(net interest margin|deposit margin compression|provision for credit losses|credit loss expense|net charge-offs?|noninterest expense|compensation expense|efficiency ratio|segment profitability|pre-provision profit)/i;
const ENERGY_MARGIN_PATTERN =
  /(refining margins?|chemical margins?|upstream earnings|downstream earnings|production costs?|depreciation|depletion).{0,220}(margin|profit|earnings|cost|expense|increase|decrease|higher|lower|reflecting|driven|due to|offset)/i;
const RETAIL_MARGIN_PATTERN =
  /(gross margin rate|markdowns?|shrink|inventory|fuel prices?|ecommerce fulfillment|e-commerce fulfillment|wage|labor costs?|advertising income|membership income).{0,220}(margin|profit|income|cost|expense|increase|decrease|higher|lower|reflecting|driven|due to|offset)/i;
const INDUSTRIAL_MARGIN_PATTERN =
  /(price realization|manufacturing costs?|material costs?|volume leverage|sales volume|dealer inventor(?:y|ies)|warranty|quality costs?|restructuring|segment operating profit|operating profit margin).{0,220}(margin|profit|income|cost|expense|increase|decrease|higher|lower|reflecting|driven|due to|offset)/i;
const COST_DISCUSSION_PATTERN =
  /(cost of sales|cost of revenue|operating expenses?|sg&a|sga|r&d|research and development|input costs?|labor costs?|fuel|freight|logistics|tariff|foreign exchange|fx|impairment|restructuring|depreciation|amortization|depletion|one-time charge)/i;
const MARGIN_DISCUSSION_PATTERN =
  /(gross margin|operating margin|profit margin|operating income margin|margin rate|profitability|gross profit|operating income|segment operating income|segment operating profit|price-cost)/i;

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
  if (BANK_PROFITABILITY_PATTERN.test(text)) {
    return "bank_profitability_discussion";
  }
  if (ENERGY_MARGIN_PATTERN.test(text)) {
    return "energy_margin_discussion";
  }
  if (INDUSTRIAL_MARGIN_PATTERN.test(text)) {
    return "industrial_margin_discussion";
  }
  if (RETAIL_MARGIN_PATTERN.test(text)) {
    return "retail_margin_discussion";
  }
  if (MARGIN_DISCUSSION_PATTERN.test(text)) {
    return "margin_discussion";
  }
  if (COST_DISCUSSION_PATTERN.test(text)) {
    return "cost_discussion";
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
