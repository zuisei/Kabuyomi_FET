import type { ChatPromptInput } from "./types";

export function shouldRecoverLowQualityChatAnswer(input: ChatPromptInput, answer: string, sourceIds: string[]): boolean {
  const normalizedQuestion = input.question.replace(/\s+/g, "").toLowerCase();
  const normalizedAnswer = answer.toLowerCase();
  const asksBusinessOverview =
    /(なんの企業|何の企業|なんの会社|何の会社|どんな企業|どんな会社|何してる|何をしてる|何をやってる|事業内容|主な事業|事業は)/.test(
      normalizedQuestion
    ) || /(whatdoes.*companydo|whatcompany|whatbusiness|businessmodel)/.test(normalizedQuestion);
  const asksProfitCause =
    /(赤字|黒字|損失|欠損|純利益|利益|net income|net loss|profit|income|earnings|loss)/.test(normalizedQuestion) &&
    /(主因|要因|原因|理由|なぜ|背景|何が|driver|cause|why)/.test(normalizedQuestion);
  const asksRevenueCause =
    /(売上|増収|revenue|sales|growth)/.test(normalizedQuestion) &&
    /(主因|要因|原因|理由|なぜ|背景|押し上げ|牽引|driver|cause|why|一時|継続|持続|temporary|recurring)/.test(
      normalizedQuestion
    );
  const asksBroadStockContext =
    /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
      normalizedQuestion
    ) ||
    (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalizedQuestion) &&
      /(株|株価|市場|stock|share)/.test(normalizedQuestion));
  const asksDurabilityOfCause =
    /(一時的|一過性|一時要因|一回限り|単発|継続|持続|続く|続きそう|構造的|恒常|今後も|来期も|短期|長期|temporary|transitory|one[- ]?time|one[- ]?off|recurring|sustain|continue|ongoing)/.test(
      normalizedQuestion
    ) && /(要因|原因|理由|影響|それ|その|この|driver|cause|factor)/.test(normalizedQuestion);

  const asksAboutFilingStructure =
    /(item|md&a|risk factors|form 10-q|form 10-k|項目|どこ|どの欄|section|パート)/.test(normalizedQuestion);
  const asksContextualReasoning =
    /(ガイダンス|見通し|予想|guidance|outlook|来期|次四半期|リスク|懸念|逆風|不確実|不透明|risk|uncertain|uncertainty|関税|tariff|還元|自社株買い|buyback|repurchase|配当|dividend|株主還元|キャッシュフロー|cash flow|株価|市場|反応|支え|押し上げ|牽引|主因|要因|原因|理由|なぜ)/.test(
      normalizedQuestion
    );

  if (
    !asksAboutFilingStructure &&
    /(management's discussion|results of operations|our business risks|forward-looking statements|investors are cautioned|available information|investor relations website|corporate website|private securities litigation reform act|item\s+\d+[a-z]?\.|form 10-q|form 10-k)/.test(
      normalizedAnswer
    )
  ) {
    return true;
  }

  if (asksBroadStockContext) {
    const mentionsStockContext =
      /(株価|市場|反応|ニュース|別情報|判断できません|決められません|断定できません|株の調子|market|stock|share)/.test(
        normalizedAnswer
      );
    const leansOnMetricsOnly =
      /(売上高|営業利益|純利益|前年比|前年同期比|revenue|operating income|net income)/.test(normalizedAnswer);

    if (leansOnMetricsOnly && !mentionsStockContext) {
      return true;
    }
  }

  if (asksBusinessOverview) {
    if (/^[\s、。,]*(?:は|が|を|に|で)(?:[、。,\s]|$)/.test(answer)) {
      return true;
    }

    const sourceCandidates = input.contextPack?.sourceChunks ?? input.filing.sourceChunks;
    const citedChunks = sourceIds
      .map((sourceId) => sourceCandidates.find((chunk) => chunk.sourceId === sourceId))
      .filter((chunk): chunk is NonNullable<typeof chunk> => chunk !== undefined);
    const citesOnlyMetrics = citedChunks.length > 0 && citedChunks.every((chunk) => chunk.sectionType === "xbrl_metric");
    const metricIndex = firstPatternIndex(
      normalizedAnswer,
      /売上高|営業利益|純利益|営業cf|eps|前年比|前年同期比|revenue|operating income|net income|cash flow|growth|margin/
    );
    const businessIndex = firstPatternIndex(
      normalizedAnswer,
      /事業|主な|手がけ|提供|販売|製造|開発|運営|サービス|製品|プラットフォーム|顧客|患者|医療|検査|診断|がん|癌|腫瘍|精密医療|血液|分子|製薬|臨床研究|創薬|自動車|車両|エネルギー|蓄電|クラウド|広告|決済|サブスク|ai|gpu|データセンター|半導体|アクセラレーテッド|コンピューティング|ネットワーキング|グラフィックス|ゲーミング|oncology|cancer|diagnostic|blood|biopharmaceutical|automotive|vehicle|energy|cloud|advertising|payment|subscription|data center|semiconductor|networking|graphics|gaming/
    );
    const boilerplateIndex = firstPatternIndex(
      normalizedAnswer,
      /一般的な注意書き|案内文|材料としては弱め|深掘りには向きません|forward-looking statements|available information|investor relations website|corporate website/
    );

    if (citesOnlyMetrics || boilerplateIndex >= 0) {
      return true;
    }

    if (metricIndex >= 0 && (businessIndex === -1 || metricIndex < businessIndex)) {
      return true;
    }

    if (/確認できません|分かりません|わかりません|not enough context|cannot confirm/.test(normalizedAnswer) && businessIndex === -1) {
      return true;
    }
  }

  if (asksDurabilityOfCause) {
    const mentionsDurability =
      /(一時|一過性|一回限り|単発|継続|持続|続|構造|恒常|今後|来期|断定|確認できません|見通し|リスク|次の期|次四半期|temporary|transitory|one[- ]?time|one[- ]?off|recurring|ongoing|continue|sustain)/.test(
        normalizedAnswer
      );
    const leansOnBoilerplate = /(一般的な注意書き|案内文|材料としては弱め|forward-looking statements|available information|investor relations website|corporate website)/.test(
      normalizedAnswer
    );

    if (!mentionsDurability || leansOnBoilerplate) {
      return true;
    }
  }

  if (asksRevenueCause) {
    const mentionsRevenue = /(売上|増収|revenue|sales)/.test(normalizedAnswer);
    const leansOnProfitOnly = /(営業利益|純利益|利益率|eps|operating income|net income|profit|earnings)/.test(normalizedAnswer);
    if (leansOnProfitOnly && !mentionsRevenue) {
      return true;
    }
  }

  if (asksProfitCause) {
    const mentionsProfitContext = /(純利益|赤字|黒字|損失|net income|net loss|profit|loss)/.test(normalizedAnswer);
    const leansOnRevenue = /(売上高|revenue|sales)/.test(normalizedAnswer);
    const leansOnBoilerplate =
      /(一般的な注意書き|案内文|この論点の深掘りには向きません|この決算資料だけでは|この filing だけでは)/.test(
        normalizedAnswer
      );

    if ((leansOnRevenue || leansOnBoilerplate) && !mentionsProfitContext) {
      return true;
    }
  }

  if (asksContextualReasoning) {
    const answerLooksUnavailableOnly =
      /(確認できません|分かりません|わかりません|not enough context|cannot confirm)/.test(normalizedAnswer) &&
      !/(売上高|営業利益|純利益|営業cf|キャッシュフロー|前年比|前年同期比|revenue|operating income|net income|cash flow|本文|提出資料|需要|リスク|不確実|自社株買い|配当|株価|市場|反応)/.test(
        normalizedAnswer
      );

    if (answerLooksUnavailableOnly) {
      return true;
    }

    const answerLooksMetricOnly =
      /(売上高|営業利益|純利益|営業cf|キャッシュフロー|前年比|前年同期比|revenue|operating income|net income|cash flow)/.test(
        normalizedAnswer
      ) &&
      !/(本文|提出資料|決算資料|外部補足|この決算資料だけでは|この決算資料以外|この filing だけでは|この filing 以外|断定できません|切り分け|会社見通し|リスク|不確実|需要|iPhone|サービス|自社株買い|配当|株価|市場|反応|安全です)/.test(
        normalizedAnswer
      );

    if (answerLooksMetricOnly) {
      return true;
    }
  }

  const latinCount = (answer.match(/[A-Za-z]/g) ?? []).length;
  const japaneseCount = (answer.match(/[ぁ-んァ-ヶ一-龠]/g) ?? []).length;
  return !asksAboutFilingStructure && latinCount >= 40 && japaneseCount <= 12;
}

