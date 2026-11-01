interface Buffer extends Uint8Array {
  toString(encoding?: string): string;
}

declare namespace NodeJS {
  export interface Timeout {
    unref(): this;
    ref(): this;
  }
  export interface ProcessEnv {
    [key: string]: string | undefined;
  }
}

declare const process: {
  env: NodeJS.ProcessEnv;
  argv: string[];
  exit(code?: number): never;
  cwd(): string;
  uptime(): number;
  stdout: { write(str: string): void };
  stderr: { write(str: string): void };
  on(event: string, listener: (...args: any[]) => void): void;
};

declare const console: {
  log(...args: any[]): void;
  error(...args: any[]): void;
  warn(...args: any[]): void;
  info(...args: any[]): void;
};

declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout;
declare function clearTimeout(timeoutId?: NodeJS.Timeout): void;

declare const Buffer: {
  from(data: string | Uint8Array | ArrayLike<number>, encoding?: string): Buffer;
  isBuffer(obj: unknown): obj is Buffer;
};

declare module 'node:crypto' {
  export function randomUUID(): string;
  export function randomBytes(size: number): Buffer;
  export function scryptSync(
    password: string | Buffer | Uint8Array,
    salt: string | Buffer | Uint8Array,
    keylen: number,
    options?: { N?: number; r?: number; p?: number; maxmem?: number },
  ): Buffer;
  export function createHash(algorithm: string): {
    update(data: string | Buffer | Uint8Array): {
      digest(): Buffer;
      digest(encoding: 'hex' | 'base64'): string;
    };
  };
  export function createHmac(algorithm: string, key: string | Buffer | Uint8Array): {
    update(data: string | Buffer | Uint8Array): {
      digest(): Buffer;
      digest(encoding: 'hex' | 'base64'): string;
    };
  };
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string): void;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
}

declare module 'node:url' {
  export class URLSearchParams {
    constructor(init?: string | Record<string, string> | Iterable<[string, string]>);
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    set(name: string, value: string): void;
    toString(): string;
  }

  export class URL {
    constructor(url: string | URL, base?: string | URL);
    hash: string;
    host: string;
    hostname: string;
    href: string;
    origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    searchParams: URLSearchParams;
    username: string;
    toString(): string;
    toJSON(): string;
  }
}

declare module 'node:assert/strict' {
  interface Assert {
    (value: unknown, message?: string | Error): void;
    ok(value: unknown, message?: string | Error): void;
    equal<T>(actual: unknown, expected: T, message?: string | Error): void;
    notEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    rejects(block: (() => Promise<unknown>) | Promise<unknown>, error?: RegExp | Function | Object | Error, message?: string): Promise<void>;
    throws(block: () => unknown, error?: RegExp | Function | Object | Error, message?: string): void;
  }
  const assert: Assert;
  export default assert;
  export const ok: Assert['ok'];
  export const equal: Assert['equal'];
  export const notEqual: Assert['notEqual'];
  export const deepEqual: Assert['deepEqual'];
  export const rejects: Assert['rejects'];
  export const throws: Assert['throws'];
}

declare module 'node:assert' {
  import assert from 'node:assert/strict';
  export default assert;
}

declare module 'argon2' {
  export function hash(plain: string, options?: any): Promise<string>;
  export function verify(hash: string, plain: string): Promise<boolean>;
}

declare module 'dotenv' {
  export function config(options?: any): { parsed?: Record<string, string>; error?: Error };
}

declare module 'cors' {
  export default function cors(options?: any): any;
}

declare module 'helmet' {
  export default function helmet(options?: any): any;
}

declare module 'express-rate-limit' {
  export function rateLimit(options?: any): any;
}

declare module 'pino-http' {
  export function pinoHttp(options?: any): any;
}

declare module 'pino' {
  export interface Logger {
    level: string;
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    fatal(...args: any[]): void;
    debug(...args: any[]): void;
    trace(...args: any[]): void;
  }
  export interface LoggerOptions {
    level?: string;
    base?: any;
    timestamp?: any;
    redact?: any;
    transport?: any;
  }
  interface PinoFn {
    (options?: any, stream?: any): Logger;
    stdTimeFunctions: {
      isoTime: () => string;
    };
  }
  namespace pino {
    export type Logger = import('pino').Logger;
    export type LoggerOptions = import('pino').LoggerOptions;
  }
  const pino: PinoFn;
  export default pino;
}

declare module 'zod' {
  export interface ZodIssue {
    code: string;
    path: (string | number)[];
    message: string;
  }
  export class ZodError extends Error {
    issues: ZodIssue[];
  }
  export enum ZodIssueCode {
    custom = 'custom',
  }
  export interface ZodType<Output = any, Def = any, Input = Output> {
    parse(data: unknown): Output;
    safeParse(data: unknown): { success: true; data: Output } | { success: false; error: ZodError };
    default(def: any): ZodType<Output>;
    optional(): ZodType<Output | undefined>;
    refine(fn: (val: Output) => boolean, msg?: any): ZodType<Output>;
    transform<T>(fn: (val: Output, ctx: any) => T): ZodType<T>;
  }
  export namespace z {
    export const NEVER: never;
    export const ZodIssueCode: { custom: 'custom' };
    export function string(options?: any): any;
    export function number(options?: any): any;
    export function bigint(options?: any): any;
    export function boolean(): any;
    export function enum_<T extends readonly [string, ...string[]]>(values: T): any;
    export { enum_ as enum };
    export function object(shape: Record<string, any>): any;
    export function array(item: any): any;
    export function record(key: any, value: any): any;
    export const coerce: {
      number(): any;
      bigint(): any;
      string(): any;
      boolean(): any;
    };
    export type infer<T> = any;
  }
}

declare module 'supertest' {
  export interface TestResponse {
    status: number;
    body: any;
    headers: Record<string, string>;
  }
  export interface TestRequest {
    get(url: string): TestRequest;
    post(url: string): TestRequest;
    put(url: string): TestRequest;
    patch(url: string): TestRequest;
    delete(url: string): TestRequest;
    options(url: string): TestRequest;
    set(name: string | Record<string, string>, val?: string): TestRequest;
    send(body?: any): Promise<TestResponse>;
    then<TResult1 = TestResponse, TResult2 = never>(
      onfulfilled?: ((value: TestResponse) => TResult1 | PromiseLike<TResult1>) | undefined | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
    ): Promise<TResult1 | TResult2>;
  }
  export default function request(app: any): TestRequest;
}

declare module '@prisma/client' {
  export class PrismaClient {
    constructor(options?: any);
    $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T>;
    $queryRaw(query: any, ...args: any[]): Promise<any>;
    $disconnect(): Promise<void>;
    user: any;
    refreshSession: any;
    merchant: any;
    shop: any;
    customer: any;
    customerConsent: any;
    purchase: any;
    checkoutSession: any;
    lender: any;
    lenderConfiguration: any;
    financingApplication: any;
    applicationStatusHistory: any;
    lenderApplication: any;
    financingOffer: any;
    webhookEvent: any;
    transaction: any;
    disbursementStatus: any;
    commissionEntry: any;
    auditLog: any;
  }
}
