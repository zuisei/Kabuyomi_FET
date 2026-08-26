import type { FinancialFactPeriodKind, VerifiedFinancialFact } from "../../env";
import {
  displayRoundingTolerance,
  formatPercentage,
  preferredFinancialDisplay
} from "../financial-number-format";
import { extractMaterialNumericClaims, type MaterialNumericClaim } from "./material-numeric-claims";

export type NumericAlignmentStatus = "not_applicable" | "passed" | "repaired" | "blocked";
export type NumericAlignmentFailureLabel =
  | "material_numeric_error"
  | "unit_mismatch"
  | "currency_mismatch"
  | "sign_error"
  | "period_mismatch"
  | "unsupported_numeric_claim"
  | "source_identity_repaired"
  | "excerpt_supported_numeric_claim";

export interface NumericAlignmentResult {
  status: NumericAlignmentStatus;
  answer: string;
  labels: NumericAlignmentFailureLabel[];
  claimCount: number;
  verifiedClaimCount: number;
  repairedClaimCount: number;
  blockedClaimCount: number;
  matchedFactIds: string[];
  requiredSourceIds: string[];
  claimBindings: NumericAlignmentClaimBinding[];
}

export interface NumericAlignmentClaimBinding {
  claimStart: number;
  claimEnd: number;
  claimKind: MaterialNumericClaim["kind"];
  factId: string;
  sourceId: string;
  semanticLabel: string;
  periodStart: string | null;
  periodEnd: string;
  role: VerifiedFinancialFact["role"] | "excerpt";
  scope: VerifiedFinancialFact["scope"] | "excerpt";
  outcome: "passed" | "repaired" | "blocked";
}

interface ClaimResolution {
  claim: MaterialNumericClaim;
  outcome: "ignored" | "passed" | "repaired" | "blocked";
  fact?: VerifiedFinancialFact;
  /** XBRL に無く、引用済み本文抜粋の中に同じ数値があった場合の出どころ。 */
  excerptSourceId?: string | null;
  replacement?: string;
  labels: NumericAlignmentFailureLabel[];
}

interface PercentageCandidate {
  fact: VerifiedFinancialFact;
  value: number;
}

