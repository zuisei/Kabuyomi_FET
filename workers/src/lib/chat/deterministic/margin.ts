import type { FilingCacheRecord } from "../../../env";
import { buildSecFilingSource, dedupeChatSources, type ChatResponsePayload } from "../grounding";
import { buildMetricObservationSentence, findMetricSourceId } from "./common";

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
    operatingIncome && operatingIncome.comparisonValue !== undefined ? operatingIncome.value / revenue.value : undefined;
  const priorOperatingMargin =
    operatingIncome && operatingIncome.comparisonValue !== undefined
      ? operatingIncome.comparisonValue / revenue.comparisonValue
      : undefined;
  const currentNetMargin = netIncome && netIncome.comparisonValue !== undefined ? netIncome.value / revenue.value : undefined;
  const priorNetMargin =
    netIncome && netIncome.comparisonValue !== undefined ? netIncome.comparisonValue / revenue.comparisonValue : undefined;

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
          "一時要因か構造的変化かは、このfilingだけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。"
        ].join(" "),
        sources: dedupeChatSources([...sources, ...driverSources])
      };
    }

    if (asksAboutDeterioration && !hasDeterioration) {
      return {
        answer: [
          "提出資料上、今期の利益率悪化は確認できません。",
          ...marginSnapshots.map(formatMarginSnapshot),
          "質問は悪化理由ですが、確認できる範囲では利益率は横ばいから改善方向なので、悪化要因を探すより改善が続くかを見た方が近いです。"
        ].join(" "),
        sources
      };
    }
    if (asksAboutImprovement && !hasImprovement) {
      return {
        answer: [
          "提出資料上、今期の利益率改善は確認できません。",
          ...marginSnapshots.map(formatMarginSnapshot)
        ].join(" "),
        sources
      };
    }
    return null;
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
      "利益率そのものは選択指標だけでは精密に計算しませんが、利益の変化と本文の採算要因は確認できます。",
      buildMetricObservationSentence(profitMetric),
      marginDrivers.text,
      "一時要因か構造的変化かは、このfilingだけでは断定せず、同じ費用・価格・構成要因が次期にも続くかを見ます。"
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
      if (!points.includes(point)) {
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
    const lower = sentence.toLowerCase();
    const point = classifyMarginDriverSentence(sentence, lower);
    if (!point || points.includes(point)) {
      continue;
    }
    points.push(point);
    if (points.length >= 4) {
      break;
    }
  }

  return points;
}

function classifyMarginDriverSentence(sentence: string, lower: string): string | null {
  if (/gross margin|gross profit|gross margin ratio|粗利|売上総利益/i.test(sentence)) {
    if (/higher|increased|improved|増|改善/i.test(sentence)) {
      return "粗利率・粗利益の改善";
    }
    if (/lower|decreased|declined|低下|減/i.test(sentence)) {
      return "粗利率・粗利益の低下";
    }
    return "粗利率・粗利益の変化";
  }
  if (/operating expenses?|cost of revenue|cost of sales|fulfillment|technology and infrastructure|sales and marketing|general and administrative|research and development|marketing, selling, and administrative|SG&A|TAC|traffic acquisition costs?|営業費用|販管費|研究開発費|費用|原価/i.test(sentence)) {
    if (/higher|increase|increased|増|上昇/i.test(sentence)) {
      return "営業費用・原価の増加";
    }
    if (/lower|decrease|decreased|減|低下/i.test(sentence)) {
      return "営業費用・原価の減少";
    }
    return "営業費用・原価の変化";
  }
  if (/price realization|realized prices|pricing|price\/mix|price mix|selling prices?|価格|実現価格/i.test(sentence)) {
    if (/unfavorable|lower|declined|低下|不利/i.test(sentence)) {
      return "価格実現・価格ミックスの悪化";
    }
    if (/favorable|higher|increase|上昇|好転/i.test(sentence)) {
      return "価格実現・価格ミックスの改善";
    }
    return "価格実現・価格ミックスの変化";
  }
  if (/sales volume|unit volumes?|volume|shipments?|販売数量|出荷量|数量/i.test(sentence)) {
    if (/higher|increase|increased|growth|増/i.test(sentence)) {
      return "販売数量・出荷量の増加";
    }
    if (/lower|decrease|decreased|decline|減/i.test(sentence)) {
      return "販売数量・出荷量の減少";
    }
    return "販売数量・出荷量の変化";
  }
  if (/fuel costs?|refinery|salaries|compensation|labor|人件費|燃料/i.test(sentence)) {
    return "燃料費・人件費などのコスト増";
  }
  if (/foreign exchange|currency|為替/i.test(sentence)) {
    return "為替影響";
  }
  if (/tariff|関税/i.test(sentence)) {
    return "関税影響";
  }
  if (/inventory|write-?down|warranty|depreciation|amortization|impairment|restructuring|在庫|減価償却|減損|構造改革/i.test(sentence)) {
    return "在庫・減価償却・一時費用の影響";
  }
  if (/net income|earnings per share|income tax|tax expense/i.test(lower)) {
    return null;
  }
  return null;
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

  if (delta > 0.0001) {
    return { label, current, prior, direction: "improved" };
  }
  if (delta < -0.0001) {
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
