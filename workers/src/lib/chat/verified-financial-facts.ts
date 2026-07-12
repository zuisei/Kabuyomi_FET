import type {
  FilingCacheRecord,
  FinancialDisplayValue,
  FinancialFactPeriodKind,
  FinancialFactRole,
  FinancialFiscalQuarter,
  MetricSnapshot,
  SourceChunkRecord,
  VerifiedFinancialFact
} from "../../env";
import {
  buildFinancialDisplayValues,
  buildPercentageAliases,
  formatPercentage,
  parseFinancialUnit
} from "../financial-number-format";
import { metricLabel } from "../metrics";
import { extractMaterialNumericClaims } from "./material-numeric-claims";
import type { HistoricalFinancialFactEvidence } from "./historical-financial-fact";

export interface AdditionalVerifiedFactSource {
  sourceId: string;
  sourceLabel: string;
  sectionTitle?: string;
  text: string;
  sourceUrl?: string;
  historicalFinancialFact?: HistoricalFinancialFactEvidence;
}

export interface BuildVerifiedFinancialFactsOptions {
  metrics?: MetricSnapshot[];
  sourceChunks?: SourceChunkRecord[];
  additionalSources?: AdditionalVerifiedFactSource[];
}

export function buildVerifiedFinancialFacts(
  filing: FilingCacheRecord,
  options: BuildVerifiedFinancialFactsOptions = {}
): VerifiedFinancialFact[] {
  const metrics = options.metrics ?? filing.metrics;
  const sourceChunks = options.sourceChunks ?? filing.sourceChunks;
  const metricFacts = metrics.flatMap((metric) => buildMetricFacts(filing, metric, sourceChunks));
  const historicalMetricFacts = buildHistoricalMetricFacts(filing, options.additionalSources ?? []);
  const typedMetricFacts = [...metricFacts, ...historicalMetricFacts];
  const derivedMarginFacts = buildDerivedMarginFacts(filing, typedMetricFacts);
  // Only typed MetricSnapshot/XBRL values are verification authority. Raw
  // narrative regex matches and web excerpts remain source evidence, but they
  // must never be promoted to typed financial facts with filing-wide inferred
  // periods. Unsupported material numbers therefore fail closed.
  return dedupeFacts([...typedMetricFacts, ...derivedMarginFacts]);
}

function buildDerivedMarginFacts(
  filing: FilingCacheRecord,
  metricFacts: VerifiedFinancialFact[]
): VerifiedFinancialFact[] {
  const revenueFacts = metricFacts.filter((fact) => fact.semanticLabel === "revenue");
  const definitions: Array<{
    numeratorLabel: "operatingIncome" | "netIncome";
    semanticLabel: "operatingMargin" | "netMargin";
    semanticLabelJa: string;
  }> = [
    { numeratorLabel: "operatingIncome", semanticLabel: "operatingMargin", semanticLabelJa: "営業利益率" },
    { numeratorLabel: "netIncome", semanticLabel: "netMargin", semanticLabelJa: "純利益率" }
  ];
  const results: VerifiedFinancialFact[] = [];

  for (const definition of definitions) {
    const numeratorFacts = metricFacts.filter((fact) => fact.semanticLabel === definition.numeratorLabel);
    const byRole = new Map<FinancialFactRole, VerifiedFinancialFact>();

    for (const role of ["current", "comparison"] as const) {
      const numerator = numeratorFacts.find((fact) => fact.role === role);
      if (!numerator) continue;
      const denominator = revenueFacts.find((fact) =>
        fact.role === role &&
        financialFactScopesMatch(numerator, fact)
      );
      if (!denominator || denominator.canonicalValue === 0) continue;

      const resultPercent = (numerator.canonicalValue / denominator.canonicalValue) * 100;
      if (!Number.isFinite(resultPercent)) continue;
      const factId = createFactId({
        filingKey: filing.filingKey,
        concept: `derived:${definition.semanticLabel}`,
        sourceId: numerator.sourceId,
        role,
        periodEnd: numerator.periodEnd,
        unit: "percent",
        canonicalValue: resultPercent
      });
      const fact = createVerifiedFact({
        factId,
        concept: `derived:${definition.semanticLabel}`,
        semanticLabel: definition.semanticLabel,
        semanticLabelJa: definition.semanticLabelJa,
        rawValue: resultPercent,
        unit: "percent",
        sourceScale: 1,
        canonicalValue: resultPercent,
        periodStart: numerator.periodStart,
        periodEnd: numerator.periodEnd,
        fiscalYear: numerator.fiscalYear,
        fiscalQuarter: numerator.fiscalQuarter,
        periodKind: numerator.periodKind,
        role,
        derivedPercentage: {
          kind: "derived_ratio",
          formula: "(numerator/denominator)*100",
          numeratorFactId: numerator.factId,
          denominatorFactId: denominator.factId,
          numeratorValue: numerator.canonicalValue,
          denominatorValue: denominator.canonicalValue,
          resultPercent
        },
        sourceId: numerator.sourceId,
        sourceUrl: numerator.sourceUrl
      });
      byRole.set(role, fact);
      results.push(fact);
    }

    const current = byRole.get("current");
    const comparison = byRole.get("comparison");
    if (current && comparison) {
      current.comparisonFactId = comparison.factId;
      current.comparisonValue = comparison.canonicalValue;
    }
  }

  return results;
}

