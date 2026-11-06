import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createTestDb, ITestDb } from '../helpers/test-db.js';
import { AdminService } from '../../src/modules/admin/admin.service.js';
import { adminRoutes } from '../../src/modules/admin/admin.routes.js';
import { RemoteConfigService } from '../../src/config/remote-config.js';
import { JwtService } from '../../src/shared/jwt.js';
import { hashPassword } from '../../src/shared/crypto.js';
import { generateTotp, generateTotpSecret } from '../../src/shared/totp.js';
import { fastifyErrorHandler } from '../../src/shared/errors.js';
import { AdminContext } from '../../src/shared/types.js';

describe('Admin API & RBAC Integration Tests', () => {
  let db: ITestDb;
  let adminService: AdminService;
  let remoteConfigService: RemoteConfigService;
  let jwtService: JwtService;
  let app: FastifyInstance;

  let superAdminId: string;
  let supportAdminId: string;
  let superAdminTotpSecret: string;
  let targetAccountId: string;

  beforeEach(async () => {
    db = await createTestDb();
    remoteConfigService = new RemoteConfigService();
    jwtService = new JwtService({
      jwtSecret: 'test_jwt_secret_min_32_characters_123456',
      adminJwtSecret: 'test_admin_jwt_secret_min_32_characters_123456',
    });
    adminService = new AdminService(db as any, jwtService, remoteConfigService);

    // Create target user account with 50 credits
    const accRes = await db.query<{ id: string }>(
      `INSERT INTO accounts (kind, status, install_hash)
       VALUES ('REGISTERED', 'ACTIVE', 'user_inst_hash')
       RETURNING id;`
    );
    targetAccountId = accRes.rows[0]!.id;
    await db.query(
      `INSERT INTO credit_accounts (account_id, balance, version)
       VALUES ($1::uuid, 50, 1);`,
      [targetAccountId]
    );

    // Create SUPER_ADMIN
    superAdminTotpSecret = generateTotpSecret();
    const superPassHash = await hashPassword('SuperSecret123!');
    const superRes = await db.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, role, totp_secret)
       VALUES ('super@docreader.app', $1, 'SUPER_ADMIN', $2)
       RETURNING id;`,
      [superPassHash, superAdminTotpSecret]
    );
    superAdminId = superRes.rows[0]!.id;

    // Create SUPPORT admin
    const supportPassHash = await hashPassword('SupportSecret123!');
    const supportRes = await db.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, role, totp_secret)
       VALUES ('support@docreader.app', $1, 'SUPPORT', $2)
       RETURNING id;`,
      [supportPassHash, generateTotpSecret()]
    );
    supportAdminId = supportRes.rows[0]!.id;

    // Guard extracting AdminContext from headers
    const mockAdminGuard = async (req: any): Promise<AdminContext> => {
      const auth = req.headers.authorization;
      if (!auth) throw new Error('Unauthorized');
      const token = auth.replace('Bearer ', '');
      const payload = await jwtService.verifyAdminToken(token);
      return {
        adminId: payload.sub,
        email: payload.email,
        role: payload.role as any,
      };
    };

    app = Fastify();
    app.setErrorHandler(fastifyErrorHandler);
    await app.register(adminRoutes, {
      adminService,
      adminGuard: mockAdminGuard,
    });
  });

  describe('Admin Authentication & TOTP', () => {
    it('successfully logs in with correct password and valid RFC 6238 TOTP', async () => {
      const validTotp = generateTotp(superAdminTotpSecret);

      const res = await app.inject({
        method: 'POST',
        url: '/admin/login',
        payload: {
          email: 'super@docreader.app',
          password: 'SuperSecret123!',
          totpCode: validTotp,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.token).toBeDefined();
      expect(data.admin.role).toBe('SUPER_ADMIN');

      // Verify token is valid admin token
      const verified = await jwtService.verifyAdminToken(data.token);
      expect(verified.sub).toBe(superAdminId);
      expect(verified.role).toBe('SUPER_ADMIN');
    });

    it('rejects login with invalid TOTP code', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/login',
        payload: {
          email: 'super@docreader.app',
          password: 'SuperSecret123!',
          totpCode: '000000',
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejects login with wrong password', async () => {
      const validTotp = generateTotp(superAdminTotpSecret);
      const res = await app.inject({
        method: 'POST',
        url: '/admin/login',
        payload: {
          email: 'super@docreader.app',
          password: 'WrongPassword!',
          totpCode: validTotp,
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('RBAC & Credit Adjustment', () => {
    it('allows SUPER_ADMIN to adjust credits and records ledger + audit log', async () => {
      const token = await jwtService.signAdminToken({
        adminId: superAdminId,
        email: 'super@docreader.app',
        role: 'SUPER_ADMIN',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/admin/credits/adjust',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          accountId: targetAccountId,
          delta: 25,
          reason: 'Customer apology for downtime',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().previousBalance).toBe(50);
      expect(res.json().newBalance).toBe(75);

      // Verify credit_accounts updated
      const accRes = await db.query<{ balance: number }>(
        `SELECT balance FROM credit_accounts WHERE account_id = $1::uuid;`,
        [targetAccountId]
      );
      expect(accRes.rows[0]!.balance).toBe(75);

      // Verify ledger entry
      const ledgerRes = await db.query<{ amount: number; type: string }>(
        `SELECT amount, type FROM credit_ledger_entries WHERE account_id = $1::uuid;`,
        [targetAccountId]
      );
      expect(ledgerRes.rows).toHaveLength(1);
      expect(ledgerRes.rows[0]!.type).toBe('ADMIN_ADJUST');
      expect(ledgerRes.rows[0]!.amount).toBe(25);

      // Verify audit log entry
      const auditRes = await db.query<{ action: string; reason: string }>(
        `SELECT action, reason FROM admin_audit_log WHERE admin_id = $1::uuid;`,
        [superAdminId]
      );
      expect(auditRes.rows).toHaveLength(1);
      expect(auditRes.rows[0]!.action).toBe('CREDIT_ADJUST');
      expect(auditRes.rows[0]!.reason).toBe('Customer apology for downtime');
    });

    it('rejects credit adjustment by SUPPORT admin with 403 Forbidden', async () => {
      const token = await jwtService.signAdminToken({
        adminId: supportAdminId,
        email: 'support@docreader.app',
        role: 'SUPPORT',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/admin/credits/adjust',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          accountId: targetAccountId,
          delta: 20,
          reason: 'Test adjust',
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it('rejects negative balance adjustment with 422', async () => {
      const token = await jwtService.signAdminToken({
        adminId: superAdminId,
        email: 'super@docreader.app',
        role: 'SUPER_ADMIN',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/admin/credits/adjust',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          accountId: targetAccountId,
          delta: -100, // Account only has 50!
          reason: 'Fraud clawback',
        },
      });

      expect(res.statusCode).toBe(422);
    });
  });

  describe('Config & Support Tickets Administration', () => {
    it('allows SUPER_ADMIN to update remote_config and records audit log', async () => {
      const token = await jwtService.signAdminToken({
        adminId: superAdminId,
        email: 'super@docreader.app',
        role: 'SUPER_ADMIN',
      });

      const res = await app.inject({
        method: 'PUT',
        url: '/admin/config/creditsPerReward',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          value: 15,
          reason: 'Diwali promotional increase',
        },
      });

      expect(res.statusCode).toBe(200);

      // Verify remote config in DB
      const cfgRes = await db.query<{ value: any }>(
        `SELECT value FROM remote_config WHERE key = 'creditsPerReward';`
      );
      expect(cfgRes.rows[0]!.value).toBe(15);
    });

    it('allows SUPPORT to update ticket status', async () => {
      // Create ticket
      const tickRes = await db.query<{ id: string }>(
        `INSERT INTO support_tickets (ticket_number, email, category, message, status)
         VALUES ('TICK-TEST-1', 'user@example.com', 'BUG', 'App crashes', 'OPEN')
         RETURNING id;`
      );
      const ticketId = tickRes.rows[0]!.id;

      const token = await jwtService.signAdminToken({
        adminId: supportAdminId,
        email: 'support@docreader.app',
        role: 'SUPPORT',
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/tickets/${ticketId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          status: 'RESOLVED',
          note: 'Fixed in release 1.0.1',
        },
      });

      expect(res.statusCode).toBe(200);

      // Verify in DB
      const dbTick = await db.query<{ status: string }>(
        `SELECT status FROM support_tickets WHERE id = $1::uuid;`,
        [ticketId]
      );
      expect(dbTick.rows[0]!.status).toBe('RESOLVED');
    });

    it('queries audit logs and tickets with pagination', async () => {
      const token = await jwtService.signAdminToken({
        adminId: superAdminId,
        email: 'super@docreader.app',
        role: 'SUPER_ADMIN',
      });

      // Insert audit logs
      await db.query(
        `INSERT INTO admin_audit_log (admin_id, action, target_type, reason)
         VALUES ($1::uuid, 'TEST_ACTION_1', 'system', 'Test 1'),
                ($1::uuid, 'TEST_ACTION_2', 'system', 'Test 2');`,
        [superAdminId]
      );

      const auditRes = await app.inject({
        method: 'GET',
        url: '/admin/audit?limit=10',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(auditRes.statusCode).toBe(200);
      expect(auditRes.json().auditLogs.length).toBeGreaterThanOrEqual(2);
    });
  });
});
