import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError, NotFoundError, type ErrorDetail } from '../errors';
import { buildErrorBody } from '../response';

function getRequestId(req: unknown): string {
  const id = (req as { id?: unknown }).id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : 'unknown';
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value === 'object' && value !== null && key in value) {
    const property = (value as Record<string, unknown>)[key];
    return typeof property === 'string' ? property : undefined;
  }
  return undefined;
}

/**
 * Converts any thrown value into an AppError. Unknown errors become a generic
 * 500 so internal messages, stack traces and database details never reach
 * clients.
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    const details: ErrorDetail[] = error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    }));
    return new AppError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details,
    });
  }

  // Errors raised by the body parser (express.json)
  switch (getStringProperty(error, 'type')) {
    case 'entity.too.large':
      return new AppError({
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      });
    case 'entity.parse.failed':
      return new AppError({
        statusCode: 400,
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
      });
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return new AppError({
        statusCode: 415,
        code: 'UNSUPPORTED_ENCODING',
        message: 'Unsupported request encoding',
      });
    case 'request.aborted':
    case 'request.size.invalid':
      return new AppError({
        statusCode: 400,
        code: 'BAD_REQUEST',
        message: 'The request could not be read',
      });
    default:
      break;
  }

  return new AppError({
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
    isOperational: false,
    cause: error,
  });
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Route not found'));
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const requestId = getRequestId(req);
    const appError = normalizeError(error);

    if (appError.statusCode >= 500) {
      logger.error({ err: error, requestId }, 'Unhandled error while processing request');
    } else {
      logger.warn(
        { code: appError.code, statusCode: appError.statusCode, requestId },
        'Request rejected',
      );
    }

    res.status(appError.statusCode).json(
      buildErrorBody({
        code: appError.code,
        message: appError.message,
        requestId,
        details: appError.details,
      }),
    );
  };
}
