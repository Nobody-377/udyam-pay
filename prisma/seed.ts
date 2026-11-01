import { PrismaClient } from '@prisma/client';
import { passwordHasher } from '../src/modules/auth/password';
import { DEMO_LENDERS_SEED_DATA } from './seed-demo';

const prisma = new PrismaClient();

async function main() {
  process.stdout.write('Seeding Udyam PAY database...\n');

  // 1. Seed System Administrator
  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@udyam.example';
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'AdminPassword123!';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const passwordHash = await passwordHasher.hash(adminPassword);
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE',
        tokenVersion: 0,
      },
    });
    process.stdout.write(`Created initial admin user: ${admin.email} (id: ${admin.id})\n`);
  } else {
    process.stdout.write(`Admin user ${adminEmail} already exists.\n`);
  }

  // 2. Seed Mock/Demo Lenders (Skipped in production unless ALLOW_DEMO_SEED=true)
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
    process.stdout.write(
      'Notice: Skipping simulated/demo lender seeding in production environment (NODE_ENV=production).\n',
    );
  } else {
    process.stdout.write('Seeding simulated demo lenders...\n');
    for (const l of DEMO_LENDERS_SEED_DATA) {
      const lender = await prisma.lender.upsert({
        where: { code: l.code },
        update: {
          displayName: l.displayName,
          type: l.type,
          isSimulated: true, // Always explicitly simulated
          status: 'ACTIVE',
        },
        create: {
          code: l.code,
          displayName: l.displayName,
          type: l.type,
          isSimulated: true,
          status: 'ACTIVE',
        },
      });

      await prisma.lenderConfiguration.upsert({
        where: { lenderId: lender.id },
        update: {
          enabled: true,
          priority: l.priority,
          minAmountPaise: l.minAmountPaise,
          maxAmountPaise: l.maxAmountPaise,
          supportedCategories: l.supportedCategories,
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
          supportedCategories: l.supportedCategories,
          supportsDiscovery: l.supportsDiscovery,
          fallbackOnDecline: l.fallbackOnDecline,
          requestTimeoutMs: l.requestTimeoutMs,
        },
      });

      process.stdout.write(`   ✓ Seeded lender: ${lender.code} (${lender.displayName})\n`);
    }
  }

  // 3. Seed Sample Verified Merchant & Shop for testing
  const merchantEmail = 'owner@apex.example';
  let merchantOwner = await prisma.user.findUnique({ where: { email: merchantEmail } });

  if (!merchantOwner) {
    const merchant = await prisma.merchant.create({
      data: {
        legalName: 'Apex Digital Retail Private Limited',
        tradeName: 'Apex Electronics',
        status: 'VERIFIED',
        verifiedAt: new Date(),
      },
    });

    const shop = await prisma.shop.create({
      data: {
        merchantId: merchant.id,
        name: 'Apex Flagship Store Indiranagar',
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

  process.stdout.write('Database seeding complete!\n');
}

main()
  .catch((e) => {
    process.stderr.write(`Seeding failed: ${e}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
