import { detectQuarterlyResultsRelease, type QuarterlyResultsSignal } from "./six-k";

/// 20-F 提出者の「直近の四半期」を会話で扱えるようにする。
///
/// 20-F は年 1 回しか出ないので、これだけだと外国企業は 1 年前の話しかできない。
/// 四半期の実績は 6-K の業績プレスリリースにあるので、**本文としてそれを足す**
/// (2026-08-24 オーナー決定。docs/quality/FOREIGN_ISSUER_SUPPORT_2026-08-24.md)。
///
/// **数値は取り込まない。** プレスリリースの損益表は現地通貨(TWD / EUR)で、
/// 指標側は USD で揃えてある。混ぜると盤面の通貨が 1 社ずつ変わる。
/// ここで足すのは会話が引用できる**文章**だけで、盤面は年次 USD のまま。

export interface SixKFilingRef {
  accessionNumber: string;
  filedAt: string;
  primaryDocument: string;
}

export interface QuarterlyNarrative {
  accessionNumber: string;
  filedAt: string;
  documentUrl: string;
  documentName: string;
  period: QuarterlyResultsSignal["period"];
  kind: QuarterlyResultsSignal["kind"];
  text: string;
}

/// 直近の 6-K を何本まで遡るか。四半期業績はおよそ 3 か月に 1 本だが、
/// TSM は月次売上速報や取締役会決議も 6-K で出すので、間に何本も挟まる。
/// 8 本見れば直近の四半期には届く。全部辿ると通信量が跳ねる。
const MAX_SIX_K_SCAN = 8;

/// 1 本の 6-K で本文を探しにいく添付の上限。
const MAX_DOCUMENTS_PER_FILING = 3;

/// 添付から本文の候補を選ぶ。
///
/// **本体は必ず表紙**で、中身は添付に入っている(TSM・ASML・Shell で実測)。
/// 説明会資料は画像が主でテキストが薄いので外す。
export function selectQuarterlyResultsDocuments(
  names: string[],
  primaryDocument: string
): string[] {
  return names
    .filter((name) => /\.html?$/i.test(name))
    .filter((name) => name !== primaryDocument)
    .filter((name) => !/index|presentation|slides/i.test(name))
    .slice(0, MAX_DOCUMENTS_PER_FILING);
}

export interface QuarterlyNarrativeFetchers {
  /// 提出物の添付一覧(EDGAR の index.json)。
  listDocuments: (accessionNumber: string) => Promise<string[]>;
  /// 添付の本文をプレーンテキストで返す。
  readDocumentText: (accessionNumber: string, documentName: string) => Promise<string>;
  buildDocumentUrl: (accessionNumber: string, documentName: string) => string;
}

/// 直近の四半期業績を 1 本だけ返す。見つからなければ null。
///
/// 業績プレスリリースと取締役会決議の両方が同じ四半期を報じることがある
/// (TSM は実際に両方出し、数字も同じだった)。**プレスリリースを優先**し、
/// 決議しか無い四半期ではそれを使う。
export async function findLatestQuarterlyNarrative(
  sixKFilings: SixKFilingRef[],
  fetchers: QuarterlyNarrativeFetchers
): Promise<QuarterlyNarrative | null> {
  let boardResolutionFallback: QuarterlyNarrative | null = null;

  for (const filing of [...sixKFilings]
    .sort((left, right) => right.filedAt.localeCompare(left.filedAt))
    .slice(0, MAX_SIX_K_SCAN)) {
    let names: string[];
    try {
      names = await fetchers.listDocuments(filing.accessionNumber);
    } catch {
      continue;
    }

    for (const documentName of selectQuarterlyResultsDocuments(names, filing.primaryDocument)) {
      let text: string;
      try {
        text = await fetchers.readDocumentText(filing.accessionNumber, documentName);
      } catch {
        continue;
      }

      const signal = detectQuarterlyResultsRelease(text);
      if (!signal) continue;

      const narrative: QuarterlyNarrative = {
        accessionNumber: filing.accessionNumber,
        filedAt: filing.filedAt,
        documentUrl: fetchers.buildDocumentUrl(filing.accessionNumber, documentName),
        documentName,
        period: signal.period,
        kind: signal.kind,
        text
      };

      if (signal.kind === "results_release") return narrative;
      boardResolutionFallback ??= narrative;
    }
  }

  return boardResolutionFallback;
}

/// 会話が引用できる形にする。日本語の見出しを付けるのは、
/// **年次報告書の記述と取り違えられないようにする**ため。
/// 出典 URL と accession は 6-K のものを持たせる。
export function quarterlyNarrativeSectionTitle(narrative: QuarterlyNarrative): string {
  const year = narrative.period.calendarYear;
  const quarter = `第${narrative.period.quarter}四半期`;
  const suffix = narrative.kind === "board_resolution" ? "業績（取締役会決議）" : "業績";
  return year ? `${year}年 ${quarter} ${suffix}` : `${quarter} ${suffix}`;
}
