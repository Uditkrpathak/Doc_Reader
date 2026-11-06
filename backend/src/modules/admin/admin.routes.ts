import { FastifyPluginAsync } from 'fastify';
import { AdminService } from './admin.service.js';
import {
  adminLoginSchema,
  creditAdjustSchema,
  configUpdateSchema,
  ticketUpdateSchema,
  ticketsQuerySchema,
  auditQuerySchema,
} from './admin.schemas.js';
import { AdminContext } from '../../shared/types.js';

export const adminRoutes: FastifyPluginAsync<{
  adminService: AdminService;
  adminGuard: (req: any) => Promise<AdminContext>;
}> = async (fastify, opts) => {
  const { adminService, adminGuard } = opts;

  // POST /v1/admin/login
  fastify.post('/admin/login', async (request, reply) => {
    const body = adminLoginSchema.parse(request.body);
    const result = await adminService.login(body.email, body.password, body.totpCode);
    return reply.status(200).send(result);
  });

  // POST /v1/admin/credits/adjust
  fastify.post('/admin/credits/adjust', async (request, reply) => {
    const admin = await adminGuard(request);
    const body = creditAdjustSchema.parse(request.body);
    const ip = request.ip || (request.headers['x-forwarded-for'] as string);
    const result = await adminService.adjustCredits(
      admin,
      body.accountId,
      body.delta,
      body.reason,
      ip
    );
    return reply.status(200).send(result);
  });

  // PUT /v1/admin/config/:key
  fastify.put('/admin/config/:key', async (request, reply) => {
    const admin = await adminGuard(request);
    const { key } = request.params as { key: string };
    const body = configUpdateSchema.parse(request.body);
    const ip = request.ip || (request.headers['x-forwarded-for'] as string);
    const result = await adminService.updateConfig(admin, key, body.value, body.reason, ip);
    return reply.status(200).send(result);
  });

  // GET /v1/admin/tickets
  fastify.get('/admin/tickets', async (request, reply) => {
    await adminGuard(request);
    const query = ticketsQuerySchema.parse(request.query || {});
    const result = await adminService.getTickets(query);
    return reply.status(200).send(result);
  });

  // PATCH /v1/admin/tickets/:id
  fastify.patch('/admin/tickets/:id', async (request, reply) => {
    const admin = await adminGuard(request);
    const { id } = request.params as { id: string };
    const body = ticketUpdateSchema.parse(request.body);
    const ip = request.ip || (request.headers['x-forwarded-for'] as string);
    const result = await adminService.updateTicket(admin, id, body.status, body.note, ip);
    return reply.status(200).send(result);
  });

  // GET /v1/admin/audit
  fastify.get('/admin/audit', async (request, reply) => {
    await adminGuard(request);
    const query = auditQuerySchema.parse(request.query || {});
    const result = await adminService.getAuditLogs(query);
    return reply.status(200).send(result);
  });
};

