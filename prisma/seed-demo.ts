import { PrismaClient } from '@prisma/client';
import { passwordHasher } from '../src/modules/auth/password';

export type DemoLenderType = 'BANK' | 'NBFC' | 'FINTECH_LSP';
export type DemoProductCategory =
  | 'SMARTPHONE'
  | 'TELEVISION'
  | 'REFRIGERATOR'
  | 'WASHING_MACHINE'
  | 'AIR_CONDITIONER'
  | 'LAPTOP'
  | 'OTHER_ELECTRONICS';

export interface DemoLenderSeedDefinition {
  code: string;
  displayName: string;
  type: DemoLenderType;
  isSimulated: true;
  priority: number;
  minAmountPaise: bigint;
  maxAmountPaise: bigint;
  supportedCategories: DemoProductCategory[];
  supportsDiscovery: boolean;
  fallbackOnDecline: boolean;
  requestTimeoutMs: number;
}

/**
 * Deterministic demo lenders dataset.
 * Matches `src/modules/lenders/fixtures/demo-lenders.json` with added legacy aliases
 * for complete backwards compatibility with existing integration tests.
 */
export const DEMO_LENDERS_SEED_DATA: readonly DemoLenderSeedDefinition[] = [
  {
    code: 'DEMO_BANK_ALPHA',
    displayName: '[DEMO] Alpha Digital Bank',
    type: 'BANK',
    isSimulated: true,
    priority: 10,
    minAmountPaise: 500000n, // Rs 5,000
    maxAmountPaise: 50000000n, // Rs 5,00,000
    supportedCategories: ['SMARTPHONE', 'LAPTOP', 'TELEVISION', 'AIR_CONDITIONER'],
    supportsDiscovery: true,
    fallbackOnDecline: true,
    requestTimeoutMs: 10000,
  },
  {
    code: 'DEMO_NBFC_BETA',
    displayName: '[DEMO] Beta Retail Finance NBFC',
    type: 'NBFC',
    isSimulated: true,
    priority: 20,
    minAmountPaise: 100000n, // Rs 1,000
    maxAmountPaise: 30000000n, // Rs 3,00,000
    supportedCategories: [
      'SMARTPHONE',
      'TELEVISION',
      'REFRIGERATOR',
      'WASHING_MACHINE',
      'LAPTOP',
      'OTHER_ELECTRONICS',
    ],
    supportsDiscovery: true,
    fallbackOnDecline: true,
    requestTimeoutMs: 12000,
  },
  {
    code: 'DEMO_GAMMA_CREDIT',
    displayName: '[DEMO] Gamma Consumer Credit',
    type: 'NBFC',
    isSimulated: true,
    priority: 30,
    minAmountPaise: 50000n, // Rs 500
    maxAmountPaise: 15000000n, // Rs 1,50,000
    supportedCategories: ['SMARTPHONE', 'OTHER_ELECTRONICS'],
    supportsDiscovery: true,
    fallbackOnDecline: true,
    requestTimeoutMs: 10000,
  },
  // Legacy aliases for test compatibility
  {
    code: 'LENDER_ALPHA',
    displayName: '[DEMO] Alpha Digital Bank (Legacy)',
    type: 'BANK',
    isSimulated: true,
    priority: 15,
    minAmountPaise: 100000n, // Rs 1,000
    maxAmountPaise: 50000000n, // Rs 5,00,000
    supportedCategories: [
      'SMARTPHONE',
      'LAPTOP',
      'TELEVISION',
      'REFRIGERATOR',
      'WASHING_MACHINE',
      'AIR_CONDITIONER',
    ],
    supportsDiscovery: true,
    fallbackOnDecline: true,
    requestTimeoutMs: 10000,
  },
  {
    code: 'LENDER_BETA',
    displayName: '[DEMO] Beta Retail Finance NBFC (Legacy)',
    type: 'NBFC',
    isSimulated: true,
    priority: 25,
    minAmountPaise: 50000n, // Rs 500
    maxAmountPaise: 25000000n, // Rs 2,50,000
    supportedCategories: ['SMARTPHONE', 'TELEVISION', 'OTHER_ELECTRONICS'],
    supportsDiscovery: true,
    fallbackOnDecline: true,
    requestTimeoutMs: 12000,
  },
];

/**
 * Validates that demo seeding is allowed in the current environment.
 * Prevents accidental execution in production unless explicitly opted in.
 */
export function checkDemoSeedAllowed(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && env.ALLOW_DEMO_SEED !== 'true') {
    throw new Error(
      'ABORTING: Demo seed script cannot run in production (NODE_ENV=production) unless ALLOW_DEMO_SEED=true is explicitly set. ' +
        'This guard protects production databases from mock lender contamination.',
    );
  }
}

/**
 * Seeds demo lenders into the database with idempotent upsert operations.
 */
