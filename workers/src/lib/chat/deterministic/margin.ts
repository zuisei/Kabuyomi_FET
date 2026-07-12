import type { FilingCacheRecord } from "../../../env";
import { formatMetricValue, metricLabel } from "../../metrics";
import { buildSecFilingSource, dedupeChatSources, type ChatResponsePayload } from "../grounding";
import { findMetricSourceId } from "./common";

type MarginDirection = "improved" | "deteriorated" | "flat";

type MarginSnapshot = {
  label: string;
  current: number;
  prior: number;
  direction: MarginDirection;
};

export function buildMarginSnapshotAnswer(
  filing: FilingCacheRecord,
  {
    asksAboutCause,
    asksAboutImprovement,
    asksAboutDeterioration
  }: {
    asksAboutCause: boolean;
    asksAboutImprovement: boolean;
    asksAboutDeterioration: boolean;
  }
): ChatResponsePayload | null {
  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const operatingIncome = filing.metrics.find((metric) => metric.logicalName === "operatingIncome");
  const netIncome = filing.metrics.find((metric) => metric.logicalName === "netIncome");
  if (!revenue || !revenue.comparisonValue) {
    return asksAboutCause ? buildProfitMovementDriverAnswer(filing, operatingIncome, netIncome) : null;
  }

  const currentOperatingMargin =
    operatingIncome && operatingIncome.comparisonValue !== undefined && metricsComparableForMargin(operatingIncome, revenue)
      ? operatingIncome.value / revenue.value
      : undefined;
  const priorOperatingMargin =
    operatingIncome && operatingIncome.comparisonValue !== undefined && comparisonMetricsComparableForMargin(operatingIncome, revenue)
      ? operatingIncome.comparisonValue / revenue.comparisonValue
      : undefined;
  const currentNetMargin = netIncome && netIncome.comparisonValue !== undefined && metricsComparableForMargin(netIncome, revenue)
    ? netIncome.value / revenue.value
    : undefined;
  const priorNetMargin =
    netIncome && netIncome.comparisonValue !== undefined && comparisonMetricsComparableForMargin(netIncome, revenue)
      ? netIncome.comparisonValue / revenue.comparisonValue
      : undefined;

  const operatingDelta =
    currentOperatingMargin !== undefined && priorOperatingMargin !== undefined
      ? currentOperatingMargin - priorOperatingMargin
      : undefined;
  const netDelta =
    currentNetMargin !== undefined && priorNetMargin !== undefined ? currentNetMargin - priorNetMargin : undefined;

  const marginSnapshots = [
    buildMarginSnapshot("営業利益率", currentOperatingMargin, priorOperatingMargin, operatingDelta),
    buildMarginSnapshot("純利益率", currentNetMargin, priorNetMargin, netDelta)
  ].filter((snapshot): snapshot is MarginSnapshot => snapshot !== null);
  if (marginSnapshots.length === 0) {
    return asksAboutCause ? buildProfitMovementDriverAnswer(filing, operatingIncome, netIncome) : null;
  }

  const improvedMargins = marginSnapshots.filter((snapshot) => snapshot.direction === "improved");
  const deterioratedMargins = marginSnapshots.filter((snapshot) => snapshot.direction === "deteriorated");
  const hasImprovement = improvedMargins.length > 0;
  const hasDeterioration = deterioratedMargins.length > 0;

  const sourceIds = Array.from(
    new Set(
      [findMetricSourceId(filing, "revenue"), findMetricSourceId(filing, "operatingIncome"), findMetricSourceId(filing, "netIncome")]
        .filter((sourceId): sourceId is string => Boolean(sourceId))
    )
  );

  const sources = sourceIds.map((sourceId) => {
    const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId)!;
    return buildSecFilingSource(source);
  });

  if (asksAboutCause) {
    const marginDrivers = summarizeMarginDrivers(filing);
    if (marginDrivers) {
      const driverSources = marginDrivers.sourceIds.flatMap((sourceId) => {
        const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
        return source ? [buildSecFilingSource(source)] : [];
      });
      return {
        answer: [
          buildMarginIntro({ asksAboutImprovement, asksAboutDeterioration, hasImprovement, hasDeterioration }),
          ...marginSnapshots.map(formatMarginSnapshot),
          marginDrivers.text,
          "一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。"
        ].join(" "),
        sources: dedupeChatSources([...sources, ...driverSources])
      };
    }
    const limitationSources = filing.sourceChunks
      .filter((chunk) => chunk.sectionType === "md_a" && isMarginDriverContext(chunk.text))
      .slice(0, 2)
      .map(buildSecFilingSource);
    return {
      answer: [
        buildMarginIntro({ asksAboutImprovement, asksAboutDeterioration, hasImprovement, hasDeterioration }),
        ...marginSnapshots.map(formatMarginSnapshot),
        "利益率の方向は型付き数値から確認できますが、その変化を説明する当期の具体的な要因は、選択された資料から特定できません。",
        "一時要因か構造的変化かも、この提出資料だけでは断定しません。"
      ].join(" "),
      sources: dedupeChatSources([...sources, ...limitationSources])
    };
  }

  const answerParts = [buildMarginIntro({ asksAboutImprovement, asksAboutDeterioration, hasImprovement, hasDeterioration })];
  answerParts.push(...marginSnapshots.map(formatMarginSnapshot));

  return {
    answer: answerParts.join(" "),
    sources
  };
}

