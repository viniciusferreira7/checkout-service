import { z } from 'zod';

/**
 * The part of `GET /products/:id` the cart relies on. Parsed, not trusted:
 * anything else the products service answers is dropped.
 */
export const productSnapshotSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  price: z.number().nonnegative(),
  stock: z.number().int().nonnegative(),
  isActive: z.boolean(),
  sellerId: z.uuid(),
});

export type ProductSnapshot = z.infer<typeof productSnapshotSchema>;
