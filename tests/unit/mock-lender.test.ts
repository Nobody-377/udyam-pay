import { describe, expect, it } from 'vitest';
import { MockLenderAdapter } from '../../src/modules/lenders/adapters/mock-lender';

describe('MockLenderAdapter', () => {
  const adapter = new MockLenderAdapter({
    code: 'LENDER_ALPHA',
    displayName: 'Alpha Finance',
    simulatedDelayMs: 0,
  });

  const baseParams = {
    applicationId: 'app-12345678-abcd',
    requestKey: 'req-1',
    merchantId: 'm-1',
    customer: { id: 'c-1', fullName: 'Raj Patel', phone: '+919876543210' },
    purchase: { id: 'p-1', amountPaise: 5000000n, productCategory: 'SMARTPHONE' as const },
    requestedAmountPaise: 5000000n,
  };

  it('approves standard application and provides multiple tenure offers', async () => {
    const result = await adapter.submitApplication(baseParams);
    expect(result.outcome).toBe('OFFERED');
    expect(result.offers?.length).toBe(4);
    expect(result.offers?.[0]?.tenureMonths).toBe(3);
    expect(result.offers?.[1]?.tenureMonths).toBe(6);
  });

  it('declines deterministically when phone ends with 0001', async () => {
    const result = await adapter.submitApplication({
      ...baseParams,
      customer: { ...baseParams.customer, phone: '+919999990001' },
    });
    expect(result.outcome).toBe('DECLINED');
    expect(result.errorCode).toBe('CREDIT_POLICY_DECLINE');
  });

  it('requests additional info when phone ends with 0002', async () => {
    const result = await adapter.submitApplication({
      ...baseParams,
      customer: { ...baseParams.customer, phone: '+919999990002' },
    });
    expect(result.outcome).toBe('ADDITIONAL_INFO_REQUIRED');
  });

  it('simulates 503 unavailable when phone ends with 0004', async () => {
    const result = await adapter.submitApplication({
      ...baseParams,
      customer: { ...baseParams.customer, phone: '+919999990004' },
    });
    expect(result.outcome).toBe('UNAVAILABLE');
  });

  it('simulates rate limit when phone ends with 0005', async () => {
    const result = await adapter.submitApplication({
      ...baseParams,
      customer: { ...baseParams.customer, phone: '+919999990005' },
    });
    expect(result.outcome).toBe('RATE_LIMITED');
  });

  it('simulates async pending outcome when phone ends with 0007', async () => {
    const result = await adapter.submitApplication({
      ...baseParams,
      customer: { ...baseParams.customer, phone: '+919999990007' },
    });
    expect(result.outcome).toBe('PENDING');
    expect(result.externalReference).toBeTruthy();
  });
});

