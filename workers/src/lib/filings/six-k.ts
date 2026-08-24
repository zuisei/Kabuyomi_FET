/// 6-K のうち「四半期業績」だけを見分ける。
///
/// 20-F は年 1 回しか出ないので、外国企業の四半期の数字は 6-K から取るしかない
/// (2026-08-24 オーナー決定。docs/quality/FOREIGN_ISSUER_SUPPORT_2026-08-24.md)。
/// ところが 6-K は「その月に起きたことの報告」という器なので、中身が定まっていない。
/// TSM の直近 3 か月分を数えただけでも、四半期業績・月次売上速報・取締役会決議・
/// 配当調整・株主総会と 5 種類が同じ 6-K として出てくる。
///
/// **本体は表紙だけ**で、中身は必ず添付(EX-99.1 等)に入っている。実測した 3 社とも
/// 本体は「FORM 6-K / REPORT OF FOREIGN PRIVATE ISSUER / 署名」しか書いていない。
/// だから判定は添付の本文に対して行う。
///
/// 大きさで見分けたくなるが、TSM は月次売上速報が 100KB、四半期業績が 1.4MB、
/// 四半期財務諸表が 4.9MB と重なるので、**サイズは根拠にしない**。

export interface QuarterlyResultsPeriod {
  /// 会計四半期。「second quarter」「Q2 2026」から取る。
  quarter: 1 | 2 | 3 | 4;
  /// 「second quarter ended June 30, 2026」の年。取れない場合は null。
  calendarYear: number | null;
  /// 「ended June 30, 2026」の締め日(ISO)。取れない場合は null。
  periodEnd: string | null;
}

/// 同じ四半期の数字が複数の 6-K に載る。TSM は 7/16 に業績プレスリリースを出し、
/// 8/11 の取締役会決議にも **同じ売上・純利益・EPS が入っていた**(実測)。
/// 決議を「業績ではない」と切り捨てるのは嘘になるので、種類として持たせて
/// 呼ぶ側が選べるようにする。同じ四半期なら release を優先する。
export type QuarterlyResultsDocumentKind = "results_release" | "board_resolution";

export interface QuarterlyResultsSignal {
  period: QuarterlyResultsPeriod;
  kind: QuarterlyResultsDocumentKind;
  /// どの手掛かりで判定したか。診断ログ用で、判定ロジックの説明責任を持たせる。
  matched: string[];
}

const QUARTER_WORDS: Record<string, 1 | 2 | 3 | 4> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

/// 売上に相当する語。TSM は "consolidated revenue"、ASML は "total net sales"、
/// トヨタは "net revenues" と、同じものを別の名前で呼ぶ。
const TOP_LINE = /\b(?:total\s+)?(?:net\s+)?(?:consolidated\s+)?(?:revenues?|net\s+sales|sales\s+revenue)\b/i;

/// 最終利益に相当する語。ここが無いものは業績発表ではない
/// (月次売上速報は売上しか載せないので、この 1 点で落ちる)。
const BOTTOM_LINE = /\b(?:net\s+(?:income|loss|profit)|profit\s+(?:for\s+the\s+period|attributable\s+to))\b/i;

/// 月次売上速報。TSM は毎月 10 日前後に出す。売上の語は持つが四半期ではない。
const MONTHLY_NOTICE = /\bnet\s+revenue\s+for\s+the\s+month\s+of\b|\bmonthly\s+(?:net\s+)?revenue\b/i;

const BOARD_RESOLUTION = /\bboard\s+of\s+directors\b[^.]{0,200}\bresolutions?\b|\bpassed\s+the\s+following\s+resolutions?\b/i;

export function detectQuarterlyResultsRelease(text: string): QuarterlyResultsSignal | null {
  if (!text.trim()) return null;

  const matched: string[] = [];
  const period = readPeriod(text, matched);
  if (!period) return null;

  // 月次速報は「四半期」の語を持たないのが普通だが、四半期入りの月に
  // 両方触れることがある。売上しか無いものは業績発表として扱わない。
  if (MONTHLY_NOTICE.test(text) && !BOTTOM_LINE.test(text)) return null;

  if (!TOP_LINE.test(text)) return null;
  matched.push("top_line");
  if (!BOTTOM_LINE.test(text)) return null;
  matched.push("bottom_line");

  const kind: QuarterlyResultsDocumentKind = BOARD_RESOLUTION.test(text)
    ? "board_resolution"
    : "results_release";
  matched.push(kind);

  return { period, kind, matched };
}

/// 期は**文書の一番早い言及**を採る。業績発表は見出しに期を書くからで、
/// 本文の先頭から探すと途中の話題(ASML は自社株買いの段で "second quarter" に触れる)を
/// 拾って 1 年ずれる。「Q2 2026」形と「second quarter」形の両方を集めて、早い方を使う。
function readPeriod(text: string, matched: string[]): QuarterlyResultsPeriod | null {
  const candidates: { index: number; quarter: 1 | 2 | 3 | 4; year: number | null; signal: string }[] = [];

  const worded = /\b(first|second|third|fourth)\s+quarter\b/gi;
  for (const m of text.matchAll(worded)) {
    candidates.push({
      index: m.index ?? 0,
      quarter: QUARTER_WORDS[m[1]!.toLowerCase()]!,
      year: null,
      signal: "quarter_word"
    });
  }

  const short = /\bQ([1-4])\s*(?:'|,\s*)?\s*(20\d{2})\b/gi;
  for (const m of text.matchAll(short)) {
    candidates.push({
      index: m.index ?? 0,
      quarter: Number(m[1]) as 1 | 2 | 3 | 4,
      year: Number(m[2]),
      signal: "quarter_short"
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.index - b.index);
  const best = candidates[0]!;
  matched.push(best.signal);

  const end = readEnd(text, best.index);
  return {
    quarter: best.quarter,
    calendarYear: end.calendarYear ?? best.year,
    periodEnd: end.periodEnd
  };
}

/// 締め日は**期の言及の近くにあるものだけ**を採る。遠くにあるものは決算期とは限らず、
/// ASML の場合いちばん近い "ended" が末尾のリスク要因の
/// 「Form 20-F for the year ended December 31, 2025」で、そのまま採ると 1 年ずれる
/// (実測で Q2 2026 を 2025-12-31 と読み違えた)。近くに無ければ **null にする** —
/// 日付を捏造するより、締め日が分からないと言う方がよい。
const PERIOD_END_WINDOW_CHARS = 2_000;

function readEnd(text: string, from: number): { calendarYear: number | null; periodEnd: string | null } {
  const ended = /\bended\s+([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\b/i
    .exec(text.slice(from, from + PERIOD_END_WINDOW_CHARS));
  if (!ended) return { calendarYear: null, periodEnd: null };
  const month = MONTHS[ended[1]!.toLowerCase()];
  if (!month) return { calendarYear: null, periodEnd: null };
  const day = Number(ended[2]);
  const year = Number(ended[3]);
  if (day < 1 || day > 31) return { calendarYear: year, periodEnd: null };
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { calendarYear: year, periodEnd: iso };
}
