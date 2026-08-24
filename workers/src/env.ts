import type { RemoteConfig } from "./lib/remote-config";
import type { AccessPlan } from "./lib/billing-catalog";

export interface Env {
  KABUYOMI_ENV?: string;
  ENVIRONMENT?: string;
  RELEASE_CANDIDATE_ID?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_TRANSLATION_MODEL?: string;
  GEMINI_TIMEOUT_MS?: string;
  GEMINI_CHAT_TIMEOUT_MS?: string;
  LLM_PROVIDER?: "gemini-legacy" | "gemini" | "openai" | "disabled";
  OPENAI_API_KEY?: string;
  OPENAI_CHAT_MODEL?: string;
  /** 有料プラン(free 以外)と dev_unlimited に使う上位チャットモデル。未設定なら全員 OPENAI_CHAT_MODEL。 */
  OPENAI_CHAT_MODEL_PREMIUM?: string;
  /** 上位モデル回答の1問あたりクレジット(既定5)。 */
  PREMIUM_CHAT_CREDIT_COST?: string;
  OPENAI_PROMPT_ID?: string;
  OPENAI_PROMPT_VERSION?: string;
  OPENAI_TIMEOUT_MS?: string;
  OPENAI_REASONING_EFFORT?: "none" | "minimal" | "low" | "medium" | "high";
  OPENAI_MAX_COMPLETION_TOKENS?: string;
  OPENAI_SUMMARY_TIMEOUT_MS?: string;
  OPENAI_SUMMARY_MAX_COMPLETION_TOKENS?: string;
  HARD_INTENT_TARGETED_RETRIEVAL_MODE?: "off" | "diagnostic" | "active";
  ADMOB_REWARDED_AD_UNIT_ID?: string;
  ADMOB_SSV_PUBLIC_KEYS_URL?: string;
  SEC_USER_AGENT: string;
  SEC_FETCHER_BASE_URL?: string;
  SEC_FETCHER_SHARED_SECRET?: string;
  SEC_FETCHER_TIMEOUT_MS?: string;
  SEC_FETCHER_RETRY_COUNT?: string;
  SEC_FETCHER_INITIAL_BACKOFF_MS?: string;
  SEC_FETCHER_HTTP_TIMEOUT_MS?: string;
  BACKFILL_SHARED_SECRET?: string;
  EVAL_SHARED_SECRET?: string;
  DEV_DETACHED_ACCESS_DEVICE_KEYS?: string;
  TEST_AUTOMATION_SHARED_SECRET?: string;
  APPLE_APP_STORE_ISSUER_ID?: string;
  APPLE_APP_STORE_KEY_ID?: string;
  APPLE_APP_STORE_PRIVATE_KEY?: string;
  APPLE_BUNDLE_ID?: string;
  APPLE_APP_ID?: string;
  SUBSCRIPTION_PRINCIPAL_HMAC_KEY_V1?: string;
  INSTALLATION_TOKEN_HMAC_KEY_V1?: string;
  INSTALLATION_NETWORK_HMAC_KEY_V1?: string;
  ACCOUNT_PRINCIPAL_HMAC_KEY_V1?: string;
  ACCOUNT_SESSION_HMAC_KEY_V1?: string;
  APPLE_SIGN_IN_CLIENT_ID?: string;
  APP_ATTEST_VERIFIER_URL?: string;
  APP_ATTEST_VERIFIER_SHARED_SECRET?: string;
  APP_ATTEST_TEAM_ID?: string;
  APP_ATTEST_BUNDLE_ID?: string;
  APP_ATTEST_ALLOWED_ENVIRONMENTS?: string;
  APP_ATTEST_ALLOWED_VALIDATION_CATEGORIES?: string;
  APP_ATTEST_ALLOWED_BUNDLE_VERSIONS?: string;
  APP_ATTEST_ALLOW_MISSING_APP_EXTENSIONS?: string;
  EMERGENCY_DISABLE_CHAT?: string;
  EMERGENCY_DISABLE_ADS?: string;
  EMERGENCY_DISABLE_REWARDS?: string;
  EMERGENCY_DISABLE_WEB?: string;
  EMERGENCY_DISABLE_PAID_GRANTS?: string;
  EMERGENCY_DISABLE_SEC_REFRESH?: string;
  EMERGENCY_DISABLE_BACKGROUND_JOBS?: string;
  EMERGENCY_DISABLE_MIGRATIONS?: string;
  APPLE_APP_STORE_SERVER_ENVIRONMENT?: string;
  KABUYOMI_CACHE: KVNamespace;
  DB: D1Database;
  FILINGS_BUCKET: R2Bucket;
  SEC_RATE_LIMITER: DurableObjectNamespace;
  FILING_LOCK: DurableObjectNamespace;
  USER_QUOTA: DurableObjectNamespace;
  ENTITLEMENT: DurableObjectNamespace;
}

export interface RemoteConfigEnvelope {
  config: RemoteConfig;
  version: string;
  updatedAt: string;
  maxStaleAgeSeconds: number;
}

export interface TickerRecord {
  ticker: string;
  companyName: string;
  cik: string;
  exchange: string;
  latestFormType?: string;
}

