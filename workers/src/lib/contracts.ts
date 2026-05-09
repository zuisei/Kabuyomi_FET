import { z } from "zod";

export const WatchlistTickerRequestSchema = z.object({
  ticker: z.string().trim().min(1).max(16)
});

export const WatchlistAddRequestSchema = WatchlistTickerRequestSchema;
export const WatchlistRemoveRequestSchema = WatchlistTickerRequestSchema;

export const ChatContextMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(420)
});

export const ChatRequestSchema = z.object({
  filingKey: z.string().min(1),
  question: z.string().trim().min(1).max(1_000),
  conversationContext: z.array(ChatContextMessageSchema).max(6).optional(),
  operationId: z.string().trim().min(1).max(128).optional()
});

export const TranslateQuoteRequestSchema = z.object({
  text: z.string().trim().min(1).max(3_000),
  sourceLanguage: z.string().trim().min(2).max(16).optional(),
  targetLanguage: z.enum(["ja"]).default("ja"),
  operationId: z.string().trim().min(1).max(128).optional()
});

export const BackfillHistoryRequestSchema = z.object({
  tickers: z.array(z.string().trim().min(1).max(16)).max(50).optional(),
  years: z.number().int().min(1).max(5).default(3),
  forms: z.array(z.enum(["10-K", "10-Q"])).min(1).max(2).optional(),
  maxFilingsPerTicker: z.number().int().min(1).max(8).default(1),
  maxTotalFilings: z.number().int().min(1).max(20).default(8),
  cursorByTicker: z.record(z.string(), z.number().int().min(0)).optional()
});

const ExtractorVersionSchema = z.string().trim().regex(/^v\d+$/i).transform((value) => value.toLowerCase());

export const CleanupFilingsRequestSchema = z.object({
  execute: z.boolean().default(false),
  targetVersions: z.array(ExtractorVersionSchema).min(1).max(20).optional(),
  tickers: z.array(z.string().trim().min(1).max(16)).max(100).optional(),
  maxFilings: z.number().int().min(1).max(100).default(50),
  maxKvKeys: z.number().int().min(0).max(1_000).default(200),
  includeUnshadowed: z.boolean().default(false),
  onlyDisagreeingMetrics: z.boolean().default(false)
});

export const BillingSyncRequestSchema = z.object({
  originalTransactionId: z.string().trim().min(1),
  transactionId: z.string().trim().min(1).max(256).optional(),
  productId: z.string().trim().min(1).optional(),
  active: z.boolean().default(false),
  signedTransactionInfo: z.string().trim().min(1).max(16_384).optional()
});

export const EntitlementRequestSchema = BillingSyncRequestSchema.extend({
  serverVerified: z.boolean().default(false),
  boundDeviceHash: z.string().trim().min(1).max(128).optional(),
  boundQuotaSubject: z.string().trim().min(1).max(256).optional(),
  subscriptionPeriodStart: z.string().trim().min(1).max(64).optional(),
  subscriptionPeriodEnd: z.string().trim().min(1).max(64).optional(),
  subscriptionExpiresAt: z.string().trim().min(1).max(64).optional(),
  monthlyGrantOperationId: z.string().trim().min(1).max(256).optional()
});

const CreditPurchaseGrantBaseRequestSchema = z.object({
  productId: z.string().trim().min(1).max(128),
  transactionId: z.string().trim().min(1).max(256),
  originalTransactionId: z.string().trim().min(1).max(256).optional(),
  purchasedAt: z.string().trim().min(1).max(64).optional()
});

export const InternalCreditPurchaseGrantRequestSchema = CreditPurchaseGrantBaseRequestSchema.extend({
  quotaSubject: z.string().trim().min(1).max(256).optional()
});

export const CreditPurchaseGrantRequestSchema = CreditPurchaseGrantBaseRequestSchema.extend({
  signedTransactionInfo: z.string().trim().min(1).max(16_384)
});

