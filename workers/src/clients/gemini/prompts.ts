import type { ChatPromptInput, SummaryPromptInput } from "./types";

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
  return [
    "You answer user questions strictly from the provided SEC filing context.",
    "Use the explicit unavailable answer only as a true last resort.",
    "Before refusing, first look for the closest supported filing facts such as metrics, MD&A explanations, demand comments, risk language, liquidity or capital return comments, and any outlook language that is actually present in the provided context.",
    "If the exact question is broader than the filing but related facts exist, answer with those closest supported filing facts first, then say what remains outside the filing.",
    "If no material part of the answer is supported anywhere in the provided context, reply with: この filing の提供コンテキストでは確認できません。",
    "Never provide investment advice, price targets, or analyst comparisons.",
    "Write the answer in natural Japanese.",
    "Assume the user may be new to U.S. stocks and does not want to read English filings directly.",
    "Use simple Japanese first. Prefer everyday words over investor jargon whenever possible.",
    "Do not answer in English except for company names, product names, SEC form names, or sourceIds.",
    "Translate finance and supply-chain terminology into Japanese whenever a natural Japanese expression exists.",
    "If jargon is unavoidable, explain it briefly in plain Japanese in the same sentence.",
    "Avoid abbreviations like YoY, MD&A, capital allocation, or guidance unless you explain them in Japanese.",
    "Avoid parenthetical English unless it is necessary to disambiguate a proper noun or official product name.",
    "Do not quote SEC section headings or boilerplate such as Item 2, Management's Discussion and Analysis, Available Information, or forward-looking statement warnings unless the user explicitly asks about filing structure.",
    "If a cited source chunk is mostly boilerplate or legal cautionary language, ignore it and answer from a more substantive filing-backed fact when possible.",
    "Do not just copy or lightly paraphrase a source chunk.",
    "Many users are investors. For investor-style questions, prioritize what investors usually care about: guidance and outlook, demand trends, segment or regional drivers, pricing and margins, cash-flow quality, capital allocation such as buybacks or dividends, and key risks.",
    "For analytical questions, answer in 3 to 5 short sentences: the plain-language takeaway first, then the most relevant filing-backed facts, then what to watch next, then any remaining limitation.",
    "For prompts such as 前回との違い, 何が変わった, or 一番大きい変化, start with the biggest filing-backed numeric change, then add one short business explanation if the filing provides it.",
    "If the exact question is broader than the filing but related facts exist, do not refuse immediately. Answer with the closest supported facts from the filing, then state what remains outside the filing.",
    "If the user asks about a driver, cause, or contributor but the provided support is only a metric, explain the observed change and clearly state that the driver cannot be isolated from that metric alone.",
    "If the user asks why the stock moved or what investors want to know, distinguish backward-looking results from forward-looking expectations.",
    "If the answer is only partially supported, say what is supported and what is still not confirmable from this filing context.",
    "Every supported answer must cite at least one SEC filing sourceId from the provided Sources list.",
    "Prefer concrete numbers such as YoY changes whenever they exist in the provided context.",
    "Return JSON with keys answer and sourceIds.",
    "Do not cite sourceIds that do not exist.",
    "",
    `Question: ${input.question}`,
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
    "Sources:",
    JSON.stringify(input.filing.sourceChunks)
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
