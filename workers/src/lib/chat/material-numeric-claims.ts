import type { FinancialDisplayUnit, FinancialFactPeriodKind, FinancialFactRole } from "../../env";
import { canonicalValueFromDisplay } from "../financial-number-format";

export type MaterialNumericClaimKind = "currency" | "percentage" | "number";

export interface MaterialNumericClaim {
  kind: MaterialNumericClaimKind;
  raw: string;
  start: number;
  end: number;
  numericValue: number;
  canonicalValue: number;
  currency: string | null;
  unit: string;
  displayUnit: FinancialDisplayUnit;
  decimals: number;
  negative: boolean;
  semanticLabel: string | null;
  periodRole: Exclude<FinancialFactRole, "reported"> | null;
  periodKind: FinancialFactPeriodKind | null;
}

const CURRENCY_CLAIM_PATTERN = /(?<open>\()?[ \t]*(?<sign>[+\-−△▲])?[ \t]*(?<prefix>[$¥￥])?[ \t]*(?<number>(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)[ \t]*(?<scale>trillion|billion|million|兆|億|十億|百万)?[ \t]*(?<suffix>USD(?:\/(?:share|shares))?|JPY|米ドル|ドル(?:\/株)?|円)?[ \t]*(?<close>\))?/giu;
const PERCENTAGE_CLAIM_PATTERN = /(?<open>\()?[ \t]*(?<sign>[+\-−△▲])?[ \t]*(?<number>\d+(?:\.\d+)?)[ \t]*%(?<direction>[ \t]*(?:増|減|上昇|下落|低下|改善|悪化|increase|increased|decrease|decreased|up|down))?[ \t]*(?<close>\))?/giu;
const BARE_TYPED_CLAIM_PATTERN = /(?<open>\()?[ \t]*(?<sign>[+\-−△▲])?[ \t]*(?<number>(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)[ \t]*(?<scale>trillion|billion|million|兆|億|十億|百万)?[ \t]*(?<suffix>shares?|株|倍|x)?[ \t]*(?<close>\))?/giu;

/// 全角の数字・記号を半角へ倒す。**1文字を1文字に置き換えるので長さが変わらない。**
/// これが重要で、返す `start`/`end` は呼び出し元が持つ元テキストにそのまま使える
/// (`numeric-alignment` は元の answer に対して `slice` で修理値を差し込む)。
///
/// 正規化しないと、日本語の回答でごく自然に現れる全角 `％` や全角数字が
/// どのパターンにも一致せず、**クレームが0件 = 検証を素通り**する。
/// 全角カンマ/ピリオドは逆に数値を分断し(`1，111.8億ドル` → `1` と `111.8億ドル`)、
/// 正しい値を誤ってブロックする。どちらもここで閉じる。
/// **数値そのものを構成する文字だけ**を対象にする。全角括弧 `（）` と全角空白は
/// 意図的に含めない。日本語では `長期債務（非流動）` のようにごく普通の
/// 補足として使われ、半角 `()` に倒すと負数の括弧表記と誤認される。
const FULL_WIDTH_NUMERIC_MAP: Record<string, string> = {
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  "％": "%", "，": ",", "．": ".", "＋": "+", "－": "-", "＄": "$"
};

const FULL_WIDTH_NUMERIC_PATTERN = /[０-９％，．＋－＄]/gu;

export function normalizeNumericWidth(text: string): string {
  return text.replace(FULL_WIDTH_NUMERIC_PATTERN, (character) => FULL_WIDTH_NUMERIC_MAP[character] ?? character);
}

export function extractMaterialNumericClaims(rawText: string): MaterialNumericClaim[] {
  const text = normalizeNumericWidth(rawText);
  const explicitClaims = [
    ...extractCurrencyClaims(text),
    ...extractPercentageClaims(text)
  ];
  return [
    ...explicitClaims,
    ...extractBareTypedClaims(text, explicitClaims)
  ].sort((left, right) => left.start - right.start || left.end - right.end);
}

function extractBareTypedClaims(text: string, explicitClaims: MaterialNumericClaim[]): MaterialNumericClaim[] {
  const claims: MaterialNumericClaim[] = [];
  for (const match of text.matchAll(BARE_TYPED_CLAIM_PATTERN)) {
    const groups = match.groups;
    const raw = match[0];
    if (!groups || !raw || match.index === undefined) continue;
    const start = match.index;
    const end = start + raw.length;
    if (explicitClaims.some((claim) => start < claim.end && end > claim.start)) continue;
    if (isCalendarOrDurationToken(text, start, end) || isNonFinancialCountToken(text, end) ||
        /(?:^|[^A-Za-z])Q$/iu.test(text.slice(Math.max(0, start - 2), start))) continue;

    const context = claimContext(text, start, end);
    const prefixContext = claimPrefix(text, start, 48);
    const suffixContext = claimSuffix(text, end, 24);
    // Bare values are especially easy to bind to the label in the following
    // clause (for example, `EPS 2.18、発行済株式数 ...`). Prefer the nearest
    // preceding label and only fall back to the current clause's suffix.
    const semanticLabel = inferSemanticLabel(prefixContext) ?? inferSemanticLabel(suffixContext);
    if (!semanticLabel) continue;
    const immediateContext = `${prefixContext}${suffixContext}`;
    if (!inferSemanticLabel(immediateContext)) continue;

    const magnitude = parseNumericToken(groups.number);
    if (!Number.isFinite(magnitude)) continue;
    const negative = isNegative(groups.sign, groups.open, groups.close);
    const numericValue = negative ? -Math.abs(magnitude) : magnitude;
    const displayUnit = resolveDisplayUnit(groups.scale);
    const suffix = (groups.suffix ?? "").toLowerCase();
    const unit = /^(?:share|shares|株)$/iu.test(suffix)
      ? "shares"
      : /^(?:倍|x)$/iu.test(suffix)
        ? "ratio"
        : semanticLabel === "epsBasic"
          ? "number/shares"
          : "number";
    claims.push({
      kind: "number",
      raw,
      start,
      end,
      numericValue,
      canonicalValue: canonicalValueFromDisplay(numericValue, displayUnit),
      currency: null,
      unit,
      displayUnit,
      decimals: decimalPlaces(groups.number),
      negative,
      semanticLabel,
      periodRole: inferClaimPeriodRole(text, start, end),
      periodKind: inferPeriodKind(context)
    });
  }
  return claims;
}

function isNonFinancialCountToken(text: string, end: number): boolean {
  return /^\s*(?:つ|点|項目|種類|社|地域|事業|部門|セグメント|製品|カテゴリ|か国|カ国|ヶ国|件)/u.test(
    text.slice(end, Math.min(text.length, end + 12))
  );
}

function extractCurrencyClaims(text: string): MaterialNumericClaim[] {
  const claims: MaterialNumericClaim[] = [];
  for (const match of text.matchAll(CURRENCY_CLAIM_PATTERN)) {
    const groups = match.groups;
    const raw = match[0];
    if (!groups || !raw || match.index === undefined) {
      continue;
    }
    if (!groups.prefix && !groups.suffix) {
      continue;
    }
    const numericMagnitude = parseNumericToken(groups.number);
    if (!Number.isFinite(numericMagnitude)) {
      continue;
    }
    const negative = isNegative(groups.sign, groups.open, groups.close);
    const numericValue = negative ? -Math.abs(numericMagnitude) : numericMagnitude;
    const displayUnit = resolveDisplayUnit(groups.scale);
    const currency = resolveCurrency(groups.prefix, groups.suffix);
    const unit = /\/株|\/share/i.test(groups.suffix ?? "")
      ? `${currency ?? "number"}/shares`
      : currency ?? "number";
    const start = match.index;
    const end = start + raw.length;
    const context = claimContext(text, start, end);
    const periodRole = inferClaimPeriodRole(text, start, end);
    claims.push({
      kind: "currency",
      raw,
      start,
      end,
      numericValue,
      canonicalValue: canonicalValueFromDisplay(numericValue, displayUnit),
      currency,
      unit,
      displayUnit,
      decimals: decimalPlaces(groups.number),
      negative,
      // A two-period sentence can put the metric label more than the local
      // context window away from its second value (`売上高は <prior> から
      // <current> へ`). Keep the lookup inside the same sentence, but allow
      // both roles to inherit that metric identity.
      semanticLabel: inferSemanticLabel(context) ?? inferSemanticLabel(sentencePrefix(text, start, 160)),
      periodRole,
      periodKind: inferPeriodKind(context)
    });
  }
  return claims;
}

function extractPercentageClaims(text: string): MaterialNumericClaim[] {
  const claims: MaterialNumericClaim[] = [];
  for (const match of text.matchAll(PERCENTAGE_CLAIM_PATTERN)) {
    const groups = match.groups;
    const raw = match[0];
    if (!groups || !raw || match.index === undefined) {
      continue;
    }
    const magnitude = parseNumericToken(groups.number);
    if (!Number.isFinite(magnitude)) {
      continue;
    }
    const direction = (groups.direction ?? "").trim().toLowerCase();
    const directionNegative = /減|下落|低下|悪化|decrease|decreased|down/.test(direction);
    const directionPositive = /増|上昇|改善|increase|increased|up/.test(direction);
    const signNegative = isNegative(groups.sign, groups.open, groups.close);
    const negative = signNegative || directionNegative;
    const numericValue = negative ? -Math.abs(magnitude) : Math.abs(magnitude);
    const start = match.index;
    const end = start + raw.length;
    const context = claimContext(text, start, end);
    claims.push({
      kind: "percentage",
      raw,
      start,
      end,
      numericValue,
      canonicalValue: numericValue,
      currency: null,
      unit: "percent",
      displayUnit: "percent",
      decimals: decimalPlaces(groups.number),
      negative,
      semanticLabel: inferSemanticLabel(context) ?? inferSemanticLabel(sentencePrefix(text, start, 120)),
      // An explicit role immediately after the value (for example,
      // `4.91%（今期）対9.28%（前期）`) is stronger than change-direction
      // wording. Without this, a malformed `4.91%増（前期）` can be treated as
      // an unscoped current percentage and survive the repaired-answer pass.
      periodRole: inferTrailingPeriodRole(text, end) ??
        (directionPositive || directionNegative ? null : inferPeriodRole(claimPrefix(text, start, 48))),
      periodKind: inferPeriodKind(context)
    });
  }
  return claims;
}

function claimContext(text: string, start: number, end: number): string {
  const localPrefix = claimPrefix(text, start, 72);
  return `${localPrefix}${claimSuffix(text, end, 32)}`;
}

function claimPrefix(text: string, start: number, maxLength: number): string {
  const prefix = text.slice(Math.max(0, start - maxLength), start);
  const boundary = Math.max(
    prefix.lastIndexOf("。"),
    prefix.lastIndexOf("！"),
    prefix.lastIndexOf("？"),
    prefix.lastIndexOf("\n"),
    prefix.lastIndexOf("、"),
    prefix.lastIndexOf(","),
    prefix.lastIndexOf("；"),
    prefix.lastIndexOf(";")
  );
  return boundary >= 0 ? prefix.slice(boundary + 1) : prefix;
}

function sentencePrefix(text: string, start: number, maxLength: number): string {
  const prefix = text.slice(Math.max(0, start - maxLength), start);
  const boundary = Math.max(
    prefix.lastIndexOf("。"),
    prefix.lastIndexOf("！"),
    prefix.lastIndexOf("？"),
    prefix.lastIndexOf("\n"),
    prefix.lastIndexOf("；"),
    prefix.lastIndexOf(";")
  );
  return boundary >= 0 ? prefix.slice(boundary + 1) : prefix;
}

function isCalendarOrDurationToken(text: string, start: number, end: number): boolean {
  const suffix = text.slice(end, Math.min(text.length, end + 8));
  if (/^(?:年(?:度)?|月(?:期)?|日|か月(?:間|累計)?|カ月(?:間|累計)?|ヶ?月(?:間|累計)?|ケ月(?:間|累計)?|週間?|日間|年間|四半期|半期|期)/u.test(suffix)) {
    return true;
  }
  const prefix = text.slice(Math.max(0, start - 6), start);
  return /(?:第|Q)\s*$/iu.test(prefix) && /^(?:四半期|期)?/u.test(suffix);
}

function claimSuffix(text: string, end: number, maxLength: number): string {
  const suffix = text.slice(end, Math.min(text.length, end + maxLength));
  const boundary = suffix.search(/[。！？\n.、,；;]/u);
  return boundary >= 0 ? suffix.slice(0, boundary) : suffix;
}

function inferClaimPeriodRole(text: string, start: number, end: number): "current" | "comparison" | null {
  return inferTrailingPeriodRole(text, end) ?? inferPeriodRole(claimPrefix(text, start, 48));
}

function inferTrailingPeriodRole(text: string, end: number): "current" | "comparison" | null {
  const suffix = claimSuffix(text, end, 24);
  // A value followed by `(前年同期比 85.2%増)` is the current-period value.
  // Do not truncate the marker to `前年同期` and bind the amount to the
  // comparison fact merely because the growth annotation follows it.
  if (/^\s*[（(\[]?\s*(?:前年比|前年度比|前年同期比)\s*[-+−△▲]?\s*\d/iu.test(suffix)) {
    return "current";
  }
  // Restrict the suffix lookup to a role marker directly attached to the
  // claim. Looking across the whole suffix would let the next value's marker
  // misclassify the current claim in `current value ... prior value` prose.
  const attachedMarker = suffix.match(
    /^\s*[（(\[]?\s*(?:当期|今期|今回|直近|current|当四半期|前年同期|前年|前期|比較値|prior|previous|year[- ]ago)\s*[）)\]]?/iu
  )?.[0];
  return attachedMarker ? inferPeriodRole(attachedMarker) : null;
}

function inferSemanticLabel(context: string): string | null {
  const normalized = context.toLowerCase();
  const candidates: Array<[RegExp, string]> = [
    [/(?:営業キャッシュフロー|営業cf|operating cash flow|net cash provided by operating)/i, "operatingCashFlow"],
    [/(?:現金及び現金同等物|現金・現金同等物|cash and cash equivalents?)/i, "cashAndCashEquivalents"],
    [/(?:1年内返済予定の長期債務|流動部分の長期債務|current portion of long[- ]term debt)/i, "currentDebt"],
    [/(?:長期債務（非流動）|非流動の長期債務|非流動長期債務|noncurrent long[- ]term debt|long[- ]term debt noncurrent)/i, "longTermDebt"],
    [/(?:粗利益率|売上総利益率|gross margin)/i, "grossMargin"],
    [/(?:営業利益率|operating margin)/i, "operatingMargin"],
    [/(?:純利益率|net margin)/i, "netMargin"],
    [/(?:営業利益|operating income|operating profit)/i, "operatingIncome"],
    [/(?:純利益|純損失|net income|net loss)/i, "netIncome"],
    [/(?:eps|1株利益|一株利益|earnings per share)/i, "epsBasic"],
    [/(?:売上高|売上|収益|net sales|revenue)/i, "revenue"],
    [/(?:発行済(?:み)?株式数|shares outstanding|share count)/i, "sharesOutstanding"],
    [/(?:per|p\/e|price[- ]earnings|株価収益率)/i, "priceEarningsRatio"],
    [/(?:pbr|p\/b|price[- ]book|株価純資産倍率)/i, "priceBookRatio"],
    [/(?:debt[- ]to[- ]equity|負債資本倍率)/i, "debtToEquityRatio"],
    [/(?:純利息収入|net interest income|\bnii\b)/i, "netInterestIncome"],
    [/(?:ffo|funds from operations)/i, "fundsFromOperations"],
    [/(?:生産量|production volume)/i, "productionVolume"],
    [/(?:既存店売上|comparable sales|same-store sales)/i, "comparableSales"],
    [/(?:arr|annual recurring revenue)/i, "annualRecurringRevenue"]
  ];
  let best: { label: string; index: number } | null = null;
  for (const [pattern, label] of candidates) {
    const match = normalized.match(pattern);
    if (match?.index !== undefined && (!best || match.index > best.index)) {
      best = { label, index: match.index };
    }
  }
  return best?.label ?? null;
}

function inferPeriodRole(context: string): "current" | "comparison" | null {
  if (/(?:前年比|前年度比|前年同期比)[^。！？\n]{0,24}(?:増|減|上昇|下落|低下|改善|悪化)(?:の|で|とな|だった)/i.test(context)) {
    return "current";
  }
  const comparisonIndex = lastPatternIndex(context, /(?:前年同期|前年|前期|比較値|prior|previous|year[- ]ago)/giu);
  const currentIndex = lastPatternIndex(context, /(?:当期|今期|今回|直近|current|当四半期)/giu);
  if (comparisonIndex < 0 && currentIndex < 0) return null;
  return currentIndex > comparisonIndex ? "current" : "comparison";
}

function lastPatternIndex(text: string, pattern: RegExp): number {
  let result = -1;
  for (const match of text.matchAll(pattern)) {
    result = match.index ?? result;
  }
  return result;
}

function inferPeriodKind(context: string): FinancialFactPeriodKind | null {
  if (/(?:時点|期末|as of|balance sheet)/i.test(context)) {
    return "instant";
  }
  if (/(?:累計|year[- ]to[- ]date|\bytd\b|six months|nine months|6か月|9か月)/i.test(context)) {
    return "year_to_date";
  }
  if (/(?:四半期|quarter|three months|3か月|\bq[1-4]\b)/i.test(context)) {
    return "quarter";
  }
  if (/(?:通期|年間|年度|year ended|annual|\bfy\b)/i.test(context)) {
    return "annual";
  }
  return null;
}

function resolveDisplayUnit(scale: string | undefined): Exclude<FinancialDisplayUnit, "percent"> {
  const normalized = (scale ?? "").toLowerCase();
  if (normalized === "兆" || normalized === "trillion") {
    return "trillion";
  }
  if (normalized === "億") {
    return "oku";
  }
  if (normalized === "十億" || normalized === "billion") {
    return "billion";
  }
  if (normalized === "百万" || normalized === "million") {
    return "million";
  }
  return "raw";
}

function resolveCurrency(prefix: string | undefined, suffix: string | undefined): string | null {
  if (prefix === "$" || /USD|米ドル|ドル/i.test(suffix ?? "")) {
    return "USD";
  }
  if (prefix === "¥" || prefix === "￥" || /JPY|円/i.test(suffix ?? "")) {
    return "JPY";
  }
  return null;
}

function isNegative(sign: string | undefined, open: string | undefined, close: string | undefined): boolean {
  return Boolean(/[\-−△▲]/.test(sign ?? "") || (open === "(" && close === ")"));
}

function parseNumericToken(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function decimalPlaces(value: string): number {
  return value.includes(".") ? value.length - value.lastIndexOf(".") - 1 : 0;
}
