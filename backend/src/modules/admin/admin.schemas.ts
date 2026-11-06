import { z } from 'zod';

export const adminLoginSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    totpCode: z.string().length(6).regex(/^\d{6}$/),
  })
  .strict();

export const creditAdjustSchema = z
  .object({
    accountId: z.string().uuid(),
    delta: z.number().int().refine((n) => n !== 0, 'Delta must be non-zero'),
    reason: z.string().min(5).max(255),
  })
  .strict();

export const configUpdateSchema = z
  .object({
    value: z.any(),
    reason: z.string().min(5).max(255),
  })
  .strict();

export const ticketUpdateSchema = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']),
    note: z.string().max(1000).optional(),
  })
  .strict();

export const auditQuerySchema = z
  .object({
    adminId: z.string().uuid().optional(),
    action: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
    cursor: z.string().optional(),
  })
  .strict();

export const ticketsQuerySchema = z
  .object({
    status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
    category: z.string().optional(),
    limit: z.coerce.number().min(1).max(100).default(50),
    cursor: z.string().optional(),
  })
  .strict();

