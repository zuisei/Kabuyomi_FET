import type { SourceChunkRecord } from "../../env";
import type { GeminiChatAnswer } from "../../clients/gemini/types";
import type { EvidenceSlots } from "./evidence-slots";
import type { SourceGateResult } from "./source-gate";

export type EvidenceFallbackResult = {
  answer: GeminiChatAnswer;
  genericFallbackPhraseDetected: boolean;
};

const BANNED_PHRASES = [
  "本文に説明があります",
  "本文全体と数字を並べると見えてきます",
  "本文の要因説明と並べると判断しやすくなります",
  "価格、数量、需要、コスト、mixを見るべきです",
  "売るべき",
  "買うべき",
  "投資推奨",
  "目標株価",
  "株価予想"
];

export function buildEvidenceFallbackAnswer({
  sourceGateResult,
  evidenceSlots,
  selectedSources,
  fallbackReason
}: {
  sourceGateResult: SourceGateResult;
  evidenceSlots: EvidenceSlots;
  selectedSources: SourceChunkRecord[];
  fallbackReason?: GeminiChatAnswer["fallbackReason"];
}): EvidenceFallbackResult {
  const hardIntent = sourceGateResult.hardIntent;
  const answer = hardIntent === "margin_durability_followup"
    ? buildMarginDurabilityFallback(sourceGateResult, evidenceSlots)
    : hardIntent === "driver_durability_followup"
      ? buildDriverDurabilityFallback(sourceGateResult, evidenceSlots)
      : buildRevenueDriverFallback(sourceGateResult, evidenceSlots);
  const cleaned = cleanBannedPhrases(answer);
  const sourceIds = sourceIdsForFallback(sourceGateResult, evidenceSlots, selectedSources);
  const genericFallbackPhraseDetected = hasBannedPhrase(cleaned);

  return {
    answer: {
      answer: cleaned,
      sourceIds,
      usedRemoteModel: false,
      geminiCalled: false,
      geminiSucceeded: false,
      schemaValid: true,
      fallbackReason
    },
    genericFallbackPhraseDetected
  };
}

export function hasBannedPhrase(answer: string): boolean {
  return BANNED_PHRASES.some((phrase) => answer.includes(phrase)) ||
    /本文に.*説明があります/.test(answer) ||
    /本文全体と数字を並べると/.test(answer) ||
    /数字を並べると.*見えてきます/.test(answer) ||
    /この資料の範囲では確認できません(?!.*(不足|source|説明|指標|KPI|MD&A))/.test(answer) ||
    /一時的とは断定しにくいです(?!.*(要因|不足|未特定|不明))/.test(answer) ||
    /(^|[。！？\s])買いです/.test(answer) ||
    /(?:割安|割高)(?:です|だ|と断定|と判断)/.test(answer);
}

function buildRevenueDriverFallback(sourceGateResult: SourceGateResult, evidenceSlots: EvidenceSlots): string {
  const metric = evidenceSlots.confirmedMetricMovement;
  const safeDrivers = safeDriverTexts(evidenceSlots.companyExplainedDrivers);
  const nextEvidenceText = joinMissingSourceLabels([
    ...sourceGateResult.missingSourceTypes,
    ...evidenceSlots.sectorSpecificNextIndicators.slice(0, 5)
  ]);
  const parts: string[] = [];
  if (metric) {
    parts.push(`${metric.metricName}は${metric.currentValue ?? "確認できます"}${metric.changePct ? `で、${metric.comparisonBasis ?? "比較"}${metric.changePct}です` : "です"}。`);
  } else {
    parts.push("売上の増減方向は、選択された資料だけでは十分に整理できていません。");
  }

  if (safeDrivers.length > 0) {
    parts.push(`会社が説明する主な売上要因は、${safeDrivers.join(" / ")}です。`);
  } else {
    parts.push(`ただし、この資料だけだと会社固有の売上要因までは追いきれません。`);
    parts.push(`次に見るなら、${nextEvidenceText} あたりです。`);
  }
  return parts.join("");
}

