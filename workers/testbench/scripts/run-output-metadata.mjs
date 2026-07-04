export function buildRunMetadata(rows) {
  const first = rows[0] ?? {};
  const templateCount = countUnique(rows, (row) => row.templateId);
  const tickerCount = countUnique(rows, (row) => row.ticker);
  return {
    questions: formatRecordedPath(first.questionsPath, templateCount, "templates"),
    companySet: formatRecordedPath(first.companySetPath, tickerCount, "tickers"),
    questionTemplateCount: first.questionTemplateCount ?? templateCount,
    companyTickerCount: first.companyTickerCount ?? tickerCount
  };
}

export function runMetadataLines(rows) {
  const metadata = buildRunMetadata(rows);
  return [
    `questions: ${metadata.questions}`,
    `companySet: ${metadata.companySet}`,
    `questionTemplates: ${metadata.questionTemplateCount}`,
    `companyTickers: ${metadata.companyTickerCount}`
  ];
}

function countUnique(rows, selector) {
  return new Set(rows.map(selector).filter((value) => value != null && String(value).length > 0)).size;
}

function formatRecordedPath(path, observedCount, observedUnit) {
  return typeof path === "string" && path.length > 0
    ? `\`${path}\``
    : `not recorded (${observedCount} ${observedUnit} observed)`;
}
