import type { ConceptFact, ConceptResponse } from "../../clients/sec";

/// 一社の長期の推移を、XBRL から一気に組み立てる。
///
/// 「栄枯盛衰」を見せるための土台(2026-08-25)。要点は**安いこと**で、
/// 提出書類を1本ずつ取り込まなくても、`companyconcept` を数回引けば
/// **19 年分が返ってくる**(実測: AAPL 2007〜2025、NFLX 2007〜2025)。
///
/// 実データを見て分かった落とし穴が 2 つある。
///
/// **① 1 つのタグでは足りない。** 会社は年を跨いでタグを変える。
/// AAPL の `Revenues` は 2016〜2018 の 3 年しか無く、それ以前は `SalesRevenueNet`、
/// 以降は `RevenueFromContractWithCustomerExcludingAssessedTax`。
/// 1 タグだけ見ると **19 年の歴史が 3 年に切り詰められる**。繋いで初めて歴史になる。
/// (重複する年の値は 3 タグとも一致していたので、繋いでも矛盾しない)
///
/// **② 同じ年に 2 つの値がある。** AAPL の 2008 年度の売上は 32.48B と 37.49B の
/// 両方が存在する。iPhone の収益認識を変えたときの**遡及修正**で、
/// 前者が当時の発表値、後者が後から並べ直した値。
/// **後の値を採り、修正されたことを持ち回る。** 隠すと、当時の記事と数字が合わない
/// 理由が読者に分からなくなる。

export interface LongRunPoint {
  fiscalYear: number;
  periodEnd: string;
  value: number;
  tagUsed: string;
  /// その年を報告した提出書類。年表の各行から原文へ辿れるようにするために持つ。
  /// **数字だけの年表は、このアプリが出していい形ではない。**
  accessionNumber?: string;
  /// 後から修正された年は、最初に報告された値を残す。
  restatedFrom?: number;
}

export interface LongRunSeries {
  unit: string;
  points: LongRunPoint[];
}

/// 年次とみなす期間の長さ(日)。52/53 週決算があるので幅を持たせる。
const ANNUAL_MIN_DAYS = 300;
const ANNUAL_MAX_DAYS = 400;

const ANNUAL_FORMS = new Set(["10-K", "20-F"]);

export function buildLongRunSeries(
  conceptsByTag: Array<{ tag: string; concept: ConceptResponse | null }>,
  unit = "USD"
): LongRunSeries | null {
  /// 年 → その年の候補。タグの優先順位(引数の並び)と報告日で選ぶ。
  const byYear = new Map<number, Array<{ fact: ConceptFact; tag: string; tagPriority: number }>>();

  for (const [tagPriority, { tag, concept }] of conceptsByTag.entries()) {
    for (const fact of concept?.units?.[unit] ?? []) {
      if (!isAnnualFact(fact)) continue;
      const fiscalYear = Number(fact.end!.slice(0, 4));
      if (!Number.isSafeInteger(fiscalYear)) continue;
      const bucket = byYear.get(fiscalYear) ?? [];
      bucket.push({ fact, tag, tagPriority });
      byYear.set(fiscalYear, bucket);
    }
  }

  const points: LongRunPoint[] = [];
  for (const [fiscalYear, candidates] of [...byYear.entries()].sort((a, b) => a[0] - b[0])) {
    // 後から報告されたものを正とする。同じ報告日なら優先度の高いタグ。
    const sorted = [...candidates].sort((left, right) => {
      const filed = (right.fact.filed ?? "").localeCompare(left.fact.filed ?? "");
      return filed !== 0 ? filed : left.tagPriority - right.tagPriority;
    });
    const chosen = sorted[0]!;
    const distinct = [...new Set(candidates.map((candidate) => candidate.fact.val))];
    const earliest = [...candidates].sort((left, right) =>
      (left.fact.filed ?? "").localeCompare(right.fact.filed ?? "")
    )[0]!;

    points.push({
      fiscalYear,
      periodEnd: chosen.fact.end!,
      value: chosen.fact.val,
      tagUsed: chosen.tag,
      ...(chosen.fact.accn ? { accessionNumber: chosen.fact.accn } : {}),
      ...(distinct.length > 1 && earliest.fact.val !== chosen.fact.val
        ? { restatedFrom: earliest.fact.val }
        : {})
    });
  }

  return points.length > 0 ? { unit, points } : null;
}

function isAnnualFact(fact: ConceptFact): boolean {
  if (!fact.start || !fact.end) return false;
  if (!fact.form || !ANNUAL_FORMS.has(fact.form.trim().toUpperCase())) return false;
  if (!Number.isFinite(fact.val)) return false;
  const days = Math.round(
    (new Date(fact.end).getTime() - new Date(fact.start).getTime()) / 86_400_000
  );
  return days >= ANNUAL_MIN_DAYS && days <= ANNUAL_MAX_DAYS;
}