function buildProfitMovementDriverAnswer(
  filing: FilingCacheRecord,
  operatingIncome: FilingCacheRecord["metrics"][number] | undefined,
  netIncome: FilingCacheRecord["metrics"][number] | undefined
): ChatResponsePayload | null {
  const profitMetric = [operatingIncome, netIncome].find((metric) => metric?.comparisonValue !== undefined);
  if (!profitMetric) {
    return null;
  }

  const marginDrivers = summarizeMarginDrivers(filing);
  if (!marginDrivers) {
    return null;
  }

  const metricSourceId = findMetricSourceId(filing, profitMetric.logicalName);
  const metricSources = metricSourceId
    ? filing.sourceChunks.flatMap((source) => source.sourceId === metricSourceId ? [buildSecFilingSource(source)] : [])
    : [];
  const driverSources = marginDrivers.sourceIds.flatMap((sourceId) => {
    const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
    return source ? [buildSecFilingSource(source)] : [];
  });
  if (metricSources.length === 0 && driverSources.length === 0) {
    return null;
  }

  return {
    answer: [
      "選択された指標だけでは、売上高に対する利益率を同じ定義で計算できないため、利益率の改善・悪化は断定しません。",
      buildProfitComparisonSentence(profitMetric),
      marginDrivers.text,
      "一時要因か構造的変化かは、この提出資料だけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。"
    ].join(" "),
    sources: dedupeChatSources([...metricSources, ...driverSources])
  };
}

function summarizeMarginDrivers(filing: FilingCacheRecord): { text: string; sourceIds: string[] } | null {
  const points: string[] = [];
  const sourceIds: string[] = [];

  for (const chunk of filing.sourceChunks) {
    if (chunk.sectionType !== "md_a") {
      continue;
    }
    const text = chunk.text.replace(/\s+/g, " ");
    if (!isMarginDriverContext(text)) {
      continue;
    }

    for (const point of extractMarginDriverPoints(text)) {
      const family = marginDriverFamily(point);
      const conflictsWithExisting = family !== null && points.some((existing) => marginDriverFamily(existing) === family);
      if (!points.includes(point) && !conflictsWithExisting) {
        points.push(point);
      }
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
      if (points.length >= 4) {
        break;
      }
    }
    if (points.length >= 4) {
      break;
    }
  }

  if (points.length === 0) {
    return null;
  }

  return {
    text: `本文で確認できる利益率・利益要因は、${points.join("、")}です。`,
    sourceIds
  };
}

function isMarginDriverContext(text: string): boolean {
  return /(gross margin|gross profit|operating income|operating expense|cost of revenue|cost of sales|margin|profitability|expenses?|sales volume|price realization|pricing|manufacturing cost|fuel costs?|salaries|compensation|research and development|marketing|selling,? general and administrative|SG&A|TAC|traffic acquisition costs?|depreciation|inventory|tariff|為替|費用|原価|粗利|利益率|営業費用)/i.test(text);
}

function extractMarginDriverPoints(text: string): string[] {
  const points: string[] = [];
  const sentences = text
    .split(/(?<=[.。])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 60);

  for (const sentence of sentences) {
    for (const point of classifyMarginDriverSentence(sentence)) {
      if (!points.includes(point)) {
        points.push(point);
      }
      if (points.length >= 4) {
        break;
      }
    }
    if (points.length >= 4) break;
  }

  return points;
}

