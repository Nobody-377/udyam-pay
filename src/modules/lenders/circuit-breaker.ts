export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenSuccessThreshold?: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptAt = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && Date.now() >= this.nextAttemptAt) {
      this.state = 'HALF_OPEN';
      this.successCount = 0;
    }
    return this.state;
  }

  canExecute(): boolean {
    const currentState = this.getState();
    return currentState === 'CLOSED' || currentState === 'HALF_OPEN';
  }

  recordSuccess(): void {
    const currentState = this.getState();
    if (currentState === 'HALF_OPEN') {
      this.successCount += 1;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.reset();
      }
    } else if (currentState === 'CLOSED') {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.failureCount += 1;
    if (this.state === 'HALF_OPEN' || this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptAt = Date.now() + this.resetTimeoutMs;
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptAt = 0;
  }
}

