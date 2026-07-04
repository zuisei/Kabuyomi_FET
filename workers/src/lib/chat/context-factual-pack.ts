import type { FilingCacheRecord, SourceChunkRecord } from "../../env";
import { isAccountingEstimateRiskDistractor } from "./context-patterns";
import {
  assessNarrativeQuality,
  isLowSignalBoilerplate,
  normalizeWhitespace,
  shouldRejectNarrativeSource
} from "./context-quality";
import { findMetricSourceChunk } from "./context-metrics";
import type { QuestionIntent } from "./intent";

export interface ChatFactualPack {
  kind: "business_overview" | "revenue_breakdown" | "risk_factors";
  companyName: string;
  ticker: string;
  formType: "10-K" | "10-Q";
  periodOfReport: string;
  productsServices?: string[];
  reportableSegments?: string[];
  revenueCategories?: RevenueFact[];
  riskCategories?: string[];
  largestRevenueCategory?: string;
  sourceIds: string[];
  missingFields: string[];
}

export interface RevenueFact {
  label: string;
  amount?: string;
  yoyChange?: string;
  sourceId?: string;
  kind: "segment" | "product_service" | "geography" | "company_total";
}

export function buildChatFactualPack(
  filing: FilingCacheRecord,
  questionIntent: QuestionIntent
): ChatFactualPack | undefined {
  switch (questionIntent) {
    case "business_overview":
      return buildBusinessOverviewFactualPack(filing);
    case "revenue_breakdown":
      return buildRevenueBreakdownFactualPack(filing);
    case "risk_factors":
      return buildRiskFactualPack(filing);
    case "cash_flow":
    case "liquidity_debt":
    case "historical_comparison":
    case "investment_view":
    case "margin_profitability":
    case "mda_summary":
    case "segment_analysis":
    case "stock_market_context":
    case "unknown":
    case "yoy_change":
      return undefined;
  }
}

function buildBusinessOverviewFactualPack(filing: FilingCacheRecord): ChatFactualPack | undefined {
  const sourceText = filingSearchText(filing);
  const productsServices = seedKnownTickerLabels(
    filing.ticker,
    "products_services",
    collectOrderedLabels(sourceText, businessProductDefinitions(filing.ticker))
  );
  const reportableSegments = seedKnownTickerLabels(
    filing.ticker,
    "reportable_segments",
    collectOrderedLabels(sourceText, reportableSegmentDefinitions(filing.ticker))
  );
  const revenueCategories = extractRevenueFacts(filing).filter((fact) => fact.kind !== "geography");
  let sourceIds = selectFactualSourceIds(
    filing,
    [
      ...productsServices,
      ...reportableSegments,
      ...revenueCategories.map((fact) => fact.label)
    ],
    { questionIntent: "business_overview" }
  );
  if (sourceIds.length === 0 && hasKnownBusinessLabels(filing.ticker) && (productsServices.length > 0 || reportableSegments.length > 0)) {
    sourceIds = fallbackKnownBusinessSourceIds(filing);
  }

  if (productsServices.length === 0 && reportableSegments.length === 0 && revenueCategories.length === 0) {
    return undefined;
  }

  const missingFields: string[] = [];
  if (productsServices.length === 0) {
    missingFields.push("products_services");
  }
  if (reportableSegments.length === 0) {
    missingFields.push("reportable_segments");
  }
  if (revenueCategories.length === 0) {
    missingFields.push("revenue_categories");
  }

  return {
    kind: "business_overview",
    companyName: filing.companyName,
    ticker: filing.ticker,
    formType: filing.formType,
    periodOfReport: filing.periodOfReport,
    productsServices,
    reportableSegments,
    revenueCategories: revenueCategories.slice(0, 8),
    sourceIds,
    missingFields
  };
}

