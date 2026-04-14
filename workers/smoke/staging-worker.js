const SEC_HEADERS = {
  "user-agent": "Kabuyomi admin@kabuyomi.app",
  "accept": "application/json,text/html;q=0.9,*/*;q=0.8"
};

let tickerSnapshotPromise;
const submissionsPromiseByCIK = new Map();

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/v1/search") {
        const query = (url.searchParams.get("q") || "").trim();
        if (!query) {
          return json({ items: [], snapshotUpdatedAt: null });
        }

        const snapshot = await getTickerSnapshot();
        const lowered = query.toLowerCase();
        const items = snapshot.items
          .map((item) => ({
            item,
            score: scoreTickerSearch(item, lowered)
          }))
          .filter((candidate) => candidate.score !== null)
          .sort((left, right) => {
            if (left.score !== right.score) {
              return left.score - right.score;
            }

            if (left.item.ticker.length !== right.item.ticker.length) {
              return left.item.ticker.length - right.item.ticker.length;
            }

            return left.item.ticker.localeCompare(right.item.ticker);
          })
          .map((candidate) => candidate.item)
          .slice(0, 20);

        return json({ items, snapshotUpdatedAt: snapshot.updatedAt });
      }

      if (request.method === "POST" && url.pathname === "/v1/watchlist/add") {
        const body = await request.json();
        const company = await buildCompanyPayload(body.ticker);
        return json({
          company,
          usage: defaultUsage()
        });
      }

      if (request.method === "GET" && url.pathname.startsWith("/v1/company/")) {
        const ticker = decodeURIComponent(url.pathname.split("/")[3] || "");
        return json(await buildCompanyPayload(ticker));
      }

      if (request.method === "POST" && url.pathname.startsWith("/v1/company/") && url.pathname.endsWith("/refresh")) {
        const ticker = decodeURIComponent(url.pathname.split("/")[3] || "");
        return json(await buildCompanyPayload(ticker));
      }

      if (request.method === "POST" && url.pathname === "/v1/chat") {
        const body = await request.json();
        const [_, cik, accession] = String(body.filingKey || "").split(":");
        if (!cik || !accession) {
          return json({ error: "Invalid filing key" }, 400);
        }

        const company = await buildCompanyPayloadFromFiling(cik, accession);
        const answer = buildChatAnswer(company.sourceChunks, String(body.question || ""));
        return json({
          answer: answer.answer,
          sources: answer.sources,
          usage: defaultUsage()
        });
      }

      if (request.method === "GET" && url.pathname === "/v1/usage") {
        return json(defaultUsage());
      }

      if (request.method === "POST" && url.pathname === "/v1/billing/sync") {
        return json({
          plan: "free",
          quotaSubject: "free:staging",
          productId: null,
          syncedAt: new Date().toISOString()
        });
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
    }
  }
};

async function buildCompanyPayload(ticker) {
  const snapshot = await getTickerSnapshot();
  const match = snapshot.items.find((item) => item.ticker.toUpperCase() === String(ticker || "").toUpperCase());
  if (!match) {
    throw new Error(`Ticker not found: ${ticker}`);
  }

  const filing = await pickLatestSupportedFiling(match);
  if (!filing) {
    throw new Error(`No supported filing found for ${ticker}`);
  }

  return buildCompanyPayloadFromFiling(match.cik, filing.accessionNumber.replaceAll("-", ""), filing, match);
}

async function buildCompanyPayloadFromFiling(cik, accession, filingOverride, tickerOverride) {
  const snapshot = tickerOverride ? null : await getTickerSnapshot();
  const tickerRecord = tickerOverride || snapshot.items.find((item) => item.cik === cik);
  if (!tickerRecord) {
    throw new Error(`CIK not found: ${cik}`);
  }

  const filing = filingOverride || await findFilingByAccession(tickerRecord, accession);
  if (!filing) {
    throw new Error(`Filing not found: ${accession}`);
  }

  const primaryDocumentUrl = `https://www.sec.gov/Archives/edgar/data/${Number(filing.cik)}/${filing.accessionNumber.replaceAll("-", "")}/${filing.primaryDocument}`;
  const html = await fetchText(primaryDocumentUrl);
  const mdaText = extractMDAText(html, filing.formType);
  const metrics = [];
  const sourceChunks = buildSourceChunks(filing, mdaText, metrics);
  const summary = buildSummary(tickerRecord.companyName, filing.formType, metrics, sourceChunks);

  return {
    filingKey: `v1:${filing.cik}:${filing.accessionNumber.replaceAll("-", "")}`,
    ticker: filing.ticker,
    companyName: filing.companyName,
    cik: filing.cik,
    formType: filing.formType,
    filedAt: filing.filedAt,
    periodOfReport: filing.periodOfReport,
    primaryDocumentUrl,
    summary,
    metrics,
    sourceChunks,
    lastUpdatedAt: new Date().toISOString()
  };
}

