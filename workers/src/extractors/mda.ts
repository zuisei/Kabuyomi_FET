import { parseHTML } from "linkedom";

const TOKEN_BUDGET = 15_000;
const MIN_SECTION_CHARS = 2_400;

export interface ExtractedMDA {
  text: string;
  tokenCount: number;
  usedStartPattern: string;
  usedEndPattern: string;
}

interface PatternPair {
  start: RegExp[];
  end: RegExp[];
}

export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export function normalizeFilingText(html: string): string {
  const { document } = parseHTML(html);
  const text = document.body.textContent ?? html;

  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?([,:;.)])/g, "$1")
    .trim();
}

export function extractMDASection(html: string, formType: "10-K" | "10-Q"): ExtractedMDA | null {
  const normalizedText = normalizeFilingText(html);
  const patterns = getPatterns(formType);
  const startMatches = findAllMatches(normalizedText, patterns.start);
  const endMatches = findAllMatches(normalizedText, patterns.end);

  for (const [index, startMatch] of startMatches.entries()) {
    const nextStart = startMatches[index + 1];
    if (nextStart && nextStart.index - startMatch.index < 1_000) {
      continue;
    }

    for (const endMatch of endMatches) {
      if (endMatch.index <= startMatch.index) {
        continue;
      }

      const candidate = stripLeadingNoise(normalizedText.slice(startMatch.index, endMatch.index).trim(), patterns.start);
      if (candidate.length < MIN_SECTION_CHARS) {
        continue;
      }

      const trimmed = trimToTokenBudget(candidate, TOKEN_BUDGET);
      return {
        text: trimmed,
        tokenCount: estimateTokenCount(trimmed),
        usedStartPattern: startMatch.pattern,
        usedEndPattern: endMatch.pattern
      };
    }
  }

  return null;
}

function stripLeadingNoise(candidate: string, startPatterns: RegExp[]): string {
  const innerMatches = findAllMatches(candidate, startPatterns);
  if (innerMatches.length <= 1) {
    return candidate;
  }

  const leadingWindow = candidate.slice(0, Math.min(2_500, candidate.length));
  const itemMentions = [...leadingWindow.matchAll(/item\s+\d/gi)].length;
  const looksLikeToc =
    /table of contents/i.test(leadingWindow) ||
    /pagepart/i.test(leadingWindow) ||
    itemMentions >= 3;

  if (!looksLikeToc) {
    return candidate;
  }

  const replacement = innerMatches
    .slice(1)
    .reverse()
    .find((match) => match.index >= 120 && candidate.length - match.index >= MIN_SECTION_CHARS);

  return replacement ? candidate.slice(replacement.index).trim() : candidate;
}

function getPatterns(formType: "10-K" | "10-Q"): PatternPair {
  if (formType === "10-K") {
      return {
        start: [
        /item\s+7\b[\s.: -]*management['’]?s discussion and analysis/gi,
        /item\s+7\b/gi
      ],
      end: [
        /item\s+7a\b[\s.: -]*quantitative and qualitative disclosures/gi,
        /item\s+8\b[\s.: -]*financial statements/gi,
        /item\s+8\b/gi
      ]
    };
  }

  return {
    start: [
      /part\s+i\b[\s.: -]*item\s+2\b[\s.: -]*management['’]?s discussion and analysis/gi,
      /item\s+2\b[\s.: -]*management['’]?s discussion and analysis/gi,
      /part\s+i\b[\s.: -]*item\s+2\b/gi
    ],
    end: [
      /item\s+3\b[\s.: -]*quantitative and qualitative disclosures/gi,
      /item\s+3\b[\s.: -]*quantitative and qualitative disclosures about market risk/gi,
      /item\s+4\b[\s.: -]*controls and procedures/gi
    ]
  };
}

function findAllMatches(text: string, patterns: RegExp[]): Array<{ index: number; pattern: string }> {
  const matches: Array<{ index: number; pattern: string }> = [];

  for (const pattern of patterns) {
    const cloned = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = cloned.exec(text)) !== null) {
      matches.push({
        index: match.index,
        pattern: pattern.source
      });
    }
  }

  return matches.sort((left, right) => left.index - right.index);
}

function trimToTokenBudget(text: string, maxTokens: number): string {
  if (estimateTokenCount(text) <= maxTokens) {
    return text;
  }

  const maxChars = maxTokens * 4;
  const truncated = text.slice(0, maxChars);
  const lastBoundary = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("。\n"),
    truncated.lastIndexOf("。\r\n"),
    truncated.lastIndexOf("\n\n")
  );

  return (lastBoundary > 0 ? truncated.slice(0, lastBoundary + 1) : truncated).trim();
}
