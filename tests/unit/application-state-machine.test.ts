import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  evaluateTransition,
  getAllowedTransitions,
  InvalidStateTransitionError,
} from '../../src/modules/applications/application-state-machine';
import {
  ACTOR_TYPES,
  APPLICATION_STATUSES,
  TERMINAL_STATUSES,
  isTerminalStatus,
  type ApplicationStatus,
} from '../../src/modules/applications/application-status';

function prismaEnumValues(name: string): string[] {
  const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
  const match = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  if (match?.[1] === undefined) {
    throw new Error(`enum ${name} not found in schema.prisma`);
  }
  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
}

describe('status definitions', () => {
  it('match the Prisma enums exactly', () => {
    expect([...APPLICATION_STATUSES].sort()).toEqual(prismaEnumValues('ApplicationStatus').sort());
    expect([...ACTOR_TYPES].sort()).toEqual(prismaEnumValues('ActorType').sort());
  });
});

describe('terminal states', () => {
  it.each(TERMINAL_STATUSES)('%s has no outgoing transitions', (status) => {
    expect(getAllowedTransitions(status)).toEqual([]);
    expect(isTerminalStatus(status)).toBe(true);
  });

  it.each(APPLICATION_STATUSES.filter((status) => !TERMINAL_STATUSES.includes(status)))(
    '%s (non-terminal) has at least one way forward',
    (status) => {
      expect(getAllowedTransitions(status).length).toBeGreaterThan(0);
    },
  );

  it('never allows leaving a terminal state, for any actor', () => {
    for (const from of TERMINAL_STATUSES) {
      for (const to of APPLICATION_STATUSES) {
        for (const actor of ACTOR_TYPES) {
          expect(evaluateTransition(from, to, { actor, lenderConfirmed: true }).allowed).toBe(
            false,
          );
        }
      }
    }
  });
});

describe('happy path', () => {
  const happyPath: Array<[ApplicationStatus, ApplicationStatus, 'MERCHANT_USER' | 'SYSTEM']> = [
    ['DRAFT', 'CUSTOMER_CONSENT_PENDING', 'MERCHANT_USER'],
    ['CUSTOMER_CONSENT_PENDING', 'SUBMITTED', 'MERCHANT_USER'],
    ['SUBMITTED', 'LENDER_PROCESSING', 'SYSTEM'],
    ['LENDER_PROCESSING', 'OFFER_AVAILABLE', 'SYSTEM'],
    ['OFFER_AVAILABLE', 'CUSTOMER_ACCEPTED_OFFER', 'MERCHANT_USER'],
    ['CUSTOMER_ACCEPTED_OFFER', 'LENDER_FINAL_CONFIRMATION', 'SYSTEM'],
    ['LENDER_FINAL_CONFIRMATION', 'DISBURSEMENT_PENDING', 'SYSTEM'],
    ['DISBURSEMENT_PENDING', 'DISBURSED', 'SYSTEM'],
  ];

  it('walks the full lifecycle with the right actors and lender evidence', () => {
    for (const [from, to, actor] of happyPath) {
      expect(() => assertTransition(from, to, { actor, lenderConfirmed: true })).not.toThrow();
    }
  });
});

describe('lender authority', () => {
  const lenderBacked: Array<[ApplicationStatus, ApplicationStatus]> = [
    ['LENDER_PROCESSING', 'OFFER_AVAILABLE'],
    ['LENDER_PROCESSING', 'ADDITIONAL_INFORMATION_REQUIRED'],
    ['LENDER_PROCESSING', 'DECLINED'],
    ['LENDER_FINAL_CONFIRMATION', 'DISBURSEMENT_PENDING'],
    ['LENDER_FINAL_CONFIRMATION', 'DECLINED'],
    ['DISBURSEMENT_PENDING', 'DISBURSED'],
  ];

  it.each(lenderBacked)('%s -> %s requires lender confirmation', (from, to) => {
    expect(evaluateTransition(from, to, { actor: 'SYSTEM' })).toEqual({
      allowed: false,
      reason: 'LENDER_CONFIRMATION_REQUIRED',
    });
    expect(evaluateTransition(from, to, { actor: 'SYSTEM', lenderConfirmed: false }).allowed).toBe(
      false,
    );
    expect(evaluateTransition(from, to, { actor: 'LENDER', lenderConfirmed: true }).allowed).toBe(
      true,
    );
  });

  it('never lets a merchant or admin mark an application approved or disbursed', () => {
    for (const actor of ['MERCHANT_USER', 'ADMIN_USER'] as const) {
      expect(
        evaluateTransition('LENDER_PROCESSING', 'OFFER_AVAILABLE', {
          actor,
          lenderConfirmed: true,
        }),
      ).toEqual({ allowed: false, reason: 'ACTOR_NOT_PERMITTED' });
      expect(
        evaluateTransition('DISBURSEMENT_PENDING', 'DISBURSED', { actor, lenderConfirmed: true }),
      ).toEqual({ allowed: false, reason: 'ACTOR_NOT_PERMITTED' });
    }
  });
});

describe('invalid transitions', () => {
  it('rejects skipping states', () => {
    expect(
      evaluateTransition('DRAFT', 'DISBURSED', { actor: 'SYSTEM', lenderConfirmed: true }),
    ).toEqual({ allowed: false, reason: 'NO_SUCH_TRANSITION' });
    expect(evaluateTransition('SUBMITTED', 'OFFER_AVAILABLE', { actor: 'SYSTEM' })).toEqual({
      allowed: false,
      reason: 'NO_SUCH_TRANSITION',
    });
  });

  it('rejects moving to the same state', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(
        evaluateTransition(status, status, { actor: 'SYSTEM', lenderConfirmed: true }).allowed,
      ).toBe(false);
    }
  });

  it('throws a 409 InvalidStateTransitionError from assertTransition', () => {
    try {
      assertTransition('DRAFT', 'DISBURSED', { actor: 'SYSTEM' });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateTransitionError);
      const typed = error as InvalidStateTransitionError;
      expect(typed.statusCode).toBe(409);
      expect(typed.code).toBe('INVALID_STATE_TRANSITION');
      expect(typed.reason).toBe('NO_SUCH_TRANSITION');
    }
  });
});

describe('technical failures are not rejections', () => {
  it('cannot reach DECLINED from TECHNICAL_FAILURE', () => {
    expect(getAllowedTransitions('TECHNICAL_FAILURE')).not.toContain('DECLINED');
  });

  it('retrying after a technical failure goes back through SUBMITTED, system or admin only', () => {
    expect(evaluateTransition('TECHNICAL_FAILURE', 'SUBMITTED', { actor: 'SYSTEM' }).allowed).toBe(
      true,
    );
    expect(
      evaluateTransition('TECHNICAL_FAILURE', 'SUBMITTED', { actor: 'MERCHANT_USER' }).allowed,
    ).toBe(false);
  });
});

describe('cancellation', () => {
  it('lets merchants cancel before the lender has finalised', () => {
    for (const from of [
      'DRAFT',
      'CUSTOMER_CONSENT_PENDING',
      'SUBMITTED',
      'OFFER_AVAILABLE',
    ] as const) {
      expect(evaluateTransition(from, 'CANCELLED', { actor: 'MERCHANT_USER' }).allowed).toBe(true);
    }
  });

  it('does not let merchants cancel once disbursement is pending', () => {
    expect(
      evaluateTransition('DISBURSEMENT_PENDING', 'CANCELLED', { actor: 'MERCHANT_USER' }).allowed,
    ).toBe(false);
  });
});