async function getTickerSnapshot() {
  tickerSnapshotPromise ||= (async () => {
    const payload = await fetchJSON("https://www.sec.gov/files/company_tickers_exchange.json");
    const fields = payload.fields || ["cik", "name", "ticker", "exchange"];
    const fieldIndex = Object.fromEntries(fields.map((field, index) => [field, index]));
    return {
      updatedAt: new Date().toISOString(),
      items: payload.data.map((row) => ({
        cik: String(row[fieldIndex.cik] || "").padStart(10, "0"),
        companyName: String(row[fieldIndex.name] || ""),
        ticker: String(row[fieldIndex.ticker] || "").toUpperCase(),
        exchange: String(row[fieldIndex.exchange] || "")
      }))
    };
  })();

  return tickerSnapshotPromise;
}

async function pickLatestSupportedFiling(tickerRecord) {
  const submissions = await fetchSubmissions(tickerRecord.cik);
  const recent = findSupportedFilingInSeries(tickerRecord, submissions.filings?.recent);
  if (recent) {
    return recent;
  }

  for (const file of submissions.filings?.files || []) {
    const archive = await fetchSubmissionArchive(file.name);
    const archived = findSupportedFilingInSeries(tickerRecord, archive);
    if (archived) {
      return archived;
    }
  }

  return null;
}

async function findFilingByAccession(tickerRecord, accession) {
  const accessionNumber = accessionToDashed(accession);
  const submissions = await fetchSubmissions(tickerRecord.cik);
  const recent = findFilingInSeries(tickerRecord, submissions.filings?.recent, accessionNumber);
  if (recent) {
    return recent;
  }

  for (const file of submissions.filings?.files || []) {
    const archive = await fetchSubmissionArchive(file.name);
    const archived = findFilingInSeries(tickerRecord, archive, accessionNumber);
    if (archived) {
      return archived;
    }
  }

  return inspectAccession(tickerRecord, accession.replaceAll("-", ""));
}

async function inspectAccession(tickerRecord, accessionNoDashes) {
  const indexHeadersURL = `https://www.sec.gov/Archives/edgar/data/${Number(tickerRecord.cik)}/${accessionNoDashes}/${accessionToDashed(accessionNoDashes)}-index-headers.html`;
  const headerText = await fetchText(indexHeadersURL);
  const formType = normalizeForm(capture(headerText, /CONFORMED SUBMISSION TYPE:\s*([^\n<]+)/i));
  if (!formType) {
    return null;
  }

  const filedAtRaw = capture(headerText, /FILED AS OF DATE:\s*([0-9]{8})/i);
  const periodRaw = capture(headerText, /CONFORMED PERIOD OF REPORT:\s*([0-9]{8})/i) || filedAtRaw;
  const directory = await fetchJSON(`https://www.sec.gov/Archives/edgar/data/${Number(tickerRecord.cik)}/${accessionNoDashes}/index.json`);
  const primaryDocument =
    pickPrimaryDocumentFromHeader(headerText, formType) ||
    pickPrimaryDocument(directory.directory?.item || [], formType);

  if (!primaryDocument) {
    return null;
  }

  return {
    cik: tickerRecord.cik,
    ticker: tickerRecord.ticker,
    companyName: tickerRecord.companyName,
    exchange: tickerRecord.exchange,
    formType,
    accessionNumber: accessionToDashed(accessionNoDashes),
    primaryDocument,
    filedAt: formatSECDate(filedAtRaw),
    periodOfReport: formatSECDate(periodRaw)
  };
}

