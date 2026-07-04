export interface ChatContextMessage {
  role: "user" | "assistant";
  content: string;
}

type ContextAnchor = "operatingCashFlow" | "revenue" | "operatingIncome" | "netIncome" | "epsBasic" | "margin";

interface FollowUpDriverContext {
  driverCandidates: string[];
  driverUnresolved: boolean;
}

export function resolveContextualQuestion(question: string, context: ChatContextMessage[] = []): string {
  const trimmedQuestion = question.trim();
  if (trimmedQuestion.length === 0 || context.length === 0) {
    return trimmedQuestion;
  }

  if (detectAnchor(trimmedQuestion)) {
    return trimmedQuestion;
  }

  if (!isContextDependentFollowUp(trimmedQuestion)) {
    return trimmedQuestion;
  }

  const anchor = detectLatestAnchor(context);
  if (!anchor) {
    return trimmedQuestion;
  }

  return expandFollowUpQuestionWithContext(anchor, trimmedQuestion, context);
}

function isContextDependentFollowUp(question: string): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return (
    normalized.length <= 24 &&
    /^(なぜ|なんで|どうして|理由|原因|要因|主因|それ|その|これ|この|一時的|継続|続く|続き|改善|悪化|よくわから|わからん|分からん|わかりにく|分かりにく|どういうこと|つまり|要するに|噛み砕|かみ砕)/.test(
      normalized
    )
  );
}

function detectLatestAnchor(context: ChatContextMessage[]): ContextAnchor | null {
  const reversed = [...context].reverse();
  for (const message of reversed) {
    if (message.role !== "user") {
      continue;
    }
    const anchor = detectAnchor(message.content);
    if (anchor) {
      return anchor;
    }
  }

  for (const message of reversed) {
    const anchor = detectAnchor(message.content);
    if (anchor) {
      return anchor;
    }
  }

  return null;
}

function detectAnchor(text: string): ContextAnchor | null {
  const normalized = text.replace(/\s+/g, "").toLowerCase();
  if (
    /(営業cf|営業キャッシュフロー|operatingcashflow|cashflow|cashgenerated|netcashprovidedbyusedinoperatingactivities|営業活動によるキャッシュ)/.test(
      normalized
    )
  ) {
    return "operatingCashFlow";
  }
  if (/(利益率|マージン|margin)/.test(normalized)) {
    return "margin";
  }
  if (/(営業利益|operatingincome|operatingprofit)/.test(normalized)) {
    return "operatingIncome";
  }
  if (/(純利益|netincome|netloss)/.test(normalized)) {
    return "netIncome";
  }
  if (/(eps|1株|一株|earningspershare)/.test(normalized)) {
    return "epsBasic";
  }
  if (/(売上|収益|revenue|sales)/.test(normalized)) {
    return "revenue";
  }

  return null;
}

function expandFollowUpQuestion(anchor: ContextAnchor, question: string): string {
  return expandFollowUpQuestionWithContext(anchor, question, []);
}

function expandFollowUpQuestionWithContext(anchor: ContextAnchor, question: string, context: ChatContextMessage[]): string {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  const asksCause = /(なぜ|なんで|どうして|理由|原因|要因|主因)/.test(normalized);
  const asksPlainExplanation = /(よくわから|わからん|分からん|わかりにく|分かりにく|どういうこと|つまり|要するに|噛み砕|かみ砕)/.test(normalized);
  const asksTemporary = /(一時的|一時要因|一過性|構造的|構造|継続|続く|続き)/.test(normalized);
  const asksImprovement = /(改善|良化|向上)/.test(normalized);
  const asksDeterioration = /(悪化|低下|減少|落ち)/.test(normalized);

  const label = anchorLabel(anchor);
  if (asksPlainExplanation) {
    return `${label}について、前の回答を投資初心者にも分かるように、何が起きたか・なぜ重要か・次に何を見るかに分けて説明してください。`;
  }
  if (asksTemporary) {
    const driverContext = extractLatestDriverContext(context, anchor);
    if (driverContext.driverCandidates.length > 0) {
      return `前問で挙げた${label}の要因（${driverContext.driverCandidates.join("、")}）は一時的ですか？継続性と不明点を分けて説明してください。`;
    }
    if (driverContext.driverUnresolved) {
      return `前問では${label}の具体的なdriverが十分に特定できていません。${label}の一時要因と継続要因を、確認できる範囲と不明点に分けて説明してください。`;
    }
    return `${label}が変化した要因は一時的ですか？`;
  }
  if (asksCause) {
    return `${label}が変化した理由は？`;
  }
  if (asksImprovement) {
    return `${label}は改善しましたか？`;
  }
  if (asksDeterioration) {
    return `${label}は悪化しましたか？`;
  }

  return `${label}について、${question}`;
}

