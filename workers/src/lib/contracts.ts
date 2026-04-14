import { z } from "zod";

export const WatchlistAddRequestSchema = z.object({
  ticker: z.string().trim().min(1).max(16)
});

export const ChatRequestSchema = z.object({
  filingKey: z.string().min(1),
  question: z.string().trim().min(1).max(1_000)
});

export const BillingSyncRequestSchema = z.object({
  originalTransactionId: z.string().trim().min(1),
  productId: z.string().trim().min(1).optional(),
  active: z.boolean().default(false)
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100)
});

export const SourceSchema = z.object({
  sourceId: z.string(),
  sectionType: z.enum(["md_a", "xbrl_metric"]),
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
  sourceIds: z.array(z.string()).min(1)
});

