const TOKEN_BUDGET = 15_000;
const MIN_SECTION_CHARS = 2_400;

export function prepareFilingText(html, formType) {
  const startedAt = nowMs();
  const { text: normalizedText, diagnostics: normalizationDiagnostics } = normalizeFilingTextWithDiagnostics(html);
  const normalizedAt = nowMs();
  const patterns = getPatterns(formType);
  const startMatches = findAllMatches(normalizedText, patterns.start, "start");
  const endMatches = findAllMatches(normalizedText, patterns.end, "end");
  const matchedAt = nowMs();

  let endCursor = 0;
  for (const [index, startMatch] of startMatches.entries()) {
    const nextStart = startMatches[index + 1];
    if (nextStart && nextStart.index - startMatch.index < 1_000) {
      continue;
    }

    while (endCursor < endMatches.length && endMatches[endCursor].index <= startMatch.index) {
      endCursor += 1;
    }

    for (let endIndex = endCursor; endIndex < endMatches.length; endIndex += 1) {
      const endMatch = endMatches[endIndex];
      const candidate = stripLeadingNoise(normalizedText.slice(startMatch.index, endMatch.index).trim(), patterns.start);
      if (candidate.length < MIN_SECTION_CHARS) {
        continue;
      }

      const text = trimToTokenBudget(candidate, TOKEN_BUDGET);
      const finishedAt = nowMs();
      return {
        result: {
          mdaText: text,
          mdaTokenCount: estimateTokenCount(text),
          usedStartPattern: startMatch.pattern,
          usedEndPattern: endMatch.pattern
        },
        diagnostics: {
          inputHtmlChars: html.length,
          normalizedChars: normalizedText.length,
          startMatchesCount: startMatches.length,
          endMatchesCount: endMatches.length,
          sanitizeMs: normalizationDiagnostics.sanitizeMs,
          domParseMs: normalizationDiagnostics.domParseMs,
          textReadMs: normalizationDiagnostics.textReadMs,
          cleanupMs: normalizationDiagnostics.cleanupMs,
          normalizeMs: normalizationDiagnostics.normalizeMs,
          boundaryScanMs: elapsedMs(normalizedAt, matchedAt),
          selectionMs: elapsedMs(matchedAt, finishedAt),
          totalMs: elapsedMs(startedAt, finishedAt)
        }
      };
    }
  }

  const finishedAt = nowMs();
  return {
    result: null,
    diagnostics: {
      inputHtmlChars: html.length,
      normalizedChars: normalizedText.length,
      startMatchesCount: startMatches.length,
      endMatchesCount: endMatches.length,
      sanitizeMs: normalizationDiagnostics.sanitizeMs,
      domParseMs: normalizationDiagnostics.domParseMs,
      textReadMs: normalizationDiagnostics.textReadMs,
      cleanupMs: normalizationDiagnostics.cleanupMs,
      normalizeMs: normalizationDiagnostics.normalizeMs,
      boundaryScanMs: elapsedMs(normalizedAt, matchedAt),
      selectionMs: elapsedMs(matchedAt, finishedAt),
      totalMs: elapsedMs(startedAt, finishedAt)
    }
  };
}

function estimateTokenCount(text) {
  return Math.ceil(text.length / 4);
}

function normalizeFilingTextWithDiagnostics(html) {
  const sanitizeStartedAt = nowMs();
  const sanitizedHtml = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const sanitizedAt = nowMs();
  const text = decodeHtmlEntities(
    sanitizedHtml
      .replace(/<\/?(?:div|p|tr|table|section|article|header|footer|li|ul|ol|br|hr|h[1-6]|td|th)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
  const textReadAt = nowMs();
  const parsedAt = textReadAt;
  const normalized = text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?([,:;.)])/g, "$1")
    .trim();
  const finishedAt = nowMs();

  return {
    text: normalized,
    diagnostics: {
      sanitizeMs: elapsedMs(sanitizeStartedAt, sanitizedAt),
      domParseMs: elapsedMs(sanitizedAt, parsedAt),
      textReadMs: elapsedMs(parsedAt, textReadAt),
      cleanupMs: elapsedMs(textReadAt, finishedAt),
      normalizeMs: elapsedMs(sanitizeStartedAt, finishedAt)
    }
  };
}