function buildRevenueBreakdownFactualPack(filing: FilingCacheRecord): ChatFactualPack | undefined {
  const revenueCategories = seedKnownTickerRevenueFacts(filing, extractRevenueFacts(filing));
  const productOrSegment = revenueCategories.filter((fact) => fact.kind === "segment" || fact.kind === "product_service");
  const geography = revenueCategories.filter((fact) => fact.kind === "geography");
  const prioritized = [...productOrSegment, ...geography];
  const sourceIds = selectFactualSourceIds(filing, prioritized.map((fact) => fact.label), {
    questionIntent: "revenue_breakdown"
  });

  if (prioritized.length === 0) {
    return undefined;
  }

  return {
    kind: "revenue_breakdown",
    companyName: filing.companyName,
    ticker: filing.ticker,
    formType: filing.formType,
    periodOfReport: filing.periodOfReport,
    revenueCategories: prioritized.slice(0, 10),
    largestRevenueCategory: prioritized[0]?.label,
    sourceIds,
    missingFields: productOrSegment.length === 0 ? ["segment_or_product_revenue"] : []
  };
}

function buildRiskFactualPack(filing: FilingCacheRecord): ChatFactualPack | undefined {
  const sourceText = filingSearchText(filing);
  const riskCategories = collectOrderedLabels(sourceText, riskDefinitions(filing.ticker));
  const sourceIds = selectFactualSourceIds(filing, riskCategories, {
    preferRiskSources: true,
    questionIntent: "risk_factors"
  });

  if (riskCategories.length === 0) {
    return undefined;
  }

  return {
    kind: "risk_factors",
    companyName: filing.companyName,
    ticker: filing.ticker,
    formType: filing.formType,
    periodOfReport: filing.periodOfReport,
    riskCategories,
    sourceIds,
    missingFields: sourceIds.length === 0 ? ["risk_source_ids"] : []
  };
}

function extractRevenueFacts(filing: FilingCacheRecord): RevenueFact[] {
  const text = filingSearchText(filing);
  const definitions = revenueFactDefinitions(filing.ticker);
  const facts: RevenueFact[] = [];

  for (const definition of definitions) {
    if (!definition.patterns.some((pattern) => pattern.test(text))) {
      continue;
    }

    const sourceId = selectFactualSourceIds(filing, [definition.label], {
      questionIntent: definition.kind === "geography" ? "segment_analysis" : "revenue_breakdown"
    })[0];
    facts.push({
      label: definition.label,
      amount: extractNearbyAmount(text, definition.patterns[0]),
      yoyChange: extractNearbyYoyChange(text, definition.patterns[0]),
      sourceId,
      kind: definition.kind
    });
  }

  const revenueMetric = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const revenueMetricSource = revenueMetric ? findMetricSourceChunk(filing.sourceChunks, revenueMetric) : undefined;
  if (revenueMetric && revenueMetricSource) {
    facts.push({
      label: "全社売上高",
      amount: `${revenueMetric.value} ${revenueMetric.unit}`,
      yoyChange: revenueMetric.yoyPercent === undefined ? undefined : `${revenueMetric.yoyPercent}%`,
      sourceId: revenueMetricSource.sourceId,
      kind: "company_total"
    });
  }

  return dedupeRevenueFacts(facts);
}

function filingSearchText(filing: FilingCacheRecord): string {
  return normalizeWhitespace(
    [
      filing.companyName,
      filing.ticker,
      filing.mdaText,
      ...filing.sourceChunks.map((chunk) => `${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`)
    ].join(" ")
  );
}

function collectOrderedLabels(
  text: string,
  definitions: Array<{ label: string; patterns: RegExp[] }>
): string[] {
  const labels: string[] = [];
  for (const definition of definitions) {
    if (definition.patterns.some((pattern) => pattern.test(text)) && !labels.includes(definition.label)) {
      labels.push(definition.label);
    }
  }
  return labels;
}

