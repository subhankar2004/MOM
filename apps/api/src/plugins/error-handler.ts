import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError, type ErrorBody, type ErrorCode } from '../lib/errors.js';

/** Fastify's own client-error codes we pass through with a readable message. */
const FASTIFY_CLIENT_ERRORS: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

function send(reply: FastifyReply, request: FastifyRequest, status: number, error: ErrorBody['error']) {
  const body: ErrorBody = { error, requestId: request.id };
  return reply.status(status).send(body);
}

/**
 * One place that turns every thrown error into the spec §9 error shape.
 * Unexpected errors are logged in full but never leak details to the client.
 */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) request.log.error({ err }, err.message);
      return send(reply, request, err.statusCode, {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      });
    }

    if (hasZodFastifySchemaValidationErrors(err)) {
      return send(reply, request, 400, {
        code: 'VALIDATION_ERROR',
        message: 'Some fields are missing or invalid',
        details: err.validation.map((v) => ({
          // e.g. "body.phone" — where the problem is, never the submitted value
          field: [err.validationContext, ...v.instancePath.split('/').filter(Boolean)].join('.'),
          message: v.message,
        })),
      });
    }

    if (isResponseSerializationError(err)) {
      // Our handler returned something that doesn't match its declared response schema: a bug.
      request.log.error({ err, issues: err.cause.issues }, 'response did not match its schema');
      return send(reply, request, 500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' });
    }

    const status = err.statusCode ?? 500;
    const clientCode = FASTIFY_CLIENT_ERRORS[status];
    if (clientCode) {
      if (status === 429) request.log.warn({ ip: request.ip }, 'rate limit exceeded');
      return send(reply, request, status, {
        code: clientCode,
        message: status === 429 ? 'Too many requests, please slow down' : err.message,
      });
    }

    request.log.error({ err }, 'unhandled error');
    return send(reply, request, 500, { code: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, request, 404, {
      code: 'NOT_FOUND',
      message: `Route ${request.method} ${request.url} not found`,
    }),
  );
}
