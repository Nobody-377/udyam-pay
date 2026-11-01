import type {
  LenderAttemptOutcome,
  ProductCategory,
  RateType,
} from '../persistence/stores';

export interface EligibilityParams {
  merchantId: string;
  customer: {
    fullName: string;
    phone: string;
  };
  productCategory: ProductCategory;
  amountPaise: bigint;
}

export interface EligibilityResult {
  eligible: boolean;
  maxAmountPaise?: bigint;
  minAmountPaise?: bigint;
  reason?: string;
}

export interface OfferProposal {
  lenderOfferReference: string;
  principalPaise: bigint;
  downPaymentPaise?: bigint;
  tenureMonths: number;
  interestRatePercent: string;
  rateType: RateType;
  aprPercent: string;
  emiPaise: bigint;
  processingFeePaise?: bigint;
  taxesPaise?: bigint;
  otherChargesPaise?: bigint;
  totalRepayablePaise?: bigint;
  termsVersion?: string;
  termsUrl?: string;
}

export interface SubmissionParams {
  applicationId: string;
  requestKey: string;
  merchantId: string;
  customer: {
    id: string;
    fullName: string;
    phone: string;
  };
  purchase: {
    id: string;
    amountPaise: bigint;
    productCategory: ProductCategory;
  };
  requestedAmountPaise: bigint;
  requestedTenureMonths?: number | null;
  scenarioOverride?: string; // used for deterministic test scenario injection
}

export interface SubmissionResult {
  outcome: LenderAttemptOutcome;
  externalReference?: string;
  offers?: OfferProposal[];
  errorCode?: string;
  safeResponseSummary?: Record<string, unknown>;
  latencyMs?: number;
}

export interface LenderAdapter {
  readonly code: string;
  readonly displayName: string;
  checkEligibility(params: EligibilityParams): Promise<EligibilityResult>;
  submitApplication(params: SubmissionParams): Promise<SubmissionResult>;
  pollStatus?(externalReference: string): Promise<SubmissionResult>;
  cancelApplication?(externalReference: string): Promise<boolean>;
}

