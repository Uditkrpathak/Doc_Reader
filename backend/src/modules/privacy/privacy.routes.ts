import { FastifyPluginAsync } from 'fastify';
import { PrivacyService } from './privacy.service.js';
import { putConsentsSchema, privacyRequestSchema } from './privacy.schemas.js';
import { UserContext } from '../../shared/types.js';

export const privacyRoutes: FastifyPluginAsync<{
  privacyService: PrivacyService;
  authGuard: (req: any) => Promise<UserContext>;
}> = async (fastify, opts) => {
  const { privacyService, authGuard } = opts;

  // GET /v1/consents
  fastify.get('/consents', async (request, reply) => {
    const user = await authGuard(request);
    const result = await privacyService.getConsents(user.accountId);
    return reply.status(200).send(result);
  });

  // PUT /v1/consents
  fastify.put('/consents', async (request, reply) => {
    const user = await authGuard(request);
    const body = putConsentsSchema.parse(request.body);
    const result = await privacyService.putConsents(
      user.accountId,
      body.consents,
      body.policyVersion,
      body.source
    );
    return reply.status(200).send(result);
  });

  // POST /v1/privacy/requests
  fastify.post('/privacy/requests', async (request, reply) => {
    const user = await authGuard(request);
    const body = privacyRequestSchema.parse(request.body);
    const result = await privacyService.createPrivacyRequest(user.accountId, body.type);
    return reply.status(202).send(result);
  });

  // GET /v1/privacy/exports/:token
  fastify.get('/privacy/exports/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const payload = await privacyService.downloadExport(token);
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', 'attachment; filename="data-export.json"');
    return reply.status(200).send(payload);
  });
};

