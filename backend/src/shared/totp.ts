import * as crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Decode RFC 4648 Base32 string to Buffer
 */
export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[=\s]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i]!;
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base32 character: ${char}`);
    }

    value = (value << 5) | index;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Encode Buffer to RFC 4648 Base32 string
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | (buffer[i] ?? 0);
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export interface TotpOptions {
  timeStepSeconds?: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

/**
 * Generate RFC 6238 TOTP
 * @param secret Base32-encoded secret string OR raw secret Buffer
 * @param timestamp Time in seconds (or Date)
 */
export function generateTotp(
  secret: string | Buffer,
  timestamp: number | Date = Math.floor(Date.now() / 1000),
  options: TotpOptions = {}
): string {
  const timeStep = options.timeStepSeconds ?? 30;
  const digits = options.digits ?? 6;
  const algorithm = options.algorithm ?? 'sha1';

  const key = typeof secret === 'string' ? base32Decode(secret) : secret;
  const timeSeconds = typeof timestamp === 'number' ? timestamp : Math.floor(timestamp.getTime() / 1000);
  const counter = Math.floor(timeSeconds / timeStep);

  // 8-byte big-endian counter buffer
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac(algorithm, key).update(counterBuffer).digest();

  // Dynamic truncation (RFC 4226 Sec 5.4)
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);

  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

/**
 * Verify RFC 6238 TOTP with clock drift window (+/- 1 step)
 */
export function verifyTotp(
  token: string,
  secret: string | Buffer,
  options: TotpOptions & { window?: number; timestamp?: number | Date } = {}
): boolean {
  if (!token || token.length !== (options.digits ?? 6)) return false;

  const window = options.window ?? 1;
  const timeStep = options.timeStepSeconds ?? 30;
  const now = options.timestamp
    ? typeof options.timestamp === 'number'
      ? options.timestamp
      : Math.floor(options.timestamp.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  for (let step = -window; step <= window; step++) {
    const checkTime = now + step * timeStep;
    const generated = generateTotp(secret, checkTime, options);
    if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(generated))) {
      return true;
    }
  }

  return false;
}

/**
 * Generate cryptographically secure random Base32 secret for TOTP (default 20 bytes = 160 bits)
 */
export function generateTotpSecret(bytes: number = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

/**
 * Generate otpauth:// URI for scanning into Google Authenticator / 1Password
 */
export function generateTotpUri(secret: string, accountName: string, issuer: string = 'DocReader'): string {
  const encAccount = encodeURIComponent(accountName);
  const encIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encIssuer}:${encAccount}?secret=${secret}&issuer=${encIssuer}&algorithm=SHA1&digits=6&period=30`;
}

