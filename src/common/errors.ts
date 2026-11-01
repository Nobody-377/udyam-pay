export interface ErrorDetail {
  path?: string;
  message: string;
  code?: string;
}

export interface AppErrorParams {
  statusCode: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
  /** False for unexpected programmer/system errors whose message must not be shown to clients. */
  isOperational?: boolean;
  cause?: unknown;
}

/** Base class for every error the API deliberately returns to a client. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: ErrorDetail[];
  readonly isOperational: boolean;

  constructor(params: AppErrorParams) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = new.target.name;
    this.statusCode = params.statusCode;
    this.code = params.code;
    if (params.details !== undefined) {
      this.details = params.details;
    }
    this.isOperational = params.isOperational ?? true;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: ErrorDetail[]) {
    super({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message,
      ...(details !== undefined ? { details } : {}),
    });
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super({ statusCode: 400, code: 'BAD_REQUEST', message });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication is required') {
    super({ statusCode: 401, code: 'UNAUTHORIZED', message });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super({ statusCode: 403, code: 'FORBIDDEN', message });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super({ statusCode: 404, code: 'NOT_FOUND', message });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state of the resource') {
    super({ statusCode: 409, code: 'CONFLICT', message });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests, please try again later') {
    super({ statusCode: 429, code: 'RATE_LIMITED', message });
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super({ statusCode: 503, code: 'SERVICE_UNAVAILABLE', message });
  }
}

export class IntegrationConfigurationError extends AppError {
  constructor(message = 'Integration provider configuration is invalid or missing required credentials') {
    super({ statusCode: 503, code: 'INTEGRATION_CONFIG_ERROR', message });
  }
}