function financialFactScopesMatch(numerator: VerifiedFinancialFact, denominator: VerifiedFinancialFact): boolean {
  if (
    numerator.currency !== denominator.currency ||
    numerator.scope !== denominator.scope ||
    numerator.periodEnd !== denominator.periodEnd ||
    numerator.periodKind !== denominator.periodKind ||
    numerator.fiscalYear !== denominator.fiscalYear ||
    numerator.fiscalQuarter !== denominator.fiscalQuarter
  ) {
    return false;
  }
  if ((numerator.periodStart === null) !== (denominator.periodStart === null)) {
    return false;
  }
  return numerator.periodStart === denominator.periodStart;
}

function buildMetricFacts(
  filing: FilingCacheRecord,
  metric: MetricSnapshot,
  sourceChunks: SourceChunkRecord[]
): VerifiedFinancialFact[] {
  const source = selectMetricSource(metric, sourceChunks, "current");
  const sourceId = source?.sourceId ?? `VF-${stableFactHash(`${filing.filingKey}|${metric.tagUsed}|current-source`)}`;
  const sourceUrl = source?.sourceUrl ?? filing.primaryDocumentUrl;
  const comparisonConcept = metric.comparisonTagUsed ?? metric.tagUsed;
  const comparisonSource = metric.comparisonValue === undefined
    ? undefined
    : selectMetricSource(metric, sourceChunks, "comparison");
  const comparisonSourceId = comparisonSource?.sourceId ?? (
    metric.comparisonSourceUrl
      && (metric.comparisonSourceUrl !== sourceUrl || comparisonConcept !== metric.tagUsed)
      ? `VF-${stableFactHash(`${filing.filingKey}|${comparisonConcept}|${metric.comparisonSourceUrl}|comparison-source`)}`
      : sourceId
  );
  const comparisonSourceUrl = comparisonSource?.sourceUrl ?? metric.comparisonSourceUrl ?? sourceUrl;
  const currentPeriodEnd = metric.periodEnd || filing.periodOfReport;
  const comparisonPeriodEnd = metric.comparisonPeriodEnd ?? shiftIsoYear(currentPeriodEnd, -1) ?? currentPeriodEnd;
  const periodKind = metric.periodKind ?? inferMetricPeriodKind(filing, metric);
  const fiscalYear = metric.fiscalYear ?? yearFromIso(currentPeriodEnd);
  const fiscalQuarter = metric.fiscalQuarter ?? (periodKind === "annual" ? "FY" : null);
  const comparisonPeriodKind = metric.comparisonPeriodKind ?? inferComparisonMetricPeriodKind(metric);
  const comparisonFiscalYear = metric.comparisonFiscalYear ?? yearFromIso(comparisonPeriodEnd);
  const comparisonFiscalQuarter = metric.comparisonFiscalQuarter ?? (comparisonPeriodKind === "annual" ? "FY" : null);
  const comparisonId = metric.comparisonValue === undefined
    ? undefined
    : createFactId({
      filingKey: filing.filingKey,
      concept: comparisonConcept,
      sourceId: comparisonSourceId,
      role: "comparison",
      periodEnd: comparisonPeriodEnd,
      unit: metric.unit,
      canonicalValue: metric.comparisonValue
    });
  const currentId = createFactId({
    filingKey: filing.filingKey,
    concept: metric.tagUsed,
    sourceId,
    role: "current",
    periodEnd: currentPeriodEnd,
    unit: metric.unit,
    canonicalValue: metric.value
  });

  const comparisonFact = metric.comparisonValue === undefined || !comparisonId
    ? null
    : createVerifiedFact({
      factId: comparisonId,
      concept: comparisonConcept,
      semanticLabel: metric.logicalName,
      semanticLabelJa: metricLabel(metric.logicalName),
      rawValue: metric.comparisonValue,
      unit: metric.unit,
      sourceScale: 1,
      canonicalValue: metric.comparisonValue,
      periodStart: metric.comparisonPeriodStart ?? null,
      periodEnd: comparisonPeriodEnd,
      fiscalYear: comparisonFiscalYear,
      fiscalQuarter: comparisonFiscalQuarter,
      periodKind: comparisonPeriodKind,
      role: "comparison",
      comparisonValue: undefined,
      sourceId: comparisonSourceId,
      sourceUrl: comparisonSourceUrl
    });

  const signCrossingComparison = Boolean(comparisonFact && valuesCrossZero(metric.value, comparisonFact.canonicalValue));
  const derivedPercentage = comparisonFact
    && comparisonFact.canonicalValue !== 0
    && !signCrossingComparison
    ? {
      kind: "derived_change" as const,
      formula: "((current-comparison)/abs(comparison))*100" as const,
      currentFactId: currentId,
      comparisonFactId: comparisonFact.factId,
      currentValue: metric.value,
      comparisonValue: comparisonFact.canonicalValue,
      resultPercent: ((metric.value - comparisonFact.canonicalValue) / Math.abs(comparisonFact.canonicalValue)) * 100
    }
    : metric.yoyPercent === undefined || signCrossingComparison
      ? undefined
      : {
        kind: "reported" as const,
        formula: "source_reported" as const,
        currentFactId: currentId,
        currentValue: metric.value,
        resultPercent: metric.yoyPercent
      };
  const currentFact = createVerifiedFact({
    factId: currentId,
    concept: metric.tagUsed,
    semanticLabel: metric.logicalName,
    semanticLabelJa: metricLabel(metric.logicalName),
    rawValue: metric.value,
    unit: metric.unit,
    sourceScale: 1,
    canonicalValue: metric.value,
    periodStart: metric.periodStart ?? null,
    periodEnd: currentPeriodEnd,
    fiscalYear,
    fiscalQuarter,
    periodKind,
    role: "current",
    comparisonFactId: comparisonFact?.factId,
    comparisonValue: comparisonFact?.canonicalValue,
    derivedPercentage,
    sourceId,
    sourceUrl
  });

  return comparisonFact ? [currentFact, comparisonFact] : [currentFact];
}

