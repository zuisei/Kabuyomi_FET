/// 6-K の業績プレスリリースに載っている損益表を読む。
///
/// 20-F は年 1 回しか出ないので、外国企業の四半期はここからしか取れない
/// (6-K に XBRL は無い。docs/quality/FOREIGN_ISSUER_SUPPORT_2026-08-24.md)。
///
/// **位置で列を選ばないこと。** 2026-08-24 に実物を並べたら、TSMC は
/// 「2Q26 | 2Q25 | YoY% | 1Q26 | QoQ%」で当期が左端、ASML は「Q1 2026 | Q2 2026」で
/// 当期が右端だった。「最初の数値列」を採ると ASML では前四半期を今期として出す。
/// 見出し行に期が書いてあるので、**期で列を突き止める**。
///
/// **通貨も推測しないこと。** TSMC の表は `(Unit: NT$ million, except for EPS)`、
/// ASML は `(Figures in millions of euros unless otherwise indicated)`。
/// どちらも自分で単位を書いている。書いていない表は読まない。

export interface QuarterlyPeriodLabel {
  quarter: 1 | 2 | 3 | 4;
  year: number;
}

export interface QuarterlyFigure {
  /// 表の行見出しをそのまま(“Net sales” 等)。訳したり寄せたりしない。
  label: string;
  /// 盤面の指標に対応づけられたもの。対応が付かない行は null のまま残す。
  logicalName: "revenue" | "operatingIncome" | "netIncome" | "grossProfit" | null;
  value: number;
  /// 表の単位を掛けた後の値。`value` は表記のまま、こちらは実額。
  scaledValue: number;
  /// 根拠として引く原文の行。数字だけを持ち出さない。
  sourceText: string;
}

export interface QuarterlyResultsTable {
  currency: string;
  scale: number;
  /// 単位を読み取った原文(“Unit: NT$ million, except for EPS”)。
  unitNote: string;
  period: QuarterlyPeriodLabel;
  figures: QuarterlyFigure[];
}

const SCALES: ReadonlyArray<readonly [RegExp, number]> = [
  [/\bbillions?\b/i, 1_000_000_000],
  [/\bmillions?\b/i, 1_000_000],
  [/\bthousands?\b/i, 1_000]
];

/// 通貨の書き方は会社ごとに違う。記号・コード・英語名のどれで書かれても拾う。
const CURRENCIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bNT\$|\bnew taiwan dollars?\b|\bTWD\b/i, "TWD"],
  [/\beuros?\b|\bEUR\b|€/i, "EUR"],
  [/\byen\b|\bJPY\b|¥/i, "JPY"],
  [/\brenminbi\b|\byuan\b|\bCNY\b|\bRMB\b/i, "CNY"],
  [/\bdanish kroner?\b|\bDKK\b/i, "DKK"],
  [/\bUS\$|\bU\.S\. dollars?\b|\bUSD\b/i, "USD"]
];

/// 行見出し → 盤面の指標。TSMC は "Net sales"、ASML は "Total net sales"、
/// トヨタは "Net revenues" と、同じものを別の名前で呼ぶ。
const ROW_LABELS: ReadonlyArray<readonly [RegExp, QuarterlyFigure["logicalName"]]> = [
  [/^(?:total\s+)?net\s+(?:sales|revenues?)$|^(?:consolidated\s+)?revenues?$/i, "revenue"],
  [/^gross\s+profit$/i, "grossProfit"],
  [/^income\s+from\s+operations$|^operating\s+(?:income|profit)$/i, "operatingIncome"],
  [/^net\s+income$|^profit\s+for\s+the\s+period$/i, "netIncome"]
];

export function readUnitNote(text: string): { currency: string; scale: number; unitNote: string } | null {
  // 単位の注記は表のすぐ上に括弧で書かれる。段落全体ではなくその括弧だけを見る。
  for (const match of text.matchAll(/\(([^()]{0,160})\)/g)) {
    const note = match[1]!.trim();
    const scale = SCALES.find(([pattern]) => pattern.test(note))?.[1];
    const currency = CURRENCIES.find(([pattern]) => pattern.test(note))?.[1];
    if (scale && currency) return { currency, scale, unitNote: note };
  }
  return null;
}

export function readPeriodLabel(cell: string): QuarterlyPeriodLabel | null {
  const compact = /\b([1-4])Q\s*((?:20)?\d{2})\b/i.exec(cell);
  if (compact) {
    return { quarter: Number(compact[1]) as 1 | 2 | 3 | 4, year: expandYear(compact[2]!) };
  }
  const spaced = /\bQ([1-4])\s*((?:20)?\d{2})\b/i.exec(cell);
  if (spaced) {
    return { quarter: Number(spaced[1]) as 1 | 2 | 3 | 4, year: expandYear(spaced[2]!) };
  }
  return null;
}

function expandYear(raw: string): number {
  const value = Number(raw);
  return value < 100 ? 2000 + value : value;
}

/// 見出し行のどの列が目的の期か。**位置ではなく期の一致で決める。**
/// 見出しに目的の期が無ければ null を返す(近いものを選ばない)。
export function findPeriodColumn(headerCells: string[], period: QuarterlyPeriodLabel): number | null {
  for (const [index, cell] of headerCells.entries()) {
    const label = readPeriodLabel(cell);
    if (label && label.quarter === period.quarter && label.year === period.year) return index;
  }
  return null;
}

export function readQuarterlyResultsTable(
  rows: string[][],
  period: QuarterlyPeriodLabel,
  surroundingText: string
): QuarterlyResultsTable | null {
  const unit = readUnitNote(surroundingText);
  if (!unit) return null;

  for (const [headerIndex, headerRow] of rows.entries()) {
    const column = findPeriodColumn(headerRow, period);
    if (column === null) continue;

    const figures: QuarterlyFigure[] = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const label = row[0]?.trim();
      if (!label) continue;
      // 見出し列を 1 つ持つ表と持たない表がある。見出し行と同じ列位置で読む。
      const raw = row[column]?.trim();
      const value = parseAmount(raw);
      if (value === null) continue;

      figures.push({
        label,
        logicalName: ROW_LABELS.find(([pattern]) => pattern.test(label))?.[1] ?? null,
        value,
        scaledValue: value * unit.scale,
        sourceText: row.filter((cell) => cell.trim().length > 0).join(" ").replace(/\s+/g, " ").trim()
      });
    }

    if (figures.length === 0) continue;
    return { currency: unit.currency, scale: unit.scale, unitNote: unit.unitNote, period, figures };
  }

  return null;
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  // 脚注記号("27.25 b")や括弧の負数("(1,234)")が付く。
  const cleaned = raw.replace(/[a-z]\s*$/i, "").trim();
  const negative = /^\(.*\)$/.test(cleaned);
  const digits = cleaned.replace(/^\(|\)$/g, "").replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}
