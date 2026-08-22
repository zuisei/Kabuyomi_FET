#!/usr/bin/env node
// Absence tripwire for the constant-answer surfaces.
//
// This script used to enumerate them: for each production tracked ticker, which
// constant-derived answer path could fire for it. That surface is gone — the
// tables and per-issuer synthesis functions were deleted rather than gated — so
// the script's job changed from measuring the surface to keeping it at zero.
//
// It fails if any of the deleted declarations reappears anywhere under
// workers/src. Reintroducing one is not a style question: each of them asserted
// a fact about a company that the filing was never consulted for, and then
// attached that filing's source chunks to the answer as citations. That is the
// exact behaviour the product's 「すべての記述に、出典があります」 claim rules out.
//
// Usage:
//   node scripts/report-constant-answer-coverage.mjs           # check, print report
//   node scripts/report-constant-answer-coverage.mjs --write    # also regenerate the doc

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workers = resolve(here, "..");
const repo = resolve(workers, "..");
const sourceRoot = resolve(workers, "src");

/**
 * The declarations removed when the constant-answer paths were deleted. A match
 * on any of these names under src/ means one came back.
 */
export const FORBIDDEN_DECLARATIONS = [
  {
    name: "TICKER_BUSINESS_OVERVIEWS",
    was: "lib/chat/deterministic.ts",
    served: "「{社名}は、{定数}で収益を得ている会社です。」+ filing の実ソースチップ"
  },
  {
    name: "TICKER_REVENUE_BREAKDOWNS",
    was: "lib/chat/deterministic.ts",
    served: "「売上構造を見る軸は、{定数}です。」+ filing の実ソースチップ"
  },
  {
    name: "seedKnownTickerLabels",
    was: "lib/chat/context-factual-pack.ts",
    served: "本文の有無に関係なく factual pack に定数ラベルを merge"
  },
  {
    name: "seedKnownTickerRevenueFacts",
    was: "lib/chat/context-factual-pack.ts",
    served: "本文の有無に関係なく factual pack に定数の売上区分を merge"
  },
  {
    name: "summarizeKnownCompanyBusiness",
    was: "clients/gemini/fallback-known-business.ts (ファイルごと削除)",
    served: "PH / CRWD / CEG / INTU の事業説明を完全な定数文字列で返す"
  },
  {
    name: "buildJpmDurabilitySynthesis",
    was: "lib/chat/response-finalizer.ts",
    served: "JPM 類似 filing に銀行業の定型段落を返し source_backed ラベルを付ける"
  },
  {
    name: "buildWmtDurabilitySynthesis",
    was: "lib/chat/response-finalizer.ts",
    served: "WMT 類似 filing に小売の定型段落を返し source_backed ラベルを付ける"
  },
  {
    name: "buildGoogleDurabilitySynthesis",
    was: "lib/chat/response-finalizer.ts",
    served: "Alphabet 類似 filing にプラットフォームの定型段落を返す"
  }
];

/**
 * Kept on purpose. Both are per-ticker tables, and neither can produce a claim:
 * they only narrow claims that extraction already matched against filing text.
 * Listed here so a reader does not take the zero above as "we stopped looking".
 */
export const DELIBERATELY_KEPT = [
  {
    name: "issuerSignalLabels",
    where: "lib/chat/deterministic.ts",
    why: "MD&A の実文から抽出済みのシグナルを、その発行体にとって意味のあるものだけに絞る。追加はできず、削るだけ。"
  },
  {
    name: "normalizeSector",
    where: "lib/chat/source-gate.ts",
    why: "どの根拠タイプを要求するかを決める sector 判定。回答文そのものを供給しない。"
  }
];

function listTypeScriptFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...listTypeScriptFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * @returns {{ files: number, violations: Array<{ name: string, file: string, line: number }> }}
 */
export function scanForConstantSurfaces(root = sourceRoot) {
  const files = listTypeScriptFiles(root);
  if (files.length === 0) {
    throw new Error(`no TypeScript files found under ${root} — the tripwire is not looking at the source tree`);
  }

  const violations = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const declaration of FORBIDDEN_DECLARATIONS) {
        if (text.includes(declaration.name)) {
          violations.push({ name: declaration.name, file: file.slice(workers.length + 1), line: index + 1 });
        }
      }
    });
  }
  return { files: files.length, violations };
}

export function buildReport(scan) {
  const lines = [];
  lines.push("# 定数由来の回答が発火しうる範囲(自動生成)");
  lines.push("");
  lines.push("`node workers/scripts/report-constant-answer-coverage.mjs --write` で再生成する。**手で編集しない。**");
  lines.push("");
  lines.push("## 現状: 0件");
  lines.push("");
  lines.push("会社固有の記述を定数として持ち、それに filing の実ソースチップを付けて返す経路は");
  lines.push("本番コードから削除済み。事業内容・売上区分・継続性の回答は、抽出結果か、");
  lines.push("別途出典検証を通るモデル経路か、根拠不足を認める回答のいずれかになる。");
  lines.push("");
  lines.push(`スクリプトは \`workers/src\` 配下の ${scan.files} ファイルを走査し、`);
  lines.push("下表の宣言が再び現れたら非ゼロ終了する。");
  lines.push("");
  lines.push("## 削除済みの宣言(再導入を禁止)");
  lines.push("");
  lines.push("| 宣言 | あった場所 | 返していたもの |");
  lines.push("|---|---|---|");
  for (const declaration of FORBIDDEN_DECLARATIONS) {
    lines.push(`| \`${declaration.name}\` | \`${declaration.was}\` | ${declaration.served} |`);
  }
  lines.push("");
  lines.push("## 意図的に残している銘柄別テーブル");
  lines.push("");
  lines.push("どちらも「実データに対するフィルタ・ゲート」であって、記述を作り出さない。");
  lines.push("この0件は「見るのをやめた」という意味ではない。");
  lines.push("");
  lines.push("| 名前 | 場所 | 残す理由 |");
  lines.push("|---|---|---|");
  for (const kept of DELIBERATELY_KEPT) {
    lines.push(`| \`${kept.name}\` | \`${kept.where}\` | ${kept.why} |`);
  }
  lines.push("");

  if (scan.violations.length > 0) {
    lines.push("## 検出された再導入");
    lines.push("");
    lines.push("| 宣言 | 場所 |");
    lines.push("|---|---|");
    for (const violation of scan.violations) {
      lines.push(`| \`${violation.name}\` | \`${violation.file}:${violation.line}\` |`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

function main() {
  const scan = scanForConstantSurfaces();
  if (process.argv.includes("--write")) {
    const out = resolve(repo, "docs/quality/CONSTANT_ANSWER_COVERAGE.md");
    writeFileSync(out, buildReport(scan));
    console.log(`wrote ${out}`);
  }

  if (scan.violations.length > 0) {
    console.error("report-constant-answer-coverage: deleted constant-answer declarations are back:");
    for (const violation of scan.violations) {
      console.error(`  ${violation.name} at ${violation.file}:${violation.line}`);
    }
    console.error("");
    console.error("These served company-specific text the filing was never consulted for, with");
    console.error("the filing's own source chunks attached as citations. Answers must come from");
    console.error("extraction, from the source-validated model path, or admit insufficiency.");
    process.exit(1);
  }

  console.log(
    `report-constant-answer-coverage: 0 constant-answer surfaces across ${scan.files} files under workers/src ` +
    `(${FORBIDDEN_DECLARATIONS.length} declarations checked).`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