function extractMDAText(html, formType) {
  const htmlSection = extractMDAHtmlSection(html, formType);
  if (htmlSection) {
    return normalizeSectionText(htmlSection).slice(0, 60000);
  }

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const patterns = formType === "10-K"
    ? {
        starts: [
          /item 7 management'?s discussion and analysis/i,
          /item 7/i
        ],
        ends: [
          /item 7a quantitative and qualitative disclosures/i,
          /item 8 financial statements/i,
          /item 8/i
        ]
      }
    : {
        starts: [
          /part i item 2 management'?s discussion and analysis/i,
          /item 2 management'?s discussion and analysis/i,
          /part i item 2/i
        ],
        ends: [
          /item 3 quantitative and qualitative disclosures/i,
          /item 4 controls and procedures/i,
          /item 3/i,
          /item 4/i
        ]
      };

  const starts = findMatches(text, patterns.starts);
  const ends = findMatches(text, patterns.ends);

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const nextStart = starts[i + 1];
    if (nextStart && nextStart.index - start.index < 1000) {
      continue;
    }

    for (const end of ends) {
      if (end.index <= start.index) {
        continue;
      }
      const candidate = text.slice(start.index, end.index).trim();
      if (candidate.length < 2400) {
        continue;
      }
      return candidate.slice(0, 60000);
    }
  }

  return text.slice(0, 12000);
}

function extractMDAHtmlSection(html, formType) {
  const patterns = formType === "10-K"
    ? {
        starts: [
          /item\s*7\.(?:.|\n){0,300}?management(?:.|\n){0,300}?discussion/gi,
          /part\s*ii(?:.|\n){0,300}?item\s*7\./gi,
          /item\s*7\./gi
        ],
        ends: [
          /item\s*7a\.(?:.|\n){0,300}?quantitative(?:.|\n){0,300}?qualitative/gi,
          /item\s*8\.(?:.|\n){0,300}?financial statements/gi,
          /item\s*8\./gi
        ]
      }
    : {
        starts: [
          /item\s*2\.(?:.|\n){0,300}?management(?:.|\n){0,300}?discussion/gi,
          /part\s*i(?:.|\n){0,300}?item\s*2\./gi
        ],
        ends: [
          /item\s*3\.(?:.|\n){0,300}?quantitative(?:.|\n){0,300}?qualitative/gi,
          /item\s*4\.(?:.|\n){0,300}?controls(?:.|\n){0,300}?procedures/gi,
          /item\s*3\./gi,
          /item\s*4\./gi
        ]
      };

  const starts = findMatches(html, patterns.starts);
  const ends = findMatches(html, patterns.ends);

  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const nextStart = starts[i + 1];
    if (nextStart && nextStart.index - start.index < 5000) {
      continue;
    }

    for (const end of ends) {
      if (end.index <= start.index) {
        continue;
      }

      const candidate = html.slice(start.index, end.index).trim();
      if (looksLikeTOCCandidate(candidate)) {
        continue;
      }
      if (candidate.length < 20000) {
        continue;
      }

      return candidate;
    }
  }

  return null;
}

function looksLikeTOCCandidate(sectionHtml) {
  const preview = normalizeSectionText(sectionHtml.slice(0, 2500)).toLowerCase();
  const signals = [
    preview.includes("table of contents"),
    preview.includes("part ii. other information"),
    preview.includes("item 3. quantitative and qualitative"),
    preview.includes("item 4. controls and procedures"),
    preview.includes("signatures")
  ].filter(Boolean).length;
  return signals >= 2;
}