function buildHistoricalMetricFacts(
  filing: FilingCacheRecord,
  sources: AdditionalVerifiedFactSource[]
): VerifiedFinancialFact[] {
  const facts = sources.flatMap((source) => {
    const typed = source.historicalFinancialFact;
    if (!typed) {
      return [];
    }
    const factId = createFactId({
      filingKey: typed.filingKey,
      concept: typed.tagUsed,
      sourceId: source.sourceId,
      role: typed.role,
      periodEnd: typed.periodEnd,
      unit: typed.unit,
      canonicalValue: typed.value
    });
    return [createVerifiedFact({
      factId,
      concept: typed.tagUsed,
      semanticLabel: typed.logicalName,
      semanticLabelJa: metricLabel(typed.logicalName),
      rawValue: typed.value,
      unit: typed.unit,
      sourceScale: 1,
      canonicalValue: typed.value,
      periodStart: typed.periodStart,
      periodEnd: typed.periodEnd,
      fiscalYear: typed.fiscalYear,
      fiscalQuarter: typed.fiscalQuarter,
      periodKind: typed.periodKind,
      role: typed.role,
      sourceId: source.sourceId,
      sourceUrl: source.sourceUrl ?? filing.primaryDocumentUrl
    })];
  });

  for (const current of facts.filter((fact) => fact.role === "current")) {
    const comparison = facts.find((fact) =>
      fact.role === "comparison"
      && fact.semanticLabel === current.semanticLabel
      && fact.unit === current.unit
    );
    if (!comparison) {
      continue;
    }
    current.comparisonFactId = comparison.factId;
    current.comparisonValue = comparison.canonicalValue;
    if (comparison.canonicalValue !== 0 && !valuesCrossZero(current.canonicalValue, comparison.canonicalValue)) {
      current.derivedPercentage = {
        kind: "derived_change",
        formula: "((current-comparison)/abs(comparison))*100",
        currentFactId: current.factId,
        comparisonFactId: comparison.factId,
        currentValue: current.canonicalValue,
        comparisonValue: comparison.canonicalValue,
        resultPercent: ((current.canonicalValue - comparison.canonicalValue) / Math.abs(comparison.canonicalValue)) * 100
      };
    }
  }

  return facts;
}

