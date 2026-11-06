import { z } from 'zod';

export const guestSchema = z
  .object({
    installId: z.string().min(8).max(128),
    integrityToken: z.string().optional(),
  })
  .strict();

export const signupSchema = z
  .object({
    email: z.string().email().max(255),
    password: z.string().min(8).max(128),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().email().max(255),
    password: z.string().min(8).max(128),
  })
  .strict();

export const refreshSchema = z
  .object({
    refreshToken: z.string().min(16),
  })
  .strict();

export const emailVerifySchema = z
  .object({
    code: z.string().length(6),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: z.string().email().max(255),
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    email: z.string().email().max(255),
    code: z.string().length(6),
    newPassword: z.string().min(8).max(128),
  })
  .strict();

export const deleteAccountSchema = z
  .object({
    password: z.string().optional(),
  })
  .strict();

