import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'authorization',
      'password',
      'newPassword',
      'code',
      'refreshToken',
      'token',
      'tokens',
      'email',
      'totpSecret',
      '*.password',
      '*.newPassword',
      '*.code',
      '*.refreshToken',
      '*.token',
      '*.email',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

