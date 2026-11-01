import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../../src/modules/lenders/circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts in CLOSED state and allows execution', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
  });

  it('trips to OPEN after reaching failure threshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 1000 });
    cb.recordFailure();
    expect(cb.getState()).toBe('CLOSED');
    cb.recordFailure();
    expect(cb.getState()).toBe('CLOSED');
    cb.recordFailure();

    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions from OPEN to HALF_OPEN after timeout and recovers to CLOSED', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50,
      halfOpenSuccessThreshold: 2,
    });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    expect(cb.getState()).toBe('HALF_OPEN');
    expect(cb.canExecute()).toBe(true);

    cb.recordSuccess();
    expect(cb.getState()).toBe('HALF_OPEN');

    cb.recordSuccess();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canExecute()).toBe(true);
  });

  it('trips back to OPEN immediately if a failure occurs during HALF_OPEN', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50,
      halfOpenSuccessThreshold: 2,
    });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');

    await new Promise((r) => setTimeout(r, 60));
    expect(cb.getState()).toBe('HALF_OPEN');

    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canExecute()).toBe(false);
  });
});

