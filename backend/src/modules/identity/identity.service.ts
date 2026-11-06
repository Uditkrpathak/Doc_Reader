import { Pool, PoolClient } from 'pg';
import { Database } from '../../db/pool';
import { JwtService } from '../../shared/jwt';
import { EmailService } from '../../shared/email';
import { RemoteConfigService } from '../../config/remote-config';
import { AppError, ErrorCodes } from '../../shared/errors';
import {
  hashPassword,
  verifyPassword,
  sha256,
  hmacSha256,
  generateRandomCode,
  generateToken,
} from '../../shared/crypto';
import { getServerTime } from '../../shared/time';
import { UserContext } from '../../shared/types';

export class IdentityService {
  constructor(
    private db: Database,
    private jwt: JwtService,
    private emailService: EmailService,
    private configService: RemoteConfigService
  ) {}

  /**
   * Helper: create a session and issue access/refresh token pair
   */
  private async createSessionPair(
    client: PoolClient | Pool,
    account: { id: string; kind: 'GUEST' | 'REGISTERED'; email?: string },
    familyId?: string
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const famId = familyId || (await client.query(`SELECT gen_random_uuid() as id`)).rows[0].id;
    const rawRefreshToken = generateToken(40);
    const refreshHash = sha256(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // 60 days

    const sessionRes = await client.query(
      `INSERT INTO sessions (account_id, family_id, refresh_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [account.id, famId, refreshHash, expiresAt]
    );

    const sessionId = sessionRes.rows[0].id;
    const accessToken = await this.jwt.signAccessToken({
      accountId: account.id,
      kind: account.kind,
      email: account.email,
      sessionId,
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /**
   * POST /auth/guest: Create or fetch existing guest by install hash
   */
  async handleGuest(installId: string, _integrityToken?: string) {
    const installHash = sha256(installId);

    return this.db.withTransaction(async (client) => {
      // Look up existing guest
      const existing = await client.query(
        `SELECT id, kind, status FROM accounts WHERE install_hash = $1 AND kind = 'GUEST' AND status = 'ACTIVE'`,
        [installHash]
      );

      let accountId: string;
      if (existing.rows.length > 0) {
        accountId = existing.rows[0].id;
      } else {
        // Create new guest account
        const accRes = await client.query(
          `INSERT INTO accounts (kind, status, install_hash)
           VALUES ('GUEST', 'ACTIVE', $1)
           RETURNING id, kind, status`,
          [installHash]
        );
        accountId = accRes.rows[0].id;

        // Create credit_accounts row (balance 0)
        await client.query(
          `INSERT INTO credit_accounts (account_id, balance) VALUES ($1, 0)`,
          [accountId]
        );
      }

      const tokens = await this.createSessionPair(client, {
        id: accountId,
        kind: 'GUEST',
      });

      return {
        ...tokens,
        account: {
          id: accountId,
          kind: 'GUEST' as const,
          status: 'ACTIVE' as const,
        },
      };
    });
  }

  /**
   * POST /auth/signup: in-place guest upgrade or fresh account creation
   */
  async handleSignup(
    email: string,
    password: string,
    currentUser?: UserContext | null
  ) {
    const cfg = await this.configService.get(this.db.getPool());
    if (cfg.killSwitches.signups) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'New signups are temporarily disabled');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const pwHash = await hashPassword(password);

    return this.db.withTransaction(async (client) => {
      // Check if email already registered
      const dup = await client.query(
        `SELECT id FROM accounts WHERE LOWER(email) = $1 AND status IN ('ACTIVE', 'PENDING_DELETION')`,
        [normalizedEmail]
      );
      if (dup.rows.length > 0) {
        throw new AppError(409, ErrorCodes.CONFLICT, 'An account with this email already exists');
      }

      let accountId: string;

      if (currentUser && currentUser.kind === 'GUEST') {
        // Upgrade guest account in place (keeps all credits and transactions)
        await client.query(
          `UPDATE accounts 
           SET kind = 'REGISTERED', email = $1, password_hash = $2, updated_at = NOW()
           WHERE id = $3 AND kind = 'GUEST'`,
          [normalizedEmail, pwHash, currentUser.accountId]
        );
        accountId = currentUser.accountId;
      } else {
        // Fresh registered account
        const accRes = await client.query(
          `INSERT INTO accounts (kind, status, email, password_hash)
           VALUES ('REGISTERED', 'ACTIVE', $1, $2)
           RETURNING id`,
          [normalizedEmail, pwHash]
        );
        accountId = accRes.rows[0].id;

        await client.query(
          `INSERT INTO credit_accounts (account_id, balance) VALUES ($1, 0)`,
          [accountId]
        );
      }

      // Generate 6-digit email verification code
      const code = generateRandomCode(6);
      const codeHash = sha256(code);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      await client.query(
        `INSERT INTO auth_tokens (account_id, email, type, code_hash, expires_at)
         VALUES ($1, $2, 'EMAIL_VERIFY', $3, $4)`,
        [accountId, normalizedEmail, codeHash, expiresAt]
      );

      // Queue verification email
      await this.emailService.queueEmail(
        client,
        normalizedEmail,
        'Verify your DocReader account',
        `Your 6-digit email verification code is: ${code}\nThis code will expire in 24 hours.`
      );

      const tokens = await this.createSessionPair(client, {
        id: accountId,
        kind: 'REGISTERED',
        email: normalizedEmail,
      });

      return {
        ...tokens,
        account: {
          id: accountId,
          kind: 'REGISTERED' as const,
          email: normalizedEmail,
        },
      };
    });
  }

  /**
   * POST /auth/login: login with progressive lockout and guest merge
   */
  async handleLogin(
    email: string,
    password: string,
    currentUser?: UserContext | null
  ) {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Read user account (outside transaction)
    const userRes = await this.db.query(
      `SELECT id, kind, status, password_hash, failed_logins, locked_until
       FROM accounts 
       WHERE LOWER(email) = $1 AND kind = 'REGISTERED' AND status IN ('ACTIVE', 'PENDING_DELETION')`,
      [normalizedEmail]
    );

    const user = userRes.rows[0];

    // Check lockout
    if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
      await verifyPassword(null, password);
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid email or password');
    }

    const isValid = await verifyPassword(user?.password_hash, password);

    if (!user || !isValid) {
      if (user) {
        const failures = (user.failed_logins || 0) + 1;
        let lockUntil: Date | null = null;
        if (failures >= 5) {
          const lockMinutes = Math.min(15, Math.pow(2, failures - 5) + 1);
          lockUntil = new Date(Date.now() + lockMinutes * 60 * 1000);
        }
        await this.db.query(
          `UPDATE accounts SET failed_logins = $1, locked_until = $2 WHERE id = $3::uuid`,
          [failures, lockUntil, user.id]
        );
      }
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid email or password');
    }

    // 2. Verified: Run reset, merge and session creation in transaction
    return this.db.withTransaction(async (client) => {
      await client.query(
        `UPDATE accounts SET failed_logins = 0, locked_until = NULL WHERE id = $1::uuid`,
        [user.id]
      );

      const targetAccountId = user.id;

      if (currentUser && currentUser.kind === 'GUEST' && currentUser.accountId !== targetAccountId) {
        await this.mergeGuestIntoAccount(client, currentUser.accountId, targetAccountId);
      }

      const tokens = await this.createSessionPair(client, {
        id: targetAccountId,
        kind: 'REGISTERED',
        email: normalizedEmail,
      });

      return {
        ...tokens,
        account: {
          id: targetAccountId,
          kind: 'REGISTERED' as const,
          email: normalizedEmail,
        },
      };
    });
  }

  /**
   * Helper: Merge guest into registered account in ONE transaction
   */
  private async mergeGuestIntoAccount(
    client: PoolClient,
    guestId: string,
    targetAccountId: string
  ) {
    // 1. Lock both accounts in lexicographical ID order to prevent deadlocks
    const { first, second } = await this.db.lockTwoAccountsForUpdate(
      client,
      guestId,
      targetAccountId
    );

    const guestAcc = first.id === guestId ? first : second;
    const targetAcc = first.id === targetAccountId ? first : second;

    const guestBalance = guestAcc.balance;

    if (guestBalance > 0) {
      const mergeKey = `merge:${guestId}:${targetAccountId}`;

      // Guest: -X balance
      await client.query(
        `UPDATE credit_accounts SET balance = 0, version = version + 1 WHERE account_id = $1::uuid`,
        [guestId]
      );

      await client.query(
        `INSERT INTO credit_ledger_entries (account_id, idempotency_key, type, amount, balance_after, reference)
         VALUES ($1::uuid, $2, 'MERGE', $3, 0, $4)`,
        [guestId, `${mergeKey}:out`, -guestBalance, `Merged into account ${targetAccountId}`]
      );

      // Target: +X balance
      const newTargetBalance = targetAcc.balance + guestBalance;
      await client.query(
        `UPDATE credit_accounts SET balance = $1, version = version + 1 WHERE account_id = $2::uuid`,
        [newTargetBalance, targetAccountId]
      );

      await client.query(
        `INSERT INTO credit_ledger_entries (account_id, idempotency_key, type, amount, balance_after, reference)
         VALUES ($1::uuid, $2, 'MERGE', $3, $4, $5)`,
        [
          targetAccountId,
          `${mergeKey}:in`,
          guestBalance,
          newTargetBalance,
          `Merged from guest ${guestId}`,
        ]
      );
    }

    // 2. Merge entitlements (keep the later ad-free end)
    const guestEnt = await client.query(
      `SELECT kind, ends_at FROM entitlements WHERE account_id = $1::uuid`,
      [guestId]
    );

    for (const ent of guestEnt.rows) {
      await client.query(
        `INSERT INTO entitlements (account_id, kind, ends_at, source)
         VALUES ($1::uuid, $2, $3, 'MERGE')
         ON CONFLICT (account_id, kind)
         DO UPDATE SET ends_at = GREATEST(entitlements.ends_at, EXCLUDED.ends_at), updated_at = NOW()`,
        [targetAccountId, ent.kind, ent.ends_at]
      );
    }

    // 3. Move purchase records from guest to account
    await client.query(
      `UPDATE purchase_records SET account_id = $1::uuid WHERE account_id = $2::uuid`,
      [targetAccountId, guestId]
    );

    // 4. Mark guest MERGED and revoke all its sessions
    await client.query(
      `UPDATE accounts SET status = 'MERGED', merged_into = $1::uuid, updated_at = NOW() WHERE id = $2::uuid`,
      [targetAccountId, guestId]
    );

    await client.query(
      `UPDATE sessions SET revoked_at = NOW() WHERE account_id = $1::uuid AND revoked_at IS NULL`,
      [guestId]
    );
  }

  /**
   * POST /auth/refresh: rotating refresh tokens with family tracking and grace period
   */
  async handleRefresh(rawRefreshToken: string) {
    const refreshHash = sha256(rawRefreshToken);

    const sessRes = await this.db.query(
      `SELECT s.id, s.account_id, s.family_id, s.expires_at, s.used_at, s.revoked_at, a.kind, a.email, a.status
       FROM sessions s
       JOIN accounts a ON s.account_id = a.id
       WHERE s.refresh_hash = $1`,
      [refreshHash]
    );

    const session = sessRes.rows[0];

    if (!session) {
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid refresh token');
    }

    if (session.status !== 'ACTIVE') {
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Account is not active');
    }

    // Check if session was already revoked
    if (session.revoked_at) {
      // Replay of a revoked token: revoke entire family for security
      await this.db.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE family_id = $1::uuid`,
        [session.family_id]
      );
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Token family revoked due to reuse');
    }

    // Check if session was already used (reuse detection)
    if (session.used_at) {
      const usedTime = new Date(session.used_at).getTime();
      const diffMs = Date.now() - usedTime;

      // 10-second grace window for concurrent/duplicate submits (e.g. mobile race)
      if (diffMs <= 10000) {
        throw new AppError(
          409,
          ErrorCodes.RETRYABLE_CONFLICT,
          'Token recently refreshed. Retry with latest credentials.',
          true
        );
      }

      // Outside grace window: token reuse detected! Revoke entire family!
      await this.db.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE family_id = $1::uuid`,
        [session.family_id]
      );
      throw new AppError(
        401,
        ErrorCodes.UNAUTHORIZED,
        'Suspicious token reuse detected. All sessions in family revoked.'
      );
    }

    if (new Date(session.expires_at) < new Date()) {
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Refresh token expired');
    }

    return this.db.withTransaction(async (client) => {
      // Mark current session as used
      await client.query(
        `UPDATE sessions SET used_at = NOW() WHERE id = $1::uuid`,
        [session.id]
      );

      // Create new session in the same family
      const nextTokens = await this.createSessionPair(
        client,
        {
          id: session.account_id,
          kind: session.kind,
          email: session.email,
        },
        session.family_id
      );

      return nextTokens;
    });
  }

  /**
   * POST /auth/logout: Revoke current session
   */
  async handleLogout(user: UserContext) {
    if (user.sessionId) {
      await this.db.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE id = $1`,
        [user.sessionId]
      );
    }
  }

  /**
   * POST /auth/email/verify
   */
  async handleEmailVerify(user: UserContext, code: string) {
    const codeHash = sha256(code);

    const tokenRes = await this.db.query(
      `SELECT id, attempts, expires_at, used_at
       FROM auth_tokens
       WHERE account_id = $1 AND type = 'EMAIL_VERIFY' AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [user.accountId]
    );

    const token = tokenRes.rows[0];
    if (!token) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'No pending email verification code found');
    }

    if (new Date(token.expires_at) < new Date() || token.attempts >= 5) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Verification code expired or exceeded attempts');
    }

    const matchRes = await this.db.query(
      `SELECT id FROM auth_tokens WHERE id = $1 AND code_hash = $2`,
      [token.id, codeHash]
    );

    if (matchRes.rows.length === 0) {
      await this.db.query(`UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = $1`, [token.id]);
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Invalid verification code');
    }

    await this.db.query(`UPDATE auth_tokens SET used_at = NOW() WHERE id = $1`, [token.id]);
  }

  /**
   * POST /auth/email/resend (60s cooldown)
   */
  async handleEmailResend(user: UserContext) {
    const lastToken = await this.db.query(
      `SELECT created_at FROM auth_tokens 
       WHERE account_id = $1 AND type = 'EMAIL_VERIFY'
       ORDER BY created_at DESC LIMIT 1`,
      [user.accountId]
    );

    if (lastToken.rows.length > 0) {
      const diffMs = Date.now() - new Date(lastToken.rows[0].created_at).getTime();
      if (diffMs < 60000) {
        const waitSec = Math.ceil((60000 - diffMs) / 1000);
        throw new AppError(429, ErrorCodes.RATE_LIMITED, `Please wait ${waitSec}s before requesting a new code`);
      }
    }

    const userRes = await this.db.query(`SELECT email FROM accounts WHERE id = $1`, [user.accountId]);
    const email = userRes.rows[0]?.email;
    if (!email) {
      throw new AppError(400, ErrorCodes.BAD_REQUEST, 'No email associated with account');
    }

    const code = generateRandomCode(6);
    const codeHash = sha256(code);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await this.db.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO auth_tokens (account_id, email, type, code_hash, expires_at)
         VALUES ($1, $2, 'EMAIL_VERIFY', $3, $4)`,
        [user.accountId, email, codeHash, expiresAt]
      );

      await this.emailService.queueEmail(
        client,
        email,
        'Your new verification code',
        `Your verification code is: ${code}`
      );
    });
  }

  /**
   * POST /auth/password/forgot: Timing-safe 202 response
   */
  async handleForgotPassword(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const userRes = await this.db.query(
      `SELECT id FROM accounts WHERE LOWER(email) = $1 AND kind = 'REGISTERED' AND status = 'ACTIVE'`,
      [normalizedEmail]
    );

    const user = userRes.rows[0];

    // Dummy computation to equalize timing
    const dummySecret = 'dummy-salt-constant-work';
    hmacSha256(normalizedEmail, dummySecret);

    if (user) {
      const code = generateRandomCode(6);
      const codeHash = hmacSha256(code, dummySecret);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await this.db.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO auth_tokens (account_id, email, type, code_hash, expires_at)
           VALUES ($1, $2, 'PASSWORD_RESET', $3, $4)`,
          [user.id, normalizedEmail, codeHash, expiresAt]
        );

        await this.emailService.queueEmail(
          client,
          normalizedEmail,
          'DocReader Password Reset Code',
          `Your password reset code is: ${code}\nThis code will expire in 10 minutes.`
        );
      });
    }

    // ALWAYS return the exact same 202 response
    return {
      message: 'If an account exists with this email, a reset code has been sent.',
    };
  }

  /**
   * POST /auth/password/reset: Single use, revokes all sessions
   */
  async handleResetPassword(email: string, code: string, newPassword: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const dummySecret = 'dummy-salt-constant-work';
    const codeHash = hmacSha256(code, dummySecret);

    return this.db.withTransaction(async (client) => {
      const tokenRes = await client.query(
        `SELECT id, account_id, attempts, expires_at, used_at, code_hash
         FROM auth_tokens
         WHERE LOWER(email) = $1 AND type = 'PASSWORD_RESET' AND used_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [normalizedEmail]
      );

      const token = tokenRes.rows[0];
      if (!token) {
        throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Invalid or expired password reset code');
      }

      if (new Date(token.expires_at) < new Date() || token.attempts >= 5) {
        throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Reset code expired or exceeded 5 attempts');
      }

      if (token.code_hash !== codeHash) {
        await client.query(`UPDATE auth_tokens SET attempts = attempts + 1 WHERE id = $1`, [token.id]);
        throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Invalid reset code');
      }

      // Mark token used (single-use)
      await client.query(`UPDATE auth_tokens SET used_at = NOW() WHERE id = $1`, [token.id]);

      // Update password
      const newHash = await hashPassword(newPassword);
      await client.query(
        `UPDATE accounts SET password_hash = $1, failed_logins = 0, locked_until = NULL, updated_at = NOW()
         WHERE id = $2`,
        [newHash, token.account_id]
      );

      // Revoke ALL sessions
      await client.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE account_id = $1`,
        [token.account_id]
      );
    });
  }

  /**
   * DELETE /account: Re-auth, revoke sessions, create DELETE privacy request, leave tombstone
   */
  async handleDeleteAccount(user: UserContext, password?: string) {
    const accRes = await this.db.query(
      `SELECT id, kind, password_hash FROM accounts WHERE id = $1`,
      [user.accountId]
    );
    const acc = accRes.rows[0];
    if (!acc) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Account not found');
    }

    if (acc.kind === 'REGISTERED') {
      if (!password) {
        throw new AppError(400, ErrorCodes.BAD_REQUEST, 'Password confirmation required to delete account');
      }
      const isValid = await verifyPassword(acc.password_hash, password);
      if (!isValid) {
        throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid password');
      }
    }

    return this.db.withTransaction(async (client) => {
      // 1. Mark account pending deletion
      await client.query(
        `UPDATE accounts SET status = 'PENDING_DELETION', updated_at = NOW() WHERE id = $1`,
        [user.accountId]
      );

      // 2. Revoke all sessions immediately
      await client.query(
        `UPDATE sessions SET revoked_at = NOW() WHERE account_id = $1`,
        [user.accountId]
      );

      // 3. Insert DELETE privacy request
      const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await client.query(
        `INSERT INTO privacy_requests (account_id, type, status, due_at)
         VALUES ($1, 'DELETE', 'PENDING', $2)
         ON CONFLICT DO NOTHING`,
        [user.accountId, dueAt]
      );

      return {
        message: 'Account deletion initiated. Your sessions have been revoked immediately.',
        notice:
          'Personal data (email, credentials, reports) will be permanently anonymized. Anonymized credit ledger records are retained solely for tax and accounting compliance. Note: Google Play Store subscriptions must be canceled via the Google Play app; deleting this account does not cancel recurring store billing.',
      };
    });
  }

  /**
   * GET /me: Current account profile, credits, ad-free status
   */
  async getMe(user: UserContext) {
    const accRes = await this.db.query(
      `SELECT a.id, a.kind, a.status, a.email, a.created_at, c.balance,
              e.ends_at as adfree_ends_at, e.source as adfree_source,
              p.ends_at as premium_ends_at
       FROM accounts a
       LEFT JOIN credit_accounts c ON a.id = c.account_id
       LEFT JOIN entitlements e ON a.id = e.account_id AND e.kind = 'ADFREE_CREDIT' AND e.ends_at > NOW()
       LEFT JOIN entitlements p ON a.id = p.account_id AND p.kind = 'PREMIUM' AND p.ends_at > NOW()
       WHERE a.id = $1`,
      [user.accountId]
    );

    const row = accRes.rows[0];
    if (!row) {
      throw new AppError(404, ErrorCodes.NOT_FOUND, 'Account not found');
    }

    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      email: row.email || null,
      balance: row.balance || 0,
      adFree: {
        active: Boolean(row.adfree_ends_at || row.premium_ends_at),
        source: row.premium_ends_at ? 'PREMIUM' : row.adfree_ends_at ? 'CREDIT' : null,
        endsAt: row.premium_ends_at || row.adfree_ends_at || null,
      },
      premium: {
        active: Boolean(row.premium_ends_at),
        endsAt: row.premium_ends_at || null,
      },
      memberSince: row.created_at,
      serverTime: getServerTime(),
    };
  }
}
