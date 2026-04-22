import type { FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../../env";
import { formatMetricValue, formatYoYDelta, metricLabel } from "../metrics";
import { buildSecFilingSource, dedupeChatSources, type ChatEvidenceSource, type ChatResponsePayload } from "./grounding";

export interface DeterministicChatAnswer {
  strategy:
    | "margin_snapshot"
    | "revenue_breakdown"
    | "revenue_drivers"
    | "contrastive_market_reaction"
    | "cash_generation"
    | "change_overview"
    | "stock_context";
  response: ChatResponsePayload;
}

export function buildDeterministicMetricAnswer(
  filing: FilingCacheRecord,
  question: string
): DeterministicChatAnswer | null {
  const normalizedQuestion = question.replace(/\s+/g, "").toLowerCase();
  const asksContrastiveMarketReaction =
    /(株価|市場|反応|上げ|上が|下げ|下が|好感|嫌気)/.test(normalizedQuestion) &&
    (/(なのに|にもかかわらず|のに)/.test(normalizedQuestion) ||
      /(不確実|不透明|懸念|逆風|弱い|悪い|微妙|risk|uncertain|uncertainty)/.test(normalizedQuestion));
  const asksStockContext = isBroadStockContextQuestion(normalizedQuestion);
  const asksChangeOverview =
    /(前回決算との違い|前回との違い|前回比|今回の一番大きい変化|何が変わった|どこが変わった|変化点|今回の変化)/.test(
      normalizedQuestion
    );
  const asksRevenueBreakdown =
    /(売上|sales|revenue)/.test(normalizedQuestion) &&
    /(セクター|sector|セグメント|segment|事業|business|部門|内訳|構成|柱|源泉|カテゴリ)/.test(normalizedQuestion);
  const asksRevenueDrivers =
    /(売上|増収|成長|growth|revenue)/.test(normalizedQuestion) &&
    /(支え|押し上げ|牽引|ドライバ|主因|要因|原因|理由|どの変化|何が)/.test(normalizedQuestion);
  const asksCashGeneration =
    /(キャッシュフロー|cashflow|cash flow|現金|お金.*稼|稼げてる)/.test(normalizedQuestion) &&
    !/(還元|自社株買い|buyback|repurchase|配当|dividend|株主還元)/.test(normalizedQuestion);
  const asksAboutMargin = /(利益率|マージン|採算)/.test(normalizedQuestion);
  const asksAboutCause = /(主因|要因|原因|理由|なぜ)/.test(normalizedQuestion);
  const asksAboutImprovement = /(改善|向上|良化)/.test(normalizedQuestion);
  const asksAboutDeterioration = /(悪化|低下|下落|落ち込|鈍化)/.test(normalizedQuestion);
  const asksAboutChange = /(どう|変化|推移|なった)/.test(normalizedQuestion);
  if (asksContrastiveMarketReaction) {
    const response = buildContrastiveMarketReactionAnswer(filing);
    return response ? { strategy: "contrastive_market_reaction", response } : null;
  }

  if (asksStockContext) {
    const response = buildStockContextAnswer(filing);
    return response ? { strategy: "stock_context", response } : null;
  }

  if (asksChangeOverview) {
    const response = buildChangeOverviewAnswer(filing, normalizedQuestion);
    return response ? { strategy: "change_overview", response } : null;
  }

  if (asksRevenueBreakdown) {
    const response = buildRevenueBreakdownAnswer(filing);
    return response ? { strategy: "revenue_breakdown", response } : null;
  }

  if (asksRevenueDrivers) {
    const response = buildRevenueDriversAnswer(filing);
    return response ? { strategy: "revenue_drivers", response } : null;
  }

  if (asksCashGeneration) {
    const response = buildCashGenerationAnswer(filing);
    return response ? { strategy: "cash_generation", response } : null;
  }

  if (!asksAboutMargin || (!asksAboutImprovement && !asksAboutDeterioration && !asksAboutChange)) {
    return null;
  }

  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const operatingIncome = filing.metrics.find((metric) => metric.logicalName === "operatingIncome");
  const netIncome = filing.metrics.find((metric) => metric.logicalName === "netIncome");
  if (!revenue || !revenue.comparisonValue) {
    return null;
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
    return null;
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
    if (asksAboutDeterioration && !hasDeterioration) {
      return {
        strategy: "margin_snapshot",
        response: {
          answer: [
            "提出資料上、今期の利益率悪化は確認できません。",
            ...marginSnapshots.map(formatMarginSnapshot)
          ].join(" "),
          sources
        }
      };
    }
    if (asksAboutImprovement && !hasImprovement) {
      return {
        strategy: "margin_snapshot",
        response: {
          answer: [
            "提出資料上、今期の利益率改善は確認できません。",
            ...marginSnapshots.map(formatMarginSnapshot)
          ].join(" "),
          sources
        }
      };
    }
    return null;
  }

  const answerParts = [buildMarginIntro({ asksAboutImprovement, asksAboutDeterioration, hasImprovement, hasDeterioration })];
  answerParts.push(...marginSnapshots.map(formatMarginSnapshot));

  return {
    strategy: "margin_snapshot",
    response: {
      answer: answerParts.join(" "),
      sources
    }
  };
}

export function shouldRecoverFromWeakModelSources(
  filing: FilingCacheRecord,
  question: string,
  sourceIds: string[]
): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  const asksBroadReasoning =
    ((/(売上|sales|revenue)/.test(normalized) && /(主因|要因|原因|理由|なぜ|支え|ドライバ|牽引)/.test(normalized)) ||
      /(株価|市場|反応|好感|嫌気|織り込|織込|shareprice|stockprice|marketreaction|ガイダンス|見通し|予想|guidance|outlook|来期|次四半期|還元|自社株買い|buyback|repurchase|配当|dividend|capitalallocation|株主還元)/.test(
        normalized
      ) ||
      isBroadStockContextQuestion(normalized));

  if (!asksBroadReasoning) {
    return false;
  }

  const citedNarratives = sourceIds
    .map((sourceId) => filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId))
    .filter((chunk): chunk is SourceChunkRecord => chunk !== undefined && chunk.sectionType === "md_a");

  return citedNarratives.length > 0 && citedNarratives.every(isLowSignalNarrativeSource);
}

