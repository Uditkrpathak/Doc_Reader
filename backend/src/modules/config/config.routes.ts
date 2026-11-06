import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { Database } from '../../db/pool.js';
import { RemoteConfigService } from '../../config/remote-config.js';
import { getServerTime } from '../../shared/time.js';

export const configRoutes: FastifyPluginAsync<{
  db: Database;
  remoteConfigService: RemoteConfigService;
}> = async (fastify, opts) => {
  const { db, remoteConfigService } = opts;

  // GET /v1/config
  fastify.get('/config', async (request, reply) => {
    const config = await remoteConfigService.getAll();
    const ed25519PublicKey = process.env.OFFLINE_TOKEN_PUBLIC_KEY || '';

    const payload = {
      ...config,
      offlineTokenPublicKey: ed25519PublicKey,
      serverTime: getServerTime(),
    };

    const etag = `"${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16)}"`;

    reply.header('ETag', etag);
    reply.header('Cache-Control', 'public, max-age=60');

    if (request.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }

    return reply.status(200).send(payload);
  });

  // GET /healthz (Liveness)
  fastify.get('/healthz', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok', uptime: process.uptime() });
  });

  // GET /readyz (Readiness)
  fastify.get('/readyz', async (_request, reply) => {
    try {
      await db.query('SELECT 1;');
      return reply.status(200).send({ status: 'ready', db: 'ok' });
    } catch (err: any) {
      return reply.status(503).send({ status: 'not_ready', db: 'error', error: err.message });
    }
  });
};