function normalizeSectionText(sectionHtml) {
  return decodeHtmlEntities(
    sectionHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, "\"")
    .replace(/&#8221;/g, "\"")
    .replace(/&#8211;/g, "-")
    .replace(/&#8212;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#([0-9]+);/g, (_, codePoint) => String.fromCharCode(Number(codePoint)));
}

function findMatches(text, patterns) {
  const matches = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const cloned = new RegExp(pattern.source, flags);
    let match;
    while ((match = cloned.exec(text)) !== null) {
      matches.push({ index: match.index });
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

function buildSourceChunks(filing, mdaText, metrics) {
  const chunks = [];
  const paragraphs = mdaText.match(/.{1,900}(?:\s|$)/g) || [mdaText];
  let offset = 0;
  let sourceIndex = 1;

  for (const paragraph of paragraphs.slice(0, 8)) {
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "md_a",
      sectionTitle: filing.formType === "10-K" ? "Item 7" : "Part I, Item 2",
      sourceLabel: `${filing.formType} ${filing.formType === "10-K" ? "Item 7" : "Part I Item 2"}, filed ${filing.filedAt}`,
      text: paragraph.trim(),
      startOffset: offset,
      endOffset: offset + paragraph.length,
      sortOrder: sourceIndex
    });
    offset += paragraph.length;
    sourceIndex += 1;
  }

  for (const metric of metrics) {
    chunks.push({
      sourceId: `S${sourceIndex}`,
      sectionType: "xbrl_metric",
      sectionTitle: metricTitle(metric.logicalName),
      sourceLabel: `XBRL ${metricTitle(metric.logicalName)} (${metric.tagUsed})`,
      text: [
        `${metricTitle(metric.logicalName)}: ${metric.value} ${metric.unit}`,
        metric.comparisonValue !== undefined ? `比較値: ${metric.comparisonValue}` : null,
        metric.yoyPercent !== undefined ? `YoY: ${metric.yoyPercent.toFixed(1)}%` : null
      ].filter(Boolean).join(" / "),
      startOffset: 0,
      endOffset: 0,
      tagName: metric.tagUsed,
      sortOrder: sourceIndex
    });
    sourceIndex += 1;
  }

  return chunks;
}

function buildSummary(companyName, formType, metrics, sourceChunks) {
  const headlineMetric = metrics.find((metric) => metric.yoyPercent !== undefined) || metrics[0];
  return {
    verdict: headlineMetric
      ? `${companyName}\u306e\u6700\u65b0${formType}\u3067\u306f\u3001${metricTitle(headlineMetric.logicalName)}\u3092\u4e2d\u5fc3\u306b\u63d0\u51fa\u8cc7\u6599\u30d9\u30fc\u30b9\u3067\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002`
      : `${companyName}\u306e\u6700\u65b0${formType}\u3092\u65e5\u672c\u8a9e\u3067\u78ba\u8a8d\u3067\u304d\u307e\u3059\u3002`,
    highlights: sourceChunks.filter((chunk) => chunk.sectionType === "md_a").slice(0, 2).map((chunk) => ({
      text: chunk.text.slice(0, 120),
      sourceIds: [chunk.sourceId]
    })),
    changes: sourceChunks.filter((chunk) => chunk.sectionType === "xbrl_metric").slice(0, 2).map((chunk) => ({
      text: chunk.text,
      sourceIds: [chunk.sourceId]
    }))
  };
}

function buildChatAnswer(sourceChunks, question) {
  const terms = String(question || "").toLowerCase().split(/\s+/).filter((term) => term.length >= 2);
  const ranked = sourceChunks.map((chunk) => ({
    chunk,
    score: terms.reduce((sum, term) => sum + (chunk.text.toLowerCase().includes(term) ? 1 : 0), 0)
  })).sort((left, right) => right.score - left.score);

  const best = ranked[0]?.chunk || sourceChunks[0];
  const hasSignal = ranked[0]?.score > 0;

  return {
    answer: hasSignal ? `${best.text.slice(0, 180)}...` : "\u3053\u306e filing \u306e\u63d0\u4f9b\u30b3\u30f3\u30c6\u30ad\u30b9\u30c8\u3067\u306f\u78ba\u8a8d\u3067\u304d\u307e\u305b\u3093\u3002",
    sources: [{
      sourceId: best.sourceId,
      sectionType: best.sectionType,
      sourceLabel: best.sourceLabel,
      excerpt: best.text.slice(0, 220)
    }]
  };
}

function metricTitle(logicalName) {
  return {
    revenue: "\u58f2\u4e0a\u9ad8",
    netIncome: "\u7d14\u5229\u76ca",
    epsBasic: "EPS\uff08Basic\uff09",
    operatingIncome: "\u55b6\u696d\u5229\u76ca",
    operatingCashFlow: "\u55b6\u696dCF"
  }[logicalName] || logicalName;
}

function normalizeForm(form) {
  if (!form) {
    return null;
  }
  if (String(form).startsWith("10-K")) {
    return "10-K";
  }
  if (String(form).startsWith("10-Q")) {
    return "10-Q";
  }
  return null;
}

function scoreTickerSearch(item, query) {
  const ticker = item.ticker.toLowerCase();
  const companyName = item.companyName.toLowerCase();

  if (ticker === query) {
    return 0;
  }

  if (ticker.startsWith(query)) {
    return 1;
  }

  if (companyName === query) {
    return 2;
  }

  if (companyName.startsWith(query)) {
    return 3;
  }

  if (ticker.includes(query)) {
    return 4;
  }

  if (companyName.includes(query)) {
    return 5;
  }

  return null;
}

function findSupportedFilingInSeries(tickerRecord, series) {
  if (!series?.form?.length) {
    return null;
  }

  for (let index = 0; index < series.form.length; index += 1) {
    const formType = normalizeForm(series.form[index]);
    if (!formType) {
      continue;
    }

    const filing = filingFromSeriesIndex(tickerRecord, series, index, formType);
    if (filing) {
      return filing;
    }
  }

  return null;
}

function findFilingInSeries(tickerRecord, series, accessionNumber) {
  if (!series?.accessionNumber?.length) {
    return null;
  }

  for (let index = 0; index < series.accessionNumber.length; index += 1) {
    if (String(series.accessionNumber[index] || "") !== accessionNumber) {
      continue;
    }

    const formType = normalizeForm(series.form[index]);
    if (!formType) {
      return null;
    }

    return filingFromSeriesIndex(tickerRecord, series, index, formType);
  }

  return null;
}

function filingFromSeriesIndex(tickerRecord, series, index, formType) {
  const accessionNumber = String(series.accessionNumber?.[index] || "");
  const primaryDocument = String(series.primaryDocument?.[index] || "").trim();
  if (!accessionNumber || !primaryDocument) {
    return null;
  }

  return {
    cik: tickerRecord.cik,
    ticker: tickerRecord.ticker,
    companyName: tickerRecord.companyName,
    exchange: tickerRecord.exchange,
    formType,
    accessionNumber,
    primaryDocument,
    filedAt: String(series.filingDate?.[index] || ""),
    periodOfReport: String(series.reportDate?.[index] || series.filingDate?.[index] || "")
  };
}

function pickPrimaryDocumentFromHeader(headerText, formType) {
  const escapedPattern = new RegExp(
    `&lt;DOCUMENT&gt;[\\s\\S]*?&lt;TYPE&gt;${escapeRegExp(formType)}(?:[\\s\\S]*?)&lt;FILENAME&gt;([^\\s<]+)`,
    "i"
  );
  const rawPattern = new RegExp(
    `<DOCUMENT>[\\s\\S]*?<TYPE>${escapeRegExp(formType)}(?:[\\s\\S]*?)<FILENAME>([^\\s<]+)`,
    "i"
  );

  return capture(headerText, escapedPattern) || capture(headerText, rawPattern) || null;
}

function pickPrimaryDocument(items, formType) {
  const candidates = items
    .map((item) => String(item.name || ""))
    .filter((name) => /\.html?$/i.test(name))
    .filter((name) => !isExcludedDocumentName(name))
    .map((name) => ({
      name,
      score: scorePrimaryDocument(name, formType)
    }))
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.name || null;
}

function scorePrimaryDocument(name, formType) {
  const lowered = name.toLowerCase();
  let score = 0;

  if (formType === "10-Q" && lowered.includes("10-q")) {
    score += 80;
  }
  if (formType === "10-K" && lowered.includes("10-k")) {
    score += 80;
  }
  if (lowered.startsWith("form") || lowered.startsWith("d")) {
    score += 10;
  }
  if (/^[a-z0-9-]+-\d{8}\.html?$/i.test(name)) {
    score += 100;
  }
  if (/^[a-z0-9-]+-\d{8}\.htm$/i.test(name)) {
    score += 20;
  }

  return score;
}

function isExcludedDocumentName(name) {
  const lowered = name.toLowerCase();
  return lowered.includes("index")
    || lowered.startsWith("r")
    || lowered.includes("exhibit")
    || lowered.startsWith("ex-")
    || lowered.includes("filingsummary")
    || lowered.endsWith(".xml")
    || lowered.endsWith(".xsd")
    || lowered.endsWith(".xsl")
    || lowered.endsWith(".txt");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function accessionToDashed(accessionNoDashes) {
  const raw = String(accessionNoDashes);
  if (raw.includes("-")) {
    return raw;
  }
  return `${raw.slice(0, 10)}-${raw.slice(10, 12)}-${raw.slice(12)}`;
}

function capture(text, pattern) {
  return pattern.exec(text)?.[1]?.trim() || "";
}

function formatSECDate(raw) {
  const value = String(raw || "");
  if (value.length !== 8) {
    return value;
  }
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function defaultUsage() {
  return {
    plan: "free",
    chatsUsed: 0,
    chatLimit: 3,
    stocksUsed: 0,
    stockLimit: 3,
    dateJST: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date())
  };
}

async function fetchJSON(url) {
  const response = await fetch(url, { headers: SEC_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function fetchSubmissions(cik) {
  const cacheKey = String(cik).padStart(10, "0");
  if (!submissionsPromiseByCIK.has(cacheKey)) {
    submissionsPromiseByCIK.set(cacheKey, fetchJSON(`https://data.sec.gov/submissions/CIK${cacheKey}.json`));
  }

  try {
    return await submissionsPromiseByCIK.get(cacheKey);
  } catch (error) {
    submissionsPromiseByCIK.delete(cacheKey);
    throw error;
  }
}

async function fetchSubmissionArchive(name) {
  return fetchJSON(`https://data.sec.gov/submissions/${name}`);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: SEC_HEADERS });
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }
  return response.text();
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}
