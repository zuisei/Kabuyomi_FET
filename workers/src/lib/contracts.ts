import { z } from "zod";

export const WatchlistTickerRequestSchema = z.object({
  ticker: z.string().trim().min(1).max(16)
});

export const WatchlistAddRequestSchema = WatchlistTickerRequestSchema;
export const WatchlistRemoveRequestSchema = WatchlistTickerRequestSchema;

export const ChatContextMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(700)
});

export const ChatRequestSchema = z.object({
  filingKey: z.string().min(1),
  question: z.string().trim().min(1).max(1_000),
  conversationContext: z.array(ChatContextMessageSchema).max(10).optional(),
  operationId: z.string().trim().min(1).max(128)
});

export const TranslateQuoteRequestSchema = z.object({
  text: z.string().trim().min(1).max(3_000),
  sourceLanguage: z.string().trim().min(2).max(16).optional(),
  targetLanguage: z.enum(["ja"]).default("ja"),
  operationId: z.string().trim().min(1).max(128)
});

const RequestExecutionRouteSchema = z.enum(["chat", "quote_translation"]);
const RequestExecutionConfigValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const RequestExecutionDetailsSchema = z.record(z.string(), RequestExecutionConfigValueSchema);
const RequestExecutionQuotaPlanSchema = z.enum(["free", "lite", "pro", "pro_max"]);

const RequestExecutionCreditQuotaContextSchema = z.object({
  plan: RequestExecutionQuotaPlanSchema,
  accessMode: z.string().trim().min(1).max(64).optional(),
  dateJST: z.string().trim().min(1).max(32),
  monthlyCreditLimit: z.number().int().min(0).max(100_000),
  monthlyCreditPeriodStart: z.string().trim().min(1).max(64).optional(),
  monthlyCreditPeriodEnd: z.string().trim().min(1).max(64).optional(),
  monthlyGrantOperationId: z.string().trim().min(1).max(256).optional()
});

const RequestExecutionLegacyQuotaContextSchema = z.object({
  plan: RequestExecutionQuotaPlanSchema,
  accessMode: z.string().trim().min(1).max(64).optional(),
  dateJST: z.string().trim().min(1).max(32),
  chatLimit: z.number().int().min(0).max(100_000)
});

export const RequestExecutionReservationIntentSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("credits"),
    creditsRequired: z.number().int().min(1).max(100),
    referenceType: z.string().trim().min(1).max(64),
    referenceId: z.string().trim().min(1).max(256),
    quota: RequestExecutionCreditQuotaContextSchema
  }),
  z.object({
    mode: z.literal("legacy_chat"),
    slots: z.literal(1),
    quota: RequestExecutionLegacyQuotaContextSchema
  }),
  z.object({
    mode: z.literal("unmetered")
  })
]);

const RequestExecutionBaseSchema = z.object({
  operationId: z.string().trim().min(1).max(128),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  route: RequestExecutionRouteSchema
});

export const RequestExecutionRequestSchema = z.discriminatedUnion("action", [
  RequestExecutionBaseSchema.extend({
    action: z.literal("begin"),
    allowCreate: z.boolean(),
    executionPolicyVersion: z.string().trim().min(1).max(64),
    configSnapshot: RequestExecutionDetailsSchema,
    reservation: RequestExecutionReservationIntentSchema
  }),
  RequestExecutionBaseSchema.extend({
    action: z.literal("complete"),
    resultBody: z.record(z.string(), z.unknown()),
    resultMetadata: RequestExecutionDetailsSchema,
    chargeable: z.boolean()
  }),
  RequestExecutionBaseSchema.extend({
    action: z.literal("fail"),
    failureCode: z.string().trim().regex(/^[a-z0-9_]+$/).max(64),
    failureStatus: z.number().int().min(400).max(599),
    failureDetails: RequestExecutionDetailsSchema.optional()
  })
]);

export const BackfillHistoryRequestSchema = z.object({
  tickers: z.array(z.string().trim().min(1).max(16)).max(50).optional(),
  years: z.number().int().min(1).max(5).default(3),
  forms: z.array(z.enum(["10-K", "10-Q", "20-F"])).min(1).max(3).optional(),
  maxFilingsPerTicker: z.number().int().min(1).max(8).default(1),
  maxTotalFilings: z.number().int().min(1).max(20).default(8),
  cursorByTicker: z.record(z.string(), z.number().int().min(0)).optional(),
  contentMode: z.enum(["metrics_only", "full"]).default("metrics_only")
});

export const PrincipalMigrationAdminRequestSchema = z.object({
  mode: z.enum(["preview", "apply"]),
  migrationId: z.string().trim().regex(/^[a-zA-Z0-9:_-]+$/).max(128),
  sourceQuotaSubject: z.string().trim().min(1).max(256),
  originalTransactionId: z.string().trim().min(1).max(256),
  environment: z.enum(["production", "sandbox"])
}).strict();

export const InstallationBootstrapRequestSchema = z.object({
  bootstrapOperationId: z.string().trim().min(16).max(128),
  legacyDeviceKey: z.string().trim().min(16).max(128),
  appAttestCapability: z.enum(["supported", "unavailable"]),
  appAttestKeyId: z.string().trim().min(16).max(512).nullable().optional()
}).strict();

export const AppAttestChallengeRequestSchema = z.object({
  purpose: z.enum(["attestation", "assertion"]),
  keyId: z.string().trim().min(16).max(512),
  method: z.string().trim().min(3).max(16).nullable().optional(),
  path: z.string().trim().min(1).max(2_048).nullable().optional(),
  bodySHA256: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  installationPrincipal: z.string().trim().min(1).max(256),
  tokenReference: z.string().trim().min(1).max(128)
}).strict().superRefine((value, ctx) => {
  if (value.purpose === "assertion" && (!value.method || !value.path || !value.bodySHA256)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Assertion request binding is required" });
  }
});

