import dotenv from 'dotenv';
dotenv.config();

import { env } from './config/env.js';
import { pool, Database } from './db/pool.js';
import { runMigrations } from './db/migrator.js';
import { JwtService } from './shared/jwt.js';
import { EmailService } from './shared/email.js';
import { RemoteConfigService } from './config/remote-config.js';
import { JobRunner } from './jobs/runner.js';
import { buildApp } from './app.js';
import { logger } from './shared/logger.js';

async function main() {
  logger.info({ nodeEnv: env.NODE_ENV, port: env.PORT }, 'Initializing Universal File Viewer Backend...');

  // 1. Run database migrations
  try {
    logger.info('Running database migrations...');
    await runMigrations(pool);
    logger.info('Database migrations applied successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to run database migrations');
    process.exit(1);
  }

  // 2. Initialize shared services
  const db = new Database(pool);
  const jwtService = new JwtService({
    jwtSecret: env.JWT_SECRET,
    adminJwtSecret: env.ADMIN_JWT_SECRET,
    ed25519PrivateKeyPem: env.OFFLINE_TOKEN_PRIVATE_KEY,
    ed25519PublicKeyPem: env.OFFLINE_TOKEN_PUBLIC_KEY,
  });

  if (env.OFFLINE_TOKEN_PRIVATE_KEY) {
    await jwtService.initializeEd25519(env.OFFLINE_TOKEN_PRIVATE_KEY);
  }

  const emailService = new EmailService(
    env.SMTP_HOST
      ? {
          host: env.SMTP_HOST,
          port: env.SMTP_PORT || 587,
          secure: env.SMTP_SECURE || false,
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
          from: env.EMAIL_FROM || 'DocReader <noreply@docreaderapp.com>',
        }
      : undefined
  );

  const remoteConfigService = new RemoteConfigService();
  await remoteConfigService.refresh(pool);

  // 3. Start background job runner
  const jobRunner = new JobRunner(db, emailService, remoteConfigService);
  jobRunner.start();

  // 4. Build and start Fastify app
  const app = await buildApp({
    db,
    jwtService,
    emailService,
    remoteConfigService,
  });

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info(`Server listening at http://0.0.0.0:${env.PORT}`);
  } catch (err) {
    logger.error({ err }, 'Failed to start Fastify server');
    process.exit(1);
  }

  // Graceful shutdown handling
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Gracefully shutting down server...');
    try {
      jobRunner.stop();
      await app.close();
      await pool.end();
      logger.info('Clean shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