function classifyMarginDriverSentence(sentence: string): string[] {
  const lower = sentence.toLowerCase();
  if (isProspectiveDefinitionOrCashFlowNoise(lower)) return [];
  const hasObservedChange = /(?:due to|driven by|reflect(?:ed|ing)?|result(?:ed|ing)? from|offset by|higher|lower|increase|increased|decrease|decreased|declined|improved|unfavorable|favorable|up\s+\d|down\s+\d|増加|減少|低下|改善|悪化|押し上げ|押し下げ|要因|影響|寄与)/i.test(sentence);
  const hasRecordedOneTimeFactor = /(?:recorded|recognized)[^.!?]{0,100}(?:charges?|write-?down|impairment|restructuring|gain|loss)|減損|構造改革|一時費用/i.test(sentence);
  if (!hasObservedChange && !hasRecordedOneTimeFactor) return [];

  const points: string[] = [];
  const addDirectional = (
    pattern: RegExp,
    up: string,
    down: string,
    neutral?: string
  ) => {
    const direction = directionNearPattern(sentence, pattern);
    const point = direction === "up" ? up : direction === "down" ? down : neutral;
    if (point && !points.includes(point)) points.push(point);
  };

  addDirectional(/(?:unit sales|sales volume|unit volumes?|bit shipments?|shipments?|deliveries|concentrate sales volume|unit case volume)/i,
    "販売数量・出荷量の増加", "販売数量・出荷量の減少");
  addDirectional(/advertising sales|advertising revenue/i, "広告売上の増加", "広告売上の減少");
  addDirectional(/price realization|realized prices|pricing|price\/mix|price mix|selling prices?|average selling prices?|merchandise mix|sales mix/i,
    "価格実現・製品ミックスの改善", "価格実現・製品ミックスの悪化");
  addDirectional(/manufacturing cost reductions?|manufacturing costs?/i, "製造コストの増加", "製造コストの減少");
  addDirectional(/shipping and fulfillment costs?|ecommerce fulfillment costs?|fulfillment costs?/i,
    "配送・フルフィルメント費用の増加", "配送・フルフィルメント費用の減少");
  addDirectional(/fuel costs?|aircraft fuel costs?|refinery sales to third parties/i,
    "燃料・精製関連費用の増加", "燃料・精製関連費用の減少");
  addDirectional(/compensation expense|employee compensation|salaries and related costs|personnel(?: and marketing)? expenses?|employee and labor costs?/i,
    "人件費・報酬費の増加", "人件費・報酬費の減少");
  addDirectional(/brokerage expense|distribution fees?/i,
    "ブローカレッジ・販売手数料の増加", "ブローカレッジ・販売手数料の減少");
  addDirectional(/research and development expenses?|marketing, selling, and administrative expenses?|selling, general and administrative|SG&A/i,
    "研究開発・販管費の増加", "研究開発・販管費の減少");
  addDirectional(/acquired IPR&D charges?|acquisition-related costs?/i,
    "買収関連費用の増加", "買収関連費用の減少");
  addDirectional(/litigation provision|legal expense/i, "訴訟・法務費用の増加", "訴訟・法務費用の減少");
  addDirectional(/inventory provisions?|inventory write-?downs?|inventory charges?/i,
    "在庫引当・評価損の増加", "在庫引当・評価損の減少");
  addDirectional(/depreciation|amortization/i, "減価償却費の増加", "減価償却費の減少");
  addDirectional(/foreign exchange|currency exchange|exchange rate/i, "為替の押し上げ", "為替の押し下げ");

  if (/tariff|関税/i.test(sentence) && !points.some((point) => point.includes("関税"))) {
    points.push(/one-time benefits?[^.!?]{0,80}(?:tariff|関税)/i.test(sentence)
      ? "保証・関税に関する一時的な押し上げ"
      : "関税影響");
  }
  if (/prior year'?s?[^.!?]{0,80}(?:charge|write-?down|impairment)/i.test(sentence)) {
    points.push("前年同期の一時費用の反動");
  }

  const hasSpecificPoint = points.length > 0;
  if (!hasSpecificPoint && /gross margin|gross profit|gross profit rate|gross margin ratio|粗利|売上総利益/i.test(sentence)) {
    const direction = directionNearPattern(sentence, /gross margin|gross profit|gross profit rate|gross margin ratio|粗利|売上総利益/i);
    if (direction === "up") points.push("粗利率・粗利益の改善");
    if (direction === "down") points.push("粗利率・粗利益の低下");
  }
  if (points.length === 0 && /operating expenses?|cost of revenue|cost of sales|営業費用|費用|原価/i.test(sentence)) {
    const direction = directionNearPattern(sentence, /operating expenses?|cost of revenue|cost of sales|営業費用|費用|原価/i);
    if (direction === "up") points.push("営業費用・原価の増加");
    if (direction === "down") points.push("営業費用・原価の減少");
  }
  return points;
}

