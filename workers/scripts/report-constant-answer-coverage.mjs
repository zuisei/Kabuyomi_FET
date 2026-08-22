#!/usr/bin/env node
// Reports, per production tracked ticker, which constant-derived answer paths
// can fire for it. Nothing here changes an answer: it makes the existing
// coverage visible so the "every statement has a source" claim can be checked
// against what the code actually does.
//
// The tables are module-private, so this reads them out of the source rather
// than importing them. Every extractor asserts it found something — if a table
// is renamed or restructured this fails loudly instead of silently reporting
// "no coverage".
//
// Usage: node scripts/report-constant-answer-coverage.mjs [--write]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workers = resolve(here, "..");
const repo = resolve(workers, "..");

function read(relativePath) {
  return readFileSync(resolve(workers, relativePath), "utf8");
}

function fail(message) {
  console.error(`report-constant-answer-coverage: ${message}`);
  process.exit(1);
}

/** Pulls the top-level keys out of an object literal declared as `<declaration> {` ... `};`. */
function objectLiteralKeys(source, declaration, label) {
  const start = source.indexOf(declaration);
  if (start === -1) fail(`could not find ${label} (${declaration})`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    else if (source[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = source.slice(open + 1, end);
  // Only depth-1 keys: strip nested objects first.
  let flattened = "";
  depth = 0;
  for (const char of body) {
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (depth === 0) flattened += char;
  }
  const keys = [...flattened.matchAll(/(?:^|,)\s*([A-Z][A-Z0-9.\-]{0,15})\s*:/g)].map((m) => m[1]);
  if (keys.length === 0) fail(`${label} produced no ticker keys — the table shape changed`);
  return new Set(keys);
}

/** Pulls tickers out of an inline array literal on the line matching `anchor`. */
function inlineArrayTickers(source, anchor, label) {
  const line = source.split("\n").find((candidate) => candidate.includes(anchor));
  if (!line) fail(`could not find ${label} (${anchor})`);
  const tickers = [...line.matchAll(/"([A-Z][A-Z0-9.\-]{0,15})"/g)].map((m) => m[1]);
  if (tickers.length === 0) fail(`${label} produced no tickers — the shape changed`);
  return new Set(tickers);
}

const trackedSource = read("src/lib/tracked-tickers.ts");
const trackedBlock = trackedSource.slice(
  trackedSource.indexOf("DEFAULT_TRACKED_TICKERS"),
  trackedSource.indexOf("] as const")
);
const tracked = [...trackedBlock.matchAll(/"([A-Z][A-Z0-9.\-]{0,15})"/g)].map((m) => m[1]);
if (tracked.length === 0) fail("DEFAULT_TRACKED_TICKERS produced no tickers");

const deterministic = read("src/lib/chat/deterministic.ts");
const factualPack = read("src/lib/chat/context-factual-pack.ts");
const knownBusiness = read("src/clients/gemini/fallback-known-business.ts");
const sourceGate = read("src/lib/chat/source-gate.ts");
const finalizer = read("src/lib/chat/response-finalizer.ts");

const surfaces = [
  {
    key: "事業内容(定数)",
    where: "deterministic.ts TICKER_BUSINESS_OVERVIEWS",
    note: "「{社名}は、{定数}で収益を得ている会社です。」を返し、filing の実ソースをチップとして添付する",
    tickers: objectLiteralKeys(deterministic, "const TICKER_BUSINESS_OVERVIEWS", "TICKER_BUSINESS_OVERVIEWS")
  },
  {
    key: "売上区分(定数)",
    where: "deterministic.ts TICKER_REVENUE_BREAKDOWNS",
    note: "売上の内訳を定数で提示する",
    tickers: objectLiteralKeys(deterministic, "const TICKER_REVENUE_BREAKDOWNS", "TICKER_REVENUE_BREAKDOWNS")
  },
  {
    key: "許可ラベル(定数)",
    where: "deterministic.ts issuerSignalLabels",
    note: "抽出されたシグナルをこの定数リストに載っているものだけに絞る",
    tickers: objectLiteralKeys(deterministic, "const issuerSignalLabels", "issuerSignalLabels")
  },
  {
    key: "factual pack への seed",
    where: "context-factual-pack.ts seedKnownTickerLabels",
    note: "**本文に出ているかに関係なく** merge され、プロンプトは factual pack を raw excerpt より優先しろと指示する",
    tickers: objectLiteralKeys(factualPack, "const seeds: Record<string, Record<typeof field, string[]>>", "seedKnownTickerLabels seeds")
  },
  {
    key: "既知事業ラベル",
    where: "context-factual-pack.ts hasKnownBusinessLabels",
    note: "定数ラベルを持つ銘柄として扱う",
    tickers: inlineArrayTickers(factualPack, '"PH", "CRWD", "INTU", "CEG"', "hasKnownBusinessLabels")
  },
  {
    key: "売上ファクト seed",
    where: "context-factual-pack.ts seedKnownTickerRevenueFacts",
    note: "売上区分を定数で seed する",
    tickers: inlineArrayTickers(factualPack, 'if (!["AAPL", "MSFT", "AMZN"', "seedKnownTickerRevenueFacts")
  },
  {
    key: "定数の事業説明",
    where: "gemini/fallback-known-business.ts",
    note: "完全な定数文字列を返す",
    tickers: new Set([...knownBusiness.matchAll(/ticker === "([A-Z][A-Z0-9.\-]{0,15})"/g)].map((m) => m[1]))
  },
  {
    key: "sector 判定表",
    where: "source-gate.ts normalizeSector",
    note: "この表に無い銘柄は companyName のキーワードだけで sector が決まる",
    tickers: new Set([...sourceGate.matchAll(/tickerKey === "([A-Z][A-Z0-9.\-]{0,15})"/g)].map((m) => m[1]))
  }
];

// The durability syntheses gate on a company-name regex rather than a ticker table.
const synthesisGates = [
  { key: "JPM 定型合成", pattern: /\bJPM\b/, where: "response-finalizer.ts buildJpmDurabilitySynthesis" },
  { key: "WMT 定型合成", pattern: /\bWMT\b/, where: "response-finalizer.ts buildWmtDurabilitySynthesis" },
  { key: "GOOG(L) 定型合成", pattern: /\bGOOGL?\b/, where: "response-finalizer.ts buildGoogleDurabilitySynthesis" }
];
for (const gate of synthesisGates) {
  if (!finalizer.includes(gate.where.split(" ")[1])) fail(`could not find ${gate.where}`);
}

const rows = tracked.map((ticker) => {
  const hits = surfaces.filter((surface) => surface.tickers.has(ticker)).map((surface) => surface.key);
  const gateHits = synthesisGates.filter((gate) => gate.pattern.test(ticker)).map((gate) => gate.key);
  return { ticker, hits: [...hits, ...gateHits] };
});

const uncovered = surfaces.flatMap((surface) =>
  [...surface.tickers].filter((ticker) => !tracked.includes(ticker)).map((ticker) => ({ surface: surface.key, ticker }))
);

const lines = [];
lines.push("# 定数由来の回答が発火しうる範囲(自動生成)");
lines.push("");
lines.push("`node workers/scripts/report-constant-answer-coverage.mjs --write` で再生成する。**手で編集しない。**");
lines.push("");
lines.push("回答を変更するものではない。「すべての記述に、出典があります」という表示に対して、");
lines.push("実際にはどこまでが filing 由来でどこからが定数由来なのかを見えるようにするための表。");
lines.push("");
lines.push("**読み方の注意**: ここに出るのは「ティッカーで門が開くか」であって、");
lines.push("「その質問で必ず発火するか」ではない。定型合成は evidence の有無と");
lines.push("回答の未達判定も条件にする。逆に `factual pack への seed` は");
lines.push("**本文の有無に関係なく** merge されるので、門が開けば必ず入る。");
lines.push("");
lines.push(`本番の追跡銘柄: ${tracked.length}件 (\`DEFAULT_TRACKED_TICKERS\`)`);
lines.push("");
lines.push("## 銘柄ごと");
lines.push("");
lines.push("| ティッカー | 定数経路の数 | 発火しうる経路 |");
lines.push("|---|---:|---|");
for (const row of rows) {
  lines.push(`| \`${row.ticker}\` | ${row.hits.length} | ${row.hits.length === 0 ? "—" : row.hits.join(" / ")} |`);
}
lines.push("");
const covered = rows.filter((row) => row.hits.length > 0);
lines.push(`**${covered.length}/${tracked.length} 銘柄**が1つ以上の定数経路に該当する。`);
lines.push("");
lines.push("## 経路ごと");
lines.push("");
lines.push("| 経路 | 場所 | 本番銘柄の該当数 | 内容 |");
lines.push("|---|---|---:|---|");
for (const surface of surfaces) {
  const hit = tracked.filter((ticker) => surface.tickers.has(ticker));
  lines.push(`| ${surface.key} | \`${surface.where}\` | ${hit.length}/${tracked.length} | ${surface.note} |`);
}
for (const gate of synthesisGates) {
  const hit = tracked.filter((ticker) => gate.pattern.test(ticker));
  lines.push(`| ${gate.key} | \`${gate.where}\` | ${hit.length}/${tracked.length} | 完全な定数文字列。ラベルは \`source_backed\` を名乗る |`);
}
lines.push("");
lines.push("## 本番の追跡リストに載っていない銘柄向けの定数");
lines.push("");
if (uncovered.length === 0) {
  lines.push("なし。");
} else {
  lines.push("| 経路 | ティッカー |");
  lines.push("|---|---|");
  const grouped = new Map();
  for (const entry of uncovered) {
    if (!grouped.has(entry.surface)) grouped.set(entry.surface, []);
    grouped.get(entry.surface).push(entry.ticker);
  }
  for (const [surface, tickers] of grouped) {
    lines.push(`| ${surface} | ${tickers.map((t) => `\`${t}\``).join(", ")} |`);
  }
  lines.push("");
  lines.push("これらは本番で追跡されていないため、表に載っていても発火する経路が無い。");
}

const report = lines.join("\n") + "\n";
if (process.argv.includes("--write")) {
  const out = resolve(repo, "docs/quality/CONSTANT_ANSWER_COVERAGE.md");
  writeFileSync(out, report);
  console.log(`wrote ${out}`);
} else {
  process.stdout.write(report);
}
