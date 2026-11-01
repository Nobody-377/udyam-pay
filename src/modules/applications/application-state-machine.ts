import { AppError } from '../../common/errors';
import type { ActorType, ApplicationStatus } from './application-status';

interface TransitionRule {
  readonly to: ApplicationStatus;
  /** Actor types allowed to perform this transition. */
  readonly actors: readonly ActorType[];
  /**
   * True when the target state asserts an outcome that only an authoritative
   * lender signal can establish (offer made, decline, final confirmation,
   * disbursement). The caller must pass `lenderConfirmed: true`, meaning the
   * change is backed by a verified lender response or signed callback.
   */
  readonly requiresLenderConfirmation?: boolean;
}

const MERCHANT_OR_SYSTEM: readonly ActorType[] = ['MERCHANT_USER', 'SYSTEM'];
const CANCELLERS: readonly ActorType[] = ['MERCHANT_USER', 'ADMIN_USER'];
const SYSTEM_ONLY: readonly ActorType[] = ['SYSTEM'];
const SYSTEM_OR_ADMIN: readonly ActorType[] = ['SYSTEM', 'ADMIN_USER'];
const LENDER_BACKED: readonly ActorType[] = ['SYSTEM', 'LENDER'];

/**
 * The complete, explicit transition table. Anything not listed is forbidden.
 * Record<ApplicationStatus, ...> makes the compiler reject a missing state.
 */
