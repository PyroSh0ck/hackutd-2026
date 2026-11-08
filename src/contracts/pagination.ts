import { z } from "zod";

// Shared list query/response shapes for owner-scoped resources.
// Query params arrive as strings, so numbers are coerced and bounded.
export const PAGE_SIZES = [10, 20, 50] as const;

export const ListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce
      .number()
      .int()
      .refine((value) => (PAGE_SIZES as readonly number[]).includes(value), {
        message: `Page size must be one of ${PAGE_SIZES.join(", ")}.`,
      })
      .default(20),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

export type ListQuery = z.infer<typeof ListQuerySchema>;

export const PageMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int(),
  total: z.number().int().min(0),
  pageCount: z.number().int().min(1),
});

export type PageMeta = z.infer<typeof PageMetaSchema>;

export function pageMeta(page: number, pageSize: number, total: number): PageMeta {
  return { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

// Resource IDs are opaque cuid strings. Anything else is treated as not found.
export const ResourceIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
