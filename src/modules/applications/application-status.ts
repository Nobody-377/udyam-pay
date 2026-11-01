/**
 * Internal financing-application lifecycle. This is Udhyam PAY's own workflow,
 * not a claim that every lender uses identical states. The values must stay in
 * sync with the Prisma enum `ApplicationStatus` (a unit test enforces this).
 */
export const APPLICATION_STATUSES = [
  'DRAFT',
  'CUSTOMER_CONSENT_PENDING',
  'SUBMITTED',
  'LENDER_PROCESSING',
  'OFFER_AVAILABLE',
  'ADDITIONAL_INFORMATION_REQUIRED',
  'DECLINED',
  'CUSTOMER_ACCEPTED_OFFER',
  'LENDER_FINAL_CONFIRMATION',
  'DISBURSEMENT_PENDING',
  'DISBURSED',
  'CANCELLED',
  'EXPIRED',
  'TECHNICAL_FAILURE',
  'MANUAL_REVIEW',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Who is causing a state change. Mirrors the Prisma enum `ActorType`. */
export const ACTOR_TYPES = ['MERCHANT_USER', 'ADMIN_USER', 'SYSTEM', 'LENDER'] as const;

export type ActorType = (typeof ACTOR_TYPES)[number];

/** States from which no further transition is possible. */
export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  'DECLINED',
  'DISBURSED',
  'CANCELLED',
  'EXPIRED',
];

export function isTerminalStatus(status: ApplicationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
