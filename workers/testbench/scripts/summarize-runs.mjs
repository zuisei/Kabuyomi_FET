import { readFile } from "node:fs/promises";

const runPath = process.argv[2];

if (!runPath) {
  console.error("Usage: npm run testbench:summarize -- ./testbench/runs/<run-id>.jsonl");
  process.exit(1);
}

const rows = (await readFile(runPath, "utf8"))
  .split(/\r?\n/)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

if (rows.length === 0) {
  console.error("Run file is empty.");
  process.exit(1);
}

const responsePaths = countBy(rows, (row) => row.responsePath ?? "unknown");
const fallbackReasons = countBy(
  rows.filter((row) => row.fallbackReason),
  (row) => row.fallbackReason
);
const failureLabels = countBy(
  rows.flatMap((row) => observedFailureLabels(row)),
  (label) => label
);
const answerFlags = countBy(
  rows.flatMap((row) => row.answerQualityFlags ?? []),
  (label) => label
);
const invalidSourceRows = rows.filter((row) => row.sourceIdsValid === false);
const ratedRows = rows.filter((row) => typeof row.answerRating === "number");

console.log(`# Testbench Summary`);
console.log(`file: ${runPath}`);
console.log(`rows: ${rows.length}`);
console.log(`tickers: ${Array.from(new Set(rows.map((row) => row.ticker))).join(", ")}`);
console.log(`avg latency ms: ${average(rows.map((row) => row.latencyMs)).toFixed(0)}`);
console.log(`p95 latency ms: ${percentile(rows.map((row) => row.latencyMs), 0.95).toFixed(0)}`);
console.log(`avg source count: ${average(rows.map((row) => row.sourceCount)).toFixed(1)}`);
console.log(`sourceIdsValid false: ${invalidSourceRows.length}`);

if (ratedRows.length > 0) {
  console.log(`avg human rating: ${average(ratedRows.map((row) => row.answerRating)).toFixed(2)} (${ratedRows.length} rated)`);
}

printCounts("responsePath", responsePaths);
printCounts("fallbackReason", fallbackReasons);
printCounts("answerQualityFlags", answerFlags);
printCounts("failureLabelsObserved", failureLabels);

if (invalidSourceRows.length > 0) {
  console.log(`\n## Invalid Source ID Cases`);
  for (const row of invalidSourceRows) {
    console.log(`- ${row.caseId}: ${row.question}`);
  }
}

