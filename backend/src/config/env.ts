import { z } from 'zod';
import * as dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/docreader'),
  REDIS_URL: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  JWT_SECRET: z.string().default('dev-insecure-jwt-secret-min-32-chars-long!'),
  ADMIN_JWT_SECRET: z.string().default('dev-insecure-admin-secret-min-32-chars-long!'),
  ED25519_PRIVATE_KEY: z.string().optional(),
  ED25519_PUBLIC_KEY: z.string().optional(),
  OFFLINE_TOKEN_PRIVATE_KEY: z.string().optional(),
  OFFLINE_TOKEN_PUBLIC_KEY: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GOOGLE_PUBSUB_AUDIENCE: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('DocReader <noreply@docreaderapp.com>'),
  EMAIL_FROM: z.string().default('DocReader <noreply@docreaderapp.com>'),
});

export type EnvConfig = z.infer<typeof envSchema>;

let parsedEnv: EnvConfig;

try {
  parsedEnv = envSchema.parse(process.env);

  // Strict check in production
  if (parsedEnv.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (parsedEnv.JWT_SECRET.includes('dev-insecure')) missing.push('JWT_SECRET');
    if (parsedEnv.ADMIN_JWT_SECRET.includes('dev-insecure')) missing.push('ADMIN_JWT_SECRET');
    if (!parsedEnv.ED25519_PRIVATE_KEY) missing.push('ED25519_PRIVATE_KEY');
    if (!parsedEnv.ED25519_PUBLIC_KEY) missing.push('ED25519_PUBLIC_KEY');

    if (missing.length > 0) {
      throw new Error(
        `[CRITICAL] Refusing to start production server with missing production secrets: ${missing.join(', ')}`
      );
    }
  }
} catch (err: any) {
  console.error('Environment validation error:', err.message || err);
  throw err;
}

export const env = parsedEnv;