function buildDriverDurabilityFallback(sourceGateResult: SourceGateResult, evidenceSlots: EvidenceSlots): string {
  const safeDrivers = driverLabelsForFallback(evidenceSlots.companyExplainedDrivers);
  if (sourceGateResult.followupTargetFound === false || safeDrivers.length === 0) {
    const nextIndicatorText = joinMissingSourceLabels(["MD&A", ...evidenceSlots.sectorSpecificNextIndicators.slice(0, 5)]);
    return [
      "前問の具体的な要因が十分に特定できていません。",
      "そのため、選択された資料だけで一時要因か継続要因かは分類しません。",
      `判断には、${nextIndicatorText} の追加確認が必要です。`
    ].join("");
  }

  const durable = safeFactTexts(evidenceSlots.durabilityEvidence.potentiallyDurable).slice(0, 2);
  const temporary = safeFactTexts(evidenceSlots.durabilityEvidence.likelyTemporary).slice(0, 2);
  const parts = [`前問の要因は、${safeDrivers.join(" / ")}です。`];
  if (temporary.length > 0) {
    parts.push(`一時性を見る材料は、${temporary.join(" / ")} です。`);
  }
  if (durable.length > 0) {
    parts.push(`継続性を見る材料は、${durable.join(" / ")} です。`);
  }
  if (temporary.length === 0 && durable.length === 0) {
    parts.push(`継続性の判断には、${joinMissingSourceLabels(evidenceSlots.sectorSpecificNextIndicators.slice(0, 5))} の追加確認が必要です。`);
  }
  return parts.join("");
}

function buildMarginDurabilityFallback(sourceGateResult: SourceGateResult, evidenceSlots: EvidenceSlots): string {
  const metric = evidenceSlots.confirmedMetricMovement;
  const safeMarginDrivers = safeDriverTexts(evidenceSlots.marginDrivers);
  const parts: string[] = [];
  if (safeMarginDrivers.length === 0 || sourceGateResult.followupTargetFound === false) {
    if (metric) {
      parts.push(`確認できているのは、${metric.metricName}が${metric.currentValue ?? "報告されている"}${metric.changePct ? `、${metric.comparisonBasis ?? "比較"}${metric.changePct}` : ""}という点です。`);
    }
    parts.push("ただし、利益率変化の具体的な要因は十分に特定できていません。");
    parts.push("そのため、選択された資料だけで一時要因か構造的変化かは分類しません。");
    parts.push(`判断には、${joinMissingSourceLabels([...sourceGateResult.missingSourceTypes, ...evidenceSlots.sectorSpecificNextIndicators].slice(0, 6))} の説明が必要です。`);
    return parts.join("");
  }

  parts.push(`利益率要因として確認できるのは、${safeMarginDrivers.join(" / ")}です。`);
  if (evidenceSlots.durabilityEvidence.likelyTemporary.length === 0 && evidenceSlots.durabilityEvidence.potentiallyDurable.length === 0) {
    parts.push(`一時要因か構造変化かの判断には、${joinMissingSourceLabels(evidenceSlots.sectorSpecificNextIndicators.slice(0, 5))} の継続確認が必要です。`);
  }
  return parts.join("");
}

function safeDriverTexts(drivers: Array<{ driver: string }>): string[] {
  return drivers
    .map((driver) => driver.driver.replace(/\s+/g, " ").trim())
    .filter((driver) => !isUnsafeEvidenceText(driver))
    .map((driver) => driver.length > 80 ? `${driver.slice(0, 77)}...` : driver)
    .slice(0, 3);
}

function driverLabelsForFallback(drivers: Array<{ driver: string }>): string[] {
  const safeDrivers = safeDriverTexts(drivers);
  if (safeDrivers.length > 0) {
    return safeDrivers;
  }
  const labels = new Set<string>();
  for (const { driver } of drivers) {
    const text = driver.replace(/\s+/g, " ");
    if (/foreign exchange|fx|currency/i.test(text)) labels.add("為替影響");
    if (/\bAWS\b|cloud/i.test(text)) labels.add("AWS・クラウド需要");
    if (/unit sales|third-party sellers/i.test(text)) labels.add("販売数量・第三者販売");
    if (/advertising/i.test(text)) labels.add("広告売上");
    if (/subscription/i.test(text)) labels.add("サブスクリプション");
    if (/average selling prices?|ASP/i.test(text)) labels.add("平均販売価格");
    if (/bit shipments?|shipments/i.test(text)) labels.add("出荷量");
    if (/favorable mix|product mix|mix/i.test(text)) labels.add("製品ミックス");
    if (/manufacturing cost reductions?|cost reductions?/i.test(text)) labels.add("製造コスト削減");
    if (/demand|customer usage|usage/i.test(text)) labels.add("需要・利用量");
    if (/pricing changes?|price/i.test(text)) labels.add("価格変更");
  }
  return [...labels].slice(0, 4);
}

