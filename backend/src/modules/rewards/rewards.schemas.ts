import { z } from 'zod';

export const admobWebhookQuerySchema = z.object({
  ad_network: z.string().optional(),
  ad_unit: z.string().optional(),
  custom_data: z.string(),
  reward_amount: z.string().optional(),
  reward_item: z.string().optional(),
  timestamp: z.string(),
  transaction_id: z.string().min(1),
  user_id: z.string().min(1),
  signature: z.string().min(1),
  key_id: z.string().min(1),
});