export function validateNumericAlignment(input: {
  answer: string;
  facts: VerifiedFinancialFact[];
  citedSourceIds: string[];
  /**
   * 引用したソース本文。ここに同じ数値が書かれている主張は「出典あり」として通す。
   * 検証済み事実(XBRL)だけを照合すると、MD&A 本文にしか無い数字
   * (例: 「AWS sales increased 17%」)を含む正しい回答が丸ごと捨てられ、
   * 汎用の「特定できません」に差し替わっていた(2026-08-22 実機レビュー)。
   * 捏造対策は弱めない — 引用文の中に実在する数値表記にしか一致しない。
   */
  citedSourceTexts?: string[];
  /**
   * モデルが見た文脈チャンク(引用していないものを含む)。ここで一致した数値は
   * 出典ありとして通し、引用されていなければそのチャンクを requiredSourceIds に
   * 足して根拠チップに出す — 数字の出典が画面に見える、は守る。
   */
  contextSources?: Array<{ sourceId: string; text: string }>;
}): NumericAlignmentResult {
  const claims = extractMaterialNumericClaims(input.answer);
  if (claims.length === 0) {
    return {
      status: "not_applicable",
      answer: input.answer,
      labels: [],
      claimCount: 0,
      verifiedClaimCount: 0,
      repairedClaimCount: 0,
      blockedClaimCount: 0,
      matchedFactIds: [],
      requiredSourceIds: [],
      claimBindings: []
    };
  }

  const cited = new Set(input.citedSourceIds);
  const excerptSources: Array<{ sourceId: string | null; text: string }> = [
    ...(input.citedSourceTexts ?? []).map((text) => ({ sourceId: null, text })),
    ...(input.contextSources ?? [])
  ];
  const excerptRequiredSourceIds: string[] = [];
  const surfaceValidatedResolutions = claims
    .map((claim) => resolveClaim(claim, input.facts, cited))
    .map((resolution) => validateClaimBindingSurface(input.answer, resolution))
    .map((resolution) => {
      if (resolution.outcome !== "blocked") return resolution;
      const supporting = excerptSupportingClaim(resolution.claim, excerptSources);
      if (!supporting) return resolution;
      if (supporting.sourceId && !cited.has(supporting.sourceId)) {
        excerptRequiredSourceIds.push(supporting.sourceId);
      }
      return excerptSupportedResolution(resolution.claim, supporting.sourceId);
    });
  const resolutions = blockCurrentComparisonRoleCollapse(surfaceValidatedResolutions, input.facts);
  const blocked = resolutions.filter((resolution) => resolution.outcome === "blocked");
  const repaired = resolutions.filter((resolution) => resolution.outcome === "repaired");
  const passed = resolutions.filter((resolution) => resolution.outcome === "passed");
  const applicableCount = blocked.length + repaired.length + passed.length;
  const labels = dedupe(resolutions.flatMap((resolution) => resolution.labels));
  const matchedFacts = resolutions.flatMap((resolution) => resolution.fact ? [resolution.fact] : []);
  const evidenceFacts = dedupeFactsById(
    resolutions.flatMap((resolution) => evidenceFactsForResolution(resolution, input.facts))
  );
  const requiredSourceIds = dedupe([
    ...evidenceFacts.map((fact) => fact.sourceId).filter((sourceId) => !cited.has(sourceId)),
    ...excerptRequiredSourceIds
  ]);

  if (blocked.length > 0) {
    return {
      status: "blocked",
      answer: buildBlockedFallback(input.facts, matchedFacts, cited),
      labels: dedupe([...labels, "unsupported_numeric_claim"]),
      claimCount: applicableCount,
      verifiedClaimCount: passed.length,
      repairedClaimCount: repaired.length,
      blockedClaimCount: blocked.length,
      matchedFactIds: dedupe(matchedFacts.map((fact) => fact.factId)),
      requiredSourceIds,
      claimBindings: buildClaimBindings(resolutions)
    };
  }

  let answer = input.answer;
  for (const resolution of [...repaired].sort((left, right) => right.claim.start - left.claim.start)) {
    if (!resolution.replacement) {
      continue;
    }
    answer = `${answer.slice(0, resolution.claim.start)}${resolution.replacement}${answer.slice(resolution.claim.end)}`;
  }
  const sourceRepairCount = requiredSourceIds.length;
  const status: NumericAlignmentStatus = repaired.length > 0 || sourceRepairCount > 0 ? "repaired" : "passed";
  return {
    status,
    answer,
    labels: sourceRepairCount > 0 ? dedupe([...labels, "source_identity_repaired"]) : labels,
    claimCount: applicableCount,
    verifiedClaimCount: passed.length + repaired.length,
    repairedClaimCount: repaired.length + sourceRepairCount,
    blockedClaimCount: 0,
    matchedFactIds: dedupe(matchedFacts.map((fact) => fact.factId)),
    requiredSourceIds,
    claimBindings: buildClaimBindings(resolutions)
  };
}

function evidenceFactsForResolution(
  resolution: ClaimResolution,
  allFacts: VerifiedFinancialFact[]
): VerifiedFinancialFact[] {
  const fact = resolution.fact;
  if (!fact) return [];
  const facts = [fact];
  if (resolution.claim.kind !== "percentage" && fact.unit !== "percent") {
    return facts;
  }

  const provenance = fact.derivedPercentage;
  for (const factId of [
    provenance?.currentFactId,
    provenance?.comparisonFactId,
    provenance?.numeratorFactId,
    provenance?.denominatorFactId
  ]) {
    if (!factId) continue;
    const referenced = allFacts.find((candidate) => candidate.factId === factId);
    if (referenced) facts.push(referenced);
  }
  return facts;
}

function dedupeFactsById(facts: VerifiedFinancialFact[]): VerifiedFinancialFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    if (seen.has(fact.factId)) return false;
    seen.add(fact.factId);
    return true;
  });
}