function isLowSignalNarrativeSource(source: SourceChunkRecord): boolean {
  return /available information|investor relations website|corporate website|securities and exchange commission|should be read in conjunction/i.test(
    source.text
  );
}

function buildRevenueDriversAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const revenueSourceId = findMetricSourceId(filing, "revenue");
  if (!revenue || !revenueSourceId) {
    return null;
  }

  const revenueSource = filing.sourceChunks.find((chunk) => chunk.sourceId === revenueSourceId);
  if (!revenueSource) {
    return null;
  }

  const narrative = summarizeRevenueDrivers(filing.sourceChunks);
  const sources = [buildSecFilingSource(revenueSource)];
  if (narrative) {
    for (const sourceId of narrative.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
  }

  const answerParts = [buildMetricObservationSentence(revenue)];
  if (narrative) {
    answerParts.push(narrative.text);
  }
  answerParts.push("ただし、どの要因がいちばん効いたかを厳密に切り分けるには追加情報が必要です。");

  return {
    answer: answerParts.join(" "),
    sources: dedupeChatSources(sources)
  };
}

function buildRevenueBreakdownAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const breakdown = summarizeRevenueBreakdown(filing.sourceChunks);
  if (!breakdown) {
    return null;
  }

  const sources = breakdown.sourceIds.flatMap((sourceId) => {
    const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
    return source ? [buildSecFilingSource(source)] : [];
  });

  return {
    answer: breakdown.text,
    sources: dedupeChatSources(sources)
  };
}

function buildStockContextAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const performance = summarizePerformanceStrength(filing);
  const risk = summarizeRiskContext(filing.sourceChunks);

  if (!performance && !risk) {
    return null;
  }

  const sources: ChatEvidenceSource[] = [];
  const answerParts = [buildFilingStockContextJudgment(filing, risk)];

  if (performance) {
    for (const sourceId of performance.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(`根拠になる直近決算の事実としては、${performance.text}`);
  }

  if (risk) {
    for (const sourceId of risk.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(`一方で、提出資料では${risk.text}。`);
  }

  answerParts.push("株の強弱をみるには、実際の株価推移や決算後ニュースも併せて確認する必要があります。");

  return {
    answer: answerParts.join(" "),
    sources: dedupeChatSources(sources)
  };
}

function buildContrastiveMarketReactionAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const risk = summarizeRiskContext(filing.sourceChunks);
  const performance = summarizePerformanceStrength(filing);
  const drivers = summarizeRevenueDrivers(filing.sourceChunks);

  if (!risk && !performance && !drivers) {
    return null;
  }

  const sources: ChatEvidenceSource[] = [];
  const answerParts: string[] = [];

  if (risk) {
    for (const sourceId of risk.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(`たしかに、提出資料では${risk.text}。`);
  }

  if (performance) {
    for (const sourceId of performance.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(`一方で、${performance.text}`);
  }

  if (drivers) {
    for (const sourceId of drivers.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(drivers.text);
  }

  answerParts.push("そのため、「不確実さはあるが、足元の業績や需要は想定より強い」と受け取られても不思議ではありません。");
  answerParts.push("ただし、実際に株価を押し上げた理由を一つに断定することはできません。");

  return {
    answer: answerParts.join(" "),
    sources: dedupeChatSources(sources)
  };
}

function buildCashGenerationAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const metric = filing.metrics.find((entry) => entry.logicalName === "operatingCashFlow");
  const sourceId = findMetricSourceId(filing, "operatingCashFlow");
  if (!metric || !sourceId) {
    return null;
  }

  const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
  if (!source) {
    return null;
  }

  return {
    answer: buildMetricObservationSentence(metric),
    sources: [buildSecFilingSource(source)]
  };
}

function buildChangeOverviewAnswer(
  filing: FilingCacheRecord,
  normalizedQuestion: string
): ChatResponsePayload | null {
  const rankedMetrics = filing.metrics
    .map((metric) => ({
      metric,
      sourceId: findMetricSourceId(filing, metric.logicalName),
      priority: metricPriority(metric.logicalName),
      magnitude:
        metric.yoyPercent !== undefined
          ? Math.abs(metric.yoyPercent)
          : metric.comparisonValue !== undefined && metric.comparisonValue !== 0
            ? Math.abs(((metric.value - metric.comparisonValue) / metric.comparisonValue) * 100)
            : 0
    }))
    .filter((entry) => entry.sourceId)
    .sort((left, right) => {
      if (right.magnitude !== left.magnitude) {
        return right.magnitude - left.magnitude;
      }

      return left.priority - right.priority;
    })
    .slice(0, 3);

  if (rankedMetrics.length === 0) {
    return null;
  }

  const sources = rankedMetrics.map((entry) => {
    const source = filing.sourceChunks.find((chunk) => chunk.sourceId === entry.sourceId)!;
    return buildSecFilingSource(source);
  });

  const answerParts: string[] = [];
  answerParts.push(`数字で目立つのは、${buildMetricObservationSentence(rankedMetrics[0]!.metric)}`);

  if (rankedMetrics.length > 1) {
    answerParts.push(`ほかには、${rankedMetrics.slice(1).map((entry) => buildMetricObservationSentence(entry.metric)).join(" ")}`);
  }

  const drivers = summarizeRevenueDrivers(filing.sourceChunks);
  if (drivers) {
    for (const sourceId of drivers.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(drivers.text);
  }

  if (/(前回決算|前回との違い|前回比)/.test(normalizedQuestion)) {
    answerParts.push("なお、この決算資料でそのまま比べやすいのは直前四半期ではなく前年同期比です。");
  }

  return {
    answer: answerParts.join(" "),
    sources: dedupeChatSources(sources)
  };
}

function summarizeRevenueDrivers(
  sourceChunks: SourceChunkRecord[]
): { text: string; sourceIds: string[] } | null {
  const points: string[] = [];
  const sourceIds: string[] = [];
  const regionPatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: "米州", pattern: /Americas[\s\S]*?higher net sales of ([^.]+)\./i },
    { label: "中国", pattern: /Greater China[\s\S]*?higher net sales of ([^.]+)\./i },
    { label: "日本", pattern: /Japan[\s\S]*?higher net sales of ([^.]+)\./i },
    { label: "アジア太平洋", pattern: /Rest of Asia Pacific[\s\S]*?higher net sales of ([^.]+)\./i }
  ];

  for (const chunk of sourceChunks) {
    if (chunk.sectionType !== "md_a") {
      continue;
    }

    for (const region of regionPatterns) {
      const match = chunk.text.match(region.pattern);
      if (!match?.[1]) {
        continue;
      }

      const driver = translateDriverList(match[1]);
      const point = `${region.label}は ${driver}`;
      if (!points.includes(point)) {
        points.push(point);
      }
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
    }
  }

  if (points.length === 0) {
    return null;
  }

  return {
    text: `提出資料では、${points.join("、")}の売上増が伸びを支えたと説明しています。`,
    sourceIds
  };
}

function summarizeRevenueBreakdown(
  sourceChunks: SourceChunkRecord[]
): { text: string; sourceIds: string[] } | null {
  type RevenueBucket = {
    label: string;
    priority: number;
    sourceId: string;
  };

  const bucketDefinitions: Array<{
    label: string;
    priority: number;
    patterns: RegExp[];
  }> = [
    {
      label: "車両販売・関連サービス",
      priority: 10,
      patterns: [/vehicle sales and services/i, /automotive sales(?: revenue)?/i, /vehicle sales(?: revenue)?/i]
    },
    {
      label: "サービス・その他",
      priority: 20,
      patterns: [/services and other/i]
    },
    {
      label: "自動車リース",
      priority: 30,
      patterns: [/automotive leasing/i]
    },
    {
      label: "エネルギー生成・蓄電",
      priority: 40,
      patterns: [/energy generation and storage revenue/i, /energy generation and storage/i]
    },
    {
      label: "サブスク・サービス",
      priority: 50,
      patterns: [/subscription and services/i]
    },
    {
      label: "取引収益",
      priority: 60,
      patterns: [/transaction revenue/i]
    },
    {
      label: "準備金運用収益",
      priority: 70,
      patterns: [/reserve income/i]
    },
    {
      label: "その他収益",
      priority: 80,
      patterns: [/other revenue/i]
    },
    {
      label: "製品売上",
      priority: 90,
      patterns: [/product revenue/i]
    },
    {
      label: "サービス売上",
      priority: 100,
      patterns: [/service revenue/i]
    }
  ];

  const found = new Map<string, RevenueBucket>();

  for (const chunk of sourceChunks) {
    if (chunk.sectionType !== "md_a") {
      continue;
    }

    const text = chunk.text;
    if (!isRevenueBreakdownContext(text)) {
      continue;
    }

    for (const definition of bucketDefinitions) {
      if (!definition.patterns.some((pattern) => pattern.test(text))) {
        continue;
      }

      if (!found.has(definition.label)) {
        found.set(definition.label, {
          label: definition.label,
          priority: definition.priority,
          sourceId: chunk.sourceId
        });
      }
    }
  }

  const buckets = Array.from(found.values()).sort((left, right) => left.priority - right.priority);
  if (buckets.length === 0) {
    return null;
  }

  const headlineBuckets = buckets.slice(0, 4);
  const sourceIds = Array.from(new Set(headlineBuckets.map((bucket) => bucket.sourceId)));

  return {
    text: `売上の主な区分は、${headlineBuckets.map((bucket) => bucket.label).join("、")}です。`,
    sourceIds
  };
}

function isRevenueBreakdownContext(text: string): boolean {
  const strongPositivePatterns = [
    /revenue by/i,
    /disaggregation of revenue/i,
    /revenue from/i,
    /automotive sales(?: revenue)?/i,
    /automotive leasing/i,
    /vehicle sales and services/i,
    /services and other/i,
    /energy generation and storage revenue/i,
    /subscription and services/i,
    /transaction revenue/i,
    /reserve income/i,
    /other revenue/i,
    /product revenue/i,
    /service revenue/i
  ];
  const disqualifyingPatterns = [
    /sources? to fund/i,
    /cash requirements?/i,
    /operating cash inflows?/i,
    /cash inflows?/i,
    /liquidity/i,
    /cash and investments portfolio/i,
    /debt facilities?/i,
    /equity offerings?/i,
    /indebtedness/i,
    /capital resources?/i
  ];
  const hasStrongPositive = strongPositivePatterns.some((pattern) => pattern.test(text));
  if (!hasStrongPositive) {
    return false;
  }

  return !disqualifyingPatterns.some((pattern) => pattern.test(text));
}

function summarizePerformanceStrength(
  filing: FilingCacheRecord
): { text: string; sourceIds: string[] } | null {
  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const operatingIncome = filing.metrics.find((metric) => metric.logicalName === "operatingIncome");
  const netIncome = filing.metrics.find((metric) => metric.logicalName === "netIncome");
  const sourceIds: string[] = [];

  if (revenue) {
    const sourceId = findMetricSourceId(filing, "revenue");
    if (sourceId) {
      sourceIds.push(sourceId);
    }
  }

  if (operatingIncome) {
    const sourceId = findMetricSourceId(filing, "operatingIncome");
    if (sourceId) {
      sourceIds.push(sourceId);
    }
  } else if (netIncome) {
    const sourceId = findMetricSourceId(filing, "netIncome");
    if (sourceId) {
      sourceIds.push(sourceId);
    }
  }

  if (revenue && operatingIncome) {
    return {
      text: `${buildMetricObservationSentence(revenue)} ${buildMetricObservationSentence(operatingIncome)} 少なくとも、足元の数字自体は弱くありません。`,
      sourceIds
    };
  }

  if (revenue) {
    return {
      text: `${buildMetricObservationSentence(revenue)} 少なくとも、売上の伸び自体は確認できます。`,
      sourceIds
    };
  }

  if (operatingIncome) {
    return {
      text: `${buildMetricObservationSentence(operatingIncome)} 少なくとも、利益面は弱くありません。`,
      sourceIds
    };
  }

  if (netIncome) {
    return {
      text: `${buildMetricObservationSentence(netIncome)} 少なくとも、利益面は弱くありません。`,
      sourceIds
    };
  }

  return null;
}

function summarizeRiskContext(
  sourceChunks: SourceChunkRecord[]
): { text: string; sourceIds: string[] } | null {
  const points: string[] = [];
  const sourceIds: string[] = [];

  for (const chunk of sourceChunks) {
    if (chunk.sectionType !== "md_a") {
      continue;
    }

    const haystack = chunk.text.toLowerCase();
    if (/forward-looking statements|private securities litigation reform act|available information/i.test(haystack)) {
      continue;
    }

    if (/tariff|関税/.test(haystack) && !points.includes("関税や追加措置の不確実さが残っています")) {
      points.push("関税や追加措置の不確実さが残っています");
      sourceIds.push(chunk.sourceId);
    }

    if (
      /(macroeconomic|inflation|interest rates|component pricing|currency fluctuations|macro)/.test(haystack) &&
      !points.includes("景気・金利・為替などの不確実さがあります")
    ) {
      points.push("景気・金利・為替などの不確実さがあります");
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
    }

    if (
      /(consumer spending|consumer sentiment|negative consumer sentiment|adverse impact|uncertain|uncertainty|risk)/.test(
        haystack
      ) &&
      !points.includes("需要や消費者心理が弱くなるリスクがあります")
    ) {
      points.push("需要や消費者心理が弱くなるリスクがあります");
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
    }

    if (points.length >= 2) {
      break;
    }
  }

  if (points.length === 0) {
    return null;
  }

  return {
    text: points.join("、"),
    sourceIds
  };
}

function buildFilingStockContextJudgment(
  filing: FilingCacheRecord,
  risk: { text: string; sourceIds: string[] } | null
): string {
  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const profit =
    filing.metrics.find((metric) => metric.logicalName === "operatingIncome") ??
    filing.metrics.find((metric) => metric.logicalName === "netIncome");
  let score = 0;

  if ((revenue?.yoyPercent ?? 0) > 0) {
    score += 1;
  } else if ((revenue?.yoyPercent ?? 0) < 0) {
    score -= 1;
  }

  if ((profit?.yoyPercent ?? 0) > 0) {
    score += 1;
  } else if ((profit?.yoyPercent ?? 0) < 0) {
    score -= 1;
  }

  if (risk) {
    score -= 1;
  }

  if (score >= 1) {
    return "今回の決算資料だけで見ると、足元はやや強めです。";
  }

  if (score <= -1) {
    return "今回の決算資料だけで見ると、足元は慎重寄りです。";
  }

  return "今回の決算資料だけで見ると、強弱はまだらです。";
}

function isBroadStockContextQuestion(normalizedQuestion: string): boolean {
  return (
    /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
      normalizedQuestion
    ) ||
    (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalizedQuestion) &&
      /(株|株価|市場|stock|share)/.test(normalizedQuestion))
  );
}

