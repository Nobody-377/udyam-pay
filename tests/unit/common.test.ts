import { describe, expect, it } from 'vitest';
import { TimeoutError, withTimeout } from '../../src/common/async';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../src/common/errors';
import {
  buildPaginationMeta,
  paginationQuerySchema,
  toSkipTake,
} from '../../src/common/pagination';
import { buildErrorBody } from '../../src/common/response';

describe('errors', () => {
  it('carries status code, code and operational flag', () => {
    const error = new NotFoundError();

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.isOperational).toBe(true);
    expect(error.name).toBe('NotFoundError');
  });

  it('keeps validation details', () => {
    const error = new ValidationError('bad', [{ path: 'a', message: 'required' }]);

    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual([{ path: 'a', message: 'required' }]);
  });

  it('maps conflicts to 409', () => {
    expect(new ConflictError().statusCode).toBe(409);
  });
});

describe('buildErrorBody', () => {
  it('omits empty details and includes the request id', () => {
    const body = buildErrorBody({ code: 'X', message: 'm', requestId: 'r1', details: [] });

    expect(body).toEqual({ success: false, error: { code: 'X', message: 'm', requestId: 'r1' } });
  });
});

describe('pagination', () => {
  it('applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('coerces strings and computes skip/take', () => {
    const query = paginationQuerySchema.parse({ page: '3', pageSize: '10' });

    expect(toSkipTake(query)).toEqual({ skip: 20, take: 10 });
  });

  it('rejects page sizes above 100 and pages below 1', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('computes total pages', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 20 }, 41)).toEqual({
      page: 1,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
  });
});

describe('withTimeout', () => {
  it('resolves when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 100)).resolves.toBe(7);
  });

  it('rejects with TimeoutError when the promise is too slow', async () => {
    await expect(withTimeout(new Promise<void>(() => undefined), 20)).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it('propagates the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 100)).rejects.toThrow('boom');
  });
});
