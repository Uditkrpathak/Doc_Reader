import { FastifyPluginAsync } from 'fastify';
import { SupportService } from './support.service.js';
import { adReportSchema, problemReportSchema, supportTicketSchema } from './support.schemas.js';
import { UserContext } from '../../shared/types.js';

export const supportRoutes: FastifyPluginAsync<{
  supportService: SupportService;
  optionalAuthGuard: (req: any) => Promise<UserContext | null>;
}> = async (fastify, opts) => {
  const { supportService, optionalAuthGuard } = opts;

  // POST /v1/reports/ad
  fastify.post('/reports/ad', async (request, reply) => {
    const user = await optionalAuthGuard(request);
    const body = adReportSchema.parse(request.body);
    const result = await supportService.reportAd(user?.accountId || null, body);
    return reply.status(200).send(result);
  });

  // POST /v1/reports/problem
  fastify.post('/reports/problem', async (request, reply) => {
    const user = await optionalAuthGuard(request);
    const body = problemReportSchema.parse(request.body);
    const result = await supportService.reportProblem(user?.accountId || null, body);
    return reply.status(200).send(result);
  });

  // POST /v1/support/tickets
  fastify.post('/support/tickets', async (request, reply) => {
    const user = await optionalAuthGuard(request);
    const body = supportTicketSchema.parse(request.body);
    const result = await supportService.createSupportTicket(user?.accountId || null, body);
    return reply.status(201).send(result);
  });

  // GET /v1/help/faq
  fastify.get('/help/faq', async (request, reply) => {
    const { locale } = (request.query as { locale?: string }) || {};
    const { items, etag } = await supportService.getFaq(locale || 'en');

    reply.header('ETag', etag);
    reply.header('Cache-Control', 'public, max-age=300');

    if (request.headers['if-none-match'] === etag) {
      return reply.status(304).send();
    }

    return reply.status(200).send({ items });
  });
};

