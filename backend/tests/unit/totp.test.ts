import { describe, it, expect } from 'vitest';
import { generateTotp, verifyTotp, base32Encode } from '../../src/shared/totp';

describe('RFC 6238 TOTP Implementation', () => {
  // RFC 6238 Appendix B test vectors for HMAC-SHA1
  // Secret: "12345678901234567890" (20 bytes ASCII)
  const rfcSecret = Buffer.from('12345678901234567890', 'ascii');
  const base32Secret = base32Encode(rfcSecret);

  it('matches RFC 6238 official test vectors for SHA-1 (8 digits)', () => {
    // Vectors from RFC 6238 Appendix B Table 1:
    // Time (sec)   | Expected TOTP (SHA1, 8 digits)
    // 59           | 94287082
    // 1111111109   | 07081804
    // 1111111111   | 14050471
    // 1234567890   | 89005924
    // 2000000000   | 69279037

    const testVectors = [
      { time: 59, expected: '94287082' },
      { time: 1111111109, expected: '07081804' },
      { time: 1111111111, expected: '14050471' },
      { time: 1234567890, expected: '89005924' },
      { time: 2000000000, expected: '69279037' },
    ];

    for (const { time, expected } of testVectors) {
      const token = generateTotp(rfcSecret, time, { digits: 8, algorithm: 'sha1', timeStepSeconds: 30 });
      expect(token).toBe(expected);
    }
  });

  it('generates and verifies 6-digit TOTP with Base32 secret', () => {
    const time = 1700000000;
    const token = generateTotp(base32Secret, time, { digits: 6 });
    expect(token).toHaveLength(6);

    const valid = verifyTotp(token, base32Secret, {
      digits: 6,
      timestamp: time,
      window: 1,
    });
    expect(valid).toBe(true);

    const wrong = verifyTotp('999999', base32Secret, {
      digits: 6,
      timestamp: time,
      window: 1,
    });
    expect(wrong).toBe(false);
  });

  it('allows clock drift within the window', () => {
    const time = 1700000000;
    // Generated 30 seconds ago
    const tokenPast = generateTotp(base32Secret, time - 30, { digits: 6 });
    expect(verifyTotp(tokenPast, base32Secret, { timestamp: time, window: 1 })).toBe(true);

    // Generated 90 seconds ago (outside window=1)
    const tokenTooOld = generateTotp(base32Secret, time - 90, { digits: 6 });
    expect(verifyTotp(tokenTooOld, base32Secret, { timestamp: time, window: 1 })).toBe(false);
  });
});

