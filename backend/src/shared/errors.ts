import { ZodError } from 'zod';
import { logger } from './logger.js';

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    request_id?: string;
    retryable: boolean;
  };
}

export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RETRYABLE_CONFLICT: 'RETRYABLE_CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  IDEMPOTENCY_REQUIRED: 'IDEMPOTENCY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  DAILY_LIMIT_REACHED: 'DAILY_LIMIT_REACHED',
  CLAIM_EXPIRED: 'CLAIM_EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  PREMIUM_ACTIVE: 'PREMIUM_ACTIVE',
  PURCHASE_ALREADY_LINKED: 'PURCHASE_ALREADY_LINKED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly retryable: boolean;

  constructor(
    statusCode: number,
    codeOrMessage: string,
    message?: string,
    retryable: boolean = false
  ) {
    const code = message ? codeOrMessage : ErrorCodes.BAD_REQUEST;
    const msg = message ?? codeOrMessage;
    super(msg);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function fastifyErrorHandler(error: any, request: any, reply: any) {
  const requestId = request.id || undefined;

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        request_id: requestId,
        retryable: error.retryable,
      },
    });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ') || 'Validation failed',
        request_id: requestId,
        retryable: false,
      },
    });
  }

  logger.error({ err: error, reqId: requestId }, 'Unhandled request error');

  return reply.status(500).send({
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: 'Internal Server Error',
      request_id: requestId,
      retryable: false,
    },
  });
}