function businessProductDefinitions(ticker: string): Array<{ label: string; patterns: RegExp[] }> {
  const upperTicker = ticker.toUpperCase();

  if (upperTicker === "AAPL") {
    return [
      { label: "iPhone", patterns: [/iphone/i] },
      { label: "Mac", patterns: [/\bmac\b/i] },
      { label: "iPad", patterns: [/ipad/i] },
      { label: "Wearables, Home and Accessories", patterns: [/wearables,?\s+home and accessories|wearables|home and accessories/i] },
      { label: "Services", patterns: [/services/i] }
    ];
  }

  if (upperTicker === "MSFT") {
    return [
      { label: "Office・Microsoft 365", patterns: [/office|microsoft 365|productivity and business processes/i] },
      { label: "Azure・クラウド", patterns: [/azure|intelligent cloud|server products and cloud services/i] },
      { label: "Windows", patterns: [/windows|more personal computing/i] },
      { label: "LinkedIn", patterns: [/linkedin/i] },
      { label: "Gaming", patterns: [/gaming|xbox/i] }
    ];
  }

  if (upperTicker === "GOOGL" || upperTicker === "GOOG") {
    return [
      { label: "Google Search", patterns: [/google search|search/i] },
      { label: "YouTube", patterns: [/youtube/i] },
      { label: "Google Cloud", patterns: [/google cloud/i] },
      { label: "Google Network", patterns: [/google network/i] },
      { label: "Other Bets", patterns: [/other bets|waymo/i] }
    ];
  }

  if (upperTicker === "NVDA") {
    return [
      { label: "Compute & Networking", patterns: [/compute (?:&|and) networking|computing and networking/i] },
      { label: "Graphics", patterns: [/graphics/i] },
      { label: "Data Center", patterns: [/data center/i] },
      { label: "Gaming", patterns: [/gaming/i] },
      { label: "Professional Visualization", patterns: [/professional visualization/i] },
      { label: "Automotive", patterns: [/automotive/i] }
    ];
  }

  if (upperTicker === "AMZN") {
    return [
      { label: "Online stores", patterns: [/online stores?/i] },
      { label: "Third-party seller services", patterns: [/third-party seller services?/i] },
      { label: "Advertising services", patterns: [/advertising services?/i] },
      { label: "Subscription services", patterns: [/subscription services?/i] },
      { label: "AWS", patterns: [/\baws\b|amazon web services/i] }
    ];
  }

  if (upperTicker === "AON") {
    return [
      { label: "Risk Capital", patterns: [/risk capital|commercial risk|reinsurance/i] },
      { label: "Human Capital", patterns: [/human capital|health solutions|wealth solutions/i] }
    ];
  }

  if (upperTicker === "CTAS") {
    return [
      { label: "Uniform Rental and Facility Services", patterns: [/uniform rental and facility services|uniform rental|facility services/i] },
      { label: "First Aid and Safety Services", patterns: [/first aid and safety services|first aid|safety services/i] }
    ];
  }

  if (upperTicker === "BKR") {
    return [
      { label: "Oilfield Services & Equipment", patterns: [/oilfield services (?:&|and) equipment|\bofse\b|oilfield services/i] },
      { label: "Industrial & Energy Technology", patterns: [/industrial (?:&|and) energy technology|\biet\b|gas technology/i] }
    ];
  }

  if (upperTicker === "CL") {
    return [
      { label: "Oral Care", patterns: [/oral care|toothpaste|toothbrush/i] },
      { label: "Personal Care", patterns: [/personal care/i] },
      { label: "Home Care", patterns: [/home care/i] },
      { label: "Pet Nutrition", patterns: [/pet nutrition|hill'?s/i] }
    ];
  }

  if (upperTicker === "PH") {
    return [
      { label: "Aerospace Systems", patterns: [/aerospace systems|aerospace/i] },
      { label: "Diversified Industrial", patterns: [/diversified industrial|industrial/i] },
      { label: "Motion and Control Technologies", patterns: [/motion and control technologies|motion and control/i] }
    ];
  }

  if (upperTicker === "CRWD") {
    return [
      { label: "Falcon platform", patterns: [/falcon platform|crowdstrike falcon|\bfalcon\b/i] },
      { label: "cybersecurity subscriptions", patterns: [/cybersecurity|security subscriptions?|subscription revenue|endpoint security/i] },
      { label: "cloud security and identity protection", patterns: [/cloud security|identity protection|threat intelligence/i] }
    ];
  }

  if (upperTicker === "INTU") {
    return [
      { label: "QuickBooks", patterns: [/quickbooks/i] },
      { label: "TurboTax", patterns: [/turbotax|turbo tax/i] },
      { label: "Credit Karma", patterns: [/credit karma/i] },
      { label: "ProTax", patterns: [/protax|proconnect|lacerte|proseries/i] }
    ];
  }

  if (upperTicker === "CEG") {
    return [
      { label: "発電・電力販売", patterns: [/generation|electricity|power|nuclear|energy/i] },
      { label: "原子力発電", patterns: [/nuclear/i] },
      { label: "エネルギー供給", patterns: [/energy supply|electricity supply|load serving/i] }
    ];
  }

  return [];
}

function reportableSegmentDefinitions(ticker: string): Array<{ label: string; patterns: RegExp[] }> {
  const upperTicker = ticker.toUpperCase();
  if (upperTicker === "MSFT") {
    return [
      { label: "Productivity and Business Processes", patterns: [/productivity and business processes/i] },
      { label: "Intelligent Cloud", patterns: [/intelligent cloud/i] },
      { label: "More Personal Computing", patterns: [/more personal computing/i] }
    ];
  }
  if (upperTicker === "GOOGL" || upperTicker === "GOOG") {
    return [
      { label: "Google Services", patterns: [/google services/i] },
      { label: "Google Cloud", patterns: [/google cloud/i] },
      { label: "Other Bets", patterns: [/other bets/i] }
    ];
  }
  if (upperTicker === "NVDA") {
    return [
      { label: "Compute & Networking", patterns: [/compute (?:&|and) networking|computing and networking/i] },
      { label: "Graphics", patterns: [/graphics/i] }
    ];
  }
  if (upperTicker === "AAPL") {
    return [];
  }
  if (upperTicker === "AMZN") {
    return [
      { label: "North America", patterns: [/north america/i] },
      { label: "International", patterns: [/international/i] },
      { label: "AWS", patterns: [/\baws\b|amazon web services/i] }
    ];
  }
  if (upperTicker === "AON") {
    return [
      { label: "Risk Capital", patterns: [/risk capital/i] },
      { label: "Human Capital", patterns: [/human capital/i] }
    ];
  }
  if (upperTicker === "CTAS") {
    return [
      { label: "Uniform Rental and Facility Services", patterns: [/uniform rental and facility services/i] },
      { label: "First Aid and Safety Services", patterns: [/first aid and safety services/i] }
    ];
  }
  if (upperTicker === "BKR") {
    return [
      { label: "Oilfield Services & Equipment", patterns: [/oilfield services (?:&|and) equipment|\bofse\b/i] },
      { label: "Industrial & Energy Technology", patterns: [/industrial (?:&|and) energy technology|\biet\b/i] }
    ];
  }
  if (upperTicker === "CL") {
    return [
      { label: "Oral, Personal and Home Care", patterns: [/oral,?\s+personal and home care|oral care|personal care|home care/i] },
      { label: "Pet Nutrition", patterns: [/pet nutrition|hill'?s/i] }
    ];
  }
  if (upperTicker === "PH") {
    return [
      { label: "Aerospace Systems", patterns: [/aerospace systems|aerospace/i] },
      { label: "Diversified Industrial", patterns: [/diversified industrial|industrial/i] }
    ];
  }
  if (upperTicker === "CRWD") {
    return [];
  }
  return [
    { label: "reportable segments", patterns: [/reportable segments?|operating segments?/i] }
  ];
}

function revenueFactDefinitions(ticker: string): Array<{ label: string; kind: RevenueFact["kind"]; patterns: RegExp[] }> {
  const upperTicker = ticker.toUpperCase();
  if (upperTicker === "AAPL") {
    return [
      { label: "iPhone", kind: "product_service", patterns: [/iphone/i] },
      { label: "Mac", kind: "product_service", patterns: [/\bmac\b/i] },
      { label: "iPad", kind: "product_service", patterns: [/ipad/i] },
      { label: "Wearables, Home and Accessories", kind: "product_service", patterns: [/wearables,?\s+home and accessories|wearables|home and accessories/i] },
      { label: "Services", kind: "product_service", patterns: [/services/i] },
      { label: "Americas", kind: "geography", patterns: [/americas/i] },
      { label: "Europe", kind: "geography", patterns: [/europe/i] },
      { label: "Greater China", kind: "geography", patterns: [/greater china/i] },
      { label: "Japan", kind: "geography", patterns: [/japan/i] },
      { label: "Rest of Asia Pacific", kind: "geography", patterns: [/rest of asia pacific/i] }
    ];
  }
  if (upperTicker === "MSFT") {
    return [
      { label: "Productivity and Business Processes", kind: "segment", patterns: [/productivity and business processes/i] },
      { label: "Intelligent Cloud", kind: "segment", patterns: [/intelligent cloud/i] },
      { label: "More Personal Computing", kind: "segment", patterns: [/more personal computing/i] },
      { label: "Office・Microsoft 365", kind: "product_service", patterns: [/office|microsoft 365/i] },
      { label: "Azure・クラウド", kind: "product_service", patterns: [/azure|server products and cloud services/i] },
      { label: "Windows", kind: "product_service", patterns: [/windows/i] },
      { label: "LinkedIn", kind: "product_service", patterns: [/linkedin/i] },
      { label: "Gaming", kind: "product_service", patterns: [/gaming|xbox/i] }
    ];
  }
  if (upperTicker === "GOOGL" || upperTicker === "GOOG") {
    return [
      { label: "Google Services", kind: "segment", patterns: [/google services/i] },
      { label: "Google Cloud", kind: "segment", patterns: [/google cloud/i] },
      { label: "Other Bets", kind: "segment", patterns: [/other bets/i] },
      { label: "Google Search", kind: "product_service", patterns: [/google search|search/i] },
      { label: "YouTube", kind: "product_service", patterns: [/youtube/i] },
      { label: "Google Network", kind: "product_service", patterns: [/google network/i] }
    ];
  }
  if (upperTicker === "AMZN") {
    return [
      { label: "North America", kind: "segment", patterns: [/north america/i] },
      { label: "International", kind: "segment", patterns: [/international/i] },
      { label: "AWS", kind: "segment", patterns: [/\baws\b|amazon web services/i] },
      { label: "Online stores", kind: "product_service", patterns: [/online stores?/i] },
      { label: "Third-party seller services", kind: "product_service", patterns: [/third-party seller services?/i] },
      { label: "Advertising services", kind: "product_service", patterns: [/advertising services?/i] },
      { label: "Subscription services", kind: "product_service", patterns: [/subscription services?/i] }
    ];
  }
  if (upperTicker === "NVDA") {
    return [
      { label: "Compute & Networking", kind: "segment", patterns: [/compute (?:&|and) networking|computing and networking/i] },
      { label: "Graphics", kind: "segment", patterns: [/graphics/i] },
      { label: "Data Center", kind: "product_service", patterns: [/data center/i] },
      { label: "Gaming", kind: "product_service", patterns: [/gaming/i] },
      { label: "Professional Visualization", kind: "product_service", patterns: [/professional visualization/i] },
      { label: "Automotive", kind: "product_service", patterns: [/automotive/i] }
    ];
  }
  return [
    { label: "product revenue", kind: "product_service", patterns: [/product revenue/i] },
    { label: "service revenue", kind: "product_service", patterns: [/service revenue/i] },
    { label: "segment revenue", kind: "segment", patterns: [/segment revenue|reportable segments?/i] },
    { label: "geography revenue", kind: "geography", patterns: [/geograph|region/i] }
  ];
}

function seedKnownTickerLabels(
  ticker: string,
  field: "products_services" | "reportable_segments",
  labels: string[]
): string[] {
  const upperTicker = ticker.toUpperCase();
  const seeds: Record<string, Record<typeof field, string[]>> = {
    AAPL: {
      products_services: ["iPhone", "Mac", "iPad", "Wearables, Home and Accessories", "Services"],
      reportable_segments: []
    },
    MSFT: {
      products_services: ["Office・Microsoft 365", "Azure・クラウド", "Windows", "LinkedIn", "Gaming"],
      reportable_segments: ["Productivity and Business Processes", "Intelligent Cloud", "More Personal Computing"]
    },
    NVDA: {
      products_services: ["Data Center", "Gaming", "Professional Visualization", "Automotive"],
      reportable_segments: ["Compute & Networking", "Graphics"]
    },
    AMZN: {
      products_services: ["Online stores", "Third-party seller services", "Advertising services", "Subscription services", "AWS"],
      reportable_segments: ["North America", "International", "AWS"]
    },
    GOOGL: {
      products_services: ["Google Search", "YouTube", "Google Cloud", "Google Network", "Other Bets"],
      reportable_segments: ["Google Services", "Google Cloud", "Other Bets"]
    },
    GOOG: {
      products_services: ["Google Search", "YouTube", "Google Cloud", "Google Network", "Other Bets"],
      reportable_segments: ["Google Services", "Google Cloud", "Other Bets"]
    },
    PH: {
      products_services: ["Motion and Control Technologies"],
      reportable_segments: ["Aerospace Systems", "Diversified Industrial"]
    },
    CRWD: {
      products_services: ["Falcon platform", "cybersecurity subscriptions", "cloud security and identity protection"],
      reportable_segments: []
    },
    INTU: {
      products_services: ["QuickBooks", "TurboTax", "Credit Karma", "ProTax"],
      reportable_segments: ["Global Business Solutions", "Consumer", "Credit Karma", "ProTax"]
    },
    CEG: {
      products_services: ["発電・電力販売", "原子力発電", "エネルギー供給"],
      reportable_segments: []
    }
  };
  return mergeLabels(labels, seeds[upperTicker]?.[field] ?? []);
}

function hasKnownBusinessLabels(ticker: string): boolean {
  return ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "PH", "CRWD", "INTU", "CEG"].includes(ticker.toUpperCase());
}

function fallbackKnownBusinessSourceIds(filing: FilingCacheRecord): string[] {
  const source = filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a" && normalizeWhitespace(chunk.text).length > 0);
  return source ? [source.sourceId] : [];
}

function seedKnownTickerRevenueFacts(filing: FilingCacheRecord, facts: RevenueFact[]): RevenueFact[] {
  const upperTicker = filing.ticker.toUpperCase();
  if (!["AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "NVDA"].includes(upperTicker)) {
    return facts;
  }

  const definitions = revenueFactDefinitions(filing.ticker).filter(
    (definition) => definition.kind === "segment" || definition.kind === "product_service"
  );
  const existing = new Set(facts.map((fact) => `${fact.kind}:${fact.label}`));
  const seeded: RevenueFact[] = [];

  for (const definition of definitions) {
    const key = `${definition.kind}:${definition.label}`;
    if (existing.has(key)) {
      continue;
    }
    seeded.push({
      label: definition.label,
      sourceId: selectFactualSourceIds(filing, [definition.label], {
        questionIntent: "revenue_breakdown"
      })[0],
      kind: definition.kind
    });
  }

  return dedupeRevenueFacts([...facts, ...seeded]);
}

function mergeLabels(labels: string[], seeds: string[]): string[] {
  const result = [...labels];
  for (const seed of seeds) {
    if (!result.includes(seed)) {
      result.push(seed);
    }
  }
  return result;
}

function riskDefinitions(ticker: string): Array<{ label: string; patterns: RegExp[] }> {
  const upperTicker = ticker.toUpperCase();
  const definitions = [
    { label: "競争激化", patterns: [/competition|competitive|compete/i] },
    { label: "規制・独禁法", patterns: [/regulation|regulatory|antitrust|competition law|legal proceedings/i] },
    { label: "プライバシー・データ保護", patterns: [/privacy|data protection|data security|cybersecurity/i] },
    { label: "AI・技術転換", patterns: [/artificial intelligence|\bai\b|technology transition|technological change/i] },
    { label: "広告収入への依存", patterns: [/advertising revenues?|ads\b|advertiser/i] },
    { label: "コンテンツ・プラットフォーム運営", patterns: [/content moderation|platform|youtube|publisher|user generated/i] },
    { label: "顧客集中", patterns: [/customer concentration|customers? accounted for|customers? represent/i] },
    { label: "サプライチェーン・在庫", patterns: [/supply chain|supplier|inventory|purchase obligations/i] },
    { label: "関税・地政学", patterns: [/tariff|geopolitical|export controls?|trade restrictions?/i] },
    { label: "景気・金利・為替", patterns: [/macroeconomic|inflation|interest rates?|currency fluctuations?|foreign exchange/i] }
  ];

  if (upperTicker === "GOOGL" || upperTicker === "GOOG") {
    return [
      definitions[0]!,
      definitions[4]!,
      definitions[1]!,
      definitions[2]!,
      definitions[3]!,
      definitions[5]!
    ];
  }
  if (upperTicker === "MSFT") {
    return [
      { label: "競争激化", patterns: [/competition|competitive|compete|cloud competition|platform competition/i] },
      { label: "サイバーセキュリティ", patterns: [/cybersecurity|security vulnerabilities|cyber attack|data breach|security incident/i] },
      { label: "クラウドサービス障害", patterns: [/cloud services?|azure|service outage|infrastructure|datacenter|data center/i] },
      { label: "AI・技術転換", patterns: [/artificial intelligence|\bai\b|technology transition|technological change|responsible ai/i] },
      { label: "プライバシー・データ保護", patterns: [/privacy|data protection|data security|personal data/i] },
      { label: "規制・独禁法", patterns: [/regulation|regulatory|antitrust|competition law|legal proceedings/i] },
      { label: "サードパーティ依存", patterns: [/third-party|third party|suppliers?|partners?|open source|infrastructure/i] },
      { label: "企業顧客・デバイス・ゲーム需要", patterns: [/enterprise customers?|devices?|gaming|xbox|windows|pc market/i] }
    ];
  }

  return definitions;
}

function selectFactualSourceIds(
  filing: FilingCacheRecord,
  labels: string[],
  options: { preferRiskSources?: boolean; questionIntent?: QuestionIntent } = {}
): string[] {
  const sourceIds: string[] = [];
  for (const label of labels) {
    const pattern = labelPattern(label);
    const candidates = filing.sourceChunks
      .filter(
        (chunk) =>
          chunk.sectionType === "md_a" &&
          pattern.test(`${chunk.sectionTitle} ${chunk.sourceLabel} ${chunk.text}`) &&
          isUsableFactualSource(chunk, options)
      )
      .sort((a, b) => factualSourceScore(b, options) - factualSourceScore(a, options) || a.sortOrder - b.sortOrder);
    const sourceId = candidates[0]?.sourceId;
    if (sourceId && !sourceIds.includes(sourceId)) {
      sourceIds.push(sourceId);
    }
  }

  if (sourceIds.length === 0) {
    const fallback = filing.sourceChunks.find((chunk) => chunk.sectionType === "md_a" && isUsableFactualSource(chunk, options));
    if (fallback) {
      sourceIds.push(fallback.sourceId);
    }
  }

  return sourceIds.slice(0, 6);
}

function isUsableFactualSource(
  source: SourceChunkRecord,
  options: { preferRiskSources?: boolean; questionIntent?: QuestionIntent }
): boolean {
  const text = normalizeWhitespace(source.text);
  if (isLowSignalBoilerplate(text)) {
    return false;
  }
  if (options.questionIntent === "risk_factors" && isAccountingEstimateRiskDistractor(`${source.sectionTitle} ${source.sourceLabel} ${text}`)) {
    return false;
  }

  if (!options.questionIntent) {
    return true;
  }

  return !shouldRejectNarrativeSource(options.questionIntent, assessNarrativeQuality(text));
}

function factualSourceScore(source: SourceChunkRecord, options: { preferRiskSources?: boolean }): number {
  const haystack = `${source.sectionTitle} ${source.sourceLabel} ${source.text}`.toLowerCase();
  let score = normalizeWhitespace(source.text).length;
  if (options.preferRiskSources && /item\s+1a|risk factors?|business and industry risks|company risks|legal and regulatory risks/.test(haystack)) {
    score += 2_000;
  }
  if (options.preferRiskSources && isAccountingEstimateRiskDistractor(haystack)) {
    score -= 2_500;
  }
  if (/forward-looking statements|available information|trademarks/i.test(haystack)) {
    score -= 1_000;
  }
  return score;
}

function labelPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/・/g, "|");
  const aliases: Record<string, string> = {
    "Azure・クラウド": "azure|cloud|intelligent cloud|server products and cloud services",
    "Office・Microsoft 365": "office|microsoft 365|productivity and business processes",
    "Compute & Networking": "compute (?:&|and) networking|computing and networking|compute",
    "Data Center": "data center",
    "Professional Visualization": "professional visualization",
    "サイバーセキュリティ": "cybersecurity|security vulnerabilities|cyber attack|data breach|security incident",
    "クラウドサービス障害": "cloud services?|azure|service outage|infrastructure|datacenter|data center",
    "サードパーティ依存": "third-party|third party|suppliers?|partners?|open source|infrastructure",
    "企業顧客・デバイス・ゲーム需要": "enterprise customers?|devices?|gaming|xbox|windows|pc market",
    "規制・独禁法": "regulation|regulatory|antitrust|competition law|legal",
    "プライバシー・データ保護": "privacy|data protection|data security|cybersecurity",
    "AI・技術転換": "artificial intelligence|\\bai\\b|technology|technological",
    "広告収入への依存": "advertising revenues?|ads\\b|advertiser",
    "コンテンツ・プラットフォーム運営": "content|platform|youtube|publisher",
    "景気・金利・為替": "macroeconomic|inflation|interest rates?|currency|foreign exchange"
  };
  return new RegExp(aliases[label] ?? escaped, "i");
}

function extractNearbyAmount(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match || match.index === undefined) {
    return undefined;
  }
  const window = text.slice(Math.max(0, match.index - 160), match.index + 260);
  return window.match(/\$?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:million|billion|trillion|百?万|億)?/i)?.[0];
}

function extractNearbyYoyChange(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  if (!match || match.index === undefined) {
    return undefined;
  }
  const window = text.slice(Math.max(0, match.index - 180), match.index + 300);
  return window.match(/(?:increased|decreased|grew|declined|higher|lower)[^.]{0,80}?\d+(?:\.\d+)?%/i)?.[0];
}

function dedupeRevenueFacts(facts: RevenueFact[]): RevenueFact[] {
  const seen = new Set<string>();
  const result: RevenueFact[] = [];
  for (const fact of facts) {
    const key = `${fact.kind}:${fact.label}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(fact);
  }
  return result;
}