function blockCurrentComparisonRoleCollapse(
  resolutions: ClaimResolution[],
  facts: VerifiedFinancialFact[]
): ClaimResolution[] {
  return resolutions.map((resolution) => {
    const label = resolution.claim.semanticLabel;
    if (!label || resolution.claim.periodRole !== "comparison") return resolution;
    const currentClaim = resolutions.find((candidate) =>
      candidate !== resolution &&
      candidate.claim.semanticLabel === label &&
      candidate.claim.periodRole === "current"
    );
    if (!currentClaim || Math.abs(currentClaim.claim.canonicalValue - resolution.claim.canonicalValue) > currencyTolerance(resolution.claim)) {
      return resolution;
    }
    const currentFact = facts.find((fact) => fact.semanticLabel === label && fact.role === "current");
    const comparisonFact = facts.find((fact) => fact.semanticLabel === label && fact.role === "comparison");
    if (!currentFact || !comparisonFact || Math.abs(currentFact.canonicalValue - comparisonFact.canonicalValue) <= currencyTolerance(resolution.claim)) {
      return resolution;
    }
    return {
      ...resolution,
      outcome: "blocked",
      replacement: undefined,
      labels: dedupe([...resolution.labels, "period_mismatch"])
    };
  });
}

function buildClaimBindings(resolutions: ClaimResolution[]): NumericAlignmentClaimBinding[] {
  return resolutions.flatMap((resolution): NumericAlignmentClaimBinding[] => {
    if (resolution.outcome === "ignored") {
      return [];
    }
    if (!resolution.fact) {
      // 本文抜粋で裏が取れた数値。XBRL の fact は無いが、最終表面の検証数に
      // 数えないと「claim 3 件 / verified 2 件」となり、ベンチの数値証明
      // (verified == claims)が根拠のある回答を material numeric error に
      // 数えてしまう(2026-08-22 口語ベンチ JPM-Q05 / MA-Q12)。
      if (resolution.outcome !== "passed" || !resolution.labels.includes("excerpt_supported_numeric_claim")) {
        return [];
      }
      return [{
        claimStart: resolution.claim.start,
        claimEnd: resolution.claim.end,
        claimKind: resolution.claim.kind,
        factId: `EXCERPT:${resolution.excerptSourceId ?? "cited"}`,
        sourceId: resolution.excerptSourceId ?? "cited",
        semanticLabel: "excerpt",
        periodStart: null,
        periodEnd: "",
        role: "excerpt",
        scope: "excerpt",
        outcome: "passed"
      }];
    }
    return [{
      claimStart: resolution.claim.start,
      claimEnd: resolution.claim.end,
      claimKind: resolution.claim.kind,
      factId: resolution.fact.factId,
      sourceId: resolution.fact.sourceId,
      semanticLabel: resolution.fact.semanticLabel,
      periodStart: resolution.fact.periodStart,
      periodEnd: resolution.fact.periodEnd,
      role: resolution.fact.role,
      scope: resolution.fact.scope,
      outcome: resolution.outcome
    }];
  });
}

function validateClaimBindingSurface(answer: string, resolution: ClaimResolution): ClaimResolution {
  if (!resolution.fact || (resolution.outcome !== "passed" && resolution.outcome !== "repaired")) {
    return resolution;
  }
  if (hasMismatchedExplicitDateAnchor(answer, resolution.claim, resolution.fact)) {
    return { ...resolution, outcome: "blocked", replacement: undefined, labels: dedupe([...resolution.labels, "period_mismatch"]) };
  }
  if (hasUnsupportedSegmentScope(answer, resolution.claim, resolution.fact)) {
    return { ...resolution, outcome: "blocked", replacement: undefined, labels: dedupe([...resolution.labels, "unsupported_numeric_claim"]) };
  }
  return resolution;
}

function hasMismatchedExplicitDateAnchor(
  answer: string,
  claim: MaterialNumericClaim,
  fact: VerifiedFinancialFact
): boolean {
  const clause = claimClause(answer, claim.start, claim.end);
  const dates = Array.from(clause.text.matchAll(/\b(20\d{2})[-\/年](\d{1,2})[-\/月](\d{1,2})日?\b/gu));
  if (dates.length === 0) return false;
  const claimIndex = claim.start - clause.start;
  const candidates = dates
    .map((match) => ({
      date: `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`,
      index: match.index ?? 0,
      distance: Math.abs((match.index ?? 0) - claimIndex)
    }));
  // Financial prose normally anchors a value with the date immediately before
  // it. Using absolute distance can incorrectly bind the prior value to the
  // following current-period date in a compact `prior ... から current ...`
  // sentence.
  const preceding = candidates
    .filter((candidate) => candidate.index <= claimIndex)
    .sort((left, right) => right.index - left.index)[0];
  const nearest = preceding ?? candidates.sort((left, right) => left.distance - right.distance)[0];
  if (!nearest || nearest.distance > 64) return false;
  return nearest.date !== fact.periodEnd && nearest.date !== fact.periodStart;
}