function countBy(values, keyFn) {
  const counts = new Map();
  for (const value of values) {
    const key = keyFn(value) ?? "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function printCounts(title, counts) {
  console.log(`\n## ${title}`);
  if (counts.length === 0) {
    console.log("- none");
    return;
  }
  for (const [key, count] of counts) {
    console.log(`- ${key}: ${count}`);
  }
}

function observedFailureLabels(row) {
  return Array.from(new Set([...(row.failureLabelsObserved ?? []), ...autoFailureLabels(row)]));
}

function autoFailureLabels(row) {
  const labels = [];
  const answer = String(row.answer ?? "");
  const sourceLabels = [
    ...(row.selectedSourceLabels ?? []),
    ...(row.sources ?? []).map((source) => source.sourceLabel ?? "")
  ].join(" ");
  const sourceText = `${sourceLabels} ${JSON.stringify(row.sources ?? [])}`.toLowerCase();

  if (row.intent === "prior_filing_delta") {
    if (!/(previous|prior|historical|前回|前期|前四半期|前の|過去)/i.test(sourceText)) {
      labels.push("retrieval_missing_prior_period");
    }
    if (/(前年同期比|前年比|year over year|yoy)/i.test(answer) && !/(前回|前四半期|前期|前の決算|previous|prior)/i.test(answer)) {
      labels.push("bad_comparison");
      labels.push("comparison_context_lost");
    }
  }

  if (row.intent === "cash_flow_quality") {
    if (/この数字がプラスで伸びているなら/.test(answer)) {
      labels.push("deterministic_template_leak");
      labels.push("conditional_template_mismatch");
    }
    if (/(JPM|JPMorgan|bank|銀行)/i.test(`${row.ticker} ${answer}`) && /本業からの現金創出/.test(answer)) {
      labels.push("sector_inappropriate_metric");
    }
  }

  if (row.intent === "liquidity_debt") {
    if (!/(liquidity|debt|borrowings?|credit facilit|maturit|cash and cash equivalents|流動性|負債|借入|現金)/i.test(sourceText)) {
      labels.push("retrieval_missing_liquidity_section");
    }
  }

  if (row.fallbackReason === "gemini_timeout" && (row.answerQualityFlags ?? []).includes("model_retry_used")) {
    labels.push("timeout_after_retry");
  }
  if (row.retryWasted === true || (row.answerQualityFlags ?? []).includes("retry_wasted")) {
    labels.push("retry_wasted");
  }
  if (row.fallbackReason === "gemini_api_error" && (row.answerQualityFlags ?? []).includes("model_retry_used")) {
    labels.push("api_error_after_retry");
  }

  if (["revenue_driver", "margin_driver", "segment_driver"].includes(row.intent)) {
    if (!hasDriverNarrativeSource(sourceText)) {
      labels.push("driver_source_missing");
    }
    if (/(具体的なdriverが十分に特定できていません|主因かまでは薄め|直接要因は明示されていません|具体的な(?:会社説明|要因|driver).*確認できません|driverまでは十分に確認できません)/i.test(answer)) {
      labels.push("driver_slot_empty");
    }
  }

  if (["driver_durability_followup", "margin_durability_followup"].includes(row.intent)) {
    if (/(前問.*具体的なdriverが十分に特定できていません|前問の要因.*十分に特定できていない|前問.*driver.*未特定)/i.test(answer)) {
      labels.push("followup_target_empty");
    }
  }

  if (["revenue_driver", "driver_durability_followup", "margin_durability_followup", "liquidity_debt"].includes(row.intent)) {
    if (isSectorRequiredSourceMissing(row, sourceText)) {
      labels.push("sector_required_source_missing");
    }
  }

  return labels;
}

function hasDriverNarrativeSource(sourceText) {
  return /(md&a|management'?s discussion|item\s*[127]|part\s*i\s*item\s*2|segment|revenue note|profitability context|filing context|segment and revenue context|10-[kq])/i.test(sourceText);
}

function isSectorRequiredSourceMissing(row, sourceText) {
  const ticker = String(row.ticker ?? "").toUpperCase();
  const haystack = sourceText.toLowerCase();
  if (ticker === "JPM") {
    return !/(net interest income|noninterest income|provision for credit losses|deposits?|loans?|credit quality|capital ratios?|liquidity|segment)/i.test(haystack);
  }
  if (ticker === "XOM") {
    return !/(commodity|crude oil|natural gas|upstream|downstream|refining margin|chemical margin|production volume|segment)/i.test(haystack);
  }
  if (ticker === "CAT") {
    return !/(price realization|sales volume|backlog|dealer inventory|construction industries|resource industries|energy and transportation|segment)/i.test(haystack);
  }
  if (ticker === "WMT") {
    return !/(comparable sales|comp sales|traffic|ticket|ecommerce|e-commerce|membership|advertising|inventory|gross margin|segment|walmart u\.s\.|sam'?s club)/i.test(haystack);
  }
  if (ticker === "AAPL") {
    return !/(iphone|services|mac|ipad|wearables|americas|greater china|japan|geographic|segment|product)/i.test(haystack);
  }
  return false;
}

function average(values) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  if (numeric.length === 0) {
    return 0;
  }
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function percentile(values, ratio) {
  const numeric = values.filter((value) => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (numeric.length === 0) {
    return 0;
  }
  const index = Math.min(numeric.length - 1, Math.ceil(numeric.length * ratio) - 1);
  return numeric[index];
}