function getPatterns(formType) {
  // 20-F の MD&A 相当は Item 5「Operating and Financial Review and Prospects」。
  // TSMC は様式名と違って "Reviews"(複数形)で書く。章題の後にダッシュか閉じ引用符が
  // 続くものは相互参照なので入口にしない。Worker 側 `src/extractors/mda.ts` と対。
  if (formType === "20-F") {
    return {
      start: [
        /item\s+5\b[\s.: -]*operating and financial reviews? and prospects(?!\s*[–—”"'-])/gi,
        /operating and financial reviews? and prospects(?!\s*[–—”"'-])/gi
      ],
      end: [
        /item\s+6\b[\s.: -]*directors,? senior management and employees/gi,
        /item\s+6\b/gi,
        /directors,? senior management and employees/gi
      ]
    };
  }

  if (formType === "10-K") {
    return {
      start: [
        /item\s+7\b[\s.: -]*management['’]?s discussion and analysis/gi,
        /item\s+7\b/gi,
        /management['’]?s discussion and analysis(?: of financial condition and results of operations)?/gi
      ],
      end: [
        /item\s+7a\b[\s.: -]*quantitative and qualitative disclosures/gi,
        /item\s+8\b[\s.: -]*financial statements/gi,
        /item\s+8\b/gi,
        /quantitative and qualitative disclosures about market risk/gi,
        /financial statements and supplementary data/gi
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

function findAllMatches(text, patterns, boundaryType) {
  const matches = [];
  for (const pattern of patterns) {
    const cloned = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = cloned.exec(text)) !== null) {
      if (!isLikelySectionBoundary(text, match.index, match[0], pattern, boundaryType)) {
        continue;
      }
      matches.push({ index: match.index, pattern: pattern.source });
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

function isLikelySectionBoundary(text, index, matchedText, pattern, boundaryType) {
  if (!isGenericBoundaryPattern(pattern)) {
    return true;
  }

  const afterWindow = text.slice(index + matchedText.length, index + matchedText.length + 700);
  const nearAfterWindow = afterWindow.slice(0, 240);
  if (boundaryType === "start") {
    return (
      /our md&a begins|the following discussion|we then provide|significant events and trends impacting results/i.test(afterWindow) ||
      looksLikeNarrativeWindow(afterWindow)
    );
  }

  return (
    /we are affected by|we use derivative|our exposure|foreign currency|interest rates|item\s+8\b|financial statements/i.test(
      afterWindow
    ) || looksLikeNarrativeWindow(nearAfterWindow)
  );
}

function isGenericBoundaryPattern(pattern) {
  return !/item\\s\+\d|part\\s\+i\\b/i.test(pattern.source);
}

function looksLikeNarrativeWindow(text) {
  const sample = text.slice(0, 500);
  if (!sample || looksLikeTocWindow(sample)) {
    return false;
  }
  const lowercaseWordCount = [...sample.matchAll(/\b[a-z]{3,}\b/g)].length;
  const sentenceSignals = [...sample.matchAll(/[.!?]/g)].length;
  const proseSignals = [...sample.matchAll(/\b(?:we|our|the|this|these|during|results?|believe|expect|continue)\b/gi)]
    .length;
  return lowercaseWordCount >= 24 && (sentenceSignals >= 2 || proseSignals >= 4);
}

function looksLikeTocWindow(text) {
  const sample = text.slice(0, 320);
  const itemMentions = [...sample.matchAll(/item\s+\d/gi)].length;
  const pageMentions = [...sample.matchAll(/\bpages?\s*\d/gi)].length;
  return /table of contents/i.test(sample) || /pagepart/i.test(sample) || itemMentions >= 3 || pageMentions >= 2;
}

function stripLeadingNoise(candidate, startPatterns) {
  const innerMatches = findAllMatches(candidate, startPatterns, "start");
  if (innerMatches.length <= 1) {
    return candidate;
  }
  const leadingWindow = candidate.slice(0, Math.min(2_500, candidate.length));
  const itemMentions = [...leadingWindow.matchAll(/item\s+\d/gi)].length;
  const looksLikeToc = /table of contents/i.test(leadingWindow) || /pagepart/i.test(leadingWindow) || itemMentions >= 3;
  if (!looksLikeToc) {
    return candidate;
  }
  const replacement = innerMatches
    .slice(1)
    .reverse()
    .find((match) => match.index >= 120 && candidate.length - match.index >= MIN_SECTION_CHARS);
  return replacement ? candidate.slice(replacement.index).trim() : candidate;
}

function decodeHtmlEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, body) => {
    const normalizedBody = body.toLowerCase();
    if (normalizedBody === "nbsp") return " ";
    if (normalizedBody === "amp") return "&";
    if (normalizedBody === "lt") return "<";
    if (normalizedBody === "gt") return ">";
    if (normalizedBody === "quot") return "\"";
    if (normalizedBody === "apos" || normalizedBody === "#39") return "'";
    const codePoint = normalizedBody.startsWith("#x")
      ? Number.parseInt(normalizedBody.slice(2), 16)
      : normalizedBody.startsWith("#")
        ? Number.parseInt(normalizedBody.slice(1), 10)
        : Number.NaN;
    if (!Number.isFinite(codePoint)) {
      return entity;
    }
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return entity;
    }
  });
}

function trimToTokenBudget(text, maxTokens) {
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

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function elapsedMs(startedAt, finishedAt) {
  return Math.round((finishedAt - startedAt) * 10) / 10;
}
