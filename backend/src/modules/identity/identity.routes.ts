import { FastifyPluginAsync } from 'fastify';
import { IdentityService } from './identity.service';
import {
  guestSchema,
  signupSchema,
  loginSchema,
  refreshSchema,
  emailVerifySchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  deleteAccountSchema,
} from './identity.schemas';
import { UserContext } from '../../shared/types';

export const identityRoutes: FastifyPluginAsync<{
  identityService: IdentityService;
  authGuard: (req: any) => Promise<UserContext>;
  optionalAuthGuard: (req: any) => Promise<UserContext | null>;
}> = async (fastify, opts) => {
  const { identityService, authGuard, optionalAuthGuard } = opts;

  // POST /v1/auth/guest
  fastify.post('/auth/guest', async (request, reply) => {
    const body = guestSchema.parse(request.body);
    const result = await identityService.handleGuest(body.installId, body.integrityToken);
    return reply.status(200).send(result);
  });

  // POST /v1/auth/signup
  fastify.post('/auth/signup', async (request, reply) => {
    const body = signupSchema.parse(request.body);
    const currentUser = await optionalAuthGuard(request);
    const result = await identityService.handleSignup(body.email, body.password, currentUser);
    return reply.status(201).send(result);
  });

  // POST /v1/auth/login
  fastify.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const currentUser = await optionalAuthGuard(request);
    const result = await identityService.handleLogin(body.email, body.password, currentUser);
    return reply.status(200).send(result);
  });

  // POST /v1/auth/refresh
  fastify.post('/auth/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    const result = await identityService.handleRefresh(body.refreshToken);
    return reply.status(200).send(result);
  });

  // POST /v1/auth/logout
  fastify.post('/auth/logout', async (request, reply) => {
    const user = await authGuard(request);
    await identityService.handleLogout(user);
    return reply.status(200).send({ success: true });
  });

  // POST /v1/auth/email/verify
  fastify.post('/auth/email/verify', async (request, reply) => {
    const user = await authGuard(request);
    const body = emailVerifySchema.parse(request.body);
    await identityService.handleEmailVerify(user, body.code);
    return reply.status(200).send({ success: true, message: 'Email successfully verified' });
  });

  // POST /v1/auth/email/resend
  fastify.post('/auth/email/resend', async (request, reply) => {
    const user = await authGuard(request);
    await identityService.handleEmailResend(user);
    return reply.status(200).send({ success: true, message: 'Verification code resent' });
  });

  // POST /v1/auth/password/forgot
  fastify.post('/auth/password/forgot', async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);
    const result = await identityService.handleForgotPassword(body.email);
    return reply.status(202).send(result);
  });

  // POST /v1/auth/password/reset
  fastify.post('/auth/password/reset', async (request, reply) => {
    const body = resetPasswordSchema.parse(request.body);
    await identityService.handleResetPassword(body.email, body.code, body.newPassword);
    return reply.status(200).send({ success: true, message: 'Password has been reset. Please sign in.' });
  });

  // DELETE /v1/account
  fastify.delete('/account', async (request, reply) => {
    const user = await authGuard(request);
    const body = deleteAccountSchema.parse(request.body || {});
    const result = await identityService.handleDeleteAccount(user, body.password);
    return reply.status(200).send(result);
  });

  // GET /v1/me
  fastify.get('/me', async (request, reply) => {
    const user = await authGuard(request);
    const result = await identityService.getMe(user);
    return reply.status(200).send(result);
  });
};