function valuesCrossZero(current: number, comparison: number): boolean {
  return (current < 0 && comparison >= 0) || (current >= 0 && comparison < 0);
}

function buildSourceFacts(
  filing: FilingCacheRecord,
  source: AdditionalVerifiedFactSource
): VerifiedFinancialFact[] {
  const claims = extractMaterialNumericClaims(source.text);
  return claims.map((claim, index) => {
    const semanticLabel = claim.semanticLabel ?? normalizeSemanticLabel(source.sectionTitle ?? source.sourceLabel);
    const periodKind = claim.periodKind ?? inferSourcePeriodKind(`${source.sectionTitle ?? ""} ${source.sourceLabel} ${source.text}`);
    const role: FinancialFactRole = claim.periodRole ?? "reported";
    const unit = claim.kind === "percentage" ? "percent" : claim.unit;
    const factId = createFactId({
      filingKey: filing.filingKey,
      concept: source.sectionTitle ?? source.sourceLabel,
      sourceId: source.sourceId,
      role,
      periodEnd: filing.periodOfReport,
      unit,
      canonicalValue: claim.canonicalValue,
      occurrence: index
    });
    if (claim.kind === "percentage") {
      const aliases = buildPercentageAliases(claim.canonicalValue);
      const display: FinancialDisplayValue = {
        displayUnit: "percent",
        value: claim.canonicalValue,
        scale: 1,
        precision: Math.max(1, claim.decimals),
        ja: formatPercentage(claim.canonicalValue, Math.max(1, claim.decimals)),
        aliases
      };
      return {
        factId,
        concept: source.sectionTitle ?? source.sourceLabel,
        semanticLabel,
        semanticLabelJa: source.sectionTitle ?? source.sourceLabel,
        rawValue: claim.numericValue,
        currency: null,
        unit: "percent",
        sourceScale: 1,
        canonicalValue: claim.canonicalValue,
        allowedDisplayUnits: ["percent"],
        displayValues: [display],
        displayAliases: dedupeStrings([claim.raw.trim(), ...aliases]),
        periodStart: null,
        periodEnd: filing.periodOfReport,
        fiscalYear: yearFromIso(filing.periodOfReport),
        fiscalQuarter: periodKind === "annual" ? "FY" : null,
        periodKind,
        role,
        scope: "company_total",
        derivedPercentage: {
          kind: "reported",
          formula: "source_reported",
          resultPercent: claim.canonicalValue
        },
        sourceId: source.sourceId,
        sourceUrl: source.sourceUrl ?? filing.primaryDocumentUrl
      } satisfies VerifiedFinancialFact;
    }

    return createVerifiedFact({
      factId,
      concept: source.sectionTitle ?? source.sourceLabel,
      semanticLabel,
      semanticLabelJa: source.sectionTitle ?? source.sourceLabel,
      rawValue: claim.numericValue,
      unit,
      sourceScale: claim.displayUnit === "percent" ? 1 : claim.canonicalValue / (claim.numericValue || 1),
      canonicalValue: claim.canonicalValue,
      periodStart: null,
      periodEnd: filing.periodOfReport,
      fiscalYear: yearFromIso(filing.periodOfReport),
      fiscalQuarter: periodKind === "annual" ? "FY" : null,
      periodKind,
      role,
      sourceId: source.sourceId,
      sourceUrl: source.sourceUrl ?? filing.primaryDocumentUrl,
      extraAliases: [claim.raw.trim()]
    });
  });
}

