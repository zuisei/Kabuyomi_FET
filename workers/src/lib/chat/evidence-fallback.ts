import type { SourceChunkRecord } from "../../env";
import type { GeminiChatAnswer } from "../../clients/gemini/types";
import type { EvidenceSlots } from "./evidence-slots";
import type { SourceGateResult } from "./source-gate";

export type EvidenceFallbackResult = {
  answer: GeminiChatAnswer;
  genericFallbackPhraseDetected: boolean;
};

const BANNED_PHRASES = [
  "本文に説明があります",
  "本文全体と数字を並べると見えてきます",
  "本文の要因説明と並べると判断しやすくなります",
  "価格、数量、需要、コスト、mixを見るべきです"
];

export function buildEvidenceFallbackAnswer({
  sourceGateResult,
  evidenceSlots,
  selectedSources,
  fallbackReason
}: {
  sourceGateResult: SourceGateResult;
  evidenceSlots: EvidenceSlots;
  selectedSources: SourceChunkRecord[];
  fallbackReason?: GeminiChatAnswer["fallbackReason"];
}): EvidenceFallbackResult {
  const hardIntent = sourceGateResult.hardIntent;
  const answer = hardIntent === "margin_durability_followup"
    ? buildMarginDurabilityFallback(sourceGateResult, evidenceSlots)
    : hardIntent === "driver_durability_followup"
      ? buildDriverDurabilityFallback(sourceGateResult, evidenceSlots)
      : buildRevenueDriverFallback(sourceGateResult, evidenceSlots);
  const cleaned = cleanBannedPhrases(answer);
  const sourceIds = sourceIdsForFallback(sourceGateResult, evidenceSlots, selectedSources);
  const genericFallbackPhraseDetected = hasBannedPhrase(cleaned);

  return {
    answer: {
      answer: cleaned,
      sourceIds,
      usedRemoteModel: false,
      geminiCalled: false,
      geminiSucceeded: false,
      schemaValid: true,
      fallbackReason
    },
    genericFallbackPhraseDetected
  };
}

export function hasBannedPhrase(answer: string): boolean {
  return BANNED_PHRASES.some((phrase) => answer.includes(phrase)) ||
    /本文に.*説明があります/.test(answer) ||
    /本文全体と数字を並べると/.test(answer) ||
    /数字を並べると.*見えてきます/.test(answer) ||
    /この資料の範囲では確認できません(?!.*(不足|source|説明|指標|KPI|MD&A))/.test(answer) ||
    /一時的とは断定しにくいです(?!.*(driver|要因|不足|未特定|不明))/.test(answer);
}

function buildRevenueDriverFallback(sourceGateResult: SourceGateResult, evidenceSlots: EvidenceSlots): string {
  const metric = evidenceSlots.confirmedMetricMovement;
  const safeDrivers = safeDriverTexts(evidenceSlots.companyExplainedDrivers);
  const parts: string[] = [];
  if (metric) {
    parts.push(`${metric.metricName}は${metric.currentValue ?? "確認できます"}${metric.changePct ? `で、${metric.comparisonBasis ?? "比較"}${metric.changePct}です` : "です"}。`);
  } else {
    parts.push("売上の増減方向は、選択sourceだけでは十分に整理できていません。");
  }

  if (safeDrivers.length > 0) {
    parts.push(`会社が説明する主なdriverは、${safeDrivers.join(" / ")}です。`);
  } else {
    parts.push(`ただし、取得できたsourceでは、会社固有の売上driverは十分に特定できていません。不足しているのは ${joinItems(sourceGateResult.missingSourceTypes)} です。`);
    parts.push(`主因を見るには、${joinItems(evidenceSlots.sectorSpecificNextIndicators.slice(0, 5))} を追加確認する必要があります。`);
  }
  return parts.join("");
}

function buildDriverDurabilityFallback(sourceGateResult: SourceGateResult, evidenceSlots: EvidenceSlots): string {
  const safeDrivers = safeDriverTexts(evidenceSlots.companyExplainedDrivers);
  if (sourceGateResult.followupTargetFound === false || safeDrivers.length === 0) {
    return [
      "前問の具体的なdriverが十分に特定できていません。",
      "そのため、選択sourceだけで一時要因か継続要因かは分類しません。",
      `判断には、MD&Aと${joinItems(evidenceSlots.sectorSpecificNextIndicators.slice(0, 5))} の追加確認が必要です。`
    ].join("");
  }

  const durable = safeFactTexts(evidenceSlots.durabilityEvidence.potentiallyDurable).slice(0, 2);
  const temporary = safeFactTexts(evidenceSlots.durabilityEvidence.likelyTemporary).slice(0, 2);
  const parts = [`前問のdriverは、${safeDrivers.join(" / ")}です。`];
  if (temporary.length > 0) {
    parts.push(`一時性を見る材料は、${temporary.join(" / ")} です。`);
  }
  if (durable.length > 0) {
    parts.push(`継続性を見る材料は、${durable.join(" / ")} です。`);
  }
  if (temporary.length === 0 && durable.length === 0) {
    parts.push(`継続性の判断には、${joinItems(evidenceSlots.sectorSpecificNextIndicators.slice(0, 5))} の追加確認が必要です。`);
  }
  return parts.join("");
}