function hasUnsupportedSegmentScope(
  answer: string,
  claim: MaterialNumericClaim,
  fact: VerifiedFinancialFact
): boolean {
  if (fact.scope !== "company_total") return false;
  if (!["revenue", "operatingIncome", "netIncome", "operatingMargin", "netMargin"].includes(fact.semanticLabel)) {
    return false;
  }
  const clause = claimClause(answer, claim.start, claim.end).text;
  const segmentMetric = /(?:AWS|Azure|Google Cloud|Data Center|Gaming|Microsoft 365|Walmart U\.?S\.?|Sam'?s Club|Mounjaro|Zepbound|Construction Industries|Resource Industries|Energy\s*&\s*Transportation|データセンター|ゲーミング|建設機械|資源産業|エネルギー・輸送)(?:部門|事業|セグメント)?(?:の|における|\s+)*(?:売上高?|収益|営業利益|純利益|利益率|revenue|sales|operating income|net income|margin)/iu;
  return segmentMetric.test(clause);
}

function claimClause(answer: string, start: number, end: number): { text: string; start: number } {
  const prefix = answer.slice(0, start);
  const suffix = answer.slice(end);
  const leftBoundary = Math.max(
    prefix.lastIndexOf("。"), prefix.lastIndexOf("！"), prefix.lastIndexOf("？"),
    prefix.lastIndexOf("\n"), prefix.lastIndexOf(";"), prefix.lastIndexOf("；")
  );
  const rightRelative = suffix.search(/[。！？\n;；]/u);
  const clauseStart = leftBoundary + 1;
  const clauseEnd = rightRelative >= 0 ? end + rightRelative : answer.length;
  return { text: answer.slice(clauseStart, clauseEnd), start: clauseStart };
}

function resolveClaim(
  claim: MaterialNumericClaim,
  facts: VerifiedFinancialFact[],
  cited: Set<string>
): ClaimResolution {
  if (claim.kind === "percentage") {
    return resolvePercentageClaim(claim, facts, cited);
  }
  if (claim.kind === "number") {
    return resolveBareNumberClaim(claim, facts, cited);
  }
  return resolveCurrencyClaim(claim, facts, cited);
}

function resolveBareNumberClaim(
  claim: MaterialNumericClaim,
  facts: VerifiedFinancialFact[],
  cited: Set<string>
): ClaimResolution {
  if (!claim.semanticLabel) return ignoredResolution(claim);
  const semanticFacts = narrowBySemanticLabel(
    facts.filter((fact) => fact.unit !== "percent"),
    claim.semanticLabel
  );
  if (semanticFacts.length === 0) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }

  const exact = rankFacts(
    semanticFacts.filter((fact) => bareNumberMatchesFact(claim, fact) && periodMatches(claim, fact)),
    claim,
    cited
  );
  if (exact.length === 1 || (exact.length > 1 && exact[0]!.score > exact[1]!.score)) {
    const fact = exact[0]!.fact;
    // A bare monetary number is still missing its currency/unit even when its
    // magnitude happens to match; repair it to the typed display form.
    return fact.currency
      ? repairedResolution(claim, fact, ["currency_mismatch"], preferredFactDisplay(fact))
      : passedResolution(claim, fact);
  }
  if (exact.length > 1) return blockedResolution(claim, ["unsupported_numeric_claim"]);

  const intended = selectIntendedFact(claim, semanticFacts, cited);
  if (!intended) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }
  return claimValueMatchesAlternativeUnit(claim, intended)
    ? repairedResolution(claim, intended, ["unit_mismatch"], preferredFactDisplay(intended))
    : blockedResolution(claim, ["material_numeric_error"]);
}