function createVerifiedFact(input: {
  factId: string;
  concept: string;
  semanticLabel: string;
  semanticLabelJa: string;
  rawValue: number;
  unit: string;
  sourceScale: number;
  canonicalValue: number;
  periodStart: string | null;
  periodEnd: string;
  fiscalYear: number | null;
  fiscalQuarter: FinancialFiscalQuarter;
  periodKind: FinancialFactPeriodKind;
  role: FinancialFactRole;
  scope?: VerifiedFinancialFact["scope"];
  comparisonFactId?: string;
  comparisonValue?: number;
  derivedPercentage?: VerifiedFinancialFact["derivedPercentage"];
  sourceId: string;
  sourceUrl: string;
  extraAliases?: string[];
}): VerifiedFinancialFact {
  const parsedUnit = parseFinancialUnit(input.unit);
  const displayValues = buildFinancialDisplayValues(input.canonicalValue, input.unit);
  return {
    factId: input.factId,
    concept: input.concept,
    semanticLabel: input.semanticLabel,
    semanticLabelJa: input.semanticLabelJa,
    rawValue: input.rawValue,
    currency: parsedUnit.currency,
    unit: parsedUnit.canonicalUnit,
    sourceScale: input.sourceScale,
    canonicalValue: input.canonicalValue,
    allowedDisplayUnits: displayValues.map((display) => display.displayUnit),
    displayValues,
    displayAliases: dedupeStrings([
      ...displayValues.flatMap((display) => display.aliases),
      ...(input.extraAliases ?? [])
    ]),
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    fiscalYear: input.fiscalYear,
    fiscalQuarter: input.fiscalQuarter,
    periodKind: input.periodKind,
    role: input.role,
    scope: input.scope ?? "company_total",
    ...(input.comparisonFactId ? { comparisonFactId: input.comparisonFactId } : {}),
    ...(input.comparisonValue !== undefined ? { comparisonValue: input.comparisonValue } : {}),
    ...(input.derivedPercentage ? { derivedPercentage: input.derivedPercentage } : {}),
    sourceId: input.sourceId,
    sourceUrl: input.sourceUrl
  };
}

