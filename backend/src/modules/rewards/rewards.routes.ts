import { FastifyPluginAsync } from 'fastify';
import { RewardsService } from './rewards.service';
import { admobWebhookQuerySchema } from './rewards.schemas';
import { UserContext } from '../../shared/types';
import { z } from 'zod';

const claimParamSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const rewardsRoutes: FastifyPluginAsync<{
  rewardsService: RewardsService;
  authGuard: (req: any) => Promise<UserContext>;
}> = async (fastify, opts) => {
  const { rewardsService, authGuard } = opts;

  // POST /v1/rewards/claims
  fastify.post('/rewards/claims', async (request, reply) => {
    const user = await authGuard(request);
    const result = await rewardsService.createClaim(user);
    return reply.status(201).send(result);
  });

  // GET /v1/rewards/claims/:id
  fastify.get('/rewards/claims/:id', async (request, reply) => {
    const user = await authGuard(request);
    const params = claimParamSchema.parse(request.params);
    const result = await rewardsService.getClaim(user, params.id);
    return reply.status(200).send(result);
  });

  // GET /v1/webhooks/admob-ssv
  fastify.get('/webhooks/admob-ssv', async (request, reply) => {
    const query = admobWebhookQuerySchema.parse(request.query);
    const rawUrl = request.raw.url || '';
    const result = await rewardsService.handleAdMobWebhook(query as any, rawUrl);
    return reply.status(200).send(result);
  });
};

