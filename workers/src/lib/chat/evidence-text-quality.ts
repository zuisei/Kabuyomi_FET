import type { SourceChunkRecord } from "../../env";
import type { HardFinancialIntent, SourceGateSector } from "./source-gate";

export function isFragmentaryEvidenceText(text: string): boolean {
  const normalized = normalize(text);
  return (
    normalized.length < 30 ||
    /\.{3}|…/.test(normalized) ||
    /^[a-z][a-z]?[;,:]\s*•/.test(normalized) ||
    /^\W*[a-z]{1,3}\b/.test(normalized) ||
    /•\s*[A-Za-z]/.test(normalized)
  );
}

export function isMostlyEnglishRawExcerpt(text: string): boolean {
  const normalized = normalize(text);
  const latin = [...normalized].filter((char) => /[A-Za-z]/.test(char)).length;
  const japanese = [...normalized].filter((char) => /[\u3040-\u30ff\u3400-\u9fff]/u.test(char)).length;
  return latin > 80 && latin > japanese * 3;
}

export function isBoilerplateOrRiskOnly(
  text: string,
  sourceLabel = "",
  sectionType = ""
): boolean {
  const normalized = normalize(`${sourceLabel} ${sectionType} ${text}`);
  return (
    /(forward-looking statements|available information|investor relations website|trademark|table of contents|risk factors|risks related to|we urge you to carefully review|supervision and regulation)/i.test(normalized) &&
    !/(net sales|revenue increased|decreased|primarily due|driven by|attributable to|gross margin|operating margin|segment operating)/i.test(normalized)
  );
}

export function isSectionHeadingOrTableFragment(text: string): boolean {
  const normalized = normalize(text);
  return (
    /\b(?:Item\s+7|Part\s+I\.\s*Item|Results of Operations|Classes of Service|Public Utility Subsidiaries by Jurisdiction)\b/i.test(normalized) ||
    /\b(?:table|schedule|jurisdiction|classes of service)\b.{0,80}\b(?:amount|rate|revenue|subsidiaries)\b/i.test(normalized)
  );
}

export function isDriverLikeEvidence(
  text: string,
  intent: HardFinancialIntent,
  sector: SourceGateSector
): boolean {
  const normalized = normalize(text);
  if (
    isFragmentaryEvidenceText(normalized) ||
    isBoilerplateOrRiskOnly(normalized) ||
    isSectionHeadingOrTableFragment(normalized) ||
    isCountryOrJurisdictionList(normalized)
  ) {
    return false;
  }

  const causal = /(primarily due to|driven by|attributable to|resulted from|because|reflecting|as a result of|increased due to|decreased due to|増加.*要因|減少.*要因|主因|要因)/i;
  const financialTopic = intent === "margin_durability_followup"
    ? /(margin|profitability|gross profit|operating income|expense|cost|price-cost|provision|impairment|restructuring|segment operating)/i
    : /(net sales|revenue|sales|segment|geographic|product|volume|price|orders|backlog|traffic|ticket|net interest|noninterest|commodity|production)/i;
  const sectorTopic = sectorPattern(sector).test(normalized);

  return (causal.test(normalized) && financialTopic.test(normalized)) || (sectorTopic && causal.test(normalized));
}

export function isUnsafeDriverEvidence(
  source: Pick<SourceChunkRecord, "text" | "sourceLabel" | "sectionType">,
  intent: HardFinancialIntent,
  sector: SourceGateSector
): boolean {
  return !isDriverLikeEvidence(source.text, intent, sector) ||
    (isMostlyEnglishRawExcerpt(source.text) && isFragmentaryEvidenceText(source.text));
}

function sectorPattern(sector: SourceGateSector): RegExp {
  switch (sector) {
    case "bank":
      return /(net interest income|noninterest income|provision for credit losses|wealth management|investment banking|trading|deposits|loans)/i;
    case "energy":
      return /(commodity|crude oil|natural gas|production volume|drilling|completion|upstream|refining|oilfield)/i;
    case "industrial":
      return /(price realization|sales volume|orders|backlog|dealer inventory|manufacturing cost|construction equipment|agriculture equipment)/i;
    case "retail":
      return /(comparable sales|traffic|ticket|ecommerce|membership|advertising|gross margin|inventory)/i;
    case "technology":
      return /(product revenue|services revenue|subscription|usage|rpo|arr|customer growth|installed base|channel inventory)/i;
    case "general":
      return /(segment|revenue|margin|profitability|orders|backlog|pricing|volume)/i;
  }
}

function isCountryOrJurisdictionList(text: string): boolean {
  return /\b(?:U\.S\.|United States|Peru|Chile|Indonesia|China|Europe|Asia|Canada|Mexico),\s+[A-Z][A-Za-z]+,\s+[A-Z][A-Za-z]+/.test(text);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
