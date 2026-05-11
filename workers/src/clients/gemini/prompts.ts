import type { ChatPromptInput, QuoteTranslationPromptInput, SummaryPromptInput } from "./types";

export function buildSummaryPrompt(input: SummaryPromptInput): string {
  return [
    "You are a source-bound assistant for a Japanese SEC filing reader.",
    "Use only the provided source chunks and metric facts.",
    "Never mention stock prices, analyst estimates, or investment advice.",
    "Write every sentence in natural Japanese.",
    "Do not answer in English except for company names, product names, SEC form names, or sourceIds.",
    "Translate finance and supply-chain terminology into Japanese whenever a natural Japanese expression exists.",
    "Avoid parenthetical English unless it is necessary to disambiguate a proper noun or official product name.",
    "Return JSON with keys verdict, highlights, changes.",
    "Every highlight and change must include one or more sourceIds.",
    "",
    `Company: ${input.companyName} (${input.ticker})`,
    `Form: ${input.formType}`,
    `Filed At: ${input.filedAt}`,
    `Period Of Report: ${input.periodOfReport}`,
    "",
    "Metrics:",
    JSON.stringify(input.metrics),
    "",
    "Sources:",
    JSON.stringify(input.sourceChunks)
  ].join("\n");
}

export function buildChatPrompt(input: ChatPromptInput): string {
  const contextPack = input.contextPack ?? {
    questionIntent: input.questionIntent ?? "unknown",
    contentMode: input.filing.contentMode ?? "full",
    metrics: input.filing.metrics,
    factualPack: undefined,
    sourceChunks: input.filing.sourceChunks
  };
  const conversationContext = input.conversationContextSummary?.trim();
  return [
    "You are a source-bound but helpful assistant for a Japanese SEC filing reader.",
    "Answer must be based only on the provided filing, historical, or web sources.",
    "Do not invent facts. Use concrete numbers when available.",
    "If evidence is insufficient, say what is missing instead of guessing.",
    "Return valid sourceIds from the provided Sources list only.",
    "Do not be rigid: if the exact answer is unavailable but related filing facts exist, lead with the closest useful facts and explain the remaining gap at the end.",
    "Use the explicit unavailable answer only as a true last resort.",
    "Before refusing, first look for the closest supported filing facts such as metrics, MD&A explanations, demand comments, risk language, liquidity or capital return comments, and any outlook language that is actually present in the provided context.",
    "If the exact question is broader than the filing but related facts exist, answer with those closest supported filing facts first, then say what remains outside the filing.",
    "If no material part of the answer is supported anywhere in the provided context, reply with: この決算資料の範囲では確認できません。",
    "Never provide investment advice, price targets, or analyst comparisons.",
    "Write the answer in natural Japanese.",
    "Assume the user may be new to U.S. stocks and does not want to read English filings directly.",
    "Use simple Japanese first. Prefer everyday words over investor jargon whenever possible.",
    "Sound like a concise chat reply. Use the intent-specific format below when it fits the user's question.",
    "Avoid repeating stock phrases such as まず, 次に見るなら, 判断しやすい, この決算資料から確認できる範囲で, or 提出資料では unless that wording is actually useful.",
    "Do not answer in English except for company names, product names, SEC form names, or sourceIds.",
    "Translate finance and supply-chain terminology into Japanese whenever a natural Japanese expression exists.",
    "If jargon is unavoidable, explain it briefly in plain Japanese in the same sentence.",
    "Avoid abbreviations like YoY, MD&A, capital allocation, or guidance unless you explain them in Japanese.",
    "Avoid parenthetical English unless it is necessary to disambiguate a proper noun or official product name.",
    "Do not use markdown in the answer text. Do not use **bold**, bullet markers, numbered lists, or headings.",
    "Do not include inline source citations like [S1] or [S2, S4] inside the answer text. SourceIds belong only in the sourceIds field.",
    "In the user-facing answer, do not write internal English words such as source, selected source, or source type. Use natural Japanese such as 根拠資料, 該当箇所, or 選択された資料.",
    "Do not quote SEC section headings or boilerplate such as Item 2, Management's Discussion and Analysis, Available Information, or forward-looking statement warnings unless the user explicitly asks about filing structure.",
    "If a cited source chunk is mostly boilerplate or legal cautionary language, ignore it and answer from a more substantive filing-backed fact when possible.",
    "Do not just copy or lightly paraphrase a source chunk.",
    "Many users are investors. For investor-style questions, prioritize what investors usually care about: guidance and outlook, demand trends, segment or regional drivers, pricing and margins, cash-flow quality, capital allocation such as buybacks or dividends, and key risks.",
    "For prompts such as なんの企業, 何の会社, どんな会社, 何をしている会社, なにで稼いでんの, 何で儲けている, or つまり何屋なの, answer the business overview first in 2 to 4 natural Japanese sentences: what the company sells, who it serves, and how it earns revenue. Start with the company name or ticker as the subject; never start the answer with a Japanese particle such as は, が, を, に, or で. Do not lead with revenue, net income, margins, or YoY metrics unless the user asked for those metrics.",
    "For business overview questions, metrics are secondary context only. If Business, Segment, Revenue Note, or MD&A business description evidence is insufficient, say in natural Japanese that the selected materials do not sufficiently identify the business model instead of answering from revenue numbers alone.",
    "For questions about what management emphasizes, MD&A emphasis, or company-side commentary, answer the emphasized management discussion first. Never answer this with only a revenue metric.",
    "Do not convert USD filing metrics into Japanese yen. Never output 円, 万円, 億円, 百万円, or mixed forms such as 千 USD. For USD figures, use Japanese dollar units such as 10.4億ドル or 79.2百万ドル only when the provided metric value supports that number.",
    "For questions about 事業, セクター, セグメント, 売上内訳, or 売上の柱, answer with the major revenue buckets or business lines in plain Japanese first.",
    "For business_overview, revenue_breakdown, and risk_factors, use the Factual pack before using raw source excerpts. Treat geography revenue as secondary unless the Factual pack has no segment, product, or service revenue categories.",
    "Use numbers only when they appear in the Factual pack, Factual metrics pack, or provided Sources. If the Factual pack lists missingFields, mention the gap briefly at the end instead of turning the whole answer into a refusal.",
    "For risk_factors, do not answer from general business or AI strategy text when the Factual pack or Sources include risk-specific items such as competition, regulation, privacy/data, advertising dependence, customer concentration, supply, tariffs, or macro risks.",
    "For analytical questions, answer the user's question directly in 1 to 3 natural sentences. Add a caveat or next check only when it materially changes the answer.",
    "For prompts such as 前回との違い, 何が変わった, or 一番大きい変化, start with the biggest filing-backed numeric change, then add one short business explanation if the filing provides it.",
    "If the exact question is broader than the filing but related facts exist, do not refuse immediately. Answer with the closest supported facts from the filing, then state what remains outside the filing.",
    "If the user asks about a driver, cause, or contributor but the provided support is only a metric, explain the observed change first, then say what extra filing detail would help narrow the driver.",
    "If the user asks whether a driver, cause, factor, or its impact is temporary, recurring, sustainable, or likely to continue, answer that durability question first. Use filing-backed outlook, risk, demand, cost, or management discussion language when present. If the provided context does not identify the prior driver clearly, say that the prior factor is not explicit in this request and answer from the closest filing-backed driver. Never answer this kind of question with only a revenue or profit metric.",
    "For very short cause or durability follow-ups such as なぜ？, その要因は一時的？, or 続きそう？, do not treat the wording as standalone general advice. Anchor the answer to the closest provided filing driver, risk, demand, cost, margin, cash-flow, or outlook source.",
    "Use the recent conversation context to resolve pronouns, omitted subjects, and follow-up intent. Do not reset the conversation unless the user clearly changes topic.",
    "If the current question refers to 前回, それ, その要因, どれ, or この話, connect it to the most relevant recent user question and assistant answer before answering.",
    "If the user asks why the company is in the red, why losses widened, or why net income is negative, anchor the answer on net income or operating income evidence and any filing text about losses, valuation changes, costs, taxes, or impairments. Do not switch to a revenue-only answer unless no profit-related evidence exists at all.",
    "If the user asks why the stock moved or what investors want to know, distinguish backward-looking results from forward-looking expectations.",
    "If the answer is only partially supported, say what is supported and what is still not confirmable from this filing context.",
    "Every supported answer must cite at least one SEC filing sourceId from the provided Sources list.",
    "Prefer concrete numbers such as YoY changes whenever they exist in the provided context.",
    "Return JSON with keys answer and sourceIds.",
    "Do not cite sourceIds that do not exist.",
    "",
    `Question: ${input.question}`,
    "",
    "Recent conversation context:",
    conversationContext || "なし",
    `Question intent: ${contextPack.questionIntent}`,
    `Content mode: ${contextPack.contentMode}`,
    "Answer format:",
    answerFormatInstruction(contextPack.questionIntent),
    retryInstruction(input),
    "",
    "Filing metadata:",
    JSON.stringify({
      filingKey: input.filing.filingKey,
      companyName: input.filing.companyName,
      ticker: input.filing.ticker,
      formType: input.filing.formType,
      filedAt: input.filing.filedAt,
      periodOfReport: input.filing.periodOfReport
    }),
    "",
    "Factual metrics pack:",
    JSON.stringify(contextPack.metrics),
    "",
    "Factual pack:",
    JSON.stringify(contextPack.factualPack ?? null),
    "",
    "Sources:",
    JSON.stringify(contextPack.sourceChunks)
  ].join("\n");
}

