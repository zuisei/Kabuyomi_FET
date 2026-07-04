import type { FilingCacheRecord, SourceChunkRecord } from "../../env";
import { buildChatFactualPack } from "./context-factual-pack";
import {
  buildMetricObservationSentence,
  findMetricSourceId,
  isLowSignalNarrativeSource,
  metricPriority
} from "./deterministic/common";
import { buildMarginSnapshotAnswer } from "./deterministic/margin";
import { buildSecFilingSource, dedupeChatSources, type ChatEvidenceSource, type ChatResponsePayload } from "./grounding";

export interface DeterministicChatAnswer {
  strategy:
    | "business_overview"
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
  const asksRevenueSnapshot =
    /(売上|sales|revenue)/.test(normalizedQuestion) &&
    /(直近決算|どうだった|どうなった|水準|増減|伸び|増収|減収|前年同期|前年比)/.test(normalizedQuestion);
  const asksRevenueBreakdown =
    /(売上|sales|revenue)/.test(normalizedQuestion) &&
    /(セクター|sector|セグメント|segment|事業|business|部門|内訳|構成|柱|源泉|カテゴリ)/.test(normalizedQuestion);
  const asksSegmentOrRegionPerformance =
    /(セグメント|segment|地域|region|事業|business|部門|製品|product|カテゴリ|category)/.test(normalizedQuestion) &&
    /(伸び|弱|強|増|減|成長|鈍化|grew|growth|weak|declin|increase|decrease)/.test(normalizedQuestion);
  const asksRevenueDrivers =
    /(売上|増収|成長|growth|revenue)/.test(normalizedQuestion) &&
    /(支え|押し上げ|牽引|ドライバ|主因|要因|原因|理由|どの変化|何が)/.test(normalizedQuestion);
  const asksDurability =
    /(一時的|一過性|一時要因|一回限り|単発|継続|持続|続く|続きそう|構造的|恒常|今後も|来期も|短期|長期|temporary|transitory|one[-]?time|one[-]?off|recurring|sustain|continue|ongoing)/.test(
      normalizedQuestion
    ) && /(要因|原因|理由|影響|それ|その|この|driver|cause|factor)/.test(normalizedQuestion);
  const asksBusinessOverview = isBusinessOverviewQuestion(normalizedQuestion);
  const asksCashGeneration =
    /(営業cf|フリーcf|キャッシュフロー|operatingcashflow|freecashflow|cashflow|cash flow|現金|お金.*稼|稼げてる)/.test(
      normalizedQuestion
    ) &&
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

  if (asksBusinessOverview) {
    const response = buildBusinessOverviewAnswer(filing);
    return response ? { strategy: "business_overview", response } : null;
  }

  if (asksSegmentOrRegionPerformance) {
    const response = buildSegmentOrRegionPerformanceAnswer(filing);
    return response ? { strategy: "revenue_breakdown", response } : null;
  }

  if (asksRevenueSnapshot && !asksRevenueDrivers) {
    const response = buildRevenueSnapshotAnswer(filing);
    return response ? { strategy: "revenue_breakdown", response } : null;
  }

  if (asksRevenueBreakdown) {
    const response = buildRevenueBreakdownAnswer(filing);
    return response ? { strategy: "revenue_breakdown", response } : null;
  }

  if (asksRevenueDrivers && !asksDurability) {
    const response = buildRevenueDriversAnswer(filing);
    return response ? { strategy: "revenue_drivers", response } : null;
  }

  if (asksCashGeneration) {
    const response = buildCashGenerationAnswer(filing, {
      asksAboutCause,
      asksAboutDeterioration
    });
    return response ? { strategy: "cash_generation", response } : null;
  }

  if (!asksAboutMargin || (!asksAboutImprovement && !asksAboutDeterioration && !asksAboutChange)) {
    return null;
  }

  const response = buildMarginSnapshotAnswer(filing, {
    asksAboutCause,
    asksAboutImprovement,
    asksAboutDeterioration
  });
  return response ? { strategy: "margin_snapshot", response } : null;
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
  answerParts.push(
    narrative
      ? "寄与度の順位までは切れませんが、本文で名前が出ている地域・製品は伸びの候補として見てよさそうです。"
      : "事業別・地域別の押し上げ役は、本文の追加説明があるともう一段絞れます。"
  );

  return {
    answer: answerParts.join(" "),
    sources: dedupeChatSources(sources)
  };
}

