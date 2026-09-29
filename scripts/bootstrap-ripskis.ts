/**
 * Production admin bootstrap for the single Ripskis deployment.
 * Reads RIPSKIS_ADMIN_EMAIL, RIPSKIS_ADMIN_PASSWORD, and RIPSKIS_ADMIN_NAME.
 * Does not print those values. Refuses to run when any of them is missing.
 *
 * Upserts exactly one ADMIN user. Does not create creators or organizations,
 * and does not delete or recreate contests or other production data.
 */
import { Role } from '@prisma/client';
import { prisma } from '../src/config/database.js';
import { hashPassword } from '../src/utils/crypto.js';

const REQUIRED = ['RIPSKIS_ADMIN_EMAIL', 'RIPSKIS_ADMIN_PASSWORD', 'RIPSKIS_ADMIN_NAME'] as const;

async function main() {
  const missing = REQUIRED.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    process.exit(2);
  }

  const email = process.env.RIPSKIS_ADMIN_EMAIL!.trim().toLowerCase();
  const name = process.env.RIPSKIS_ADMIN_NAME!.trim();
  const password = process.env.RIPSKIS_ADMIN_PASSWORD!;
  if (password.length < 6) {
    console.error('RIPSKIS_ADMIN_PASSWORD must be at least 6 characters');
    process.exit(2);
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    update: { name, role: Role.ADMIN, passwordHash },
    create: { email, name, role: Role.ADMIN, passwordHash },
  });

  const users = await prisma.user.groupBy({ by: ['role'], _count: { _all: true } });
  const contests = await prisma.contest.findMany({ select: { status: true, title: true } });
  const submissions = await prisma.submission.count();
  const ratings = await prisma.rating.count();
  console.log(
    JSON.stringify({
      adminCreated: true,
      users,
      contests,
      submissions,
      ratings,
    }),
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'bootstrap failed';
    console.error(message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