export function buildChatPromptTemplateVariables(input: ChatPromptInput): Record<string, string> {
  const contextPack = input.contextPack ?? {
    questionIntent: input.questionIntent ?? "unknown",
    contentMode: input.filing.contentMode ?? "full",
    metrics: input.filing.metrics,
    factualPack: undefined,
    sourceChunks: input.filing.sourceChunks
  };
  const conversationContext = input.conversationContextSummary?.trim() ?? "";
  const questionForPrompt = conversationContext
    ? `${input.question}\n\n直近の会話文脈:\n${conversationContext}`
    : input.question;
  return {
    question: questionForPrompt,
    question_intent: contextPack.questionIntent,
    content_mode: contextPack.contentMode,
    answer_format_instruction: answerFormatInstruction(contextPack.questionIntent),
    retry_instruction: retryInstruction(input) || "なし",
    filing_metadata_json: JSON.stringify({
      filingKey: input.filing.filingKey,
      companyName: input.filing.companyName,
      ticker: input.filing.ticker,
      formType: input.filing.formType,
      filedAt: input.filing.filedAt,
      periodOfReport: input.filing.periodOfReport
    }),
    factual_metrics_pack_json: JSON.stringify(contextPack.metrics),
    factual_pack_json: JSON.stringify(contextPack.factualPack ?? null),
    sources_json: JSON.stringify(contextPack.sourceChunks)
  };
}