function extractLatestDriverContext(context: ChatContextMessage[], anchor: ContextAnchor): FollowUpDriverContext {
  const assistant = [...context].reverse().find((message) => message.role === "assistant");
  const content = assistant?.content ?? "";
  if (!content.trim()) {
    return { driverCandidates: [], driverUnresolved: false };
  }

  const normalized = content.replace(/\s+/g, " ").toLowerCase();
  const driverUnresolved =
    /(driver|要因|主因|理由).{0,40}(不足|薄め|未特定|特定でき|確認でき|断定でき|明示されていない|分解でき)/i.test(content) ||
    /(不足|薄め|未特定|特定でき|確認でき|断定でき|明示されていない|分解でき).{0,40}(driver|要因|主因|理由)/i.test(content) ||
    /見る必要があります|確認する必要があります|source だけでは|sourceだけでは/.test(content);

  if (driverUnresolved && !hasCompanyExplainedDriverSignal(normalized)) {
    return { driverCandidates: [], driverUnresolved: true };
  }

  return {
    driverCandidates: extractDriverCandidates(normalized, anchor),
    driverUnresolved
  };
}

function hasCompanyExplainedDriverSignal(text: string): boolean {
  return /primarily due to|driven by|attributable to|resulted from|because of|partially offset|押し上げ|牽引|主な要因|要因として|寄与|増加.*(?:ため|による|背景)|減少.*(?:ため|による|背景)/i.test(text);
}

function extractDriverCandidates(text: string, anchor: ContextAnchor): string[] {
  const revenueCandidates: Array<[RegExp, string]> = [
    [/comparable sales|same-store sales|comp sales|既存店売上/i, "既存店売上"],
    [/\btraffic\b|客数/i, "traffic"],
    [/\bticket\b|客単価/i, "ticket"],
    [/ecommerce|e-commerce|eコマース/i, "eCommerce"],
    [/membership|会員/i, "membership"],
    [/advertising|広告/i, "advertising"],
    [/inventory|在庫/i, "inventory"],
    [/net interest income|nii|純利息収入/i, "net interest income"],
    [/noninterest income|非金利収入/i, "noninterest income"],
    [/provision for credit losses|信用損失/i, "credit losses"],
    [/deposits?|預金/i, "deposits"],
    [/loans?|貸出/i, "loans"],
    [/crude oil|原油/i, "crude oil price"],
    [/natural gas|天然ガス/i, "natural gas price"],
    [/refining margins?|精製マージン/i, "refining margin"],
    [/production volumes?|\bvolume\b|生産量|販売数量/i, "volume"],
    [/price realization|realizations?|価格実現/i, "pricing"],
    [/backlog|受注残/i, "backlog"],
    [/dealer inventory|ディーラー在庫/i, "dealer inventory"],
    [/iphone/i, "iPhone"],
    [/\bmac\b|macbook/i, "Mac"],
    [/\bipad\b/i, "iPad"],
    [/wearables/i, "Wearables"],
    [/製品とサービスの売上構成|売上構成|品目構成|構成の違い|product mix/i, "product mix"],
    [/services|サービス/i, "Services"],
    [/greater china|china|中国/i, "Greater China"],
    [/americas/i, "Americas"],
    [/foreign currency|foreign exchange|為替/i, "foreign exchange"],
    [/installed base|インストールベース/i, "installed base"],
    [/product introductions?|製品投入|新製品/i, "product introductions"],
    [/demand|需要/i, "demand"],
    [/関税|tariff/i, "tariff"],
    [/\bnii\b|純利息収入|金利収入/i, "net interest income"],
    [/\bnir\b|非金利収入/i, "noninterest income"],
    [/販売量|販売数量|equipment to end users|エンドユーザー/i, "volume"]
  ];
  const marginCandidates: Array<[RegExp, string]> = [
    [/gross margin|粗利|売上総利益/i, "gross margin"],
    [/pricing|価格|価格実現/i, "pricing"],
    [/mix|構成/i, "mix"],
    [/cost|expense|費用|コスト/i, "cost"],
    [/volume|数量|販売量|販売数量/i, "volume"]
  ];
  const candidates = anchor === "revenue" ? revenueCandidates : [...marginCandidates, ...revenueCandidates];

  const found: string[] = [];
  for (const [pattern, label] of candidates) {
    if (pattern.test(text) && !found.includes(label)) {
      found.push(label);
    }
    if (found.length >= 4) {
      break;
    }
  }
  return found;
}

function anchorLabel(anchor: ContextAnchor): string {
  switch (anchor) {
    case "operatingCashFlow":
      return "営業CF";
    case "revenue":
      return "売上高";
    case "operatingIncome":
      return "営業利益";
    case "netIncome":
      return "純利益";
    case "epsBasic":
      return "EPS";
    case "margin":
      return "利益率";
  }
}