function bareNumberMatchesFact(claim: MaterialNumericClaim, fact: VerifiedFinancialFact): boolean {
  if (isPerShare(claim.unit) !== isPerShare(fact.unit)) return false;
  if (claim.unit === "shares" && !/(?:^|\/)shares?$/iu.test(fact.unit)) return false;
  if (claim.unit === "ratio" && fact.currency !== null) return false;
  return Math.abs(claim.canonicalValue - fact.canonicalValue) <= currencyTolerance(claim);
}

function resolveCurrencyClaim(
  claim: MaterialNumericClaim,
  facts: VerifiedFinancialFact[],
  cited: Set<string>
): ClaimResolution {
  const currencyFacts = facts.filter((fact) => fact.unit !== "percent" && fact.currency !== null);
  if (!claim.semanticLabel) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }
  const semanticFacts = narrowBySemanticLabel(currencyFacts, claim.semanticLabel);
  if (semanticFacts.length === 0) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }
  const exactIgnoringPeriod = semanticFacts.filter((fact) => currencyClaimMatchesFact(claim, fact));
  const periodMismatch = exactIgnoringPeriod.find((fact) => !periodMatches(claim, fact));
  if (periodMismatch) {
    const intended = selectIntendedFact(claim, semanticFacts, cited);
    return intended
      ? repairedResolution(claim, intended, ["period_mismatch"], preferredFactDisplay(intended))
      : blockedResolution(claim, ["period_mismatch"]);
  }

  const exact = rankFacts(
    exactIgnoringPeriod.filter((fact) => periodMatches(claim, fact)),
    claim,
    cited
  );
  if (exact.length === 1 || (exact.length > 1 && exact[0]!.score > exact[1]!.score)) {
    return passedResolution(claim, exact[0]!.fact);
  }
  if (exact.length > 1) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }

  const intended = selectIntendedFact(claim, semanticFacts, cited);
  if (!intended) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }
  const labels = classifyCurrencyMismatch(claim, intended);
  return labels.includes("material_numeric_error")
    ? blockedResolution(claim, labels)
    : repairedResolution(claim, intended, labels, preferredFactDisplay(intended));
}

function resolvePercentageClaim(
  claim: MaterialNumericClaim,
  facts: VerifiedFinancialFact[],
  cited: Set<string>
): ClaimResolution {
  const candidates = percentageCandidates(facts);
  if (!claim.semanticLabel) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }
  const semanticCandidates = narrowPercentageBySemanticLabel(candidates, claim.semanticLabel);
  if (semanticCandidates.length === 0) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }
  const exactIgnoringPeriod = semanticCandidates.filter((candidate) => percentageMatches(claim, candidate.value));
  const periodMismatch = exactIgnoringPeriod.find((candidate) => !periodMatches(claim, candidate.fact));
  if (periodMismatch) {
    const intended = selectIntendedPercentage(claim, semanticCandidates, cited);
    return intended
      ? repairedResolution(claim, intended.fact, ["period_mismatch"], formatPercentage(intended.value, preferredPercentPrecision(claim)))
      : blockedResolution(claim, ["period_mismatch"]);
  }
  const exact = rankPercentageCandidates(
    exactIgnoringPeriod.filter((candidate) => periodMatches(claim, candidate.fact)),
    claim,
    cited
  );
  if (exact.length === 1 || (exact.length > 1 && exact[0]!.score > exact[1]!.score)) {
    return passedResolution(claim, exact[0]!.candidate.fact);
  }
  if (exact.length > 1) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }

  const intended = selectIntendedPercentage(claim, semanticCandidates, cited);
  if (!intended) {
    return blockedResolution(claim, ["unsupported_numeric_claim"]);
  }
  const tolerance = percentTolerance(claim);
  const signOnlyMismatch = Math.abs(Math.abs(claim.canonicalValue) - Math.abs(intended.value)) <= tolerance;
  return signOnlyMismatch
    ? repairedResolution(
        claim,
        intended.fact,
        ["sign_error"],
        formatPercentage(intended.value, preferredPercentPrecision(claim))
      )
    : blockedResolution(claim, ["material_numeric_error"]);
}

