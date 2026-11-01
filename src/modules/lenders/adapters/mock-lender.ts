import {
  JsonMockLenderAdapter,
  type JsonMockLenderConfig,
} from './json-mock-lender';

export interface MockLenderConfig extends JsonMockLenderConfig {}

/**
 * MockLenderAdapter provides a drop-in compatible mock lender implementation
 * backed by JSON fixtures and deterministic scenario mapping.
 */
export class MockLenderAdapter extends JsonMockLenderAdapter {
  constructor(config: MockLenderConfig) {
    super({
      ...config,
      defaultInterestRatePercent: config.defaultInterestRatePercent ?? 14.5,
    });
  }
}
