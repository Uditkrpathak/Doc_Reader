import * as argon2 from 'argon2';
import * as crypto from 'crypto';

// Pre-computed dummy Argon2id hash for constant-time comparisons when email is not found
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$dHVtbXlzYWx0MTIzNDU2Nw$4Zq8lG+o4g8D01d9f8A5qZ9u3nE8+1wP6jR5k7Xy2Zs';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(
  hash: string | null | undefined,
  password: string
): Promise<boolean> {
  if (!hash) {
    // Run dummy verify to prevent timing enumeration attacks
    try {
      await argon2.verify(DUMMY_HASH, password);
    } catch {
      // Ignore
    }
    return false;
  }
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export const sha256Hex = sha256;

export function hmacSha256(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

export function generateRandomCode(length: number = 6): string {
  const digits = '0123456789';
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    result += digits[byte % 10];
  }
  return result;
}

export function generateToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}
