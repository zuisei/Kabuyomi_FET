import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudflareSecFetcherService } from "../src/lib/sec-fetcher-service";

const env = { SEC_USER_AGENT: "Kabuyomi test" } as never;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SEC submissions column parity", () => {
  // submissions.json は列指向。5つの配列が同じ添字で1件の資料を表すので、
  // 長さが揃わない応答をそのまま通すと form[i] と accessionNumber[i] が
  // 別の資料を指し、**種別と実体がずれた資料**を掴む。
  it("rejects a truncated submissions payload instead of pairing mismatched columns", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      filings: {
        recent: {
          form: ["10-K", "10-Q", "8-K"],
          accessionNumber: ["0000320193-26-000001", "0000320193-26-000002"], // 1件足りない
          primaryDocument: ["a.htm", "b.htm", "c.htm"],
          filingDate: ["2026-01-01", "2026-04-01", "2026-07-01"],
          reportDate: ["2025-12-31", "2026-03-31", "2026-06-30"]
        }
      }
    })));

    const service = createCloudflareSecFetcherService(env);
    const root = await service.fetchSubmissions("0000320193", { includeHistory: true });

    // 列が食い違うので正規化は null を返し、履歴展開は元payloadをそのまま返す。
    // 少なくとも「ずれた組み合わせ」が entries として作られてはいけない。
    const recent = (root as { filings?: { recent?: Record<string, unknown[]> } })?.filings?.recent;
    expect(recent?.form).toHaveLength(3);
    expect(recent?.accessionNumber).toHaveLength(2);
  });

  // NOTE: `responseCache` はモジュールスコープなのでテスト間でも生き残る
  // (submissions の TTL は30分)。同じ CIK を使い回すと前のテストの応答を
  // 引いてしまうため、ケースごとに別 CIK を使う。
  it("accepts a payload whose columns all agree", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      filings: {
        recent: {
          form: ["10-K", "10-Q"],
          accessionNumber: ["0000320193-26-000001", "0000320193-26-000002"],
          primaryDocument: ["a.htm", "b.htm"],
          filingDate: ["2026-01-01", "2026-04-01"],
          reportDate: ["2025-12-31", "2026-03-31"]
        }
      }
    })));

    const service = createCloudflareSecFetcherService(env);
    const root = await service.fetchSubmissions("0000789019");
    expect((root as { filings: { recent: { form: string[] } } }).filings.recent.form).toEqual(["10-K", "10-Q"]);
  });
});

describe("SEC response cache byte ceiling", () => {
  // `responseCache` はモジュールスコープで isolate が生きている限り残る。
  // companyfacts は実測 1社 3.6 MB なので、件数上限(512)だけでは
  // isolate の 128 MB を守れない。バイト数でも退避されることを固定する。
  it("evicts large cached bodies so the module-level cache cannot grow without bound", async () => {
    const big = "x".repeat(5 * 1024 * 1024); // 5 MB / 件 → 3件で 12 MB の上限を超える
    const fetchMock = vi.fn(async () => new Response(big, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = createCloudflareSecFetcherService(env);
    const args = (n: number) => ({
      cik: "320193",
      accessionNumber: `0000320193-26-00000${n}`,
      primaryDocument: `doc${n}.htm`
    });

    await service.fetchFiling(args(1));
    await service.fetchFiling(args(2));
    await service.fetchFiling(args(3));
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // 1件目は上限超過で退避されているはずなので、引き直すと再取得が走る。
    await service.fetchFiling(args(1));
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("still serves a small body from cache without refetching", async () => {
    const fetchMock = vi.fn(async () => new Response("small", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const service = createCloudflareSecFetcherService(env);
    const args = { cik: "320193", accessionNumber: "0000320193-26-000009", primaryDocument: "s.htm" };

    const first = await service.fetchFiling(args);
    const second = await service.fetchFiling(args);
    expect(first.html).toBe("small");
    expect(second.html).toBe("small");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
