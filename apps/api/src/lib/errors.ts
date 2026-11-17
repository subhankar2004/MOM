/**
 * Errors the API returns on purpose. Every error response has one shape (spec §9):
 *
 *   { "error": { "code": "NOT_FOUND", "message": "Order not found", "details": … }, "requestId": "…" }
 *
 * `code` is stable and meant for programs; `message` is safe to show to people.
 */
import type { ApiErrorBody, ApiErrorCode } from '@mom/shared';

export type ErrorCode = ApiErrorCode;
export type ErrorBody = ApiErrorBody;

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const unauthenticated = (message = 'Please sign in') => new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have access to this') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);
export const serviceUnavailable = (message = 'Service temporarily unavailable') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);