export interface FilingReference {
  cik: string;
  ticker: string;
  companyName: string;
  exchange: string;
  formType: "10-K" | "10-Q";
  accessionNumber: string;
  primaryDocument: string;
  filedAt: string;
  periodOfReport: string;
}

export interface MetricSnapshot {
  logicalName:
    | "revenue"
    | "netIncome"
    | "epsBasic"
    | "operatingIncome"
    | "operatingCashFlow"
    | "cashAndCashEquivalents"
    | "currentDebt"
    | "longTermDebt";
  tagUsed: string;
  value: number;
  unit: string;
  periodStart?: string;
  periodEnd: string;
  periodKind?: FinancialFactPeriodKind;
  fiscalYear?: number;
  fiscalQuarter?: FinancialFiscalQuarter;
  comparisonValue?: number;
  comparisonPeriodStart?: string;
  comparisonPeriodEnd?: string;
  comparisonPeriodKind?: FinancialFactPeriodKind;
  comparisonFiscalYear?: number;
  comparisonFiscalQuarter?: FinancialFiscalQuarter;
  comparisonTagUsed?: string;
  comparisonSourceUrl?: string;
  comparisonAccessionNumber?: string;
  yoyPercent?: number;
}

export type FinancialFactPeriodKind = "instant" | "quarter" | "year_to_date" | "annual" | "duration" | "unknown";
export type FinancialFactRole = "current" | "comparison" | "reported";
export type FinancialFiscalQuarter = "Q1" | "Q2" | "Q3" | "Q4" | "FY" | null;
export type FinancialDisplayUnit = "raw" | "million" | "billion" | "oku" | "trillion" | "percent";

export interface FinancialDisplayValue {
  displayUnit: FinancialDisplayUnit;
  value: number;
  scale: number;
  precision: number;
  ja: string;
  aliases: string[];
}

export interface FinancialPercentageProvenance {
  kind: "derived_change" | "derived_ratio" | "reported";
  formula: "((current-comparison)/abs(comparison))*100" | "(numerator/denominator)*100" | "source_reported";
  currentFactId?: string;
  comparisonFactId?: string;
  numeratorFactId?: string;
  denominatorFactId?: string;
  currentValue?: number;
  comparisonValue?: number;
  numeratorValue?: number;
  denominatorValue?: number;
  resultPercent: number;
}

export interface VerifiedFinancialFact {
  factId: string;
  concept: string;
  semanticLabel: string;
  semanticLabelJa: string;
  rawValue: number;
  currency: string | null;
  unit: string;
  sourceScale: number;
  canonicalValue: number;
  allowedDisplayUnits: FinancialDisplayUnit[];
  displayValues: FinancialDisplayValue[];
  displayAliases: string[];
  periodStart: string | null;
  periodEnd: string;
  fiscalYear: number | null;
  fiscalQuarter: FinancialFiscalQuarter;
  periodKind: FinancialFactPeriodKind;
  role: FinancialFactRole;
  scope: "company_total" | "segment";
  comparisonFactId?: string;
  comparisonValue?: number;
  derivedPercentage?: FinancialPercentageProvenance;
  sourceId: string;
  sourceUrl: string;
}

export interface SourceChunkRecord {
  sourceId: string;
  sectionType: "md_a" | "xbrl_metric";
  sectionTitle: string;
  sourceLabel: string;
  text: string;
  startOffset: number;
  endOffset: number;
  tagName?: string;
  sourceUrl?: string;
  filingAccessionNumber?: string;
  metricRole?: "current" | "comparison";
  periodEnd?: string;
  sortOrder: number;
}

export interface SummaryLine {
  text: string;
  sourceIds: string[];
}

export interface SummaryRecord {
  verdict: string;
  highlights: SummaryLine[];
  changes: SummaryLine[];
}

export interface FilingCacheRecord {
  filingKey: string;
  ticker: string;
  companyName: string;
  cik: string;
  formType: "10-K" | "10-Q";
  filedAt: string;
  periodOfReport: string;
  primaryDocumentUrl: string;
  companyWebsiteUrl?: string;
  mdaText: string;
  mdaTokenCount: number;
  metrics: MetricSnapshot[];
  sourceChunks: SourceChunkRecord[];
  summary: SummaryRecord;
  summaryProvider?: "gemini" | "openai" | "fallback";
  /// 要約の差し替えに失敗した時刻(ISO)。恒久的に失敗する資料を
  /// 閲覧のたびに再試行してモデル呼び出しを浪費しないための目印。
  summaryUpgradeFailedAt?: string;
  contentMode?: "full" | "metrics_only";
  generatedAt: string;
  extractorVersion: string;
  promptVersion: string;
}

export interface UsageState {
  plan: AccessPlan;
  accessMode?: string;
  chatsUsed: number;
  chatLimit: number;
  stocksUsed: number;
  stockLimit: number;
  dateJST: string;
  savedTickers?: string[];
  credits?: CreditUsageState;
  creditBillingEnabled?: boolean;
}

export interface CreditUsageState {
  monthlyRemaining: number;
  monthlyLimit: number;
  welcomeRemaining?: number;
  rewardedAdRemaining?: number;
  rewardedAdExpiresAt?: string | null;
  purchasedRemaining: number;
  purchasedRefundDebt?: number;
  totalRemaining: number;
  resetsAt: string;
}