export async function seedDemoLenders(
  prisma: PrismaClient,
): Promise<{ seeded: number; lenders: Array<{ code: string; id: string; isSimulated: boolean }> }> {
  const seededLenders: Array<{ code: string; id: string; isSimulated: boolean }> = [];

  for (const l of DEMO_LENDERS_SEED_DATA) {
    // 1. Safe idempotent upsert for Lender
    const lender = await prisma.lender.upsert({
      where: { code: l.code },
      update: {
        displayName: l.displayName,
        type: l.type as any,
        isSimulated: true, // Always explicitly simulated
        status: 'ACTIVE',
      },
      create: {
        code: l.code,
        displayName: l.displayName,
        type: l.type as any,
        isSimulated: true,
        status: 'ACTIVE',
      },
    });

    // 2. Safe idempotent upsert for LenderConfiguration
    await prisma.lenderConfiguration.upsert({
      where: { lenderId: lender.id },
      update: {
        enabled: true,
        priority: l.priority,
        minAmountPaise: l.minAmountPaise,
        maxAmountPaise: l.maxAmountPaise,
        supportedCategories: l.supportedCategories as any,
        supportsDiscovery: l.supportsDiscovery,
        fallbackOnDecline: l.fallbackOnDecline,
        requestTimeoutMs: l.requestTimeoutMs,
      },
      create: {
        lenderId: lender.id,
        enabled: true,
        priority: l.priority,
        minAmountPaise: l.minAmountPaise,
        maxAmountPaise: l.maxAmountPaise,
        supportedCategories: l.supportedCategories as any,
        supportsDiscovery: l.supportsDiscovery,
        fallbackOnDecline: l.fallbackOnDecline,
        requestTimeoutMs: l.requestTimeoutMs,
      },
    });

    seededLenders.push({
      code: lender.code,
      id: lender.id,
      isSimulated: lender.isSimulated,
    });
  }

  return { seeded: seededLenders.length, lenders: seededLenders };
}

/**
 * Seeds sample demo entities (admin, merchant, shop) idempotently.
 */
export async function seedDemoEntities(
  prisma: PrismaClient,
): Promise<{ adminEmail: string; merchantLegalName: string; shopName: string }> {
  // 1. Seed System Administrator
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@udhyam.example';
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'AdminPassword123!';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const passwordHash = await passwordHasher.hash(adminPassword);
    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        tokenVersion: 0,
      },
    });
  }

  // 2. Seed Sample Demo Merchant & Shop
  const merchantEmail = 'owner@apex.example';
  let merchantOwner = await prisma.user.findUnique({ where: { email: merchantEmail } });
  const merchantLegalName = 'Apex Digital Retail Private Limited';
  const shopName = 'Apex Flagship Store Indiranagar';

  if (!merchantOwner) {
    const merchant = await prisma.merchant.create({
      data: {
        legalName: merchantLegalName,
        tradeName: 'Apex Electronics',
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });

    const shop = await prisma.shop.create({
      data: {
        merchantId: merchant.id,
        name: shopName,
        city: 'Bengaluru',
        state: 'Karnataka',
        status: 'ACTIVE',
      },
    });

    const ownerPasswordHash = await passwordHasher.hash('ApexOwner2026!');
    merchantOwner = await prisma.user.create({
      data: {
        email: merchantEmail,
        passwordHash: ownerPasswordHash,
        role: 'MERCHANT_OWNER',
        status: 'ACTIVE',
        merchantId: merchant.id,
        tokenVersion: 0,
      },
    });

    process.stdout.write(
      `Created sample merchant: ${merchant.legalName} (shop: ${shop.name}, owner: ${merchantOwner.email})\n`,
    );
  }

  return { adminEmail, merchantLegalName, shopName };
}

async function main() {
  process.stdout.write('=== Udhyam PAY Demo Environment Seeder ===\n');

  // Verify environment safety guard
  checkDemoSeedAllowed();

  const prisma = new PrismaClient();
  try {
    process.stdout.write('1. Seeding demo lenders...\n');
    const lenderResult = await seedDemoLenders(prisma);
    for (const l of lenderResult.lenders) {
      process.stdout.write(`   ✓ [${l.code}] (id: ${l.id}, isSimulated: ${l.isSimulated})\n`);
    }

    process.stdout.write('2. Seeding demo merchant, shop, and admin...\n');
    const entityResult = await seedDemoEntities(prisma);
    process.stdout.write(`   ✓ Admin user: ${entityResult.adminEmail}\n`);
    process.stdout.write(`   ✓ Merchant: ${entityResult.merchantLegalName}\n`);
    process.stdout.write(`   ✓ Shop: ${entityResult.shopName}\n`);

    process.stdout.write('=== Demo Seeding Complete (Idempotent) ===\n');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('seed-demo.ts') || process.argv[1]?.endsWith('seed-demo.js')) {
  main().catch((err) => {
    process.stderr.write(`Seeding failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