function currencyClaimMatchesFact(claim: MaterialNumericClaim, fact: VerifiedFinancialFact): boolean {
  if (claim.currency !== fact.currency) {
    return false;
  }
  if (isPerShare(claim.unit) !== isPerShare(fact.unit)) {
    return false;
  }
  return Math.abs(claim.canonicalValue - fact.canonicalValue) <= currencyTolerance(claim);
}

function classifyCurrencyMismatch(
  claim: MaterialNumericClaim,
  fact: VerifiedFinancialFact
): NumericAlignmentFailureLabel[] {
  const tolerance = currencyTolerance(claim);
  const sameMagnitude = Math.abs(Math.abs(claim.canonicalValue) - Math.abs(fact.canonicalValue)) <= tolerance;
  const alternativeUnitMatch = claimValueMatchesAlternativeUnit(claim, fact);
  if (claim.currency !== fact.currency) {
    return sameMagnitude || alternativeUnitMatch ? ["currency_mismatch"] : ["material_numeric_error"];
  }
  if (isPerShare(claim.unit) !== isPerShare(fact.unit)) {
    return sameMagnitude || alternativeUnitMatch ? ["unit_mismatch"] : ["material_numeric_error"];
  }
  if (sameMagnitude) {
    return ["sign_error"];
  }
  if (alternativeUnitMatch) {
    return ["unit_mismatch"];
  }
  return ["material_numeric_error"];
}

function claimValueMatchesAlternativeUnit(claim: MaterialNumericClaim, fact: VerifiedFinancialFact): boolean {
  return fact.displayValues.some((display) => {
    const alternativeCanonical = claim.numericValue * display.scale;
    const tolerance = display.scale * 0.5 * (10 ** -claim.decimals) + 1e-6;
    return Math.abs(alternativeCanonical - fact.canonicalValue) <= tolerance;
  });
}

function selectIntendedFact(
  claim: MaterialNumericClaim,
  facts: VerifiedFinancialFact[],
  cited: Set<string>
): VerifiedFinancialFact | null {
  const periodCompatible = facts.filter((fact) => periodMatches(claim, fact));
  const ranked = rankFacts(periodCompatible.length > 0 ? periodCompatible : facts, claim, cited);
  if (ranked.length === 1) {
    return ranked[0]!.fact;
  }
  if (ranked.length > 1 && ranked[0]!.score > ranked[1]!.score) {
    return ranked[0]!.fact;
  }
  return null;
}

function selectIntendedPercentage(
  claim: MaterialNumericClaim,
  candidates: PercentageCandidate[],
  cited: Set<string>
): PercentageCandidate | null {
  const periodCompatible = candidates.filter((candidate) => periodMatches(claim, candidate.fact));
  const ranked = rankPercentageCandidates(periodCompatible.length > 0 ? periodCompatible : candidates, claim, cited);
  if (ranked.length === 1) {
    return ranked[0]!.candidate;
  }
  if (ranked.length > 1 && ranked[0]!.score > ranked[1]!.score) {
    return ranked[0]!.candidate;
  }
  return null;
}

function rankFacts(
  facts: VerifiedFinancialFact[],
  claim: MaterialNumericClaim,
  cited: Set<string>
): Array<{ fact: VerifiedFinancialFact; score: number }> {
  return facts
    .map((fact) => ({ fact, score: factScore(fact, claim, cited) }))
    .sort((left, right) => right.score - left.score || left.fact.factId.localeCompare(right.fact.factId));
}

function rankPercentageCandidates(
  candidates: PercentageCandidate[],
  claim: MaterialNumericClaim,
  cited: Set<string>
): Array<{ candidate: PercentageCandidate; score: number }> {
  return candidates
    .map((candidate) => ({ candidate, score: factScore(candidate.fact, claim, cited) }))
    .sort((left, right) => right.score - left.score || left.candidate.fact.factId.localeCompare(right.candidate.fact.factId));
}

