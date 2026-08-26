import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env, FilingCacheRecord, MetricSnapshot, SourceChunkRecord } from "../src/env";
import { buildChatResponse } from "../src/lib/pipeline";

// 資金繰り・負債の質問は、型付き事実が揃っていればモデルを呼ばずに答える。
//
// finalizer の `liquiditySemanticRecoveryRequired` が
// 「isLiquidityDebtQuestion かつ型付き流動性事実あり」だけで決まり、
// 成立したら**常に**決定論的な比較文へ差し替える設計なので、
// モデルの答えは必ず捨てられる。捨てるものを待たない、というのがこの経路。
//
// 2026-08-21〜24 のベンチ10本では liquidity_debt が 51/51 全件この差し替えに
// 落ちていて、待ち時間の合計 209 秒がそのまま無駄になっていた。

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MODEL_ENV = {
  LLM_PROVIDER: "openai",
  OPENAI_API_KEY: "test-key",
  OPENAI_CHAT_MODEL: "gpt-5-nano"
} as unknown as Env;

describe("資金繰りの質問はモデルを呼ばずに答える", () => {
  it("型付き事実が揃っていれば OpenAI を一度も叩かない", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("モデルを呼んではいけない");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await buildChatResponse(
      liquidityFiling(),
      "借金やばくない？大丈夫？",
      MODEL_ENV,
      { webSupplementEnabled: false }
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.responsePath).toBe("deterministic");
    expect(response.debug?.geminiCalled).toBe(false);
  });

  it("差し替え後と同じ本文・同じ出典を返す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("モデルを呼んではいけない");
    }));

    const response = await buildChatResponse(
      liquidityFiling(),
      "資金繰りや負債に懸念はある？",
      MODEL_ENV,
      { webSupplementEnabled: false }
    );

    // 手元資金 1,200億ドル > 1年内 200億 + 非流動 500億。断定はしない、が契約。
    expect(response.answer).toContain("現金及び現金同等物");
    expect(response.answer).toContain("手元資金が上回っています");
    expect(response.answer).toContain("直ちに資金繰り懸念がないとは断定しません");
    expect(response.sources.length).toBeGreaterThan(0);
    expect(response.sources.every((source) => source.sourceKind === "sec_filing")).toBe(true);
  });

  it("型付き事実が無い会社では従来どおりモデルに回す", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ここではモデルに到達してよい");
    });
    vi.stubGlobal("fetch", fetchMock);

    // 打ち切りは「答えが確定するときだけ」。確定しないなら塞がずに通す。
    await buildChatResponse(
      withTypedMetrics(makeFiling(), []),
      "借金やばくない？大丈夫？",
      MODEL_ENV,
      { webSupplementEnabled: false }
    ).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalled();
  });

  it("資金繰りと関係ない質問には流動性の答えを返さない", async () => {
    // 同じ filing・同じ型付き事実でも、質問が資金繰りでなければこの経路に入らない。
    // (この質問は source-gate が先に弾くのでモデルにも届かない。ここで確かめたいのは
    //  「打ち切りが質問を取り違えていないこと」なので、経路ではなく本文で見る)
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("モデルを呼んではいけない");
    }));

    const response = await buildChatResponse(
      liquidityFiling(),
      "この会社ってなにで稼いでんの？",
      MODEL_ENV,
      { webSupplementEnabled: false }
    );

    expect(response.answer).not.toContain("手元資金が上回っています");
    expect(response.answer).not.toContain("コマーシャルペーパー");
  });
});

function liquidityFiling(): FilingCacheRecord {
  return withTypedMetrics(makeFiling(), [
    {
      logicalName: "cashAndCashEquivalents",
      tagUsed: "CashAndCashEquivalentsAtCarryingValue",
      value: 120_000_000_000,
      unit: "USD",
      periodEnd: "2025-12-31",
      periodKind: "instant"
    },
    {
      logicalName: "currentDebt",
      tagUsed: "LongTermDebtCurrent",
      value: 20_000_000_000,
      unit: "USD",
      periodEnd: "2025-12-31",
      periodKind: "instant"
    },
    {
      logicalName: "longTermDebt",
      tagUsed: "LongTermDebtNoncurrent",
      value: 50_000_000_000,
      unit: "USD",
      periodEnd: "2025-12-31",
      periodKind: "instant"
    }
  ]);
}

function makeFiling(): FilingCacheRecord {
  const chunk: SourceChunkRecord = {
    sourceId: "S1",
    sectionType: "md_a",
    sectionTitle: "Item 7",
    sourceLabel: "10-K Item 7",
    text: "Liquidity discussion mentions cash and debt.",
    startOffset: 0,
    endOffset: 45,
    sortOrder: 1
  };
  return {
    filingKey: "v1:liquidity-skip",
    ticker: "LQD",
    companyName: "Liquidity Test Corp.",
    cik: "0000000000",
    formType: "10-K",
    filedAt: "2026-01-01",
    periodOfReport: "2025-12-31",
    primaryDocumentUrl: "https://www.sec.gov/test.htm",
    mdaText: "",
    mdaTokenCount: 0,
    metrics: [],
    sourceChunks: [chunk],
    summary: { verdict: "", highlights: [], changes: [] },
    generatedAt: "2026-01-01T00:00:00.000Z",
    extractorVersion: "v1",
    promptVersion: "v1"
  };
}

function withTypedMetrics(filing: FilingCacheRecord, metrics: MetricSnapshot[]): FilingCacheRecord {
  const labelByMetric: Record<MetricSnapshot["logicalName"], string> = {
    revenue: "売上高",
    netIncome: "純利益",
    epsBasic: "1株利益",
    operatingIncome: "営業利益",
    operatingCashFlow: "営業CF",
    cashAndCashEquivalents: "現金及び現金同等物",
    currentDebt: "1年内返済予定の長期債務",
    longTermDebt: "長期債務（非流動）",
    equity: "自己資本",
    totalAssets: "総資産",
    capitalExpenditure: "設備投資"
  };
  const metricSources: SourceChunkRecord[] = metrics.map((metric, index) => ({
    sourceId: `MX${index + 1}`,
    sectionType: "xbrl_metric",
    sectionTitle: labelByMetric[metric.logicalName],
    sourceLabel: `XBRL ${labelByMetric[metric.logicalName]}`,
    text: `${labelByMetric[metric.logicalName]}: ${metric.value} ${metric.unit}`,
    startOffset: 0,
    endOffset: 0,
    tagName: metric.tagUsed,
    sortOrder: 100 + index
  }));
  return { ...filing, metrics, sourceChunks: [...filing.sourceChunks, ...metricSources] };
}