export function polishChatAnswerForQuestion(question: string, answer: string): string {
  const normalizedQuestion = question.replace(/\s+/g, "").toLowerCase();
  const asksRevenueBreakdown =
    /(売上|sales|revenue)/.test(normalizedQuestion) &&
    /(セクター|sector|セグメント|segment|事業|business|部門|内訳|構成|柱|源泉|カテゴリ)/.test(normalizedQuestion);

  if (!asksRevenueBreakdown) {
    return answer;
  }

  return answer
    .replace(
      /具体的な売上高の金額や、製品・サービス別の内訳は、この資料だけでは確認できません。/g,
      "金額の細目は限定的ですが、上記の事業・地域区分を売上の柱として見るのが近いです。"
    )
    .replace(
      /具体的な製品やサービスごとの詳細な売上金額は、この資料だけでは確認できません。/g,
      "製品・サービスごとの細かい金額までは限定的ですが、上記の区分が売上構造を見る軸です。"
    )
    .replace(
      /具体的にどの区分が最大であるかや、それぞれの詳細な売上額などの内訳は、この資料だけでは確認できません。/g,
      "最大区分や細かい金額までは限定的ですが、上記のサービス群が売上構造を見る軸です。"
    )
    .replace(
      /具体的な製品やサービスごとの売上内訳については、この資料だけでは確認できません。/g,
      "製品・サービスごとの細かい金額は限定的ですが、上記の事業内容を売上の柱として見るのが近いです。"
    )
    .replace(
      /売上の具体的な内訳や変化の方向については、この資料だけでは確認できません。/g,
      "細かい内訳や変化率は限定的ですが、上記の事業区分が売上構造を見る軸です。"
    )
    .replace(
      /具体的な製品やサービスごとの売上内訳や、それぞれの成長率などの詳細な数値は、この資料だけでは確認できません。/g,
      "製品・サービス別の細かい成長率は限定的ですが、上記のサービス区分が売上構造を見る軸です。"
    )
    .replace(
      /売上の具体的な内訳については、この資料では地域別の売上高などの地理的な区分のみが記載されており、製品やサービスごとの詳細な売上構成は確認できません。/g,
      "製品・サービス別の細かい売上構成は限定的ですが、上記の宿泊・体験・サービス領域が売上構造を見る軸です。"
    );
}

function firstPatternIndex(value: string, pattern: RegExp): number {
  const match = pattern.exec(value);
  return match?.index ?? -1;
}
