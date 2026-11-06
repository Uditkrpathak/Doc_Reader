import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import crypto from 'node:crypto';

import { Database } from './db/pool.js';
import { JwtService } from './shared/jwt.js';
import { EmailService } from './shared/email.js';
import { RemoteConfigService } from './config/remote-config.js';
import { fastifyErrorHandler, AppError, ErrorCodes } from './shared/errors.js';
import { UserContext, AdminContext } from './shared/types.js';

// Services
import { IdentityService } from './modules/identity/identity.service.js';
import { WalletService } from './modules/wallet/wallet.service.js';
import { RewardsService } from './modules/rewards/rewards.service.js';
import { AdMobSsvVerifier } from './modules/rewards/admob-ssv.js';
import { BillingService } from './modules/billing/billing.service.js';
import { GooglePlayClient, FakePlayClient } from './modules/billing/play-client.js';
import { GooglePubSubVerifier } from './modules/billing/pubsub.js';
import { PrivacyService } from './modules/privacy/privacy.service.js';
import { SupportService } from './modules/support/support.service.js';
import { AdminService } from './modules/admin/admin.service.js';

// Route plugins
import { identityRoutes } from './modules/identity/identity.routes.js';
import { walletRoutes } from './modules/wallet/wallet.routes.js';
import { rewardsRoutes } from './modules/rewards/rewards.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { privacyRoutes } from './modules/privacy/privacy.routes.js';
import { supportRoutes } from './modules/support/support.routes.js';
import { configRoutes } from './modules/config/config.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';

export interface AppDependencies {
  db: Database;
  jwtService: JwtService;
  emailService: EmailService;
  remoteConfigService: RemoteConfigService;
  playClient?: GooglePlayClient | FakePlayClient;
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { db, jwtService, emailService, remoteConfigService } = deps;

  const app = Fastify({
    bodyLimit: 64 * 1024, // 64KB strict body limit
    genReqId: () => crypto.randomUUID(),
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'body.password',
          'body.code',
          'body.refreshToken',
          'body.email',
          'body.token',
          'body.totpCode',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  // Security middlewares
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true, credentials: true });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });

  // Global Error Handler
  app.setErrorHandler(fastifyErrorHandler);

  // Authentication Guards
  const authGuard = async (req: any): Promise<UserContext> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Missing or malformed Authorization header');
    }
    const token = authHeader.substring(7);
    const payload = await jwtService.verifyAccessToken(token);
    return {
      accountId: payload.sub,
      sessionId: payload.sid || '',
      kind: payload.kind,
      email: payload.email,
    };
  };

  const optionalAuthGuard = async (req: any): Promise<UserContext | null> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    try {
      const token = authHeader.substring(7);
      const payload = await jwtService.verifyAccessToken(token);
      return {
        accountId: payload.sub,
        sessionId: payload.sid || '',
        kind: payload.kind,
        email: payload.email,
      };
    } catch {
      return null;
    }
  };

  const adminGuard = async (req: any): Promise<AdminContext> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Missing or malformed Authorization header');
    }
    const token = authHeader.substring(7);
    const payload = await jwtService.verifyAdminToken(token);
    return {
      adminId: payload.sub,
      email: payload.email,
      role: payload.role as any,
    };
  };

  // Instantiate domain services
  const playClient = deps.playClient || new FakePlayClient();
  const identityService = new IdentityService(db, jwtService, emailService, remoteConfigService);
  const walletService = new WalletService(db, remoteConfigService, jwtService);
  const rewardsService = new RewardsService(db, remoteConfigService, new AdMobSsvVerifier());
  const billingService = new BillingService(db, playClient);
  const pubSubVerifier = new GooglePubSubVerifier(
    process.env.GOOGLE_PUBSUB_AUDIENCE,
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  );
  const privacyService = new PrivacyService(db);
  const supportService = new SupportService(db);
  const adminService = new AdminService(db, jwtService, remoteConfigService);

  // Register health checks at root
  app.get('/healthz', async () => ({ status: 'ok', uptime: process.uptime() }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await db.query('SELECT 1;');
      return { status: 'ready', db: 'ok' };
    } catch (err: any) {
      return reply.status(503).send({ status: 'not_ready', db: 'error', error: err.message });
    }
  });

  // Register versioned API routes under /v1
  await app.register(
    async (v1) => {
      await v1.register(identityRoutes, { identityService, authGuard, optionalAuthGuard });
      await v1.register(walletRoutes, { walletService, authGuard });
      await v1.register(rewardsRoutes, { rewardsService, authGuard });
      await v1.register(billingRoutes, { billingService, pubSubVerifier, authGuard });
      await v1.register(privacyRoutes, { privacyService, authGuard });
      await v1.register(supportRoutes, { supportService, optionalAuthGuard });
      await v1.register(configRoutes, { db, remoteConfigService });
      await v1.register(adminRoutes, { adminService, adminGuard });
    },
    { prefix: '/v1' }
  );

  return app;
}