function buildMarginDurabilityFallback(sourceGateResult: SourceGateResult, evidenceSlots: EvidenceSlots): string {
  const metric = evidenceSlots.confirmedMetricMovement;
  const safeMarginDrivers = safeDriverTexts(evidenceSlots.marginDrivers);
  const parts: string[] = [];
  if (safeMarginDrivers.length === 0 || sourceGateResult.followupTargetFound === false) {
    if (metric) {
      parts.push(`確認できているのは、${metric.metricName}が${metric.currentValue ?? "報告されている"}${metric.changePct ? `、${metric.comparisonBasis ?? "比較"}${metric.changePct}` : ""}という点です。`);
    }
    parts.push("ただし、利益率変化の具体的なdriverは十分に特定できていません。");
    parts.push("そのため、選択sourceだけで一時要因か構造的変化かは分類しません。");
    parts.push(`判断には、${joinItems([...sourceGateResult.missingSourceTypes, ...evidenceSlots.sectorSpecificNextIndicators].slice(0, 6))} の説明が必要です。`);
    return parts.join("");
  }

  parts.push(`利益率driverとして確認できるのは、${safeMarginDrivers.join(" / ")}です。`);
  if (evidenceSlots.durabilityEvidence.likelyTemporary.length === 0 && evidenceSlots.durabilityEvidence.potentiallyDurable.length === 0) {
    parts.push(`一時要因か構造変化かの判断には、${joinItems(evidenceSlots.sectorSpecificNextIndicators.slice(0, 5))} の継続確認が必要です。`);
  }
  return parts.join("");
}

function safeDriverTexts(drivers: Array<{ driver: string }>): string[] {
  return drivers
    .map((driver) => driver.driver.replace(/\s+/g, " ").trim())
    .filter((driver) => !isUnsafeEvidenceText(driver))
    .map((driver) => driver.length > 80 ? `${driver.slice(0, 77)}...` : driver)
    .slice(0, 3);
}

function safeFactTexts(facts: Array<{ fact: string }>): string[] {
  return facts
    .map((fact) => fact.fact.replace(/\s+/g, " ").trim())
    .filter((fact) => !isUnsafeEvidenceText(fact))
    .map((fact) => fact.length > 80 ? `${fact.slice(0, 77)}...` : fact);
}

function isUnsafeEvidenceText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/[A-Za-z]+(?:\s+[A-Za-z]+){7,}/.test(trimmed)) return true;
  if (/[A-Za-z][A-Za-z\s,;]+(\.\.\.|…)/.test(trimmed)) return true;
  if (/•|Item\s+\d|Part\s+[IVX]|Risk Factors/i.test(trimmed)) return true;
  if (/^(and|or|while|these|including|within|operating|risks?)\b/i.test(trimmed)) return true;
  return false;
}

function sourceIdsForFallback(
  sourceGateResult: SourceGateResult,
  evidenceSlots: EvidenceSlots,
  selectedSources: SourceChunkRecord[]
): string[] {
  const ids = new Set<string>();
  for (const sourceId of evidenceSlots.confirmedMetricMovement?.sourceIds ?? []) ids.add(sourceId);
  for (const fact of sourceGateResult.knownFacts) {
    for (const sourceId of fact.sourceIds) ids.add(sourceId);
  }
  for (const driver of [...evidenceSlots.companyExplainedDrivers, ...evidenceSlots.marginDrivers]) {
    for (const sourceId of driver.sourceIds) ids.add(sourceId);
  }
  if (ids.size === 0) {
    const fallbackSource = selectedSources.find((source) => source.sectionType === "xbrl_metric") ?? selectedSources[0];
    if (fallbackSource) ids.add(fallbackSource.sourceId);
  }
  return [...ids].slice(0, 4);
}

function cleanBannedPhrases(answer: string): string {
  let cleaned = answer;
  for (const phrase of BANNED_PHRASES) {
    cleaned = cleaned.replaceAll(phrase, "具体的な不足sourceを確認する必要があります");
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function joinItems(items: string[]): string {
  const unique = [...new Set(items.filter(Boolean))];
  if (unique.length === 0) {
    return "MD&Aやsegment results";
  }
  return unique.join("、");
}
