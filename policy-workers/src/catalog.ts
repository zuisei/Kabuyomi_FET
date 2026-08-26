export type PolicyDomainDefinition = {
  slug: string;
  labelJA: string;
  swiftValue: string;
  keywords: string[];
};

export const policyDomains: PolicyDomainDefinition[] = [
  { slug: "foreign-security", labelJA: "外交・安全保障", swiftValue: "foreignSecurity", keywords: ["state department", "foreign", "national security", "international"] },
  { slug: "defense-procurement", labelJA: "防衛・政府調達", swiftValue: "defenseProcurement", keywords: ["defense", "army", "navy", "air force", "procurement", "acquisition"] },
  { slug: "trade-tariffs", labelJA: "貿易・関税", swiftValue: "tradeTariffs", keywords: ["trade", "tariff", "customs", "ustr", "international trade commission"] },
  { slug: "export-controls-sanctions", labelJA: "輸出管理・制裁", swiftValue: "exportControlsSanctions", keywords: ["export", "sanction", "ofac", "industrial security"] },
  { slug: "financial-regulation", labelJA: "金融規制・銀行・証券", swiftValue: "financialRegulation", keywords: ["securities", "bank", "financial", "cftc", "fdic", "occ"] },
  { slug: "monetary-policy", labelJA: "金融政策・中央銀行", swiftValue: "monetaryPolicy", keywords: ["federal reserve", "monetary", "interest rate"] },
  { slug: "tax-budget", labelJA: "税制・財政・予算", swiftValue: "taxBudget", keywords: ["internal revenue", "tax", "treasury", "budget", "fiscal"] },
  { slug: "antitrust", labelJA: "競争政策・反トラスト", swiftValue: "antitrust", keywords: ["antitrust", "competition", "federal trade commission"] },
  { slug: "technology-ai-semiconductors", labelJA: "テクノロジー・AI・半導体", swiftValue: "technologyAI", keywords: ["artificial intelligence", "semiconductor", "technology", "cyber", "digital"] },
  { slug: "telecommunications", labelJA: "通信・電波", swiftValue: "telecommunications", keywords: ["communications commission", "telecommunication", "spectrum", "broadband"] },
  { slug: "energy-nuclear", labelJA: "エネルギー・原子力", swiftValue: "energyNuclear", keywords: ["energy", "nuclear", "ferc", "pipeline"] },
  { slug: "environment-climate", labelJA: "環境・気候", swiftValue: "environmentClimate", keywords: ["environmental", "climate", "emission", "pollution", "endangered"] },
  { slug: "health-medicine", labelJA: "医薬品・医療・公衆衛生", swiftValue: "healthMedicine", keywords: ["food and drug", "health", "medicare", "medicaid", "disease", "drug"] },
  { slug: "labor-employment", labelJA: "労働・雇用", swiftValue: "laborEmployment", keywords: ["labor", "employment", "occupational safety", "wage"] },
  { slug: "immigration-border", labelJA: "移民・国境", swiftValue: "immigrationBorder", keywords: ["immigration", "border", "homeland security", "citizenship"] },
  { slug: "agriculture-food", labelJA: "農業・食品", swiftValue: "agricultureFood", keywords: ["agriculture", "food safety", "farm", "rural"] },
  { slug: "transportation", labelJA: "運輸・航空・自動車", swiftValue: "transportation", keywords: ["transportation", "aviation", "highway", "vehicle", "railroad", "coast guard"] },
  { slug: "housing-real-estate", labelJA: "住宅・不動産", swiftValue: "housingRealEstate", keywords: ["housing", "mortgage", "real estate"] },
  { slug: "education", labelJA: "教育", swiftValue: "education", keywords: ["education", "student", "school"] },
  { slug: "consumer-protection", labelJA: "消費者保護", swiftValue: "consumerProtection", keywords: ["consumer", "product safety"] },
  { slug: "industrial-policy", labelJA: "産業政策・補助金", swiftValue: "industrialPolicy", keywords: ["commerce", "grant", "subsidy", "manufacturing", "small business"] }
];

export const instrumentTypes = [
  "final_rule", "proposed_rule", "interim_final_rule", "notice", "correcting_amendment", "withdrawal",
  "guidance", "executive_order", "presidential_memorandum", "proclamation", "fact_sheet", "agency_press_release",
  "sanctions_designation", "export_control_action", "tariff_action", "legislative_bill_resolution",
  "committee_action_hearing", "monetary_policy_decision", "enforcement_action", "grant_subsidy_program", "government_contract_award"
] as const;

export function classifyDomain(title: string, agencyNames: string[]): PolicyDomainDefinition {
  const haystack = `${title} ${agencyNames.join(" ")}`.toLowerCase();
  const matches = (keyword: string): boolean => keyword.length <= 4
    ? new RegExp(`(^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(haystack)
    : haystack.includes(keyword);
  return policyDomains.find((domain) => domain.keywords.some(matches)) ?? policyDomains.at(-1)!;
}

export function classifyInstrument(type: string, title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("correction") || lower.includes("correcting amendment")) return "correcting_amendment";
  if (lower.includes("withdrawal")) return "withdrawal";
  if (lower.includes("interim final rule")) return "interim_final_rule";
  if (lower.includes("executive order")) return "executive_order";
  if (lower.includes("proclamation")) return "proclamation";
  if (lower.includes("sanction") || lower.includes("designation")) return "sanctions_designation";
  if (lower.includes("export control")) return "export_control_action";
  if (lower.includes("tariff") || lower.includes("section 301")) return "tariff_action";
  if (type === "Rule") return "final_rule";
  if (type === "Proposed Rule") return "proposed_rule";
  if (type === "Presidential Document") return "presidential_memorandum";
  return "notice";
}