const TRANSITIONS: Record<ApplicationStatus, readonly TransitionRule[]> = {
  DRAFT: [
    { to: 'CUSTOMER_CONSENT_PENDING', actors: MERCHANT_OR_SYSTEM },
    { to: 'CANCELLED', actors: [...CANCELLERS, 'SYSTEM'] },
    { to: 'EXPIRED', actors: SYSTEM_ONLY },
  ],
  CUSTOMER_CONSENT_PENDING: [
    { to: 'SUBMITTED', actors: MERCHANT_OR_SYSTEM },
    { to: 'CANCELLED', actors: [...CANCELLERS, 'SYSTEM'] },
    { to: 'EXPIRED', actors: SYSTEM_ONLY },
  ],
  SUBMITTED: [
    { to: 'LENDER_PROCESSING', actors: SYSTEM_ONLY },
    { to: 'TECHNICAL_FAILURE', actors: SYSTEM_ONLY },
    { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
    { to: 'CANCELLED', actors: CANCELLERS },
    { to: 'EXPIRED', actors: SYSTEM_ONLY },
  ],
  LENDER_PROCESSING: [
    { to: 'OFFER_AVAILABLE', actors: LENDER_BACKED, requiresLenderConfirmation: true },
    {
      to: 'ADDITIONAL_INFORMATION_REQUIRED',
      actors: LENDER_BACKED,
      requiresLenderConfirmation: true,
    },
    { to: 'DECLINED', actors: LENDER_BACKED, requiresLenderConfirmation: true },
    { to: 'TECHNICAL_FAILURE', actors: SYSTEM_ONLY },
    { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
    { to: 'CANCELLED', actors: CANCELLERS },
    { to: 'EXPIRED', actors: SYSTEM_ONLY },
  ],
  ADDITIONAL_INFORMATION_REQUIRED: [
    { to: 'LENDER_PROCESSING', actors: MERCHANT_OR_SYSTEM },
    { to: 'DECLINED', actors: LENDER_BACKED, requiresLenderConfirmation: true },
    { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
    { to: 'CANCELLED', actors: CANCELLERS },
    { to: 'EXPIRED', actors: SYSTEM_ONLY },
  ],
  OFFER_AVAILABLE: [
    { to: 'CUSTOMER_ACCEPTED_OFFER', actors: MERCHANT_OR_SYSTEM },
    { to: 'CANCELLED', actors: CANCELLERS },
    { to: 'EXPIRED', actors: SYSTEM_ONLY },
  ],
  CUSTOMER_ACCEPTED_OFFER: [
    { to: 'LENDER_FINAL_CONFIRMATION', actors: SYSTEM_ONLY },
    { to: 'TECHNICAL_FAILURE', actors: SYSTEM_ONLY },
    { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
    { to: 'CANCELLED', actors: CANCELLERS },
    { to: 'EXPIRED', actors: SYSTEM_ONLY },
  ],
  LENDER_FINAL_CONFIRMATION: [
    { to: 'DISBURSEMENT_PENDING', actors: LENDER_BACKED, requiresLenderConfirmation: true },
    { to: 'DECLINED', actors: LENDER_BACKED, requiresLenderConfirmation: true },
    { to: 'TECHNICAL_FAILURE', actors: SYSTEM_ONLY },
    { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
  ],
  DISBURSEMENT_PENDING: [
    { to: 'DISBURSED', actors: LENDER_BACKED, requiresLenderConfirmation: true },
    { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
  ],
  TECHNICAL_FAILURE: [
    // Retrying is allowed only after the outcome has been reconciled with the lender.
    { to: 'SUBMITTED', actors: SYSTEM_OR_ADMIN },
    { to: 'MANUAL_REVIEW', actors: SYSTEM_OR_ADMIN },
    { to: 'CANCELLED', actors: CANCELLERS },
  ],
  MANUAL_REVIEW: [
    { to: 'LENDER_PROCESSING', actors: ['ADMIN_USER'] },
    { to: 'DECLINED', actors: ['ADMIN_USER'], requiresLenderConfirmation: true },
    { to: 'CANCELLED', actors: ['ADMIN_USER'] },
    { to: 'EXPIRED', actors: SYSTEM_ONLY },
  ],
  // Terminal states
  DECLINED: [],
  DISBURSED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export interface TransitionContext {
  actor: ActorType;
  /** Set true only when the change is backed by a verified lender response or signed callback. */
  lenderConfirmed?: boolean;
}

export type TransitionDenialReason =
  | 'NO_SUCH_TRANSITION'
  | 'ACTOR_NOT_PERMITTED'
  | 'LENDER_CONFIRMATION_REQUIRED';

export type TransitionEvaluation =
  | { allowed: true; reason?: never }
  | { allowed: false; reason: TransitionDenialReason };

export function getAllowedTransitions(from: ApplicationStatus): readonly ApplicationStatus[] {
  return TRANSITIONS[from].map((rule) => rule.to);
}

export function evaluateTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  context: TransitionContext,
): TransitionEvaluation {
  const rule = TRANSITIONS[from].find((candidate) => candidate.to === to);
  if (rule === undefined) {
    return { allowed: false, reason: 'NO_SUCH_TRANSITION' };
  }
  if (!rule.actors.includes(context.actor)) {
    return { allowed: false, reason: 'ACTOR_NOT_PERMITTED' };
  }
  if (rule.requiresLenderConfirmation === true && context.lenderConfirmed !== true) {
    return { allowed: false, reason: 'LENDER_CONFIRMATION_REQUIRED' };
  }
  return { allowed: true };
}

export class InvalidStateTransitionError extends AppError {
  readonly from: ApplicationStatus;
  readonly to: ApplicationStatus;
  readonly reason: TransitionDenialReason;

  constructor(from: ApplicationStatus, to: ApplicationStatus, reason: TransitionDenialReason) {
    super({
      statusCode: 409,
      code: 'INVALID_STATE_TRANSITION',
      message: `Application cannot move from ${from} to ${to}`,
    });
    this.from = from;
    this.to = to;
    this.reason = reason;
  }
}

/** Throws InvalidStateTransitionError unless the transition is permitted. */
export function assertTransition(
  from: ApplicationStatus,
  to: ApplicationStatus,
  context: TransitionContext,
): void {
  const evaluation = evaluateTransition(from, to, context);
  if (evaluation.allowed === false) {
    throw new InvalidStateTransitionError(from, to, evaluation.reason);
  }
}