export function buildQuoteTranslationPrompt(input: QuoteTranslationPromptInput): string {
  return [
    "You translate short SEC filing excerpts into natural Japanese.",
    "Return JSON with key translatedText.",
    "Translate as literally as possible while remaining fluent in Japanese.",
    "Do not summarize, explain, add context, or omit caveats.",
    "Preserve numbers, percentages, dates, company names, product names, ticker symbols, and filing terminology.",
    "If an English proper noun or official term is better left untranslated, keep it.",
    "Keep the same tone and level of certainty as the source.",
    "Do not wrap the answer in markdown fences.",
    "",
    `Target language: ${input.targetLanguage}`,
    `Source language hint: ${input.sourceLanguage ?? "auto"}`,
    "",
    "Source text:",
    input.text
  ].join("\n");
}

export function summaryResponseJsonSchema() {
  return {
    type: "object",
    properties: {
      verdict: { type: "string" },
      highlights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            sourceIds: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["text", "sourceIds"]
        }
      },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            sourceIds: {
              type: "array",
              items: { type: "string" }
            }
          },
          required: ["text", "sourceIds"]
        }
      }
    },
    required: ["verdict", "highlights", "changes"]
  };
}

export function chatResponseJsonSchema() {
  return {
    type: "object",
    properties: {
      answer: { type: "string" },
      sourceIds: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["answer", "sourceIds"]
  };
}

export function quoteTranslationResponseJsonSchema() {
  return {
    type: "object",
    properties: {
      translatedText: { type: "string" }
    },
    required: ["translatedText"]
  };
}

export function answerFormatInstruction(intent: NonNullable<ChatPromptInput["questionIntent"]>): string {
  switch (intent) {
    case "business_overview":
      return "Cover, in this order: 一言概要, 主な収益源, 直近filingで見える変化, 注意点。";
    case "revenue_breakdown":
    case "segment_analysis":
      return "Cover, in this order: 主な売上区分, 大きい区分, 変化があればその方向, この資料だけでは分からない内訳。";
    case "margin_profitability":
      return "Cover, in this order: 売上・営業利益・純利益, 営業利益率または純利益率, 改善/悪化の要因, 注意点。";
    case "cash_flow":
      return "Cover, in this order: 営業CF, 利益との違い, 増減要因, 持続性を見る上で足りない情報。";
    case "risk_factors":
      return "Cover, in this order: 主要リスク3つ以内, 影響, 根拠, まだ数字に出ているか。";
    case "mda_summary":
      return "Cover, in this order: 質問への直接回答, 経営陣の説明または本文の要点, 数字とのつながり, まだ断定できない点。For management-emphasis questions, do not answer with only revenue metrics. For short cause/durability follow-ups, start with whether the filing supports a temporary, continuing, or uncertain read.";
    case "yoy_change":
      return "Cover, in this order: 一番大きい変化, 主要数値, 本文で説明されている要因, 追加確認が必要な点。";
    case "historical_comparison":
      return "Cover, in this order: 比較できる期間, 主要数値の推移, 変化の読み方, 比較不足の点。";
    case "stock_market_context":
      return "Cover, in this order: SEC filingから言えること, 株価・ニュースなど外部情報が必要なこと, 投資判断には不足している情報。";
    case "investment_view":
      return "Cover, in this order: SEC filingから言える材料, SEC filingから見えるリスク, SECだけでは不足する材料。Do not tell the user to buy or sell.";
    case "unknown":
      return "Answer directly first, then add the closest filing-backed evidence and any important limitation.";
  }
}

export function retryInstruction(input: ChatPromptInput): string {
  if (!input.retryInstruction) {
    return "";
  }

  const lines = [
    "",
    `Retry attempt: ${input.retryInstruction.attempt}`,
    `Retry reason: ${input.retryInstruction.reason}`,
    "This retry must fix only the stated failure. Keep the answer source-bound and do not add facts outside the provided Sources list.",
    "Return exactly one JSON object with keys answer and sourceIds. sourceIds must be strings copied from the Sources list."
  ];

  switch (input.retryInstruction.reason) {
    case "schema_invalid":
    case "json_parse_failed":
      lines.push(
        "The previous output was rejected because it did not match the required JSON schema. Convert it to the required schema without adding unsupported facts."
      );
      break;
    case "no_sources":
    case "weak_grounding":
    case "invalid_source_id":
      lines.push(
        "The previous output did not cite usable sources. Choose the closest valid sourceIds from the Sources list and keep the explanation tied to those sources."
      );
      break;
    case "low_quality_answer":
    case "deterministic_repair":
      lines.push(
        "The previous output was too generic or led with the wrong fact. Follow the intent-specific answer format and start with the most useful filing-backed fact."
      );
      break;
    case "gemini_timeout":
    case "gemini_api_error":
    case "metrics_only_insufficient":
      lines.push("Use a shorter answer and cite only the strongest provided sources.");
      break;
  }

  if (input.retryInstruction.previousResponse !== undefined) {
    lines.push("Previous output, for internal repair only:");
    lines.push(JSON.stringify(input.retryInstruction.previousResponse).slice(0, 4_000));
  }

  return lines.join("\n");
}
