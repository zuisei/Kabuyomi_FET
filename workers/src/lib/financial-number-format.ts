import type { FinancialDisplayUnit, FinancialDisplayValue } from "../env";

const DISPLAY_SCALES: Record<Exclude<FinancialDisplayUnit, "percent">, number> = {
  raw: 1,
  million: 1_000_000,
  billion: 1_000_000_000,
  oku: 100_000_000,
  trillion: 1_000_000_000_000
};

export interface ParsedFinancialUnit {
  currency: string | null;
  canonicalUnit: string;
  isPerShare: boolean;
}

export function parseFinancialUnit(unit: string): ParsedFinancialUnit {
  const normalized = unit.trim();
  const upper = normalized.toUpperCase();
  if (upper === "USD/SHARES" || upper === "USD/SHARE") {
    return { currency: "USD", canonicalUnit: "USD/shares", isPerShare: true };
  }
  if (upper === "USD") {
    return { currency: "USD", canonicalUnit: "USD", isPerShare: false };
  }
  if (upper === "JPY") {
    return { currency: "JPY", canonicalUnit: "JPY", isPerShare: false };
  }
  return { currency: null, canonicalUnit: normalized || "number", isPerShare: false };
}

export function buildFinancialDisplayValues(value: number, unit: string): FinancialDisplayValue[] {
  const parsed = parseFinancialUnit(unit);
  if (!Number.isFinite(value)) {
    return [];
  }
  if (parsed.isPerShare) {
    const formatted = formatDisplayNumber(value, 2);
    return [{
      displayUnit: "raw",
      value,
      scale: 1,
      precision: 2,
      ja: `${formatted}ドル/株`,
      aliases: dedupeStrings([
        `${formatted}ドル/株`,
        `${formatted} USD/share`,
        `${formatted} USD/shares`,
        `$${formatted}`
      ])
    }];
  }

  if (parsed.currency === "USD") {
    return (["raw", "million", "billion", "oku", "trillion"] as const).map((displayUnit) =>
      buildUsdDisplayValue(value, displayUnit)
    );
  }

  const formatted = formatDisplayNumber(value, 2);
  return [{
    displayUnit: "raw",
    value,
    scale: 1,
    precision: 2,
    ja: `${formatted} ${parsed.canonicalUnit}`.trim(),
    aliases: [`${formatted} ${parsed.canonicalUnit}`.trim()]
  }];
}

export function preferredFinancialDisplay(value: number, unit: string): FinancialDisplayValue {
  const displays = buildFinancialDisplayValues(value, unit);
  const parsed = parseFinancialUnit(unit);
  if (parsed.isPerShare || parsed.currency !== "USD") {
    return displays[0]!;
  }
  const abs = Math.abs(value);
  const preferredUnit: FinancialDisplayUnit = abs >= 1_000_000_000_000
    ? "trillion"
    : abs >= 100_000_000
      ? "oku"
      : abs >= 1_000_000
        ? "million"
        : "raw";
  return displays.find((display) => display.displayUnit === preferredUnit) ?? displays[0]!;
}

export function formatVerifiedFinancialValue(value: number, unit: string): string {
  return preferredFinancialDisplay(value, unit).ja;
}

export function displayScale(displayUnit: FinancialDisplayUnit): number {
  return displayUnit === "percent" ? 1 : DISPLAY_SCALES[displayUnit];
}

export function canonicalValueFromDisplay(value: number, displayUnit: FinancialDisplayUnit): number {
  return value * displayScale(displayUnit);
}

export function displayRoundingTolerance(displayUnit: FinancialDisplayUnit, decimals: number): number {
  const safeDecimals = Math.max(0, Math.min(decimals, 8));
  return displayScale(displayUnit) * 0.5 * (10 ** -safeDecimals);
}

export function formatPercentage(value: number, precision = 1): string {
  const rounded = formatDisplayNumber(Math.abs(value), precision);
  return `${rounded}%${value >= 0 ? "増" : "減"}`;
}

export function buildPercentageAliases(value: number): string[] {
  const magnitudeOne = formatDisplayNumber(Math.abs(value), 1);
  const magnitudeTwo = formatDisplayNumber(Math.abs(value), 2);
  const sign = value >= 0 ? "+" : "-";
  const directionJa = value >= 0 ? "増" : "減";
  const directionEn = value >= 0 ? "increase" : "decrease";
  return dedupeStrings([
    `${magnitudeTwo}%${directionJa}`,
    `${magnitudeOne}%${directionJa}`,
    `${sign}${magnitudeTwo}%`,
    `${sign}${magnitudeOne}%`,
    `${magnitudeTwo}% ${directionEn}`,
    `${magnitudeOne}% ${directionEn}`
  ]);
}

export function formatDisplayNumber(value: number, maximumFractionDigits: number): string {
  const rounded = roundTo(value, maximumFractionDigits);
  return new Intl.NumberFormat("ja-JP", {
    useGrouping: true,
    minimumFractionDigits: 0,
    maximumFractionDigits
  }).format(rounded);
}

function buildUsdDisplayValue(
  canonicalValue: number,
  displayUnit: Exclude<FinancialDisplayUnit, "percent">
): FinancialDisplayValue {
  const scale = DISPLAY_SCALES[displayUnit];
  const value = canonicalValue / scale;
  const precision = displayUnit === "raw" ? 2 : displayUnit === "million" ? 2 : 2;
  const exact = formatDisplayNumber(value, precision);
  const oneDecimal = formatDisplayNumber(value, 1);
  const sixDecimals = formatDisplayNumber(value, 6);
  const suffixJa = displayUnit === "raw"
    ? " USD"
    : displayUnit === "million"
      ? "百万ドル"
      : displayUnit === "billion"
        ? "十億ドル"
        : displayUnit === "oku"
          ? "億ドル"
          : "兆ドル";
  const englishUnit = displayUnit === "raw"
    ? "USD"
    : displayUnit === "million"
      ? "million USD"
      : displayUnit === "billion"
        ? "billion USD"
        : displayUnit === "oku"
          ? "hundred-million USD"
          : "trillion USD";
  // The customer-facing fallback has historically used one decimal for scaled
  // financial amounts. Keep that stable while retaining the more precise
  // forms as accepted aliases for verification.
  const ja = `${oneDecimal}${suffixJa}`.trim();
  const aliases = dedupeStrings([
    ja,
    `${oneDecimal}${suffixJa}`.trim(),
    `${sixDecimals}${suffixJa}`.trim(),
    `${exact} ${englishUnit}`,
    `${oneDecimal} ${englishUnit}`,
    displayUnit === "raw" ? `$${exact}` : `$${exact} ${displayUnit}`
  ]);
  return { displayUnit, value, scale, precision: displayUnit === "raw" ? precision : 1, ja, aliases };
}

function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) {
    return value;
  }
  const factor = 10 ** digits;
  const adjusted = value >= 0 ? value + Number.EPSILON : value - Number.EPSILON;
  return Math.round(adjusted * factor) / factor;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