function safeFactTexts(facts: Array<{ fact: string }>): string[] {
  return facts
    .map((fact) => fact.fact.replace(/\s+/g, " ").trim())
    .filter((fact) => !isUnsafeEvidenceText(fact))
    .map((fact) => fact.length > 80 ? `${fact.slice(0, 77)}...` : fact);
}

function isUnsafeEvidenceText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/[A-Za-z]+(?:\s+[A-Za-z]+){7,}/.test(trimmed)) return true;
  if (/[A-Za-z][A-Za-z\s,;]+(\.\.\.|…)/.test(trimmed)) return true;
  if (/•|Item\s+\d|Part\s+[IVX]|Risk Factors/i.test(trimmed)) return true;
  if (/^(and|or|while|these|including|within|operating|risks?)\b/i.test(trimmed)) return true;
  return false;
}

function sourceIdsForFallback(
  sourceGateResult: SourceGateResult,
  evidenceSlots: EvidenceSlots,
  selectedSources: SourceChunkRecord[]
): string[] {
  const ids = new Set<string>();
  for (const sourceId of evidenceSlots.confirmedMetricMovement?.sourceIds ?? []) ids.add(sourceId);
  for (const fact of sourceGateResult.knownFacts) {
    for (const sourceId of fact.sourceIds) ids.add(sourceId);
  }
  for (const driver of [...evidenceSlots.companyExplainedDrivers, ...evidenceSlots.marginDrivers]) {
    for (const sourceId of driver.sourceIds) ids.add(sourceId);
  }
  if (ids.size === 0) {
    const fallbackSource = selectedSources.find((source) => source.sectionType === "xbrl_metric") ?? selectedSources[0];
    if (fallbackSource) ids.add(fallbackSource.sourceId);
  }
  return [...ids].slice(0, 4);
}

