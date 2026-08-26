import { isBusinessOverviewQuestion } from "../../lib/chat/business-overview-question";

export type QuestionProfile = {
  normalized: string;
  asksCause: boolean;
  asksDetail: boolean;
  asksGuidance: boolean;
  asksMarketReaction: boolean;
  asksStockContext: boolean;
  asksCapitalAllocation: boolean;
  asksBusinessOverview: boolean;
  asksRevenue: boolean;
  asksProfitability: boolean;
  asksProfit: boolean;
  asksCashFlow: boolean;
  asksRisk: boolean;
  asksTariff: boolean;
  asksRegion: boolean;
  asksProductMix: boolean;
  asksStockPrice: boolean;
  asksRecommendation: boolean;
  asksInvestmentView: boolean;
  asksForecast: boolean;
  asksDurability: boolean;
};

export function analyzeQuestion(question: string): QuestionProfile {
  const normalized = question.replace(/\s+/g, "").toLowerCase();

  return {
    normalized,
    asksCause: /(主因|要因|原因|理由|なぜ|背景|支え|押し上げ|牽引|どの変化|何が|driver|cause|why)/.test(normalized),
    asksDetail: /(詳しく|詳細|deep|detail|breakdown|かみ砕)/.test(normalized),
    asksGuidance: /(guidance|outlook|見通し|来期|次四半期)/.test(normalized),
    asksMarketReaction: /(市場|反応|上げ|下げ|好感|嫌気|marketreaction)/.test(normalized),
    asksStockContext:
      /(株の調子|株調子|株の動き|株どう|株はどう|最近株|最近の株|直近株|足元株|足元の株|stockperformance|shareperformance)/.test(
        normalized
      ) ||
      (/(最近|直近|足元|いま|今は|今の|このところ|ここのところ)/.test(normalized) &&
        /(株|株価|市場|stock|share)/.test(normalized)),
    asksCapitalAllocation: /(還元|自社株買い|buyback|repurchase|配当|dividend|capitalallocation|株主還元)/.test(
      normalized
    ),
    asksBusinessOverview: isBusinessOverviewQuestion(normalized),
    asksRevenue: /(売上|revenue|sales|growth|増収)/.test(normalized),
    asksProfitability: /(利益率|マージン|粗利|採算|margin|profitability)/.test(normalized),
    asksProfit: /(赤字|黒字|損失|欠損|純利益|利益|netincome|netloss|netincome\(loss\)|net loss|profit|income|earnings|eps|loss)/.test(
      normalized
    ),
    asksCashFlow: /(営業cf|フリーcf|キャッシュフロー|operatingcashflow|freecashflow|cashflow|cash flow|現金|創出|お金.*稼|稼げてる)/.test(
      normalized
    ),
    asksRisk: /(リスク|懸念|逆風|不確実|不透明|risk|uncertain|uncertainty|macro)/.test(normalized),
    asksTariff: /(関税|tariff)/.test(normalized),
    asksRegion: /(地域|中国|japan|americas|asia|segment|地域別)/.test(normalized),
    asksProductMix: /(iphone|services|cloud|広告|ads|product mix|サービス|クラウド)/.test(normalized),
    asksStockPrice: /(株価|shareprice|stockprice)/.test(normalized),
    asksRecommendation: /(買いか|売りか|おすすめ|投資判断|recommend)/.test(normalized),
    asksInvestmentView: /(投資家目線|投資家として|良い点|悪い点|強み|弱み|ポジティブ|ネガティブ|bull|bear|positive|negative|strength|weakness)/.test(
      normalized
    ),
    asksForecast: /(今後|この先|予想|forecast)/.test(normalized),
    asksDurability:
      /(一時的|一過性|一時要因|一回限り|単発|継続|持続|続く|続きそう|構造的|恒常|今後も|来期も|短期|長期|temporary|transitory|one[- ]?time|one[- ]?off|recurring|sustain|continue|ongoing)/.test(
        normalized
      ) && /(要因|原因|理由|影響|それ|その|この|driver|cause|factor)/.test(normalized)
  };
}

export function wantsNarrativeDepth(profile: QuestionProfile): boolean {
  return (
    profile.asksCause ||
    profile.asksDetail ||
    profile.asksRisk ||
    profile.asksTariff ||
    profile.asksGuidance ||
    profile.asksForecast ||
    profile.asksDurability ||
    profile.asksRevenue ||
    profile.asksBusinessOverview ||
    profile.asksStockContext ||
    profile.asksInvestmentView
  );
}