export type TurningPointKind =
  /// 増え続けたあと、初めて減った年。物語はたいていここから動く。
  | "first_decline"
  /// 減ったあとの底。
  | "trough"
  /// 底から戻して過去最高を更新した年。
  | "recovery"
  /// 成長の速さが変わった年。伸び続けている会社で、唯一の目印になる。
  | "growth_shift"
  /// 桁が変わった年(10 億 → 100 億 など)。
  | "milestone";

export interface TurningPoint {
  fiscalYear: number;
  kind: TurningPointKind;
  value: number;
  changePercent: number | null;
}

/// 年表で目を留めさせる年だけを拾う。
///
/// **「過去最高を更新」は、伸び続けている会社では印にならない。**
/// Netflix の実データ(2007〜2025、19 年連続増収)に当てたら **19 行すべてが
/// 「最高更新」**になり、印が全部付いている = 何も指していない状態になった。
/// なので最高更新は**一度落ちてから戻した時(recovery)だけ**にして、
/// 単調に伸びる会社は「速さが変わった年」と「桁が変わった年」で語る。
///
/// 19 年ぶんの本文を取り込むのは高い。ここで年を絞れば、取りに行く提出書類は数本で済む。
const MAX_TURNING_POINTS = 6;

/// 成長率がこれだけ動いたら「変わった」とみなす(前年までの平均との差、%ポイント)。
const GROWTH_SHIFT_POINTS = 25;

export function findTurningPoints(series: LongRunSeries): TurningPoint[] {
  const points = series.points;
  if (points.length < 3) return [];

  const turning: TurningPoint[] = [];
  const growth: number[] = [];
  let peak = points[0]!.value;
  let sawDecline = false;
  let inDrawdown = false;
  let awaitingRecovery = false;

  for (const [index, point] of points.entries()) {
    if (index === 0) continue;
    const previous = points[index - 1]!;
    const changePercent =
      previous.value === 0 ? null : ((point.value - previous.value) / Math.abs(previous.value)) * 100;

    if (point.value < previous.value) {
      if (!sawDecline) {
        turning.push({ fiscalYear: point.fiscalYear, kind: "first_decline", value: point.value, changePercent });
        sawDecline = true;
      }
      inDrawdown = true;
      awaitingRecovery = true;
    } else if (point.value > previous.value) {
      if (inDrawdown) {
        turning.push({ fiscalYear: previous.fiscalYear, kind: "trough", value: previous.value, changePercent: null });
        inDrawdown = false;
      }
    }

    // 戻すのに何年かかっても「戻した年」は拾う。**直後の 1 年だけを見ていると
    // 落ち込みが深い会社ほど取りこぼす** — Apple は 2016 年に減収し、
    // 過去最高に戻したのは 2 年後の 2018 年で、そこが物語の山だった。
    if (awaitingRecovery && point.value > peak) {
      turning.push({ fiscalYear: point.fiscalYear, kind: "recovery", value: point.value, changePercent });
      awaitingRecovery = false;
    }

    // 速さの変化。前年までの平均と比べて大きく動いた年を拾う。
    if (changePercent !== null) {
      if (growth.length >= 2) {
        const average = growth.reduce((sum, value) => sum + value, 0) / growth.length;
        if (Math.abs(changePercent - average) >= GROWTH_SHIFT_POINTS) {
          turning.push({ fiscalYear: point.fiscalYear, kind: "growth_shift", value: point.value, changePercent });
        }
      }
      growth.push(changePercent);
    }

    if (crossedOrderOfMagnitude(previous.value, point.value)) {
      turning.push({ fiscalYear: point.fiscalYear, kind: "milestone", value: point.value, changePercent });
    }

    peak = Math.max(peak, point.value);
  }

  // 多すぎると年表が印だらけになって読めない。**新しい順に切ってはいけない** —
  // Apple で試したら、いちばん意味のある「2016 年の初の減収」が
  // 直近の小さな上下に押し出されて消えた。**種類の重みで残す。**
  return turning
    .sort((left, right) => {
      const weight = KIND_WEIGHT[left.kind] - KIND_WEIGHT[right.kind];
      return weight !== 0 ? weight : right.fiscalYear - left.fiscalYear;
    })
    .slice(0, MAX_TURNING_POINTS)
    .sort((left, right) => left.fiscalYear - right.fiscalYear);
}

/// 小さいほど残る。**初の減収は一社に一度しかない**ので最優先。
/// 底は「減って戻した」の途中経過にすぎないので最後に落とす。
const KIND_WEIGHT: Record<TurningPointKind, number> = {
  first_decline: 0,
  recovery: 1,
  milestone: 2,
  growth_shift: 3,
  trough: 4
};

function crossedOrderOfMagnitude(previous: number, current: number): boolean {
  if (previous <= 0 || current <= 0) return false;
  return Math.floor(Math.log10(current)) > Math.floor(Math.log10(previous));
}
