import { z } from 'zod';

export const consentPurposeEnum = z.enum([
  'USAGE_ANALYTICS',
  'PERSONALISED_CONTENT',
  'PERSONALISED_ADS',
  'CRASH_DIAGNOSTICS',
]);

export const putConsentsSchema = z
  .object({
    consents: z
      .array(
        z
          .object({
            purpose: consentPurposeEnum,
            granted: z.boolean(),
          })
          .strict()
      )
      .min(1),
    policyVersion: z.string().min(1).max(32),
    source: z.string().min(1).max(64).default('in_app_settings'),
  })
  .strict();

export const privacyRequestSchema = z
  .object({
    type: z.enum(['EXPORT', 'DELETE']),
  })
  .strict();

