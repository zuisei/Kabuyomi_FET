import { classifyHistoricalComparisonMode } from "../history-question";

export type QuestionIntent =
  | "business_overview"
  | "revenue_breakdown"
  | "margin_profitability"
  | "cash_flow"
  | "liquidity_debt"
  | "risk_factors"
  | "mda_summary"
  | "yoy_change"
  | "segment_analysis"
  | "historical_comparison"
  | "stock_market_context"
  | "investment_view"
  | "unknown";

export function classifyQuestionIntent(question: string): QuestionIntent {
  const normalized = question.replace(/\s+/g, "").toLowerCase();

  if (classifyHistoricalComparisonMode(question)) {
    return "historical_comparison";
  }

  if (
    /(株価|市場|反応|上げ|上が|下げ|下が|好感|嫌気|最近株|株の調子|stock|shareprice|stockprice|marketreaction|市場評価|ニュース込み|決算発表後)/.test(
      normalized
    )
  ) {
    return "stock_market_context";
  }

  if (
    /(投資家目線|投資家として|良い点|悪い点|強み|弱み|ポジティブ|ネガティブ|買い|売り|おすすめ|投資判断|投資妙味|割安|割高|recommend|investment|bull|bear|positive|negative|strength|weakness)/.test(
      normalized
    )
  ) {
    return "investment_view";
  }

  if (
    /(何で儲け|なんで儲け|何で稼|なんで稼|収益源|なんの企業|何の企業|なんの会社|何の会社|どんな企業|どんな会社|何してる|何をしてる|何をやってる|事業内容|主な事業|事業は|主な製品|主要製品|製品と顧客|顧客|customers?|businessmodel|whatdoes.*companydo|whatcompany|whatbusiness)/.test(
      normalized
    )
  ) {
    return "business_overview";
  }

  if (
    /(一時|一過性|継続|続く|続き|持続|構造的|temporary|transitory|recurring|sustain|continue)/.test(normalized) &&
    /(利益率|マージン|営業利益率|純利益率|profitability|grossprofit|grossmargin|margin)/.test(normalized)
  ) {
    return "margin_profitability";
  }

  if (
    /(一時|一過性|継続|続く|続き|持続|構造的|temporary|transitory|recurring|sustain|continue)/.test(normalized) &&
    /(売上|収益|sales|revenue)/.test(normalized) &&
    /(主因|要因|原因|理由|driver|cause|why)/.test(normalized) &&
    !/(利益率|マージン|営業利益率|純利益率|profitability|grossprofit)/.test(normalized)
  ) {
    return "yoy_change";
  }

  if (
    /(md&a|managementdiscussion|経営者による説明|経営陣|会社側.*強調|会社コメント|強調している論点|強調してる論点|強調されてること|強調されていること|managementcommentary|業績説明|本文要約|ガイダンス|見通し|outlook|guidance)/.test(
      normalized
    )
  ) {
    return "mda_summary";
  }

  if (/(資金繰り|負債|債務|借入|返済|満期|流動性|信用枠|debt|liquidity|maturity|borrowings?|creditfacility)/.test(normalized)) {
    return "liquidity_debt";
  }

  if (/(営業cf|フリーcf|キャッシュフロー|operatingcashflow|freecashflow|cashflow|cash flow|現金|お金.*稼|稼げてる)/.test(normalized)) {
    return "cash_flow";
  }

  if (/(リスク|懸念|逆風|不確実|不透明|risk|uncertain|uncertainty|macro|関税|tariff)/.test(normalized)) {
    return "risk_factors";
  }

  if (/(利益率|マージン|粗利|採算|営業利益率|純利益率|margin|profitability|grossprofit)/.test(normalized)) {
    return "margin_profitability";
  }

  if (/(セグメント|segment|部門|地域|geography|地域別|製品別|productmix|構成|内訳)/.test(normalized)) {
    return "segment_analysis";
  }

  if (
    /(売上|収益|sales|revenue)/.test(normalized) &&
    /(なぜ|なんで|どうして|理由|原因|要因|主因|背景|driver|cause|why|伸び|成長|増収|減収|変化)/.test(normalized)
  ) {
    return "yoy_change";
  }

  if (
    /(売上|sales|revenue|収益)/.test(normalized) &&
    /(内訳|構成|柱|源泉|セクター|sector|セグメント|segment|事業|business|部門|地域|geography|製品|product)/.test(
      normalized
    )
  ) {
    return "revenue_breakdown";
  }

  if (/(前年比|前年同期比|yoy|前期比|qoq|増収|減収|伸び|成長|変化|何が変わった|違い)/.test(normalized)) {
    return "yoy_change";
  }

  if (/(売上|sales|revenue|収益)/.test(normalized)) {
    return "revenue_breakdown";
  }

  if (
    /(なぜ|なんで|どうして|理由|原因|要因|主因|背景|driver|cause|why|一時的|一過性|継続|続く|持続|構造的|temporary|transitory|recurring|sustain|continue)/.test(
      normalized
    )
  ) {
    return "mda_summary";
  }

  return "unknown";
}