export const AppAttestCompleteRequestSchema = z.object({
  challengeId: z.string().uuid(),
  keyId: z.string().trim().min(16).max(512),
  clientDataHash: z.string().trim().min(1).max(256),
  attestationObject: z.string().trim().min(1).max(131_072)
}).strict();

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
  originalTransactionId: z.string().trim().min(1).max(256),
  transactionId: z.string().trim().min(1).max(256).optional(),
  productId: z.string().trim().min(1).max(128).optional(),
  // Deprecated public compatibility field. It is never an authority input.
  active: z.boolean().optional(),
  signedTransactionInfo: z.string().trim().min(1).max(16_384).optional()
}).strict();

const VerifiedSubscriptionPlanSchema = z.enum(["lite", "pro", "pro_max"]);
const VerifiedAppleEnvironmentSchema = z.enum(["production", "sandbox"]);
const EntitlementBindingMethodSchema = z.enum(["verified_sync", "verified_restore", "admin_transfer"]);
const IsoTimestampSchema = z.string().datetime({ offset: true });

export const VerifiedEntitlementMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply_verified"),
    quotaSubject: z.string().trim().min(1).max(256),
    principalKeyVersion: z.literal("v1"),
    originalTransactionId: z.string().trim().min(1).max(256),
    transactionId: z.string().trim().min(1).max(256),
    productId: z.string().trim().min(1).max(128),
    plan: VerifiedSubscriptionPlanSchema,
    status: z.enum(["active", "expired", "revoked"]),
    periodStart: IsoTimestampSchema.nullable(),
    periodEnd: IsoTimestampSchema.nullable(),
    expiresAt: IsoTimestampSchema.nullable(),
    revokedAt: IsoTimestampSchema.nullable(),
    monthlyCredits: z.number().int().min(0).max(100_000),
    monthlyGrantOperationId: z.string().trim().min(1).max(256).nullable(),
    lastVerifiedAt: IsoTimestampSchema,
    verificationEnvironment: VerifiedAppleEnvironmentSchema,
    verificationVersion: z.string().trim().min(1).max(128),
    verificationPayloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    signedDate: IsoTimestampSchema.nullable(),
    bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
    bindingMethod: EntitlementBindingMethodSchema
  }).strict(),
  z.object({
    action: z.literal("apply_verified_notification"),
    quotaSubject: z.string().trim().min(1).max(256),
    principalKeyVersion: z.literal("v1"),
    originalTransactionId: z.string().trim().min(1).max(256),
    transactionId: z.string().trim().min(1).max(256),
    productId: z.string().trim().min(1).max(128),
    plan: VerifiedSubscriptionPlanSchema,
    status: z.enum(["active", "expired", "revoked"]),
    periodStart: IsoTimestampSchema.nullable(),
    periodEnd: IsoTimestampSchema.nullable(),
    expiresAt: IsoTimestampSchema.nullable(),
    revokedAt: IsoTimestampSchema.nullable(),
    monthlyCredits: z.number().int().min(0).max(100_000),
    monthlyGrantOperationId: z.string().trim().min(1).max(256).nullable(),
    lastVerifiedAt: IsoTimestampSchema,
    verificationEnvironment: VerifiedAppleEnvironmentSchema,
    verificationVersion: z.string().trim().min(1).max(128),
    verificationPayloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
    signedDate: IsoTimestampSchema.nullable()
  }).strict(),
  z.object({
    action: z.literal("record_refresh_failure"),
    failureAt: IsoTimestampSchema,
    bindingHash: z.string().regex(/^[a-f0-9]{64}$/)
  }).strict(),
  z.object({
    action: z.literal("revoke_binding"),
    bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
    revokedAt: IsoTimestampSchema,
    transferId: z.string().trim().min(1).max(128).optional()
  }).strict()
]);

// Kept as an export for existing imports; this is intentionally not the public schema.
export const EntitlementRequestSchema = VerifiedEntitlementMutationSchema;

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

export const AppleAccountSessionRequestSchema = z.object({
  identityToken: z.string().trim().min(32).max(16_384)
}).strict();

export const PaidCreditAccountMigrationRequestSchema = z.object({
  mode: z.enum(["preview", "apply"]),
  migrationId: z.string().trim().regex(/^[a-zA-Z0-9:_-]{1,128}$/)
}).strict();

export const EvalCreditGrantRequestSchema = z.object({
  deviceKey: z.string().trim().min(1).max(48),
  credits: z.number().int().min(1).max(1_000),
  referenceId: z.string().trim().min(1).max(64)
});

export const AdMobRewardIntentRequestSchema = z.object({}).passthrough();

export const PurchaseCreditAdjustmentRequestSchema = z.object({
  action: z.enum(["refund", "reverse_refund"]),
  quotaSubject: z.string().trim().min(1).max(256),
  transactionId: z.string().trim().min(1).max(256),
  productId: z.string().trim().min(1).max(128),
  creditsGranted: z.number().int().min(1).max(10_000),
  notificationId: z.string().trim().min(1).max(128)
}).strict();

export const QuotaRequestSchema = z.object({
  action: z.enum([
    "state",
    "checkChat",
    "checkStock",
    "consumeChat",
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
  dailyRewardDateKey: z.string().trim().min(1).max(32).optional(),
  dailyRewardCap: z.number().int().min(1).max(100).optional(),
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