function isProspectiveDefinitionOrCashFlowNoise(lower: string): boolean {
  const prospectiveOrDefinition = /\b(?:may|could|can|would|subject to|consists? of|primarily consist|is defined as|are generally accounted|factors such as|represents? the percent change|computed by comparing|refer to the heading)\b/i.test(lower);
  const periodSpecificResult = /\b(?:for the (?:three|six|nine) months|compared to|from a year ago|prior-year comparable|in q[1-4]|was up|was down)\b/i.test(lower);
  if (prospectiveOrDefinition && !periodSpecificResult) return true;
  const hasProfitabilityAnchor = /(?:operating income|gross margin|gross profit|operating expense|cost of revenue|cost of sales|cost of services|net income|earnings|profitability)/i.test(lower);
  if (/(?:operating cash flow|cash provided|cash payments|working capital)/i.test(lower) && !hasProfitabilityAnchor) return true;
  return /(?:revenue|sales)/i.test(lower) && !hasProfitabilityAnchor;
}

function directionNearPattern(sentence: string, pattern: RegExp): "up" | "down" | null {
  const targetPattern = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  const targets = [...sentence.matchAll(targetPattern)].filter((match) => match.index !== undefined);
  if (targets.length === 0) return null;
  const directionPattern = /\b(higher|increase|increased|increases|growth|grew|improved|favorable|up|lower|decrease|decreased|decreases|declined|unfavorable|down|reductions?)\b|増加|上昇|改善|好転|減少|低下|悪化|不利/giu;
  const directions = [...sentence.matchAll(directionPattern)].filter((match) => match.index !== undefined);
  let best: { distance: number; direction: "up" | "down" } | null = null;
  for (const target of targets) {
    const targetIndex = target.index ?? 0;
    const targetEnd = targetIndex + target[0].length;
    const immediatePrefix = sentence.slice(Math.max(0, targetIndex - 24), targetIndex);
    const adjacentDirection = immediatePrefix.match(/(?:^|\s)(higher|increased?|growth|improved|favorable|lower|decreased?|declined|unfavorable|reductions?)\s*$/iu)?.[1];
    if (adjacentDirection) {
      return /^(?:lower|decreased?|declined|unfavorable|reductions?)$/iu.test(adjacentDirection) ? "down" : "up";
    }
    for (const directionMatch of directions) {
      const directionIndex = directionMatch.index ?? 0;
      const distance = directionIndex >= targetIndex && directionIndex < targetEnd
        ? 0
        : Math.min(Math.abs(directionIndex - targetIndex), Math.abs(directionIndex - targetEnd));
      if (distance > 90 || (best && best.distance <= distance)) continue;
      const token = directionMatch[0].toLowerCase();
      best = {
        distance,
        direction: /^(?:lower|decrease|decreased|decreases|declined|unfavorable|down|reduction)|減少|低下|悪化|不利/u.test(token)
          ? "down"
          : "up"
      };
    }
  }
  return best?.direction ?? null;
}

function marginDriverFamily(point: string): string | null {
  for (const [family, pattern] of [
    ["volume", /販売数量・出荷量/],
    ["advertising", /広告売上/],
    ["price_mix", /価格実現・製品ミックス/],
    ["manufacturing_cost", /製造コスト/],
    ["fulfillment_cost", /配送・フルフィルメント/],
    ["fuel_cost", /燃料・精製/],
    ["compensation", /人件費・報酬費/],
    ["brokerage", /ブローカレッジ/],
    ["rd_sga", /研究開発・販管費/],
    ["acquisition", /買収関連費用/],
    ["legal", /訴訟・法務費用/],
    ["inventory", /在庫引当・評価損/],
    ["depreciation", /減価償却費/],
    ["fx", /為替/],
    ["gross_margin", /粗利率・粗利益/],
    ["operating_cost", /営業費用・原価/]
  ] as Array<[string, RegExp]>) {
    if (pattern.test(point)) return family;
  }
  return null;
}

