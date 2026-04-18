import { z } from "zod";

export const WatchlistAddRequestSchema = z.object({
  ticker: z.string().trim().min(1).max(16)
});

export const ChatRequestSchema = z.object({
  filingKey: z.string().min(1),
  question: z.string().trim().min(1).max(1_000)
});

export const BackfillHistoryRequestSchema = z.object({
  tickers: z.array(z.string().trim().min(1).max(16)).max(50).optional(),
  years: z.number().int().min(1).max(5).default(3),
  forms: z.array(z.enum(["10-K", "10-Q"])).min(1).max(2).optional(),
  maxFilingsPerTicker: z.number().int().min(1).max(8).default(1),
  maxTotalFilings: z.number().int().min(1).max(20).default(8),
  cursorByTicker: z.record(z.string(), z.number().int().min(0)).optional()
});

export const BillingSyncRequestSchema = z.object({
  originalTransactionId: z.string().trim().min(1),
  productId: z.string().trim().min(1).optional(),
  active: z.boolean().default(false)
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100)
});

export const ChatSourceKindSchema = z.enum(["sec_filing", "historical_filing", "web_supplement"]);

export const SourceSchema = z.object({
  sourceId: z.string(),
  sourceKind: ChatSourceKindSchema.default("sec_filing"),
  sectionType: z.string(),
  sourceLabel: z.string(),
  excerpt: z.string()
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
  if (value.sourceIds.length === 0 && value.answer !== "この filing の提供コンテキストでは確認できません。") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "sourceIds are required unless the answer explicitly states the context is unavailable"
    });
  }
});
