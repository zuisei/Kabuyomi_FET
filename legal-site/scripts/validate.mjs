import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const publicDir = new URL("../public/", import.meta.url);
const catalogPath = new URL("../../shared/product-catalog.json", import.meta.url);
const settingsPath = new URL("../../ios/Kabuyomi/Features/Settings/SettingsView.swift", import.meta.url);
const creditsPath = new URL("../../ios/Kabuyomi/Features/Settings/CreditView.swift", import.meta.url);
const reviewDocumentPaths = [
  new URL("../../README.md", import.meta.url),
  new URL("../../docs/INDEX.md", import.meta.url),
  new URL("../../docs/admob/release-admob-checklist.md", import.meta.url),
  new URL("../../docs/admob/rewarded_admob_credits_runbook.md", import.meta.url),
  new URL("../../docs/legal/APPLE_ACCOUNT_RECOVERY_CONFIG.md", import.meta.url),
  new URL("../../docs/legal/LEGAL_SITE_DEPLOYMENT.md", import.meta.url),
  new URL("../../docs/release/APP_STORE_SUBMISSION_NOTES.md", import.meta.url),
  new URL("../../docs/release/FEATURE_PARITY_COMPATIBILITY_REPORT.md", import.meta.url),
  new URL("../../docs/release/FULL_REMEDIATION_RELEASE_GATE_REPORT.md", import.meta.url),
  new URL("../../docs/release/PR09_REMOTE_CONFIG_FAIL_CLOSED_REPORT.md", import.meta.url),
  new URL("../../docs/release/REMOTE_CONFIG_LIFECYCLE_RUNBOOK.md", import.meta.url),
  new URL("../../docs/release/TESTFLIGHT_READINESS_CHECKLIST.md", import.meta.url),
  new URL("../../docs/release/CURRENT_SHIPPING_TRUTH.md", import.meta.url),
  new URL("../../docs/legal/TESTFLIGHT_STOREKIT_DIAGNOSTICS.md", import.meta.url)
];
// 法務ページと違い、LP は外部リンク(App Store)と canonical を持つ。
// 最終更新日も持たない。よって同じループには入れず、
// 「主張の禁止」と「価格ベタ書き禁止」だけを別枠でかける。
const marketingPages = ["lp/index.html"];
const appStoreAppURL = "https://apps.apple.com/jp/app/kabuyomi/id6762764426";
const pages = [
  "index.html",
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
const expectedLegalRevision = "2026-07-11";

const failures = [];
const appAdsPath = join(publicDir.pathname, "app-ads.txt");
const expectedAppAdsLine = "google.com, pub-1248492954379402, DIRECT, f08c47fec0942fa0";
const pageContents = new Map();

let catalog;
try {
  catalog = JSON.parse(readFileSync(fileURLToPath(catalogPath), "utf8"));
} catch (error) {
  failures.push(`Unable to read shared/product-catalog.json: ${error instanceof Error ? error.message : String(error)}`);
}

if (catalog) {
  if (catalog.currencyDisplayAuthority !== "storekit") {
    failures.push("product catalog: currencyDisplayAuthority must remain storekit");
  }
  if (catalog.welcome?.recurring !== false || catalog.welcome?.requiresVerifiedInstallation !== true) {
    failures.push("product catalog: welcome credits must be one-time and require a verified installation");
  }
  if (catalog.rewardedCredit?.grantAuthority !== "admob_ssv") {
    failures.push("product catalog: rewarded-credit authority must remain admob_ssv");
  }
}

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
  pageContents.set(page, html);
  if (!html.includes("最終更新日")) {
    failures.push(`${page}: missing last updated label`);
  }
  if (!html.includes(`最終更新日: ${expectedLegalRevision}`)) {
    failures.push(`${page}: legal revision must match ${expectedLegalRevision}`);
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

  if (/(?:JPY\s*[\d,]+|[¥￥]\s*[\d,]+|[\d,]+\s*円)/iu.test(html)) {
    failures.push(`${page}: hard-coded shipping price found; use StoreKit localized display authority`);
  }
}

for (const page of marketingPages) {
  const filePath = join(publicDir.pathname, page);
  if (!existsSync(filePath)) {
    failures.push(`Missing marketing page: ${page}`);
    continue;
  }

  const html = readFileSync(filePath, "utf8");
  if (/<script[\s>]/i.test(html)) {
    failures.push(`${page}: must not include scripts`);
  }
  if (!html.includes(appStoreAppURL)) {
    failures.push(`${page}: missing App Store link ${appStoreAppURL}`);
  }
  if (!html.includes('rel="canonical"')) {
    failures.push(`${page}: missing canonical link`);
  }
  for (const match of html.matchAll(/TODO_[A-Z0-9_]+/g)) {
    failures.push(`${page}: unexpected TODO placeholder ${match[0]}`);
  }
  for (const claim of forbiddenClaims) {
    if (html.includes(claim)) {
      failures.push(`${page}: forbidden v1 claim text found: ${claim}`);
    }
  }
  if (/(?:JPY\s*[\d,]+|[¥￥]\s*[\d,]+|[\d,]+\s*円)/iu.test(html)) {
    failures.push(`${page}: hard-coded shipping price found; use StoreKit localized display authority`);
  }
}

// 発見されるための最低条件。LP が孤児のままだと検索から辿れない。
{
  const robotsPath = join(publicDir.pathname, "robots.txt");
  const sitemapPath = join(publicDir.pathname, "sitemap.xml");
  if (!existsSync(robotsPath)) {
    failures.push("Missing robots.txt");
  } else if (!readFileSync(robotsPath, "utf8").includes("sitemap.xml")) {
    failures.push("robots.txt must point at sitemap.xml");
  }
  if (!existsSync(sitemapPath)) {
    failures.push("Missing sitemap.xml");
  } else if (!readFileSync(sitemapPath, "utf8").includes("/lp/")) {
    failures.push("sitemap.xml must list the /lp/ landing page");
  }
  const rootIndex = pageContents.get("index.html") ?? "";
  if (!rootIndex.includes('href="./lp/"')) {
    failures.push("index.html: must link to the /lp/ landing page");
  }
}

function textContent(page) {
  return (pageContents.get(page) ?? "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/,/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function requireTerms(page, terms, label = page) {
  const text = textContent(page);
  for (const term of terms) {
    if (!text.includes(term.replace(/,/gu, ""))) {
      failures.push(`${label}: missing required catalog/privacy term: ${term}`);
    }
  }
}

function requireSourceTerms(source, terms, label) {
  const normalized = source.replace(/,/gu, "").replace(/\s+/gu, " ");
  for (const term of terms) {
    if (!normalized.includes(term.replace(/,/gu, ""))) {
      failures.push(`${label}: missing required catalog/privacy term: ${term}`);
    }
  }
}

if (catalog) {
  const freePlan = catalog.plans.find((plan) => plan.plan === "free");
  const productTerms = [
    ...catalog.consumables.flatMap((product) => [product.productId, `${product.credits} paid credits`]),
    ...catalog.plans
      .filter((plan) => plan.productId)
      .flatMap((plan) => [plan.productId, `${plan.monthlyCredits} credits`])
  ];

  for (const page of ["terms/index.html", "tokushoho/index.html"]) {
    requireTerms(page, [
      ...productTerms,
      "StoreKit",
      "ローカライズ表示",
      `月次付与は ${freePlan?.monthlyCredits ?? 0} credits`,
      `welcome ${catalog.welcome.credits} credits`,
      "一度だけ"
    ]);
  }

  requireTerms("terms/index.html", [
    `通常質問は 1 回 ${catalog.normalChatCreditCost} credits`,
    `${catalog.rewardedCredit.credits} ad credits`,
    `1 日 ${catalog.rewardedCredit.dailyCap} 回`,
    `${catalog.rewardedCredit.expiryDays} 日間`,
    "Sign in with Apple",
    "サインインは不要"
  ]);

  const litePlan = catalog.plans.find((plan) => plan.plan === "lite");
  const proPlan = catalog.plans.find((plan) => plan.plan === "pro");
  const maxPlan = catalog.plans.find((plan) => plan.plan === "pro_max");
  if (!freePlan || !litePlan || !proPlan || !maxPlan) {
    failures.push("product catalog: missing one or more required plans");
  } else {
    requireTerms("terms/index.html", [
      `保存上限は ${freePlan.savedCompanyLimit} 銘柄`,
      `1 日の質問上限は ${freePlan.dailyFairUseQuestionLimit} 回`,
      `Lite は保存 ${litePlan.savedCompanyLimit} 銘柄・1 日 ${litePlan.dailyFairUseQuestionLimit} 回`,
      `Pro と Max は保存 ${proPlan.savedCompanyLimit} 銘柄・1 日 ${proPlan.dailyFairUseQuestionLimit} 回`
    ]);
  }
}

requireTerms("privacy/index.html", [
  "サーバー発行の匿名 installation credential",
  "App Attest",
  "検索履歴",
  "チャット質問",
  "Sign in with Apple",
  "氏名・メールアドレスの scope は要求せず",
  "Google AdMob",
  "概算位置情報",
  "Keychain"
]);

requireTerms("support/index.html", [
  "伏せ字",
  "本人確認 token",
  "端末 credential",
  "完全な購入 ID・receipt",
  "App Attest 資料"
]);

try {
  const settingsSource = readFileSync(fileURLToPath(settingsPath), "utf8");
  const creditsSource = readFileSync(fileURLToPath(creditsPath), "utf8");
  const requiredProductTerms = catalog
    ? [
        ...catalog.consumables.map((product) => product.productId),
        ...catalog.plans.flatMap((plan) => plan.productId ? [plan.productId] : [])
      ]
    : [];

  requireSourceTerms(settingsSource, [
    ...requiredProductTerms,
    "サーバー発行の匿名 installation credential",
    "App Attest",
    "Sign in with Apple",
    "氏名・メールアドレスのscopeは要求せず",
    "価格はStoreKitのローカライズ表示が正本",
    "Freeの月次付与は0",
    `\"${expectedLegalRevision}\"`,
    "最新版をWebで確認",
    "LegalSiteConfig.url(pathComponent: document.pathComponent)",
    "質問文は必要な範囲だけ伏せ字",
    "完全な購入ID・receipt"
  ], "SettingsView.swift");

  if (catalog) {
    const freePlan = catalog.plans.find((plan) => plan.plan === "free");
    const litePlan = catalog.plans.find((plan) => plan.plan === "lite");
    const proPlan = catalog.plans.find((plan) => plan.plan === "pro");
    if (freePlan && litePlan && proPlan) {
      requireSourceTerms(settingsSource, [
        `Freeの月次付与は${freePlan.monthlyCredits} creditsで、保存${freePlan.savedCompanyLimit}銘柄・1日${freePlan.dailyFairUseQuestionLimit}質問`,
        `Liteは保存${litePlan.savedCompanyLimit}銘柄・1日${litePlan.dailyFairUseQuestionLimit}質問`,
        `ProとMaxは保存${proPlan.savedCompanyLimit}銘柄・1日${proPlan.dailyFairUseQuestionLimit}質問`
      ], "SettingsView.swift");
    }
  }

  requireSourceTerms(creditsSource, [
    "CreditBreakdownTile(title: \"月額分\"",
    "CreditBreakdownTile(title: \"ウェルカム\"",
    "CreditBreakdownTile(title: \"広告分\"",
    "CreditBreakdownTile(title: \"購入分\"",
    "Free / 月次0 / 認証済み初回50クレジット",
    "通常質問 約"
  ], "CreditView.swift");

  const localForbidden = ["提出前ブロッカー", "匿名の device key"];
  for (const term of localForbidden) {
    if (settingsSource.includes(term) || creditsSource.includes(term)) {
      failures.push(`iOS fallback copy: forbidden stale term found: ${term}`);
    }
  }
} catch (error) {
  failures.push(`Unable to validate iOS legal/credit copy: ${error instanceof Error ? error.message : String(error)}`);
}

for (const documentPath of reviewDocumentPaths) {
  try {
    const source = readFileSync(fileURLToPath(documentPath), "utf8");
    const label = fileURLToPath(documentPath).split("/").at(-1) ?? "review document";
    if (/(?:JPY\s*[\d,]+|[¥￥]\s*[\d,]+|[\d,]+\s*円)/iu.test(source)) {
      failures.push(`${label}: hard-coded shipping price found; use StoreKit localized display authority`);
    }
    if (source.includes("fresh trusted legacy") || source.includes("legacy-config compatibility mode")) {
      failures.push(`${label}: stale deployed legacy-config inference found`);
    }
  } catch (error) {
    failures.push(`Unable to validate review document: ${error instanceof Error ? error.message : String(error)}`);
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

console.log("Legal/App Review consistency validation passed.");
