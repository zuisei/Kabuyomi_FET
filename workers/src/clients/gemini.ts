import type {
  Env,
  FilingCacheRecord,
  MetricSnapshot,
  SourceChunkRecord,
  SummaryRecord
} from "../env";
import { ChatModelResponseSchema, SummaryResponseSchema } from "../lib/contracts";
import { logEvent } from "../lib/logging";

interface SummaryPromptInput {
  filingKey: string;
  ticker: string;
  companyName: string;
  formType: "10-K" | "10-Q";
  filedAt: string;
  periodOfReport: string;
  metrics: MetricSnapshot[];
  sourceChunks: SourceChunkRecord[];
}

interface ChatPromptInput {
  filing: FilingCacheRecord;
  question: string;
}

export async function generateSummary(env: Env, input: SummaryPromptInput): Promise<SummaryRecord> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "missing_api_key" });
    return localSummaryFallback(input);
  }

  const prompt = [
    "You are a source-bound assistant for a Japanese SEC filing reader.",
    "Use only the provided source chunks and metric facts.",
    "Never mention stock prices, analyst estimates, or investment advice.",
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

  const response = await invokeGemini(env, prompt, "summary");
  const parsed = SummaryResponseSchema.safeParse(response);
  if (!parsed.success) {
    logEvent("gemini_fallback_used", { kind: "summary", reason: "schema_validation_failed" });
    return localSummaryFallback(input);
  }
  return parsed.data;
}

export async function generateChatAnswer(
  env: Env,
  input: ChatPromptInput
): Promise<{ answer: string; sourceIds: string[] }> {
  if (!env.GEMINI_API_KEY) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "missing_api_key" });
    return localChatFallback(input);
  }

  const prompt = [
    "You answer user questions strictly from the provided SEC filing context.",
    "If the answer is not clearly supported, reply with: この filing の提供コンテキストでは確認できません。",
    "Never provide investment advice, price targets, or analyst comparisons.",
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

  const response = await invokeGemini(env, prompt, "chat");
  const parsed = ChatModelResponseSchema.safeParse(response);
  if (!parsed.success) {
    logEvent("gemini_fallback_used", { kind: "chat", reason: "schema_validation_failed" });
    return localChatFallback(input);
  }
  return parsed.data;
}

async function invokeGemini(env: Env, prompt: string, kind: "summary" | "chat"): Promise<unknown> {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY ?? ""
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    }
  );

  if (!response.ok) {
    logEvent("gemini_request_failed", {
      kind,
      status: response.status
    });
    throw new Error(`Gemini request failed (${response.status})`);
  }

  logEvent("gemini_request_succeeded", {
    kind,
    status: response.status
  });

  const payload = await response.json<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>();
  const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";

  try {
    return JSON.parse(text);
  } catch {
    logEvent("gemini_invalid_response", { kind });
    return {};
  }
}

function localSummaryFallback(input: SummaryPromptInput): SummaryRecord {
  const highlightSources = input.sourceChunks.filter((chunk) => chunk.sectionType === "md_a").slice(0, 2);
  const changeSources = input.sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric").slice(0, 2);
  const headlineMetric = input.metrics.find((metric) => metric.yoyPercent !== undefined) ?? input.metrics[0];
  const verdict = headlineMetric
    ? `${input.companyName}の最新${input.formType}では、${metricLabel(
        headlineMetric.logicalName
      )}を中心に提出資料ベースで確認できます。`
    : `${input.companyName}の最新${input.formType}を日本語で確認できます。`;

  return {
    verdict,
    highlights: highlightSources.map((source) => ({
      text: source.text.slice(0, 120).trim(),
      sourceIds: [source.sourceId]
    })),
    changes: changeSources.map((source) => ({
      text: source.text.slice(0, 120).trim(),
      sourceIds: [source.sourceId]
    }))
  };
}

function localChatFallback(input: ChatPromptInput): { answer: string; sourceIds: string[] } {
  const questionTerms = extractQuestionTerms(input.question);

  const scored = input.filing.sourceChunks
    .map((source) => ({
      source,
      score: questionTerms.reduce((sum, term) => sum + (source.text.toLowerCase().includes(term) ? 1 : 0), 0)
    }))
    .sort((left, right) => right.score - left.score);

  const best = scored[0]?.source;
  if (!best || scored[0].score === 0) {
    return {
      answer: "この filing の提供コンテキストでは確認できません。",
      sourceIds: input.filing.sourceChunks.slice(0, 1).map((source) => source.sourceId)
    };
  }

  return {
    answer: `${best.text.slice(0, 180).trim()}...`,
    sourceIds: [best.sourceId]
  };
}

function extractQuestionTerms(question: string): string[] {
  const normalized = question.toLowerCase().trim();
  const whitespaceTerms = normalized
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{Letter}\p{Number}]/gu, ""))
    .filter((term) => term.length >= 2);

  if (whitespaceTerms.length > 1) {
    return whitespaceTerms;
  }

  const compact = normalized.replace(/[\s。、，,.!?！？:："'“”‘’()\[\]{}]/gu, "");
  const fragments = new Set<string>();

  for (let index = 0; index < compact.length; index += 1) {
    for (let size = 2; size <= 4; size += 1) {
      const fragment = compact.slice(index, index + size);
      if (fragment.length === size) {
        fragments.add(fragment);
      }
    }
  }

  return [...fragments];
}

function metricLabel(metric: MetricSnapshot["logicalName"]): string {
  const labels: Record<MetricSnapshot["logicalName"], string> = {
    revenue: "売上高",
    netIncome: "純利益",
    epsBasic: "EPS",
    operatingIncome: "営業利益",
    operatingCashFlow: "営業CF"
  };

  return labels[metric];
}