function translateDriverList(raw: string): string {
  return raw
    .replace(/\bServices\b/g, "サービス")
    .replace(/\bService\b/g, "サービス")
    .replace(/\band\b/gi, "と")
    .replace(/\s+/g, " ")
    .trim();
}

function buildMetricObservationSentence(metric: MetricSnapshot): string {
  const label = metricLabel(metric.logicalName);
  const current = formatMetricValue(metric.value, metric.unit);

  if (metric.yoyPercent !== undefined) {
    return `${label}は ${current} で、前年同期比 ${formatYoYDelta(metric.yoyPercent)} です。`;
  }

  if (metric.comparisonValue !== undefined) {
    return `${label}は ${current} で、比較値は ${formatMetricValue(metric.comparisonValue, metric.unit)} です。`;
  }

  return `${label}は ${current} です。`;
}

function metricPriority(logicalName: MetricSnapshot["logicalName"]): number {
  switch (logicalName) {
    case "revenue":
      return 0;
    case "operatingIncome":
      return 1;
    case "netIncome":
      return 2;
    case "operatingCashFlow":
      return 3;
    case "epsBasic":
      return 4;
    default:
      return 10;
  }
}

type MarginDirection = "improved" | "deteriorated" | "flat";

type MarginSnapshot = {
  label: string;
  current: number;
  prior: number;
  direction: MarginDirection;
};

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

function findMetricSourceId(filing: FilingCacheRecord, logicalName: MetricSnapshot["logicalName"]): string | undefined {
  const metric = filing.metrics.find((item) => item.logicalName === logicalName);
  if (!metric) {
    return undefined;
  }

  return filing.sourceChunks.find(
    (chunk) => chunk.sectionType === "xbrl_metric" && chunk.tagName === metric.tagUsed
  )?.sourceId;
}