function cleanBannedPhrases(answer: string): string {
  let cleaned = answer;
  for (const phrase of BANNED_PHRASES) {
    cleaned = cleaned.replaceAll(phrase, "具体的に不足している資料を確認する必要があります");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function joinItems(items: string[]): string {
  const unique = [...new Set(items.filter(Boolean))];
  if (unique.length === 0) {
    return "経営陣による業績説明やセグメント実績";
  }
  return unique.join("、");
}

export function joinMissingSourceLabels(items: string[]): string {
  const normalized = normalizeMissingSourceLabels(items);
  return joinItems(normalized);
}

export function normalizeMissingSourceLabels(items: string[]): string[] {
  const order = [
    "MD&A",
    "segment results",
    "revenue discussion",
    "profitability discussion",
    "cash flow / liquidity",
    "risk factors",
    "sector-specific KPIs"
  ];
  const aliases: Array<[RegExp, string]> = [
    [/^md&a(?:\s+(driver|revenue|business)\s+discussion)?$|^management'?s discussion$/i, "経営陣による業績説明"],
    [/segment/i, "セグメント実績"],
    [/^revenue discussion$|^sales discussion$/i, "売上要因の説明"],
    [/^profitability discussion$|^margin discussion$/i, "利益率・採算性"],
    [/cash|liquidity|debt|balance sheet|maturit/i, "キャッシュフロー・流動性"],
    [/risk/i, "リスク要因"],
    [/^sector-specific (kpis?|indicators?)$/i, "業種固有KPI"],
    [/^product revenue(?:\s+discussion)?$/i, "製品別売上"],
    [/^services revenue(?:\s+discussion)?$/i, "サービス売上"],
    [/^geographic revenue(?:\s+discussion)?$/i, "地域別売上"],
    [/^product launches?$/i, "新製品投入"],
    [/^channel inventory$/i, "販売チャネル在庫"],
    [/^product launch or channel inventory discussion$/i, "新製品投入や販売チャネル在庫"],
    [/net interest/i, "純利息収入"],
    [/noninterest/i, "非金利収入・費用"],
    [/provision for credit losses|credit loss/i, "信用損失引当"],
    [/deposits?|loans?|credit quality/i, "預金・貸出・信用品質"],
    [/investment banking|trading|wealth management|asset management/i, "金融サービス別収益"],
    [/commodity price|crude oil|natural gas/i, "資源価格"],
    [/production volume/i, "生産量"],
    [/upstream|downstream/i, "上流・下流セグメント"],
    [/refining|chemical margin/i, "精製・化学マージン"],
    [/price-cost|manufacturing cost|cost absorption|material cost/i, "価格とコスト・製造コスト"],
    [/sg&a|sga|r&d|research and development/i, "販管費・研究開発費"],
    [/segment margin|segment profitability|segment operating profit/i, "セグメント利益率"],
    [/price realization/i, "価格実現"],
    [/sales volume/i, "販売数量"],
    [/orders?|backlog/i, "受注・バックログ"],
    [/dealer inventory/i, "ディーラー在庫"],
    [/comparable sales|comp sales/i, "既存店売上"],
    [/traffic|ticket/i, "客数・客単価"],
    [/e-?commerce/i, "EC売上"],
    [/membership|advertising/i, "会員・広告収益"],
    [/vehicle pricing/i, "車両価格"],
    [/automotive gross margin/i, "自動車粗利益率"],
    [/pricing discussion|^pricing$/i, "価格改定"],
    [/volume discussion|^volume$/i, "販売数量"],
    [/foreign exchange|currency/i, "為替影響"],
    [/organic sales/i, "オーガニック売上"],
    [/gross margin/i, "粗利益率"],
    [/deliveries/i, "納車台数"],
    [/energy revenue/i, "エネルギー事業収益"],
    [/subscription revenue|usage|customers?|rpo|deferred revenue|retention/i, "サブスク・利用量・顧客指標"],
    [/orders or backlog|wafer fab|china exposure|customer demand/i, "受注・半導体設備需要"],
    [/procedure volume|installed base|systems placements|recurring instruments/i, "処置数・設置台数・継続収益"],
    [/occupancy|same-store noi|debt maturit|interest rate/i, "稼働率・NOI・負債期限"],
    [/advertising revenue|affiliate|retransmission|content cost/i, "広告・配信・コンテンツ費用"],
    [/rate case|regulated returns|fuel cost|load growth|weather/i, "料金改定・燃料費・需要"],
    [/copper price|gold price|unit cost|mining operations/i, "金属価格・生産コスト"]
  ];
  const seen = new Set<string>();
  for (const item of items) {
    const text = item.trim();
    if (!text) continue;
    const mapped = aliases.find(([pattern]) => pattern.test(text))?.[1] ?? text;
    seen.add(mapped);
  }
  return [...seen].sort((a, b) => {
    const ai = orderIndexForMissingSourceLabel(a, order);
    const bi = orderIndexForMissingSourceLabel(b, order);
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });
}

function orderIndexForMissingSourceLabel(label: string, order: string[]): number {
  const direct = order.indexOf(label);
  if (direct !== -1) return direct;
  if (/md&a/i.test(label)) return order.indexOf("MD&A");
  if (/segment/i.test(label)) return order.indexOf("segment results");
  if (/revenue|sales|net interest|noninterest|comparable|traffic|ticket|ecommerce/i.test(label)) return order.indexOf("revenue discussion");
  if (/profit|margin|cost|pricing|mix|expense|provision|impairment|restructuring/i.test(label)) return order.indexOf("profitability discussion");
  if (/cash|liquidity|debt|balance sheet|maturit/i.test(label)) return order.indexOf("cash flow / liquidity");
  if (/risk/i.test(label)) return order.indexOf("risk factors");
  return order.indexOf("sector-specific KPIs");
}
