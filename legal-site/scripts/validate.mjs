import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const publicDir = new URL("../public/", import.meta.url);
const pages = [
  "privacy/index.html",
  "terms/index.html",
  "support/index.html",
  "tokushoho/index.html"
];

const forbiddenClaims = [
  "Pro Max",
  "¥500",
  "500円",
  "8-K",
  "web search",
  "Web search",
  "ウェブ検索",
  "目標株価を提供",
  "売買推奨を提供",
  "投資助言を提供"
];

const failures = [];
const appAdsPath = join(publicDir.pathname, "app-ads.txt");
const expectedAppAdsLine = "google.com, pub-1248492954379402, DIRECT, f08c47fec0942fa0";

if (!existsSync(appAdsPath)) {
  failures.push("Missing app-ads.txt");
} else {
  const appAdsContent = readFileSync(appAdsPath, "utf8");
  if (appAdsContent !== `${expectedAppAdsLine}\n`) {
    failures.push("app-ads.txt must contain exactly the authorized Google AdMob seller line");
  }
}

for (const page of pages) {
  const filePath = join(publicDir.pathname, page);
  if (!existsSync(filePath)) {
    failures.push(`Missing page: ${page}`);
    continue;
  }

  const html = readFileSync(filePath, "utf8");
  if (!html.includes("最終更新日")) {
    failures.push(`${page}: missing last updated label`);
  }
  if (/<script[\s>]/i.test(html)) {
    failures.push(`${page}: must not include scripts`);
  }
  if (/https?:\/\/(?!www\.apple\.com\/legal\/internet-services\/itunes\/dev\/stdeula\/)/i.test(html)) {
    failures.push(`${page}: unexpected external URL`);
  }

  for (const match of html.matchAll(/TODO_[A-Z0-9_]+/g)) {
    failures.push(`${page}: unexpected TODO placeholder ${match[0]}`);
  }

  for (const claim of forbiddenClaims) {
    if (html.includes(claim)) {
      failures.push(`${page}: forbidden v1 claim text found: ${claim}`);
    }
  }
}

const tokushohoPath = join(publicDir.pathname, "tokushoho/index.html");
if (existsSync(tokushohoPath)) {
  const tokushohoHtml = readFileSync(tokushohoPath, "utf8");
  const requiredDisclosureTerms = [
    "プライバシー保護のため",
    "特定商取引法",
    "請求があった場合",
    "遅滞なく",
    "メールその他の適切な方法",
    "kabuyomi.support@gmail.com"
  ];

  for (const term of requiredDisclosureTerms) {
    if (!tokushohoHtml.includes(term)) {
      failures.push(`tokushoho/index.html: missing disclosure-by-request wording: ${term}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Static legal site validation passed.");