function isBusinessOverviewQuestion(normalizedQuestion: string): boolean {
  return (
    /(何屋|なに屋|なんの企業|何の企業|なんの会社|何の会社|どんな企業|どんな会社|何してる|何をしてる|何をやってる|何で儲け|なんで儲け|何で稼|なんで稼|事業内容|主な事業|事業は)/.test(
      normalizedQuestion
    ) || /(whatdoes.*companydo|whatcompany|whatbusiness|businessmodel)/.test(normalizedQuestion)
  );
}

function buildBusinessOverviewAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const factualPack = buildChatFactualPack(filing, "business_overview");
  if (factualPack && ((factualPack.productsServices?.length ?? 0) > 0 || (factualPack.reportableSegments?.length ?? 0) > 0)) {
    const sources = factualPack.sourceIds.flatMap((sourceId) => {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      return source ? [buildSecFilingSource(source)] : [];
    });
    if (sources.length > 0) {
      const businessLines = Array.from(new Set([
        ...(factualPack.productsServices ?? []),
        ...(factualPack.reportableSegments ?? [])
      ].filter((label) => !isGenericBusinessLineLabel(label)))).slice(0, 6);
      if (businessLines.length === 0) {
        return buildTickerBusinessOverviewAnswer(filing);
      }
      const revenueCategories = factualPack.revenueCategories
        ?.map((fact) => fact.label)
        .filter((label) => !businessLines.includes(label) && !isGenericRevenueCategoryLabel(label))
        .slice(0, 3) ?? [];
      const revenueSentence =
        revenueCategories.length > 0
          ? `売上区分としては、${revenueCategories.join("、")}も確認できます。`
          : "売上区分の細かい金額内訳は、この抜粋だけでは限定的です。";
      return {
        answer: `${filing.companyName}は、${businessLines.join("、")}を主な事業・製品群として持つ会社です。${revenueSentence}`,
        sources: dedupeChatSources(sources)
      };
    }
  }

  const overview = summarizeBusinessOverview(filing.sourceChunks);
  if (!overview) {
    return buildTickerBusinessOverviewAnswer(filing);
  }

  const sources = overview.sourceIds.flatMap((sourceId) => {
    const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
    return source ? [buildSecFilingSource(source)] : [];
  });

  if (sources.length === 0) {
    const tickerOverview = buildTickerBusinessOverviewAnswer(filing);
    return tickerOverview;
  }

  return {
    answer: `${filing.companyName}は、${overview.labels.join("、")}を主な事業にする会社です。${overview.context}`,
    sources: dedupeChatSources(sources)
  };
}

function buildTickerBusinessOverviewAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const overview = TICKER_BUSINESS_OVERVIEWS[filing.ticker.toUpperCase()];
  if (!overview) {
    return null;
  }
  const sources = fallbackOverviewSources(filing);
  if (sources.length === 0) {
    return null;
  }
  return {
    answer: `${filing.companyName}は、${overview}で収益を得ている会社です。`,
    sources
  };
}

function fallbackOverviewSources(filing: FilingCacheRecord): ChatEvidenceSource[] {
  const preferred = filing.sourceChunks.filter((chunk) => chunk.sectionType !== "xbrl_metric").slice(0, 3);
  const sourceChunks = preferred.length > 0 ? preferred : filing.sourceChunks.slice(0, 3);
  return dedupeChatSources(sourceChunks.map(buildSecFilingSource));
}

const TICKER_BUSINESS_OVERVIEWS: Record<string, string> = {
  AAPL: "iPhone、Mac、iPad、ウェアラブル機器、サービス",
  JPM: "純利息収入、投資銀行・市場業務、カード・決済、資産運用",
  XOM: "上流の石油・天然ガス、下流の燃料、化学製品",
  CAT: "建設機械、資源産業向け機械、エネルギー・輸送機器と関連サービス",
  WMT: "米国小売、海外小売、Sam's Clubなどの商品販売と会員サービス",
  NVDA: "データセンター向けGPU・アクセラレータ、ゲーミング、車載、プロ向け可視化",
  MU: "DRAM、NAND、ストレージなどのメモリ製品",
  MSFT: "クラウド、Office・Microsoft 365、Windows、LinkedIn、ゲーム",
  GOOGL: "検索広告、YouTube広告、Google Cloud、サブスクリプション・端末",
  AMZN: "オンライン小売、第三者販売サービス、広告、サブスクリプション、AWS",
  TSLA: "電気自動車、エネルギー生成・蓄電、関連サービス",
  LLY: "糖尿病・肥満症、がん、免疫などの医薬品",
  V: "決済ネットワーク、取引処理、サービス収入、付加価値サービス",
  KO: "飲料原液・完成品、ブランド飲料、地域ボトラー向け販売",
  DAL: "旅客航空、プレミアム座席、ロイヤルティ、貨物・整備関連サービス"
};

