import { describe, expect, it } from 'vitest';
import {
  DEMO_LENDERS_SEED_DATA,
  checkDemoSeedAllowed,
  seedDemoLenders,
  seedDemoEntities,
} from '../../prisma/seed-demo';
import type { PrismaClient } from '@prisma/client';

describe('Demo Seeder & Safety Guards', () => {
  describe('Demo Lenders Data Invariants', () => {
    it('contains the 3 primary demo lenders and legacy aliases', () => {
      const codes = DEMO_LENDERS_SEED_DATA.map((l) => l.code);
      expect(codes).toContain('DEMO_BANK_ALPHA');
      expect(codes).toContain('DEMO_NBFC_BETA');
      expect(codes).toContain('DEMO_GAMMA_CREDIT');
      expect(codes).toContain('LENDER_ALPHA');
      expect(codes).toContain('LENDER_BETA');
    });

    it('ensures every single demo lender is explicitly marked as simulated', () => {
      for (const lender of DEMO_LENDERS_SEED_DATA) {
        expect(lender.isSimulated).toBe(true);
      }
    });

    it('ensures every single demo lender display name carries the [DEMO] prefix', () => {
      for (const lender of DEMO_LENDERS_SEED_DATA) {
        expect(lender.displayName.startsWith('[DEMO]')).toBe(true);
      }
    });

    it('ensures integer paise amount bounds and priorities are valid and non-negative', () => {
      for (const lender of DEMO_LENDERS_SEED_DATA) {
        expect(lender.minAmountPaise).toBeGreaterThan(0n);
        expect(lender.maxAmountPaise).toBeGreaterThan(lender.minAmountPaise);
        expect(lender.priority).toBeGreaterThan(0);
        expect(lender.supportedCategories.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Production Environment Guard (checkDemoSeedAllowed)', () => {
    it('aborts with an error if executed in production without ALLOW_DEMO_SEED=true', () => {
      expect(() => {
        checkDemoSeedAllowed({ NODE_ENV: 'production' });
      }).toThrow(/ABORTING: Demo seed script cannot run in production/);

      expect(() => {
        checkDemoSeedAllowed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'false' });
      }).toThrow(/ABORTING: Demo seed script cannot run in production/);
    });

    it('allows execution in production if ALLOW_DEMO_SEED=true is explicitly set', () => {
      expect(() => {
        checkDemoSeedAllowed({ NODE_ENV: 'production', ALLOW_DEMO_SEED: 'true' });
      }).not.toThrow();
    });

    it('allows execution in development and test environments', () => {
      expect(() => {
        checkDemoSeedAllowed({ NODE_ENV: 'development' });
      }).not.toThrow();

      expect(() => {
        checkDemoSeedAllowed({ NODE_ENV: 'test' });
      }).not.toThrow();

      expect(() => {
        checkDemoSeedAllowed({});
      }).not.toThrow();
    });
  });

  describe('Idempotent Upsert Logic (seedDemoLenders)', () => {
    it('uses upsert for both lender and lenderConfiguration ensuring repeatability', async () => {
      const lenderUpsertCalls: any[] = [];
      const configUpsertCalls: any[] = [];

      const mockPrisma = {
        lender: {
          upsert: async (args: any) => {
            lenderUpsertCalls.push(args);
            return {
              id: `uuid-${args.where.code}`,
              code: args.where.code,
              displayName: args.create.displayName,
              isSimulated: true,
              status: 'ACTIVE',
            };
          },
        },
        lenderConfiguration: {
          upsert: async (args: any) => {
            configUpsertCalls.push(args);
            return { id: 'config-uuid' };
          },
        },
      } as unknown as PrismaClient;

      const result = await seedDemoLenders(mockPrisma);

      expect(result.seeded).toBe(DEMO_LENDERS_SEED_DATA.length);
      expect(lenderUpsertCalls.length).toBe(DEMO_LENDERS_SEED_DATA.length);
      expect(configUpsertCalls.length).toBe(DEMO_LENDERS_SEED_DATA.length);

      // Verify that every upsert explicitly passed isSimulated: true in both create and update
      for (const call of lenderUpsertCalls) {
        expect(call.create.isSimulated).toBe(true);
        expect(call.update.isSimulated).toBe(true);
        expect(call.create.displayName.startsWith('[DEMO]')).toBe(true);
      }
    });
  });

  describe('Sample Demo Entities Idempotency (seedDemoEntities)', () => {
    it('does not re-create admin or merchant if already existing', async () => {
      let userCreateCount = 0;
      let merchantCreateCount = 0;
      let shopCreateCount = 0;

      const mockPrisma = {
        user: {
          findUnique: async () => ({
            id: 'existing-admin-id',
            email: 'admin@udyam.example',
            role: 'ADMIN',
          }),
          create: async () => {
            userCreateCount++;
            return {};
          },
        },
        merchant: {
          create: async () => {
            merchantCreateCount++;
            return {};
          },
        },
        shop: {
          create: async () => {
            shopCreateCount++;
            return {};
          },
        },
      } as unknown as PrismaClient;

      const result = await seedDemoEntities(mockPrisma);

      expect(result.adminEmail).toBe('admin@udyam.example');
      expect(userCreateCount).toBe(0);
      expect(merchantCreateCount).toBe(0);
      expect(shopCreateCount).toBe(0);
    });
  });
});
