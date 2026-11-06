import * as jose from 'jose';
import { UserContext, AdminContext, EntitlementKind } from './types';

export interface TokenConfig {
  jwtSecret: string;
  adminJwtSecret: string;
  ed25519PrivateKeyPem?: string;
  ed25519PublicKeyPem?: string;
  edPrivateKeyPem?: string;
  edPublicKeyPem?: string;
}

export interface AccessTokenPayload {
  sub: string;
  kind: 'GUEST' | 'REGISTERED';
  email?: string;
  sid?: string;
  aud: string;
  iss: string;
}

export interface AdminTokenPayload {
  sub: string;
  email: string;
  role: string;
  aud: string;
  iss: string;
}

export interface OfflineEntitlementPayload {
  sub: string;
  adFree: boolean;
  source: EntitlementKind | null;
  endsAt: string | null;
  serverTime: string;
  aud: string;
  iss: string;
}

export class JwtService {
  private secretKey: Uint8Array;
  private adminSecretKey: Uint8Array;
  private edPrivateKey?: jose.KeyLike | Uint8Array;
  private edPublicKeyPem?: string;

  constructor(config: TokenConfig) {
    this.secretKey = new TextEncoder().encode(config.jwtSecret);
    this.adminSecretKey = new TextEncoder().encode(config.adminJwtSecret);
    this.edPublicKeyPem = config.edPublicKeyPem;
  }

  async initializeEd25519(privateKeyPem?: string) {
    if (privateKeyPem) {
      this.edPrivateKey = await jose.importPKCS8(privateKeyPem, 'EdDSA');
    }
  }

  getEdPublicKeyPem(): string {
    return this.edPublicKeyPem || '';
  }

  // --- ACCESS TOKEN (15 min) ---
  async signAccessToken(user: UserContext, expiresIn: string = '15m'): Promise<string> {
    return new jose.SignJWT({
      kind: user.kind,
      email: user.email,
      sid: user.sessionId,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.accountId)
      .setAudience('docreader:app')
      .setIssuer('docreader:server')
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.secretKey);
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    const { payload } = await jose.jwtVerify(token, this.secretKey, {
      audience: 'docreader:app',
      issuer: 'docreader:server',
    });
    return payload as unknown as AccessTokenPayload;
  }

  // --- ADMIN TOKEN (8 hours) ---
  async signAdminToken(admin: AdminContext, expiresIn: string = '8h'): Promise<string> {
    return new jose.SignJWT({
      email: admin.email,
      role: admin.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(admin.adminId)
      .setAudience('docreader:admin')
      .setIssuer('docreader:server')
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(this.adminSecretKey);
  }

  async verifyAdminToken(token: string): Promise<AdminTokenPayload> {
    const { payload } = await jose.jwtVerify(token, this.adminSecretKey, {
      audience: 'docreader:admin',
      issuer: 'docreader:server',
    });
    return payload as unknown as AdminTokenPayload;
  }

  // --- OFFLINE ENTITLEMENT TOKEN (Ed25519 EdDSA) ---
  async signOfflineEntitlementToken(
    accountId: string,
    adFree: boolean,
    source: EntitlementKind | null,
    endsAt: Date | null,
    serverTime: string
  ): Promise<string> {
    if (!this.edPrivateKey) {
      // Fallback to HS256 if Ed25519 is not provisioned in dev
      return new jose.SignJWT({
        adFree,
        source,
        endsAt: endsAt ? endsAt.toISOString() : null,
        serverTime,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(accountId)
        .setAudience('docreader:offline')
        .setIssuer('docreader:server')
        .setIssuedAt()
        .setExpirationTime(endsAt ? Math.floor(endsAt.getTime() / 1000) : '72h')
        .sign(this.secretKey);
    }

    const nowMs = Date.now();
    const maxExpiryMs = nowMs + 72 * 60 * 60 * 1000;
    const finalExpiryMs = endsAt ? Math.min(endsAt.getTime(), maxExpiryMs) : maxExpiryMs;

    return new jose.SignJWT({
      adFree,
      source,
      endsAt: endsAt ? endsAt.toISOString() : null,
      serverTime,
    })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setSubject(accountId)
      .setAudience('docreader:offline')
      .setIssuer('docreader:server')
      .setIssuedAt()
      .setExpirationTime(Math.floor(finalExpiryMs / 1000))
      .sign(this.edPrivateKey);
  }
}