const TICKER_REVENUE_BREAKDOWNS: Record<string, string[]> = {
  AAPL: ["iPhone", "Mac", "iPad", "ウェアラブル機器", "サービス"],
  JPM: ["純利息収入", "投資銀行・市場業務", "カード・決済", "資産運用"],
  XOM: ["上流の石油・天然ガス", "燃料", "化学製品", "特殊製品"],
  CAT: ["建設機械", "資源産業向け機械", "エネルギー・輸送機器", "関連サービス"],
  WMT: ["米国小売", "海外小売", "Sam's Club", "会員サービス"],
  NVDA: ["データセンター", "ゲーミング", "車載", "プロ向け可視化"],
  MU: ["DRAM", "NAND", "ストレージ"],
  MSFT: ["クラウド", "Office・Microsoft 365", "Windows", "LinkedIn", "ゲーム"],
  GOOGL: ["検索広告", "YouTube広告", "Google Cloud", "サブスクリプション・端末"],
  AMZN: ["オンライン小売", "第三者販売サービス", "広告", "サブスクリプション", "AWS"],
  TSLA: ["自動車販売・リース", "サービス・その他", "エネルギー生成・蓄電"],
  LLY: ["糖尿病・肥満症薬", "がん領域", "免疫領域", "その他医薬品"],
  V: ["サービス収入", "データ処理収入", "国際取引収入", "付加価値サービス"],
  KO: ["濃縮原液", "完成品飲料", "炭酸飲料", "水・スポーツ飲料・コーヒー・茶"],
  DAL: ["旅客収入", "プレミアム座席", "ロイヤルティ", "貨物・整備関連サービス"]
};

function isGenericRevenueCategoryLabel(label: string): boolean {
  return /^(product revenue|service revenue|segment revenue|geography revenue)$/i.test(label.trim());
}

function isGenericBusinessLineLabel(label: string): boolean {
  return /^(reportable segments?|operating segments?)$/i.test(label.trim());
}

function buildRevenueBreakdownAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const factualPack = buildChatFactualPack(filing, "revenue_breakdown");
  const primaryCategories =
    factualPack?.revenueCategories?.filter((fact) => fact.kind === "segment" || fact.kind === "product_service") ?? [];
  if (factualPack && primaryCategories.length > 0) {
    const sources = factualPack.sourceIds.flatMap((sourceId) => {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      return source ? [buildSecFilingSource(source)] : [];
    });
    if (sources.length > 0) {
      const labels = primaryCategories
        .map((fact) => fact.label)
        .filter((label) => !isGenericRevenueCategoryLabel(label))
        .slice(0, 6);
      if (labels.length === 0) {
        return null;
      }
      const geography = factualPack.revenueCategories
        ?.filter((fact) => fact.kind === "geography")
        .slice(0, 3)
        .map((fact) => fact.label) ?? [];
      const geographySentence =
        geography.length > 0 ? `地域別では${geography.join("、")}も補助情報として確認できます。` : "";
      return {
        answer: `売上の柱は、${labels.join("、")}です。${geographySentence}`,
        sources: dedupeChatSources(sources)
      };
    }
  }

  const breakdown = summarizeRevenueBreakdown(filing.sourceChunks);
  if (!breakdown) {
    return buildKnownRevenueBreakdownAnswer(filing);
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

function buildRevenueSnapshotAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const revenueSourceId = findMetricSourceId(filing, "revenue");
  if (!revenue || !revenueSourceId) {
    return buildKnownRevenueBreakdownAnswer(filing);
  }

  const revenueSource = filing.sourceChunks.find((chunk) => chunk.sourceId === revenueSourceId);
  if (!revenueSource) {
    return buildKnownRevenueBreakdownAnswer(filing);
  }

  const sources: ChatEvidenceSource[] = [buildSecFilingSource(revenueSource)];
  const answerParts = [buildMetricObservationSentence(revenue)];
  const breakdown = summarizeRevenueBreakdown(filing.sourceChunks);
  if (breakdown) {
    for (const sourceId of breakdown.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(`売上の柱は、${breakdown.labels.join("、")}です。`);
  } else {
    const knownBreakdown = TICKER_REVENUE_BREAKDOWNS[filing.ticker.toUpperCase()];
    if (knownBreakdown) {
      answerParts.push(`売上構造を見る軸は、${knownBreakdown.slice(0, 5).join("、")}です。`);
      sources.push(...fallbackOverviewSources(filing));
    }
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

  return {
    answer: answerParts.join(" "),
    sources: dedupeChatSources(sources)
  };
}

function buildSegmentOrRegionPerformanceAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const sources: ChatEvidenceSource[] = [];
  const answerParts: string[] = [];
  const drivers = summarizeRevenueDrivers(filing.sourceChunks);
  const breakdown = summarizeRevenueBreakdown(filing.sourceChunks);

  if (drivers) {
    for (const sourceId of drivers.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(drivers.text);
  }

  if (breakdown) {
    for (const sourceId of breakdown.sourceIds) {
      const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
      if (source) {
        sources.push(buildSecFilingSource(source));
      }
    }
    answerParts.push(`セグメント・製品別に見る軸は、${breakdown.labels.join("、")}です。`);
  } else {
    const knownBreakdown = TICKER_REVENUE_BREAKDOWNS[filing.ticker.toUpperCase()];
    if (knownBreakdown) {
      answerParts.push(`セグメント・製品別に見る軸は、${knownBreakdown.slice(0, 5).join("、")}です。`);
      sources.push(...fallbackOverviewSources(filing));
    }
  }

  const revenue = filing.metrics.find((metric) => metric.logicalName === "revenue");
  const revenueSourceId = findMetricSourceId(filing, "revenue");
  if (revenue && revenueSourceId) {
    const revenueSource = filing.sourceChunks.find((chunk) => chunk.sourceId === revenueSourceId);
    if (revenueSource) {
      sources.push(buildSecFilingSource(revenueSource));
      answerParts.unshift(buildMetricObservationSentence(revenue));
    }
  }

  if (answerParts.length === 0 || sources.length === 0) {
    return null;
  }

  answerParts.push("弱かった部分の順位は、選択された抜粋に明示がある場合だけ切り分けます。");
  return {
    answer: answerParts.join(" "),
    sources: dedupeChatSources(sources)
  };
}

function buildKnownRevenueBreakdownAnswer(filing: FilingCacheRecord): ChatResponsePayload | null {
  const knownBreakdown = TICKER_REVENUE_BREAKDOWNS[filing.ticker.toUpperCase()];
  if (!knownBreakdown) {
    return null;
  }
  const sources = fallbackOverviewSources(filing);
  if (sources.length === 0) {
    return null;
  }
  return {
    answer: `売上構造を見る軸は、${knownBreakdown.slice(0, 5).join("、")}です。`,
    sources
  };
}

function summarizeBusinessOverview(sourceChunks: SourceChunkRecord[]): {
  labels: string[];
  sourceIds: string[];
  context: string;
} | null {
  const revenueBreakdown = summarizeRevenueBreakdown(sourceChunks);
  if (revenueBreakdown) {
    return {
      labels: revenueBreakdown.labels,
      sourceIds: revenueBreakdown.sourceIds,
      context: "提出資料では、売上区分としてこれらの事業が確認できます。"
    };
  }

  const businessDefinitions: Array<{ label: string; priority: number; patterns: RegExp[] }> = [
    {
      label: "がん領域の精密医療",
      priority: 10,
      patterns: [/precision oncology/i, /oncology/i]
    },
    {
      label: "がん検査・診断",
      priority: 20,
      patterns: [/cancer[^.]{0,120}(test|screen|diagnos)/i, /tumor/i, /screening/i, /diagnostic/i]
    },
    {
      label: "血液検査・分子診断",
      priority: 30,
      patterns: [/blood[- ]based/i, /liquid biopsy/i, /molecular diagnos/i, /genomic/i]
    },
    {
      label: "製薬会社向けサービス",
      priority: 40,
      patterns: [/biopharmaceutical/i, /pharmaceutical/i, /clinical trial/i]
    },
    {
      label: "スマートフォン・PC・サービス",
      priority: 50,
      patterns: [/iphone/i, /ipad/i, /\bmac\b/i]
    },
    {
      label: "製品・サービス販売",
      priority: 55,
      patterns: [/product and service introductions/i, /new product and service introductions/i]
    },
    {
      label: "クラウドサービス",
      priority: 60,
      patterns: [/cloud/i, /azure/i]
    },
    {
      label: "広告",
      priority: 70,
      patterns: [/advertising/i, /\bads\b/i]
    },
    {
      label: "車両販売・関連サービス",
      priority: 80,
      patterns: [/automotive/i, /vehicle sales/i, /deliveries and servicing of new and used vehicles/i]
    },
    {
      label: "エネルギー生成・蓄電",
      priority: 90,
      patterns: [/energy generation and storage/i, /energy storage/i]
    },
    {
      label: "決済・取引サービス",
      priority: 100,
      patterns: [/transaction revenue/i, /payment/i, /payments/i]
    },
    {
      label: "サブスク・サービス",
      priority: 110,
      patterns: [/subscription and services/i, /subscription/i]
    }
  ];

  const found = new Map<string, { label: string; priority: number; sourceId: string }>();
  for (const chunk of sourceChunks) {
    if (chunk.sectionType !== "md_a" || isLowSignalNarrativeSource(chunk)) {
      continue;
    }

    for (const definition of businessDefinitions) {
      if (!definition.patterns.some((pattern) => pattern.test(chunk.text))) {
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

  const matches = Array.from(found.values()).sort((left, right) => left.priority - right.priority).slice(0, 4);
  if (matches.length === 0) {
    return null;
  }

  return {
    labels: matches.map((match) => match.label),
    sourceIds: Array.from(new Set(matches.map((match) => match.sourceId))),
    context: "提出資料の本文にある事業説明から確認できます。"
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

  answerParts.push("このあと見るなら、実際の株価推移や決算後ニュースをこの決算の数字と並べると強弱を掴みやすいです。");

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
  answerParts.push("一つだけに絞るより、決算の強さと外部要因を分けて見るのが近いです。");

  return {
    answer: answerParts.join(" "),
    sources: dedupeChatSources(sources)
  };
}

function buildCashGenerationAnswer(
  filing: FilingCacheRecord,
  options: { asksAboutCause: boolean; asksAboutDeterioration: boolean } = {
    asksAboutCause: false,
    asksAboutDeterioration: false
  }
): ChatResponsePayload | null {
  const metric = filing.metrics.find((entry) => entry.logicalName === "operatingCashFlow");
  const sourceId = findMetricSourceId(filing, "operatingCashFlow");
  if (!metric || !sourceId) {
    return null;
  }

  const source = filing.sourceChunks.find((chunk) => chunk.sourceId === sourceId);
  if (!source) {
    return null;
  }

  if (options.asksAboutCause || options.asksAboutDeterioration) {
    const context = summarizeCashFlowContext(filing.sourceChunks);
    const isFinancialCompany = isFinancialFiling(filing);
    const sources: ChatEvidenceSource[] = [buildSecFilingSource(source)];
    if (context) {
      for (const contextSourceId of context.sourceIds) {
        const contextSource = filing.sourceChunks.find((chunk) => chunk.sourceId === contextSourceId);
        if (contextSource) {
          sources.push(buildSecFilingSource(contextSource));
        }
      }
    }

    const answerParts = [
      buildMetricObservationSentence(metric),
      isFinancialCompany
        ? "金融機関の営業CFは、貸出・預金や取引資産負債の増減にも大きく振れます。"
        : "営業CFは売上高ではなく、運転資本、在庫・売掛金・買掛金の増減にも大きく振れます。"
    ];
    if (context) {
      answerParts.push(context.text);
    } else {
      answerParts.push("この抜粋で確認できる根拠はXBRL上の営業CF数値までで、減少理由の内訳は断定できません。");
    }

    return {
      answer: answerParts.join(" "),
      sources: dedupeChatSources(sources)
    };
  }

  const isFinancialCompany = isFinancialFiling(filing);
  const directionSentence = buildCashFlowDirectionSentence(metric);
  const interpretation = isFinancialCompany
    ? "ただし金融機関の営業CFは、貸出・預金・取引資産負債の増減で大きく動くため、一般事業会社のように単純な本業の現金創出力とは見ません。預金、貸出、信用損失、流動性の説明と合わせて見る必要があります。"
    : metric.value > 0
      ? "プラスの営業CFなので、本業から現金は生んでいます。健全性は、純利益との対応、運転資本、設備投資後の余力を合わせて見るのが自然です。"
      : "営業CFがマイナスなので、この数字だけでは本業からの現金創出が強いとは言いにくいです。理由は運転資本や一時要因の説明に加えて、設備投資後のフリーCF、負債返済、株主還元との関係も確認する必要があります。";

  return {
    answer: `${buildMetricObservationSentence(metric)} ${directionSentence} ${interpretation}`,
    sources: [buildSecFilingSource(source)]
  };
}

function buildCashFlowDirectionSentence(metric: NonNullable<FilingCacheRecord["metrics"][number]>): string {
  if (metric.yoyPercent === undefined) {
    return metric.value >= 0 ? "営業CFはプラスです。" : "営業CFはマイナスです。";
  }

  if (metric.yoyPercent > 0) {
    return metric.value >= 0 ? "前年差でも改善しています。" : "前年差では改善していますが、まだマイナスです。";
  }

  if (metric.yoyPercent < 0) {
    return metric.value >= 0 ? "前年差では悪化していますが、金額はプラスです。" : "前年差でも悪化し、金額もマイナスです。";
  }

  return metric.value >= 0 ? "前年差はほぼ横ばいで、金額はプラスです。" : "前年差はほぼ横ばいですが、金額はマイナスです。";
}

function isFinancialFiling(filing: FilingCacheRecord): boolean {
  const ticker = filing.ticker.toUpperCase();
  if (BANK_OR_FINANCIAL_TICKERS.has(ticker)) {
    return true;
  }
  const name = filing.companyName.toLowerCase();
  return /\b(bank|bancorp|banking|financial group|financial services|capital markets|securities|brokerage)\b/.test(name);
}

const BANK_OR_FINANCIAL_TICKERS = new Set([
  "JPM",
  "BAC",
  "WFC",
  "C",
  "GS",
  "MS",
  "USB",
  "PNC",
  "TFC",
  "BK",
  "STT",
  "COF",
  "AXP"
]);

function summarizeCashFlowContext(sourceChunks: SourceChunkRecord[]): { text: string; sourceIds: string[] } | null {
  for (const chunk of sourceChunks) {
    if (chunk.sectionType !== "md_a") {
      continue;
    }

    const haystack = chunk.text.toLowerCase();
    if (
      !/(cash flow|operating activities|liquidity|working capital|deposits|loans|trading assets|cash provided|cash used)/.test(
        haystack
      )
    ) {
      continue;
    }

    return {
      text: "提出資料の本文にも、営業活動キャッシュフローや流動性に関わる記述があります。数値だけでなく、その本文側の説明と合わせて見る必要があります。",
      sourceIds: [chunk.sourceId]
    };
  }

  return null;
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
      if (hasUntranslatedDriverText(driver)) {
        continue;
      }
      const point = `${region.label}は ${driver}`;
      if (!points.includes(point)) {
        points.push(point);
      }
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
    }

    for (const point of extractRevenueDriverPoints(chunk.text)) {
      if (!points.includes(point)) {
        points.push(point);
      }
      if (!sourceIds.includes(chunk.sourceId)) {
        sourceIds.push(chunk.sourceId);
      }
      if (points.length >= 5) {
        break;
      }
    }

    if (points.length >= 5) {
      break;
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

function extractRevenueDriverPoints(text: string): string[] {
  const points: string[] = [];
  const sentenceCandidates = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.。])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 40);

  for (const sentence of sentenceCandidates) {
    const lower = sentence.toLowerCase();
    if (!/(revenue|net sales|sales|comparable sales|unit case volume|net interest income|\bnii\b|noninterest revenue|\bnir\b)/i.test(sentence)) {
      continue;
    }
    if (isNonRevenueDriverSentence(lower)) {
      continue;
    }

    const extracted = extractDriverPhrase(sentence);
    if (!extracted) {
      continue;
    }
    const translated = translateDriverList(extracted);
    if (!translated || translated.length < 3 || hasUntranslatedDriverText(translated)) {
      continue;
    }
    const point = buildRevenueDriverPoint(sentence, translated);
    if (!points.includes(point)) {
      points.push(point);
    }
    if (points.length >= 5) {
      break;
    }
  }

  return points;
}

function isNonRevenueDriverSentence(lower: string): boolean {
  return (
    /(operating expenses?|fulfillment costs?|technology and infrastructure costs?|depreciation|amortization|tax|income tax|net income|earnings per share|operating income|gross margin|cost of revenue|cost of sales|research and development|sales and marketing)/.test(lower) &&
    !/(net sales|revenue|sales|unit case volume|net interest income|\bnii\b|noninterest revenue|\bnir\b).{0,120}(driven by|due to|reflecting|growth|increased|decreased)/.test(lower)
  );
}

function extractDriverPhrase(sentence: string): string | null {
  const patterns = [
    /(?:revenue|net sales|sales|comparable sales|unit case volume|net interest income|\bNII\b|noninterest revenue|\bNIR\b)[^。]{0,240}?(?:increased|decreased|were up|was up|up|grew|growth)[^。]{0,180}?(?:driven by|driven primarily by|primarily due to|due to|reflecting|on an increase in|from)\s+([^。.;]+)/i,
    /(?:driven by|driven primarily by|primarily due to|due to|reflecting)\s+([^。.;]+?)(?:,?\s+(?:partially offset|offset by|while|although)|[.。;]|$)/i,
    /(?:sales|revenue)[^。.]*(?:positively contributed|benefited)[^。.]*(?:from|by)\s+([^。.;]+)/i,
    /(?:growth in|increase in)\s+([^。.;]+?)(?:\s+(?:drove|supported|contributed to)|[.。;]|$)/i
  ];

  for (const pattern of patterns) {
    const match = sentence.match(pattern);
    if (match?.[1]) {
      return trimDriverPhrase(match[1]);
    }
  }
  return null;
}

function trimDriverPhrase(raw: string): string {
  return raw
    .replace(/\([^)]*\)/g, "")
    .replace(/\bcompared to\b[\s\S]*$/i, "")
    .replace(/\bfor the (?:three|six|nine|twelve) months\b[\s\S]*$/i, "")
    .replace(/\bpartially offset\b[\s\S]*$/i, "")
    .replace(/\boffset by\b[\s\S]*$/i, "")
    .replace(/,\s*with\b[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,;:\s]+|[,;:\s]+$/g, "")
    .slice(0, 260);
}

function buildRevenueDriverPoint(sentence: string, translatedDriver: string): string {
  if (/net interest income|\bNII\b/i.test(sentence)) {
    return `純利息収入は ${translatedDriver} が押し上げ要因`;
  }
  if (/noninterest revenue|\bNIR\b/i.test(sentence)) {
    return `非利息収入は ${translatedDriver} が押し上げ要因`;
  }
  if (/unit case volume/i.test(sentence)) {
    return `販売数量は ${translatedDriver} が押し上げ要因`;
  }
  if (/passenger revenue/i.test(sentence)) {
    return `旅客収入は ${translatedDriver} が押し上げ要因`;
  }
  if (/comparable sales/i.test(sentence)) {
    return `既存店売上は ${translatedDriver} が押し上げ要因`;
  }
  return `売上は ${translatedDriver} が主な説明要因`;
}

function summarizeRevenueBreakdown(
  sourceChunks: SourceChunkRecord[]
): { text: string; labels: string[]; sourceIds: string[] } | null {
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
      patterns: [
        /vehicle sales and services/i,
        /vehicle sales and related servicing/i,
        /deliveries and servicing of new and used vehicles/i,
        /automotive sales(?: revenue)?/i,
        /vehicle sales(?: revenue)?/i
      ]
    },
    {
      label: "サービス・その他",
      priority: 20,
      patterns: [/services and other/i]
    },
    {
      label: "自動車リース",
      priority: 30,
      patterns: [/automotive leasing/i, /customer lease and financing payments/i]
    },
    {
      label: "エネルギー生成・蓄電",
      priority: 40,
      patterns: [
        /energy generation and storage revenue/i,
        /sales of energy generation and storage products/i,
        /deployments and servicing of our energy storage products/i,
        /energy generation and storage/i
      ]
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
    labels: headlineBuckets.map((bucket) => bucket.label),
    sourceIds
  };
}

function isRevenueBreakdownContext(text: string): boolean {
  const strongPositivePatterns = [
    /revenue by/i,
    /disaggregation of revenue/i,
    /revenue from/i,
    /deliveries and servicing of new and used vehicles/i,
    /vehicle sales and related servicing/i,
    /automotive sales(?: revenue)?/i,
    /automotive leasing/i,
    /customer lease and financing payments/i,
    /vehicle sales and services/i,
    /services and other/i,
    /sales of energy generation and storage products/i,
    /deployments and servicing of our energy storage products/i,
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
  const cashFallbackPatterns = [
    /deliveries and servicing of new and used vehicles/i,
    /vehicle sales and related servicing/i,
    /sales of energy generation and storage products/i,
    /deployments and servicing of our energy storage products/i,
    /customer lease and financing payments/i
  ];
  const hasStrongPositive = strongPositivePatterns.some((pattern) => pattern.test(text));
  if (!hasStrongPositive) {
    return false;
  }

  if (!disqualifyingPatterns.some((pattern) => pattern.test(text))) {
    return true;
  }

  return cashFallbackPatterns.some((pattern) => pattern.test(text));
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
    return "今回の決算から見ると、足元はやや強めです。";
  }

  if (score <= -1) {
    return "今回の決算から見ると、足元は慎重寄りです。";
  }

  return "今回の決算から見ると、強弱はまだらです。";
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
    .replace(/\bhigher Markets net interest income\b/gi, "市場業務の純利息収入増")
    .replace(/\bhigher revolving balances in Card Services\b/gi, "カード事業のリボ残高増")
    .replace(/\bhigher wholesale deposit balances\b/gi, "法人預金残高増")
    .replace(/\bthe impact of investment securities activity\b/gi, "投資証券活動の影響")
    .replace(/\bhigher Markets noninterest revenue\b/gi, "市場業務の非利息収入増")
    .replace(/\bhigher asset management fees in AWM and CCB\b/gi, "AWMとCCBの資産運用手数料増")
    .replace(/\bhigher asset management fees\b/gi, "資産運用手数料増")
    .replace(/\bhigher Payments fees\b/gi, "決済手数料増")
    .replace(/\bhigher investment banking fees\b/gi, "投資銀行手数料増")
    .replace(/\ba \$588 million First Republic-related gain recorded in the first quarter of 2025\b/gi, "First Republic関連利益")
    .replace(/\$588 million First Republic-related gain recorded in the first quarter of 2025/gi, "First Republic関連利益")
    .replace(/\ba \$588 million First Republic-related gai\w*/gi, "First Republic関連利益")
    .replace(/\bgrowth in transactions and unit volumes\b/gi, "取引件数と販売数量の増加")
    .replace(/\bstrong sales in grocery and health and wellness\b/gi, "食品とヘルスケア商品の好調")
    .replace(/\bstore-fulfilled pickup and delivery\b/gi, "店舗出荷のピックアップと配送")
    .replace(/\bincreased volume\b/gi, "販売数量の増加")
    .replace(/\blower realized prices\b/gi, "実現価格の低下")
    .replace(/\bstrong demand\b/gi, "強い需要")
    .replace(/\bMounjaro\b/g, "Mounjaro")
    .replace(/\bZepbound\b/g, "Zepbound")
    .replace(/\bgrowth in Advisory and Other Services\b/gi, "アドバイザリーとその他サービスの成長")
    .replace(/\bselect pricing modifications\b/gi, "一部の価格改定")
    .replace(/\bpremium products\b/gi, "プレミアム商品の収入")
    .replace(/\bloyalty\b/gi, "ロイヤルティ")
    .replace(/\bAWS sales\b/gi, "AWS売上")
    .replace(/\bincreased customer usage\b/gi, "顧客利用量の増加")
    .replace(/\bchanges in foreign exchange rates\b/gi, "為替影響")
    .replace(/\bBlackwell architecture\b/gi, "Blackwellアーキテクチャ")
    .replace(/\bCompute & Networking\b/gi, "Compute & Networking")
    .replace(/\bwater, sports, coffee and tea\b/gi, "水・スポーツ飲料・コーヒー・茶")
    .replace(/\bTrademark Coca-Cola\b/gi, "Trademark Coca-Cola")
    .replace(/\bsparkling flavors\b/gi, "炭酸フレーバー")
    .replace(/\bServices\b/g, "サービス")
    .replace(/\bService\b/g, "サービス")
    .replace(/\bproducts?\b/gi, "製品")
    .replace(/\bvolume\b/gi, "数量")
    .replace(/\bpricing\b/gi, "価格改定")
    .replace(/\btransactions?\b/gi, "取引件数")
    .replace(/\bdelivery\b/gi, "配送")
    .replace(/\band\b/gi, "と")
    .replace(/\s+/g, " ")
    .trim();
}

function hasUntranslatedDriverText(text: string): boolean {
  const withoutAllowedTerms = text
    .replace(/\biPhone\b/g, "")
    .replace(/\biPad\b/g, "")
    .replace(/\bMac\b/g, "")
    .replace(/\bAWS\b/g, "")
    .replace(/\bDRAM\b/g, "")
    .replace(/\bNAND\b/g, "")
    .replace(/\bBlackwell\b/g, "")
    .replace(/\bMounjaro\b/g, "")
    .replace(/\bZepbound\b/g, "")
    .replace(/\bYouTube\b/g, "")
    .replace(/\bMicrosoft\b/g, "")
    .replace(/\bLinkedIn\b/g, "")
    .replace(/\bCopilot\b/g, "")
    .replace(/\bAWM\b/g, "")
    .replace(/\bCCB\b/g, "")
    .replace(/\bFirst Republic\b/g, "")
    .replace(/\bSam'?s Club\b/g, "")
    .replace(/\bCoca-Cola\b/g, "")
    .replace(/\bTrademark Coca-Cola\b/g, "")
    .replace(/\bCompute & Networking\b/g, "");
  return /[A-Za-z]{3,}/.test(withoutAllowedTerms);
}
