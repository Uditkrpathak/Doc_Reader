import { z } from 'zod';

export const verifyPurchaseSchema = z
  .object({
    kind: z.enum(['SUBSCRIPTION', 'ONE_TIME']),
    productId: z.string().min(1).max(128),
    purchaseToken: z.string().min(1),
  })
  .strict();

export const restorePurchasesSchema = z
  .object({
    purchases: z
      .array(
        z
          .object({
            kind: z.enum(['SUBSCRIPTION', 'ONE_TIME']),
            productId: z.string().min(1).max(128),
            purchaseToken: z.string().min(1),
          })
          .strict()
      )
      .min(1)
      .max(20),
  })
  .strict();

export const pubsubPushSchema = z
  .object({
    message: z
      .object({
        data: z.string(),
        messageId: z.string(),
        publishTime: z.string(),
      })
      .strict(),
    subscription: z.string().optional(),
  })
  .strict();

