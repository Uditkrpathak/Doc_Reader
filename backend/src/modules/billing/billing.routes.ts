import { FastifyPluginAsync } from 'fastify';
import { BillingService } from './billing.service';
import { GooglePubSubVerifier } from './pubsub';
import { verifyPurchaseSchema, restorePurchasesSchema, pubsubPushSchema } from './billing.schemas';
import { UserContext } from '../../shared/types';
import { AppError, ErrorCodes } from '../../shared/errors';

export const billingRoutes: FastifyPluginAsync<{
  billingService: BillingService;
  pubSubVerifier: GooglePubSubVerifier;
  authGuard: (req: any) => Promise<UserContext>;
}> = async (fastify, opts) => {
  const { billingService, pubSubVerifier, authGuard } = opts;

  // POST /v1/billing/verify
  fastify.post('/billing/verify', async (request, reply) => {
    const user = await authGuard(request);
    const body = verifyPurchaseSchema.parse(request.body);
    const result = await billingService.verifyPurchase(
      user,
      body.kind,
      body.productId,
      body.purchaseToken
    );
    return reply.status(200).send(result);
  });

  // POST /v1/billing/restore
  fastify.post('/billing/restore', async (request, reply) => {
    const user = await authGuard(request);
    const body = restorePurchasesSchema.parse(request.body);
    const result = await billingService.restorePurchases(user, body.purchases);
    return reply.status(200).send(result);
  });

  // POST /v1/webhooks/google-play (Pub/Sub push)
  fastify.post('/webhooks/google-play', async (request, reply) => {
    const authHeader = request.headers.authorization;
    const isAuthed = await pubSubVerifier.verifyPushToken(authHeader);
    if (!isAuthed) {
      throw new AppError(401, ErrorCodes.UNAUTHORIZED, 'Invalid Google Pub/Sub OIDC token');
    }

    const body = pubsubPushSchema.parse(request.body);
    const result = await billingService.handlePubSubNotification(body.message);
    return reply.status(200).send(result);
  });
};