function factScore(fact: VerifiedFinancialFact, claim: MaterialNumericClaim, cited: Set<string>): number {
  let score = 0;
  if (claim.semanticLabel && fact.semanticLabel === claim.semanticLabel) {
    score += 10;
  }
  if (claim.periodRole && fact.role === claim.periodRole) {
    score += 8;
  } else if (!claim.periodRole && fact.role === "current") {
    score += 2;
  }
  if (claim.periodKind && fact.periodKind === claim.periodKind) {
    score += 6;
  }
  if (cited.has(fact.sourceId)) {
    score += 4;
  }
  return score;
}

function narrowBySemanticLabel(facts: VerifiedFinancialFact[], label: string | null): VerifiedFinancialFact[] {
  if (!label) {
    return facts;
  }
  const matching = facts.filter((fact) => fact.semanticLabel === label);
  return matching;
}

function narrowPercentageBySemanticLabel(
  candidates: PercentageCandidate[],
  label: string | null
): PercentageCandidate[] {
  if (!label) {
    return candidates;
  }
  const matching = candidates.filter((candidate) => candidate.fact.semanticLabel === label);
  return matching;
}

function percentageCandidates(facts: VerifiedFinancialFact[]): PercentageCandidate[] {
  const candidates: PercentageCandidate[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const value = fact.unit === "percent"
      ? fact.canonicalValue
      : fact.role === "current"
        ? isSignCrossingDerivedChange(fact)
          ? undefined
          : fact.derivedPercentage?.resultPercent
        : undefined;
    if (value === undefined || !Number.isFinite(value)) {
      continue;
    }
    const key = `${fact.semanticLabel}|${fact.sourceId}|${fact.periodEnd}|${value.toFixed(8)}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push({ fact, value });
    }
  }
  return candidates;
}

function isSignCrossingDerivedChange(fact: VerifiedFinancialFact): boolean {
  const derived = fact.derivedPercentage;
  return Boolean(
    derived?.kind === "derived_change" &&
    typeof derived.currentValue === "number" &&
    typeof derived.comparisonValue === "number" &&
    derived.currentValue !== 0 &&
    derived.comparisonValue !== 0 &&
    Math.sign(derived.currentValue) !== Math.sign(derived.comparisonValue)
  );
}

function periodMatches(claim: MaterialNumericClaim, fact: VerifiedFinancialFact): boolean {
  if (claim.periodRole && fact.role !== claim.periodRole) {
    return false;
  }
  if (claim.periodKind && !periodKindsCompatible(claim.periodKind, fact.periodKind)) {
    return false;
  }
  return true;
}

function periodKindsCompatible(claim: FinancialFactPeriodKind, fact: FinancialFactPeriodKind): boolean {
  if (claim === fact || claim === "unknown" || fact === "unknown") {
    return true;
  }
  return claim === "duration" && ["quarter", "year_to_date", "annual"].includes(fact);
}

function percentageMatches(claim: MaterialNumericClaim, value: number): boolean {
  return Math.abs(claim.canonicalValue - value) <= percentTolerance(claim);
}

function currencyTolerance(claim: MaterialNumericClaim): number {
  const roundingTolerance = displayRoundingTolerance(claim.displayUnit, claim.decimals);
  // Scaling a displayed decimal back to a large canonical amount can land a
  // few ULPs beyond the exact half-step (for example 302.6億 vs 30.2555B).
  // Keep the material tolerance unchanged and absorb only float arithmetic.
  const floatingPointSlack = Number.EPSILON * Math.max(1, Math.abs(claim.canonicalValue)) * 8;
  return roundingTolerance + Math.max(1e-6, floatingPointSlack);
}

function percentTolerance(claim: MaterialNumericClaim): number {
  return 0.5 * (10 ** -claim.decimals) + 1e-6;
}

function isPerShare(unit: string): boolean {
  return /\/share|\/株/i.test(unit);
}

function preferredFactDisplay(fact: VerifiedFinancialFact): string {
  return preferredFinancialDisplay(fact.canonicalValue, fact.unit).ja;
}

function preferredPercentPrecision(claim: MaterialNumericClaim): number {
  return Math.max(1, Math.min(2, claim.decimals));
}

function passedResolution(claim: MaterialNumericClaim, fact: VerifiedFinancialFact): ClaimResolution {
  return { claim, outcome: "passed", fact, labels: [] };
}

function repairedResolution(
  claim: MaterialNumericClaim,
  fact: VerifiedFinancialFact,
  labels: NumericAlignmentFailureLabel[],
  replacement: string
): ClaimResolution {
  return { claim, outcome: "repaired", fact, labels, replacement: preserveOuterWhitespace(claim.raw, replacement) };
}

function ignoredResolution(claim: MaterialNumericClaim): ClaimResolution {
  return { claim, outcome: "ignored", labels: [] };
}

/// 引用本文に同じ数値表記があるか。百分率は「N%」、金額・件数は数値×スケール
/// (billion / million / 億 …)を正規化して比較する。相対誤差 0.5% まで同一とみなす
/// (本文の "29.3 billion" と回答の「293億ドル」は同じ数)。
function excerptSupportingClaim(
  claim: MaterialNumericClaim,
  sources: Array<{ sourceId: string | null; text: string }>
): { sourceId: string | null } | null {
  for (const source of sources) {
    if (excerptSupportsClaim(claim, [source.text])) return { sourceId: source.sourceId };
  }
  return null;
}

function excerptSupportsClaim(claim: MaterialNumericClaim, texts: string[]): boolean {
  if (texts.length === 0) return false;
  if (claim.kind === "percentage") {
    const pattern = /(\d+(?:\.\d+)?)\s*(?:%|％|percent)/giu;
    return texts.some((text) => {
      for (const match of text.matchAll(pattern)) {
        const value = Number.parseFloat(match[1]!);
        if (Number.isFinite(value) && Math.abs(value - claim.numericValue) < 0.05) return true;
      }
      return false;
    });
  }
  const pattern = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(trillion|billion|million|thousand|兆|億|百万|千)?/giu;
  const scales: Record<string, number> = {
    trillion: 1e12, 兆: 1e12,
    billion: 1e9,
    億: 1e8,
    million: 1e6, 百万: 1e6,
    thousand: 1e3, 千: 1e3
  };
  const target = Math.abs(claim.canonicalValue);
  if (!(target > 0)) return false;
  return texts.some((text) => {
    for (const match of text.matchAll(pattern)) {
      const whole = match[1]!.replace(/,/g, "");
      const fraction = match[2] ? `.${match[2]}` : "";
      const value = Number.parseFloat(`${whole}${fraction}`) * (match[3] ? scales[match[3].toLowerCase()] ?? scales[match[3]] ?? 1 : 1);
      if (Number.isFinite(value) && value > 0 && Math.abs(value - target) / target <= 0.005) return true;
    }
    return false;
  });
}

function excerptSupportedResolution(claim: MaterialNumericClaim, sourceId: string | null): ClaimResolution {
  return {
    claim,
    outcome: "passed",
    excerptSourceId: sourceId,
    labels: ["excerpt_supported_numeric_claim"]
  };
}

function blockedResolution(
  claim: MaterialNumericClaim,
  labels: NumericAlignmentFailureLabel[]
): ClaimResolution {
  return { claim, outcome: "blocked", labels };
}

function buildBlockedFallback(
  facts: VerifiedFinancialFact[],
  matchedFacts: VerifiedFinancialFact[],
  cited: Set<string>
): string {
  const preferred = [
    ...matchedFacts,
    ...facts.filter((fact) => fact.role === "current" && cited.has(fact.sourceId)),
    ...facts.filter((fact) => fact.role === "current")
  ].find((fact, index, all) =>
    fact.unit !== "percent" && all.findIndex((candidate) => candidate.factId === fact.factId) === index
  );
  if (!preferred) {
    return "回答内の重要な数値を提出資料と安全に照合できなかったため、未確認の数値は表示しません。定量値は根拠資料を確認してから案内します。";
  }
  return `回答内の重要な数値を提出資料と安全に照合できなかったため、未確認の数値は表示しません。確認できる数値は、${preferred.semanticLabelJa}は${preferredFactDisplay(preferred)}です。`;
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function preserveOuterWhitespace(raw: string, replacement: string): string {
  const leading = raw.match(/^[ \t]*/u)?.[0] ?? "";
  const trailing = raw.match(/[ \t]*$/u)?.[0] ?? "";
  return `${leading}${replacement}${trailing}`;
}
