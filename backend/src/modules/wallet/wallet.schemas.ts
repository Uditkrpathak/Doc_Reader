import { z } from 'zod';

export const ledgerQuerySchema = z
  .object({
    type: z.enum(['all', 'earned', 'redeemed']).default('all'),
    cursor: z.string().optional(),
    limit: z.coerce.number().min(1).max(50).default(20),
  })
  .strict();

export const adfreeRedeemSchema = z
  .object({
    tierId: z.string().min(1).max(32),
  })
  .strict();

