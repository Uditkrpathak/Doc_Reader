import { FastifyPluginAsync } from 'fastify';
import { WalletService } from './wallet.service';
import { ledgerQuerySchema, adfreeRedeemSchema } from './wallet.schemas';
import { UserContext } from '../../shared/types';
import { AppError, ErrorCodes } from '../../shared/errors';

export const walletRoutes: FastifyPluginAsync<{
  walletService: WalletService;
  authGuard: (req: any) => Promise<UserContext>;
}> = async (fastify, opts) => {
  const { walletService, authGuard } = opts;

  // GET /v1/wallet
  fastify.get('/wallet', async (request, reply) => {
    const user = await authGuard(request);
    const result = await walletService.getWallet(user);
    return reply.status(200).send(result);
  });

  // GET /v1/wallet/ledger
  fastify.get('/wallet/ledger', async (request, reply) => {
    const user = await authGuard(request);
    const query = ledgerQuerySchema.parse(request.query || {});
    const result = await walletService.getLedger(user, query.type, query.cursor, query.limit);
    return reply.status(200).send(result);
  });

  // GET /v1/adfree/options
  fastify.get('/adfree/options', async (request, reply) => {
    const user = await authGuard(request);
    const result = await walletService.getAdFreeOptions(user);
    return reply.status(200).send(result);
  });

  // POST /v1/adfree/redemptions
  fastify.post('/adfree/redemptions', async (request, reply) => {
    const user = await authGuard(request);
    const idempotencyKey = (request.headers['idempotency-key'] as string) || '';
    if (!idempotencyKey) {
      throw new AppError(400, ErrorCodes.IDEMPOTENCY_REQUIRED, 'Idempotency-Key header is required');
    }

    const body = adfreeRedeemSchema.parse(request.body);
    const result = await walletService.redeemAdFree(user, body.tierId, idempotencyKey);
    return reply.status(200).send(result);
  });

  // GET /v1/entitlements
  fastify.get('/entitlements', async (request, reply) => {
    const user = await authGuard(request);
    const result = await walletService.getEntitlements(user);
    return reply.status(200).send(result);
  });
};

