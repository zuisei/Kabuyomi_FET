import type { RemoteConfig } from "./lib/remote-config";
import type { AccessPlan } from "./lib/billing-catalog";

export interface Env {
  KABUYOMI_ENV?: string;
  ENVIRONMENT?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_TRANSLATION_MODEL?: string;
  GEMINI_TIMEOUT_MS?: string;
  GEMINI_CHAT_TIMEOUT_MS?: string;
  LLM_PROVIDER?: "gemini-legacy" | "gemini" | "openai" | "disabled";
  OPENAI_API_KEY?: string;
  OPENAI_CHAT_MODEL?: string;
  OPENAI_PROMPT_ID?: string;
  OPENAI_PROMPT_VERSION?: string;
  OPENAI_TIMEOUT_MS?: string;
  OPENAI_REASONING_EFFORT?: "minimal" | "low" | "medium" | "high";
  OPENAI_MAX_COMPLETION_TOKENS?: string;
  HARD_INTENT_TARGETED_RETRIEVAL_MODE?: "off" | "diagnostic" | "active";
  SEC_USER_AGENT: string;
  SEC_FETCHER_BASE_URL?: string;
  SEC_FETCHER_SHARED_SECRET?: string;
  SEC_FETCHER_TIMEOUT_MS?: string;
  BACKFILL_SHARED_SECRET?: string;
  EVAL_SHARED_SECRET?: string;
  DEV_DETACHED_ACCESS_DEVICE_KEYS?: string;
  APPLE_APP_STORE_ISSUER_ID?: string;
  APPLE_APP_STORE_KEY_ID?: string;
  APPLE_APP_STORE_PRIVATE_KEY?: string;
  APPLE_BUNDLE_ID?: string;
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
  updatedAt: string;
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
  logicalName: "revenue" | "netIncome" | "epsBasic" | "operatingIncome" | "operatingCashFlow";
  tagUsed: string;
  value: number;
  unit: string;
  periodEnd: string;
  comparisonValue?: number;
  yoyPercent?: number;
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
  summaryProvider?: "gemini" | "fallback";
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
  purchasedRemaining: number;
  totalRemaining: number;
  resetsAt: string;
}
