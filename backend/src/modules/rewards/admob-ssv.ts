import * as crypto from 'crypto';
import { logger } from '../../shared/logger';

export interface GoogleKey {
  keyId: number;
  base64: string;
}

export interface GoogleVerifierKeysResponse {
  keys: GoogleKey[];
}

export class AdMobSsvVerifier {
  private keyCache: Map<string, crypto.KeyObject> = new Map();
  private lastFetchedAt: number = 0;
  private readonly cacheTtlMs = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * For testing, allow manual injection of test keys
   */
  setTestKey(keyId: string, keyOrPem: crypto.KeyObject | string | Buffer) {
    const key =
      typeof keyOrPem === 'object' && !(keyOrPem instanceof Buffer) && 'type' in keyOrPem
        ? (keyOrPem as crypto.KeyObject)
        : crypto.createPublicKey(keyOrPem);
    this.keyCache.set(keyId, key);
  }

  async fetchGoogleKeys(): Promise<void> {
    try {
      // In production, fetch from Google's endpoint
      const res = await fetch('https://www.gstatic.com/admob/reward/verifier-keys.json');
      if (!res.ok) {
        throw new Error(`Google keys fetch returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as GoogleVerifierKeysResponse;

      for (const k of data.keys) {
        // Base64 public key in DER format
        const der = Buffer.from(k.base64, 'base64');
        const key = crypto.createPublicKey({
          key: der,
          format: 'der',
          type: 'spki',
        });
        this.keyCache.set(k.keyId.toString(), key);
      }
      this.lastFetchedAt = Date.now();
    } catch (err) {
      logger.warn({ err }, 'Failed to fetch AdMob verifier keys from Google');
    }
  }

  /**
   * Verify ECDSA P-256 with SHA-256 over raw content
   * Content is the raw query string up to the start of '&signature='
   */
  async verifySignature(
    rawQueryString: string,
    keyId: string,
    base64UrlSignature: string
  ): Promise<boolean> {
    if (!this.keyCache.has(keyId) || Date.now() - this.lastFetchedAt > this.cacheTtlMs) {
      await this.fetchGoogleKeys();
    }

    const publicKey = this.keyCache.get(keyId);
    if (!publicKey) {
      logger.warn({ keyId }, 'Unknown AdMob SSV keyId');
      return false;
    }

    try {
      // Signature is base64 / base64url encoded
      const sigBuffer = Buffer.from(
        base64UrlSignature.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      );

      // Verify SHA256withECDSA
      const verifier = crypto.createVerify('SHA256');
      verifier.update(rawQueryString);
      verifier.end();

      return verifier.verify(
        {
          key: publicKey,
          dsaEncoding: 'der',
        },
        sigBuffer
      );
    } catch (err) {
      logger.error({ err, keyId }, 'Error verifying AdMob SSV signature');
      return false;
    }
  }
}
