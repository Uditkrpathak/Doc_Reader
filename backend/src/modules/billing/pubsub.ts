import * as jose from 'jose';
import { logger } from '../../shared/logger';

const GOOGLE_OIDC_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export class GooglePubSubVerifier {
  private jwks: any;

  constructor(
    private expectedAudience?: string,
    private expectedServiceAccountEmail?: string
  ) {
    if (expectedAudience) {
      this.jwks = jose.createRemoteJWKSet(new URL(GOOGLE_OIDC_JWKS_URL));
    }
  }

  async verifyPushToken(authHeader?: string): Promise<boolean> {
    if (!this.expectedAudience) {
      // In development / testing without Pub/Sub audience set, skip remote network call
      return true;
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Missing or malformed Authorization header on Google Pub/Sub push');
      return false;
    }

    const token = authHeader.substring(7);

    try {
      const { payload } = await jose.jwtVerify(token, this.jwks, {
        audience: this.expectedAudience,
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
      });

      if (
        this.expectedServiceAccountEmail &&
        payload.email !== this.expectedServiceAccountEmail
      ) {
        logger.warn(
          { expected: this.expectedServiceAccountEmail, received: payload.email },
          'Google Pub/Sub service account email mismatch'
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error({ err }, 'Google Pub/Sub OIDC token verification failed');
      return false;
    }
  }
}

