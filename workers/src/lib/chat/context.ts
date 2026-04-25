export interface ChatContextMessage {
  role: "user" | "assistant";
  content: string;
}

type ContextAnchor = "operatingCashFlow" | "revenue" | "operatingIncome" | "netIncome" | "epsBasic" | "margin";

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

  return expandFollowUpQuestion(anchor, trimmedQuestion);
}

function isContextDependentFollowUp(question: string): boolean {
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  return (
    normalized.length <= 24 &&
    /^(なぜ|なんで|どうして|理由|原因|要因|主因|それ|その|これ|この|一時的|継続|続く|続き|改善|悪化)/.test(
      normalized
    )
  );
}

function detectLatestAnchor(context: ChatContextMessage[]): ContextAnchor | null {
  for (const message of [...context].reverse()) {
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
  const normalized = question.replace(/\s+/g, "").toLowerCase();
  const asksCause = /(なぜ|なんで|どうして|理由|原因|要因|主因)/.test(normalized);
  const asksTemporary = /(一時的|継続|続く|続き)/.test(normalized);
  const asksImprovement = /(改善|良化|向上)/.test(normalized);
  const asksDeterioration = /(悪化|低下|減少|落ち)/.test(normalized);

  const label = anchorLabel(anchor);
  if (asksTemporary) {
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
