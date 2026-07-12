import type { SourceChunkRecord } from "../../env";
import type { HardFinancialIntent, SourceGateSector } from "./source-gate";

export function isFragmentaryEvidenceText(text: string): boolean {
  const normalized = normalize(text);
  return (
    normalized.length < 30 ||
    /\.{3}|…/.test(normalized) ||
    /^[a-z][a-z]?[;,:]\s*•/i.test(normalized) ||
    /^\W*[a-z]{1,3}[;,:](?:\s|$)/i.test(normalized)
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
  const hasPeriodDriverEvidence =
    /(net sales|revenue increased|decreased|primarily due|driven by|attributable to|gross margin|operating margin|segment operating|unit case volume|cloud revenue|revenue per user|seats grew|demand for our products|growth in)/i.test(normalized);
  return (
    /(forward-looking statements|available information|investor relations website|trademark|table of contents|risk factors|risks related to|we urge you to carefully review|supervision and regulation)/i.test(normalized) &&
    !hasPeriodDriverEvidence
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
  const causal = /(primarily due to|driven by|attributable to|resulted from|because|reflecting|as a result of|increased due to|decreased due to|増加.*要因|減少.*要因|主因|要因)/i;
  const financialTopic = intent === "margin_durability_followup"
    ? /(margin|profitability|gross profit|operating income|expense|cost|price-cost|pricing|price\/mix|foreign exchange|tariff|commodity cost|input cost|provision|impairment|restructuring|segment operating|depreciation|content acquisition|employee compensation|personnel|marketing|professional fees|litigation)/i
    : /(net sales|revenue|sales|segment|geographic|product|volume|price|orders|backlog|traffic|ticket|net interest|noninterest|commodity|production|cloud|subscription|revenue per user|seats?|copilot|unit case|demand)/i;
  const strongMarginCausalEvidence =
    intent === "margin_durability_followup" &&
    normalized.length >= 100 &&
    causal.test(normalized) &&
    financialTopic.test(normalized);
  const strongDriverCausalEvidence =
    intent === "driver_durability_followup" &&
    normalized.length >= 80 &&
    (causal.test(normalized) || /(increased|grew|growth|decreased|higher|lower)/i.test(normalized)) &&
    financialTopic.test(normalized);

  if (
    isBoilerplateOrRiskOnly(normalized) ||
    isCountryOrJurisdictionList(normalized)
  ) {
    return false;
  }
  if (isFragmentaryEvidenceText(normalized) || isSectionHeadingOrTableFragment(normalized)) {
    return strongMarginCausalEvidence || strongDriverCausalEvidence;
  }

  if (intent === "revenue_driver" || intent === "driver_durability_followup") {
    return isRevenueDriverEvidence(normalized, intent);
  }

  const sectorTopic = sectorPattern(sector).test(normalized);

  if ((causal.test(normalized) && financialTopic.test(normalized)) || (sectorTopic && causal.test(normalized))) {
    return true;
  }

  // PR4 source selection uses this predicate as a sufficiency gate before Gemini.
  // A complete MD&A paragraph with sector KPI + revenue/margin topic is useful
  // context even when the causal verb is in an adjacent sentence.
  return sectorTopic && normalized.length >= 80;
}

function isRevenueDriverEvidence(text: string, intent: HardFinancialIntent): boolean {
  const normalized = normalize(text);
  const causal = /(?:primarily due to|driven by|attributable to|resulted from|because|reflect(?:ed|ing|s)|as a result of|increased due to|decreased due to|positively contributed|partially offset|resulting in)/i;
  const revenueTopic = /(?:total net revenue|total revenues?|net sales|sales and other operating revenue|segment revenue|product revenue|services? revenue|cloud revenue|subscription(?:s)? revenue|comparable sales|unit case volume|net interest income|\bnii\b|noninterest (?:income|revenue)|\bnir\b|markets revenue|sales volume|price realization|average selling prices?|bit shipments?|customer usage|unit sales)/i;
  const sectorTopic = /(commodity|crude oil|natural gas|production volume|upstream|refining|sales volume|price realization|orders|backlog|comparable sales|traffic|ticket|ecommerce|membership|deliveries|automotive|cloud|subscription|revenue per user|seats?|copilot|unit case|demand|google services|google cloud|youtube|aws)/i;
  const relationship = revenueTopic.test(normalized) && causal.test(normalized);
  const bankRevenueBridge =
    /(?:net interest income|\bnii\b|noninterest (?:income|revenue)|\bnir\b)[\s\S]{0,180}(?:up|increased|higher)[\s\S]{0,220}(?:driven by|reflecting|primarily due to)/i.test(normalized);
  const revenueContribution =
    /(?:increase in|growth in)[\s\S]{0,120}(?:Google Services|Google Cloud|subscriptions?|paid subscriptions?|advertising|AWS|North America)[\s\S]{0,100}(?:revenue|sales)|(?:ecommerce|e-commerce) net sales positively contributed/i.test(normalized);
  const categoryMovementTable =
    /Products and Services Performance[\s\S]{0,220}net sales by category[\s\S]{0,300}\biPhone\b/i.test(normalized);
  const durabilityBridge = intent === "driver_durability_followup" &&
    revenueTopic.test(normalized) &&
    /(?:continue|continued|recurring|long-term|customer usage|unit sales|average selling prices?|bit shipments?|membership|member engagement|paid subscriptions?|installed base|lower rates?|revolving balances?|deposit balances?|foreign exchange)/i.test(normalized);
  const nonRevenueCause =
    /(?:cash (?:provided|used) by operating activities|operating cash flows?|technology and infrastructure costs?|fulfillment costs?|cost of revenues?|operating expenses?|depreciation|amortization|net income|earnings driver analysis|increased earnings|decreased earnings)[\s\S]{0,220}(?:primarily due to|driven by|reflecting)/i.test(normalized);

  if (nonRevenueCause && !relationship && !bankRevenueBridge && !revenueContribution) {
    return false;
  }
  return relationship || bankRevenueBridge || revenueContribution || categoryMovementTable || durabilityBridge ||
    (sectorTopic.test(normalized) && normalized.length >= 80);
}

export function isUnsafeDriverEvidence(
  source: Pick<SourceChunkRecord, "text" | "sourceLabel" | "sectionType">,
  intent: HardFinancialIntent,
  sector: SourceGateSector
): boolean {
  const driverLike = isDriverLikeEvidence(source.text, intent, sector);
  if (!driverLike) {
    return true;
  }
  if (intent === "margin_durability_followup" || intent === "driver_durability_followup") {
    return false;
  }
  return isMostlyEnglishRawExcerpt(source.text) && isFragmentaryEvidenceText(source.text);
}

function sectorPattern(sector: SourceGateSector): RegExp {
  switch (sector) {
    case "bank":
      return /(net interest income|noninterest income|provision for credit losses|wealth management|investment banking|trading|deposits|loans)/i;
    case "capital_markets":
      return /(investment banking|trading|asset management|wealth management|institutional securities|advisory|underwriting)/i;
    case "energy":
      return /(commodity|crude oil|natural gas|production volume|drilling|completion|upstream|refining|oilfield)/i;
    case "oilfield_services":
      return /(drilling|completion|oilfield services|north america|international activity|customer spending)/i;
    case "industrial":
      return /(price realization|sales volume|orders|backlog|dealer inventory|manufacturing cost|construction equipment|agriculture equipment)/i;
    case "retail":
      return /(comparable sales|traffic|ticket|ecommerce|membership|advertising|gross margin|inventory)/i;
    case "consumer_staples":
      return /(pricing|volume|foreign exchange|organic sales|gross margin|commodity costs|input costs|oral care|pet nutrition)/i;
    case "auto":
      return /(deliveries|automotive gross margin|vehicle pricing|production volume|average selling price|energy generation|services revenue)/i;
    case "technology":
      return /(product revenue|services revenue|subscription|usage|rpo|arr|customer growth|installed base|channel inventory|gross margins?|product margin|services margin|tariff|foreign exchange|cost of sales|cost of revenues?|inventory purchases|depreciation|traffic acquisition costs?|\btac\b|content acquisition|employee compensation)/i;
    case "software":
      return /(subscription revenue|usage|customers|rpo|remaining performance obligations|deferred revenue|retention|expansion)/i;
    case "semiconductor_equipment":
      return /(orders|backlog|wafer fab equipment|customer demand|china|semiconductor equipment)/i;
    case "healthcare_medtech":
      return /(procedure volume|installed base|systems placements|instruments|accessories|recurring revenue|healthcare utilization)/i;
    case "reit":
      return /(occupancy|same-store|net operating income|\bnoi\b|senior housing|medical office|rental revenue)/i;
    case "media":
      return /(advertising revenue|affiliate revenue|retransmission|subscriber|content costs|distribution)/i;
    case "utility":
      return /(rate case|regulated returns|fuel cost|load growth|weather|regulated operations|capex)/i;
    case "mining":
      return /(copper price|gold price|production volume|unit costs|mining operations|commodity prices)/i;
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