function metricsComparableForMargin(
  numerator: FilingCacheRecord["metrics"][number],
  denominator: FilingCacheRecord["metrics"][number]
): boolean {
  return numerator.unit === denominator.unit &&
    numerator.periodStart === denominator.periodStart &&
    numerator.periodEnd === denominator.periodEnd &&
    (numerator.periodKind ?? "unknown") === (denominator.periodKind ?? "unknown") &&
    (numerator.fiscalYear ?? null) === (denominator.fiscalYear ?? null) &&
    (numerator.fiscalQuarter ?? null) === (denominator.fiscalQuarter ?? null);
}

function comparisonMetricsComparableForMargin(
  numerator: FilingCacheRecord["metrics"][number],
  denominator: FilingCacheRecord["metrics"][number]
): boolean {
  return numerator.unit === denominator.unit &&
    (numerator.comparisonPeriodStart ?? null) === (denominator.comparisonPeriodStart ?? null) &&
    (numerator.comparisonPeriodEnd ?? null) === (denominator.comparisonPeriodEnd ?? null) &&
    (numerator.comparisonPeriodKind ?? "unknown") === (denominator.comparisonPeriodKind ?? "unknown") &&
    (numerator.comparisonFiscalYear ?? null) === (denominator.comparisonFiscalYear ?? null) &&
    (numerator.comparisonFiscalQuarter ?? null) === (denominator.comparisonFiscalQuarter ?? null);
}

function buildMarginSnapshot(
  label: string,
  current: number | undefined,
  prior: number | undefined,
  delta: number | undefined
): MarginSnapshot | null {
  if (current === undefined || prior === undefined || delta === undefined) {
    return null;
  }

  const displayedCurrent = Math.round(current * 1_000) / 10;
  const displayedPrior = Math.round(prior * 1_000) / 10;
  if (displayedCurrent > displayedPrior) {
    return { label, current, prior, direction: "improved" };
  }
  if (displayedCurrent < displayedPrior) {
    return { label, current, prior, direction: "deteriorated" };
  }
  return { label, current, prior, direction: "flat" };
}

function buildMarginIntro({
  asksAboutImprovement,
  asksAboutDeterioration,
  hasImprovement,
  hasDeterioration
}: {
  asksAboutImprovement: boolean;
  asksAboutDeterioration: boolean;
  hasImprovement: boolean;
  hasDeterioration: boolean;
}): string {
  if (asksAboutImprovement) {
    if (hasImprovement && !hasDeterioration) {
      return "提出資料上、利益率は改善しています。";
    }
    if (!hasImprovement && hasDeterioration) {
      return "提出資料上、利益率の改善は確認できません。";
    }
    return "提出資料上、利益率は項目ごとに方向が分かれています。";
  }

  if (asksAboutDeterioration) {
    if (hasDeterioration && !hasImprovement) {
      return "提出資料上、利益率は悪化しています。";
    }
    if (!hasDeterioration && hasImprovement) {
      return "提出資料上、今期の利益率悪化は確認できません。";
    }
    return "提出資料上、利益率は項目ごとに方向が分かれています。";
  }

  if (hasImprovement && !hasDeterioration) {
    return "提出資料上、利益率は改善しています。";
  }
  if (!hasImprovement && hasDeterioration) {
    return "提出資料上、利益率は悪化しています。";
  }
  return "提出資料上、利益率は項目ごとに方向が分かれています。";
}

function formatMarginSnapshot(snapshot: MarginSnapshot): string {
  const prior = `${(snapshot.prior * 100).toFixed(1)}%`;
  const current = `${(snapshot.current * 100).toFixed(1)}%`;

  switch (snapshot.direction) {
    case "improved":
      return `${snapshot.label}は ${prior} から ${current} へ改善しています。`;
    case "deteriorated":
      return `${snapshot.label}は ${prior} から ${current} へ低下しています。`;
    case "flat":
      return `${snapshot.label}は ${prior} から ${current} で、大きな変化はありません。`;
  }
}

function buildProfitComparisonSentence(metric: FilingCacheRecord["metrics"][number]): string {
  const comparison = metric.comparisonValue;
  if (comparison === undefined) return `${metricLabel(metric.logicalName)}は ${formatMetricValue(metric.value, metric.unit)} です。`;
  const direction = metric.value > comparison ? "増加" : metric.value < comparison ? "減少" : "横ばい";
  return `${metricLabel(metric.logicalName)}は比較期の ${formatMetricValue(comparison, metric.unit)} から当期の ${formatMetricValue(metric.value, metric.unit)} へ${direction}しています。`;
}
