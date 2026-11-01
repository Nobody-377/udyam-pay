import type { Response } from 'express';
import type { ErrorDetail } from './errors';

/** Standard success envelope for every /api/v1 endpoint. */
export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

/** Standard error envelope for every /api/v1 endpoint. */
export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

export interface SendSuccessOptions {
  status?: number;
  meta?: Record<string, unknown>;
}

function serializeBigInts<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString() as unknown as T;
  if (Array.isArray(obj)) return obj.map(serializeBigInts) as unknown as T;
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const copy: any = {};
    for (const [key, val] of Object.entries(obj)) {
      copy[key] = serializeBigInts(val);
    }
    return copy;
  }
  return obj;
}

export function sendSuccess<T>(res: Response, data: T, options: SendSuccessOptions = {}): void {
  const body: ApiSuccessBody<T> = { success: true, data: serializeBigInts(data) };
  if (options.meta !== undefined) {
    body.meta = serializeBigInts(options.meta);
  }
  res.status(options.status ?? 200).json(body);
}

export function buildErrorBody(params: {
  code: string;
  message: string;
  requestId: string;
  details?: ErrorDetail[] | undefined;
}): ApiErrorBody {
  const error: ApiErrorBody['error'] = {
    code: params.code,
    message: params.message,
    requestId: params.requestId,
  };
  if (params.details !== undefined && params.details.length > 0) {
    error.details = params.details;
  }
  return { success: false, error };
}
