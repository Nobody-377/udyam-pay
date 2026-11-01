declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export namespace describe {
    export function skip(name: string, fn: () => void): void;
    export function only(name: string, fn: () => void): void;
  }
  export function it(name: string, fn: () => void | Promise<void>): void;
  export namespace it {
    export function skip(name: string, fn: () => void | Promise<void>): void;
    export function only(name: string, fn: () => void | Promise<void>): void;
    export function each(items: readonly any[]): (name: string, fn: (...args: any[]) => void | Promise<void>) => void;
  }
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: any): Expectation;
  export namespace expect {
    export function unreachable(msg?: string): void;
  }
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;

  export interface Expectation {
    toBe(expected: any): void;
    toEqual(expected: any): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeNull(): void;
    toBeGreaterThan(expected: number | bigint): void;
    toBeGreaterThanOrEqual(expected: number | bigint): void;
    toBeLessThan(expected: number | bigint): void;
    toBeLessThanOrEqual(expected: number | bigint): void;
    toContain(expected: any): void;
    toMatch(expected: RegExp | string): void;
    toThrow(expected?: any): void;
    toBeInstanceOf(expected: any): void;
    resolves: Expectation;
    rejects: Expectation;
    not: Expectation;
  }
}

declare module 'vitest/config' {
  export function defineConfig(config: any): any;
}