export const EvalCreditGrantRequestSchema = z.object({
  deviceKey: z.string().trim().min(1).max(48),
  credits: z.number().int().min(1).max(1_000),
  referenceId: z.string().trim().min(1).max(64)
});

export const AdMobRewardIntentRequestSchema = z.object({}).passthrough();

export const QuotaRequestSchema = z.object({
  action: z.enum([
    "state",
    "checkChat",
    "checkStock",
    "consumeChat",
    "refundChat",
    "consumeStock",
    "refundStock",
    "removeTicker",
    "promoteTicker",
    "checkCompanyAccess",
    "ensureMonthlyCreditGrant",
    "consumeCredit",
    "refundCredit",
    "grantPurchasedCredit",
    "grantEvalCredit",
    "grantRewardedAdCredit"
  ]),
  quotaSubject: z.string().trim().min(1),
  plan: z.enum(["free", "lite", "pro", "pro_max"]),
  accessMode: z.string().trim().min(1).optional(),
  dateJST: z.string().trim().min(1),
  ticker: z.string().trim().min(1).max(16).optional(),
  chatLimit: z.number().int().min(0),
  stockLimit: z.number().int().min(0),
  monthlyCreditLimit: z.number().int().min(0).optional(),
  operationId: z.string().trim().min(1).max(256).optional(),
  monthlyCreditPeriodStart: z.string().trim().min(1).max(64).optional(),
  monthlyCreditPeriodEnd: z.string().trim().min(1).max(64).optional(),
  monthlyGrantOperationId: z.string().trim().min(1).max(256).optional(),
  originalOperationId: z.string().trim().min(1).max(128).optional(),
  creditsRequired: z.number().int().min(1).max(100).optional(),
  credits: z.number().int().min(1).max(1_000).optional(),
  promoExpiresAt: z.string().trim().min(1).max(64).optional(),
  purchaseCredits: z.number().int().min(1).max(10_000).optional(),
  productId: z.string().trim().min(1).max(128).optional(),
  transactionId: z.string().trim().min(1).max(256).optional(),
  originalTransactionId: z.string().trim().min(1).max(256).optional(),
  purchasedAt: z.string().trim().min(1).max(64).optional(),
  referenceType: z.string().trim().min(1).max(64).optional(),
  referenceId: z.string().trim().min(1).max(256).optional(),
  previewTickers: z.array(z.string().trim().min(1).max(16)).optional(),
  relatedTickers: z.array(z.string().trim().min(1).max(16)).optional()
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100)
});

export const ChatSourceKindSchema = z.enum(["sec_filing", "historical_filing", "web_supplement"]);
export const ChatSourceStrengthSchema = z.enum(["filing_primary", "supplement_article", "supplement_snippet"]);

export const SourceSchema = z.object({
  sourceId: z.string(),
  sourceKind: ChatSourceKindSchema.default("sec_filing"),
  sourceStrength: ChatSourceStrengthSchema.default("filing_primary"),
  sectionType: z.string(),
  sourceLabel: z.string(),
  excerpt: z.string(),
  sourceUrl: z.string().url().optional()
});

export const SummaryResponseSchema = z.object({
  verdict: z.string(),
  highlights: z.array(
    z.object({
      text: z.string(),
      sourceIds: z.array(z.string()).min(1)
    })
  ),
  changes: z.array(
    z.object({
      text: z.string(),
      sourceIds: z.array(z.string()).min(1)
    })
  )
});

export const ChatModelResponseSchema = z.object({
  answer: z.string(),
  sourceIds: z.array(z.string())
}).superRefine((value, ctx) => {
  if (value.sourceIds.length === 0 && value.answer !== "この決算資料の範囲では確認できません。") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sourceIds are required unless the answer explicitly states the context is unavailable"
    });
  }
});

export const QuoteTranslationResponseSchema = z.object({
  translatedText: z.string().trim().min(1)
});
