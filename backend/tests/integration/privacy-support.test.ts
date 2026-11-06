import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createTestDb, ITestDb } from '../helpers/test-db.js';
import { PrivacyService } from '../../src/modules/privacy/privacy.service.js';
import { privacyRoutes } from '../../src/modules/privacy/privacy.routes.js';
import { SupportService } from '../../src/modules/support/support.service.js';
import { supportRoutes } from '../../src/modules/support/support.routes.js';
import { configRoutes } from '../../src/modules/config/config.routes.js';
import { RemoteConfigService } from '../../src/config/remote-config.js';
import { sha256Hex } from '../../src/shared/crypto.js';
import { UserContext } from '../../src/shared/types.js';
import { fastifyErrorHandler } from '../../src/shared/errors.js';

describe('Privacy, Support & Config Integration Tests', () => {
  let db: ITestDb;
  let privacyService: PrivacyService;
  let supportService: SupportService;
  let remoteConfigService: RemoteConfigService;
  let app: FastifyInstance;
  let testAccountId: string;

  beforeEach(async () => {
    db = await createTestDb();
    privacyService = new PrivacyService(db as any);
    supportService = new SupportService(db as any);
    remoteConfigService = new RemoteConfigService();

    const accountRes = await db.query<{ id: string }>(
      `INSERT INTO accounts (kind, status, install_hash)
       VALUES ('GUEST', 'ACTIVE', 'test_inst_privacy')
       RETURNING id;`
    );
    testAccountId = accountRes.rows[0]!.id;

    const mockAuthGuard = async (_req: any): Promise<UserContext> => ({
      accountId: testAccountId,
      sessionId: 'sess_1',
      kind: 'GUEST',
    });

    const mockOptionalAuthGuard = async (req: any): Promise<UserContext | null> => {
      if (req.headers.authorization) {
        return { accountId: testAccountId, sessionId: 'sess_1', kind: 'GUEST' };
      }
      return null;
    };

    app = Fastify();
    app.setErrorHandler(fastifyErrorHandler);
    await app.register(privacyRoutes, { privacyService, authGuard: mockAuthGuard });
    await app.register(supportRoutes, {
      supportService,
      optionalAuthGuard: mockOptionalAuthGuard,
    });
    await app.register(configRoutes, { db: db as any, remoteConfigService });
  });

  describe('Consents API (Append-only DPDP)', () => {
    it('stores consents and returns latest state while keeping append-only history', async () => {
      const putRes1 = await app.inject({
        method: 'PUT',
        url: '/consents',
        payload: {
          consents: [
            { purpose: 'USAGE_ANALYTICS', granted: true },
            { purpose: 'PERSONALISED_ADS', granted: false },
          ],
          policyVersion: '1.0.0',
          source: 'onboarding_modal',
        },
      });

      expect(putRes1.statusCode).toBe(200);
      const data1 = putRes1.json();
      expect(data1.consents).toHaveLength(2);

      // Now update USAGE_ANALYTICS to false
      const putRes2 = await app.inject({
        method: 'PUT',
        url: '/consents',
        payload: {
          consents: [{ purpose: 'USAGE_ANALYTICS', granted: false }],
          policyVersion: '1.0.1',
          source: 'settings',
        },
      });

      expect(putRes2.statusCode).toBe(200);
      const data2 = putRes2.json();
      const analyticsConsent = data2.consents.find((c: any) => c.purpose === 'USAGE_ANALYTICS');
      expect(analyticsConsent.granted).toBe(false);
      expect(analyticsConsent.policyVersion).toBe('1.0.1');

      // Verify DB contains 3 total rows (append-only history)
      const countRes = await db.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM consent_records WHERE account_id = $1::uuid;`,
        [testAccountId]
      );
      expect(parseInt(countRes.rows[0]!.count, 10)).toBe(3);
    });
  });

  describe('Privacy Requests & Data Export', () => {
    it('creates EXPORT request and rejects duplicate open requests with 409', async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/privacy/requests',
        payload: { type: 'EXPORT' },
      });

      expect(res1.statusCode).toBe(202);
      expect(res1.json().type).toBe('EXPORT');
      expect(res1.json().status).toBe('PENDING');

      // Duplicate open request
      const res2 = await app.inject({
        method: 'POST',
        url: '/privacy/requests',
        payload: { type: 'EXPORT' },
      });

      expect(res2.statusCode).toBe(409);
    });

    it('marks account PENDING_DELETION on DELETE request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/privacy/requests',
        payload: { type: 'DELETE' },
      });

      expect(res.statusCode).toBe(202);

      const accRes = await db.query<{ status: string }>(
        `SELECT status FROM accounts WHERE id = $1::uuid;`,
        [testAccountId]
      );
      expect(accRes.rows[0]!.status).toBe('PENDING_DELETION');
    });

    it('handles single-use data export downloads and expired links', async () => {
      const rawToken = 'secret-export-token-12345';
      const tokenHash = sha256Hex(rawToken);

      // Insert test export valid for 24h
      await db.query(
        `INSERT INTO data_exports (account_id, token_hash, payload, expires_at)
         VALUES ($1::uuid, $2, $3, NOW() + INTERVAL '24 hours');`,
        [testAccountId, tokenHash, JSON.stringify({ accountId: testAccountId, credits: 50 })]
      );

      // First download: succeeds
      const dlRes1 = await app.inject({
        method: 'GET',
        url: `/privacy/exports/${rawToken}`,
      });
      expect(dlRes1.statusCode).toBe(200);
      expect(dlRes1.json().credits).toBe(50);

      // Second download: rejected with 410 (single-use)
      const dlRes2 = await app.inject({
        method: 'GET',
        url: `/privacy/exports/${rawToken}`,
      });
      expect(dlRes2.statusCode).toBe(410);

      // Expired token download: rejected with 410
      const expiredToken = 'expired-token-999';
      await db.query(
        `INSERT INTO data_exports (account_id, token_hash, payload, expires_at)
         VALUES ($1::uuid, $2, $3, NOW() - INTERVAL '1 hour');`,
        [testAccountId, sha256Hex(expiredToken), JSON.stringify({ foo: 'bar' })]
      );
      const dlResExpired = await app.inject({
        method: 'GET',
        url: `/privacy/exports/${expiredToken}`,
      });
      expect(dlResExpired.statusCode).toBe(410);
    });
  });

  describe('Ad & Problem Reports & Anti-Abuse Auto-Pause', () => {
    it('sanitizes paths in ad reports, increments campaign complaint count and auto-pauses at threshold', async () => {
      // Create campaign
      const campRes = await db.query<{ id: string }>(
        `INSERT INTO campaigns (name, complaint_count, paused)
         VALUES ('Sponsor App Promo', 9, FALSE)
         RETURNING id;`
      );
      const campaignId = campRes.rows[0]!.id;

      // Report ad with file path in details
      const reportRes = await app.inject({
        method: 'POST',
        url: '/reports/ad',
        payload: {
          placement: 'interstitial_home',
          reasons: ['MISLEADING', 'OFFENSIVE'],
          details: 'User tapped while viewing /storage/emulated/0/Documents/Budget.xlsx',
          adSource: 'FIRST_PARTY',
          campaignId: campaignId,
        },
      });

      expect(reportRes.statusCode).toBe(200);

      // Verify path was sanitized in DB
      const reportInDb = await db.query<{ details: string }>(
        `SELECT details FROM ad_reports WHERE id = $1::uuid;`,
        [reportRes.json().id]
      );
      expect(reportInDb.rows[0]!.details).not.toContain('/storage/emulated/0/Documents/Budget.xlsx');
      expect(reportInDb.rows[0]!.details).toContain('[REDACTED_PATH]');

      // Verify campaign auto-paused because complaints reached 10
      const campInDb = await db.query<{ complaint_count: number; paused: boolean }>(
        `SELECT complaint_count, paused FROM campaigns WHERE id = $1::uuid;`,
        [campaignId]
      );
      expect(campInDb.rows[0]!.complaint_count).toBe(10);
      expect(campInDb.rows[0]!.paused).toBe(true);
    });

    it('strictly rejects location fields in ad report', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/reports/ad',
        payload: {
          placement: 'banner_bottom',
          reasons: ['TOO_FREQUENT'],
          adSource: 'ADMOB',
          latitude: 28.6139,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('strictly accepts problem reports and rejects forbidden fileName/filePath fields', async () => {
      // Forbidden payload with fileName
      const badRes = await app.inject({
        method: 'POST',
        url: '/reports/problem',
        payload: {
          problemType: 'CRASH_ON_OPEN',
          fileExtension: 'pdf',
          detectedType: 'application/pdf',
          sizeBucket: '5-25MB',
          engine: 'PDFium',
          appVersion: '1.0.0',
          osVersion: 'Android 14',
          deviceModel: 'Pixel 8',
          fileName: 'Secret_Document.pdf', // FORBIDDEN!
        },
      });
      expect(badRes.statusCode).toBe(400);

      // Valid diagnostic payload
      const goodRes = await app.inject({
        method: 'POST',
        url: '/reports/problem',
        payload: {
          problemType: 'RENDER_CORRUPTION',
          details: 'Rendering failed at /sdcard/Download/test.docx line 5',
          fileExtension: 'docx',
          detectedType: 'application/docx',
          sizeBucket: '< 5MB',
          errorCode: 'ERR_ZIP_CORRUPT',
          engine: 'DocxEngine',
          appVersion: '1.0.0',
          osVersion: 'Android 14',
          deviceModel: 'Pixel 8',
        },
      });
      expect(goodRes.statusCode).toBe(200);

      const dbProblem = await db.query<{ details: string }>(
        `SELECT details FROM problem_reports WHERE id = $1::uuid;`,
        [goodRes.json().id]
      );
      expect(dbProblem.rows[0]!.details).not.toContain('/sdcard/Download/test.docx');
      expect(dbProblem.rows[0]!.details).toContain('[REDACTED_PATH]');
    });
  });

  describe('Support Tickets & Email Dispatch', () => {
    it('creates support ticket and queues user and support emails in email_outbox', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/support/tickets',
        payload: {
          category: 'BILLING_ISSUE',
          email: 'customer@example.com',
          message: 'I was charged twice for the annual plan.',
        },
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.ticketNumber).toMatch(/^TICK-/);
      expect(data.status).toBe('OPEN');

      // Verify emails queued in outbox
      const outbox = await db.query<{ to_email: string; subject: string }>(
        `SELECT to_email, subject FROM email_outbox ORDER BY created_at ASC;`
      );
      expect(outbox.rows).toHaveLength(2);
      expect(outbox.rows[0]!.to_email).toBe('customer@example.com');
      expect(outbox.rows[1]!.subject).toContain('New Ticket');
    });
  });

  describe('Help FAQ & Config', () => {
    it('serves FAQ with ETag caching and fallback to en', async () => {
      await db.query(
        `INSERT INTO faq_items (locale, category, question, answer, sort_order)
         VALUES ('en', 'General', 'How do I open PDFs?', 'Tap on any PDF file.', 1);`
      );

      // Request with hi locale (should fallback to en)
      const res1 = await app.inject({
        method: 'GET',
        url: '/help/faq?locale=hi',
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().items).toHaveLength(1);
      const etag = res1.headers.etag as string;
      expect(etag).toBeDefined();

      // Conditional request
      const res2 = await app.inject({
        method: 'GET',
        url: '/help/faq?locale=hi',
        headers: { 'if-none-match': etag },
      });
      expect(res2.statusCode).toBe(304);
    });

    it('serves /config, /healthz and /readyz', async () => {
      const cfgRes = await app.inject({ method: 'GET', url: '/config' });
      expect(cfgRes.statusCode).toBe(200);
      expect(cfgRes.json().creditsPerReward).toBe(10);
      expect(cfgRes.json().serverTime).toBeDefined();

      const healthRes = await app.inject({ method: 'GET', url: '/healthz' });
      expect(healthRes.statusCode).toBe(200);
      expect(healthRes.json().status).toBe('ok');

      const readyRes = await app.inject({ method: 'GET', url: '/readyz' });
      expect(readyRes.statusCode).toBe(200);
      expect(readyRes.json().db).toBe('ok');
    });
  });
});
