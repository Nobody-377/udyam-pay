import { PrismaClient } from '@prisma/client';
import { passwordHasher } from '../src/modules/auth/password';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const password = process.argv[3]?.trim();

  if (!email || !password) {
    process.stderr.write('Usage: npx tsx scripts/create-admin.ts <email> <password>\n');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    process.stderr.write(`User with email ${email} already exists.\n`);
    process.exit(1);
  }

  const passwordHash = await passwordHasher.hash(password);
  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      tokenVersion: 0,
    },
  });

  process.stdout.write(`Administrator successfully created: ${admin.email} (ID: ${admin.id})\n`);
}

main()
  .catch((e) => {
    process.stderr.write(`Failed to create admin: ${e}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