function selectMetricSource(
  metric: MetricSnapshot,
  sourceChunks: SourceChunkRecord[],
  role: "current" | "comparison"
): SourceChunkRecord | undefined {
  const tag = role === "comparison" ? (metric.comparisonTagUsed ?? metric.tagUsed) : metric.tagUsed;
  const roleCandidates = sourceChunks.filter(
    (source) => source.sectionType === "xbrl_metric" && source.tagName === tag && source.metricRole === role
  );
  const legacyCandidates = sourceChunks.filter(
    (source) => source.sectionType === "xbrl_metric" && source.tagName === tag && source.metricRole === undefined
  );
  const identitySafeLegacyCandidates = role === "comparison" && metric.comparisonSourceUrl
    ? legacyCandidates.filter((source) => source.sourceUrl === metric.comparisonSourceUrl)
    : legacyCandidates;
  const candidates = roleCandidates.length > 0 ? roleCandidates : identitySafeLegacyCandidates;
  if (role === "comparison" && candidates.length === 0) {
    const currentSource = selectMetricSource(metric, sourceChunks, "current");
    const sameSourceIdentity = !metric.comparisonSourceUrl
      || (Boolean(currentSource?.sourceUrl) && metric.comparisonSourceUrl === currentSource?.sourceUrl);
    if (sameSourceIdentity && tag === metric.tagUsed) {
      return currentSource;
    }
  }
  if (candidates.length <= 1) {
    return candidates[0];
  }
  const canonicalToken = String(role === "comparison" ? metric.comparisonValue : metric.value);
  return candidates.find((source) => source.text.replace(/,/g, "").includes(canonicalToken)) ??
    [...candidates].sort((left, right) => left.sourceId.localeCompare(right.sourceId))[0];
}

function inferMetricPeriodKind(filing: FilingCacheRecord, metric: MetricSnapshot): FinancialFactPeriodKind {
  if (/(?:assets|liabilities|cashandcashequivalents|debt|stockholdersequity)/i.test(metric.tagUsed)) {
    return "instant";
  }
  return filing.formType === "10-K" ? "annual" : "quarter";
}

function inferComparisonMetricPeriodKind(metric: MetricSnapshot): FinancialFactPeriodKind {
  if (/(?:assets|liabilities|cashandcashequivalents|debt|stockholdersequity)/i.test(metric.tagUsed)) {
    return "instant";
  }
  if (!metric.comparisonPeriodStart) return "unknown";
  const start = Date.parse(metric.comparisonPeriodStart);
  const end = Date.parse(metric.comparisonPeriodEnd ?? "");
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "unknown";
  const durationDays = Math.round((end - start) / (24 * 60 * 60 * 1_000));
  if (durationDays <= 120) return "quarter";
  if (durationDays >= 320) return "annual";
  return "year_to_date";
}

function inferSourcePeriodKind(text: string): FinancialFactPeriodKind {
  if (/(?:as of|balance sheet|時点|期末|assets|liabilities|debt|cash and cash equivalents)/i.test(text)) {
    return "instant";
  }
  if (/(?:year[- ]to[- ]date|\bytd\b|six months|nine months|累計|6か月|9か月)/i.test(text)) {
    return "year_to_date";
  }
  if (/(?:three months|quarter|四半期|3か月|\bq[1-4]\b)/i.test(text)) {
    return "quarter";
  }
  if (/(?:year ended|annual|通期|年間|\bfy\b)/i.test(text)) {
    return "annual";
  }
  return "unknown";
}

function createFactId(input: {
  filingKey: string;
  concept: string;
  sourceId: string;
  role: FinancialFactRole;
  periodEnd: string;
  unit: string;
  canonicalValue: number;
  occurrence?: number;
}): string {
  const stableKey = [
    "v1",
    input.filingKey,
    input.concept,
    input.sourceId,
    input.role,
    input.periodEnd,
    input.unit,
    String(input.canonicalValue),
    String(input.occurrence ?? 0)
  ].join("|");
  return `VF-${stableFactHash(stableKey)}`;
}

function stableFactHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizeSemanticLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\p{L}]+/gu, "_").replace(/^_+|_+$/g, "") || "reported_metric";
}

function yearFromIso(value: string): number | null {
  const match = /^(\d{4})-/.exec(value);
  return match ? Number(match[1]) : null;
}

function shiftIsoYear(value: string, offset: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  return `${Number(match[1]) + offset}-${match[2]}-${match[3]}`;
}

function dedupeFacts(facts: VerifiedFinancialFact[]): VerifiedFinancialFact[] {
  const byId = new Map<string, VerifiedFinancialFact>();
  for (const fact of facts) {
    byId.set(fact.factId, fact);
  }
  return [...byId.values()];
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
