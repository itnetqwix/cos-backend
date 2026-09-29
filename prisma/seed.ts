/**
 * M13-P02-T04. Local sample data for Ripskis.
 * Upserts the Ripskis organization and, when that org has no ACTIVE contest,
 * creates one. Also upserts a super admin, a second sample org, and brand
 * admin / creator users. Writes to DATABASE_URL. Do not point this at a
 * production database. It is not a migration.
 */
import { ContestStatus, Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../src/config/database.js';

const SALT_ROUNDS = 10;

const ORGANIZATIONS = [
  {
    name: 'Ripskis Entertainment',
    slug: 'ripskis',
    branding: {
      primaryColor: '#FF5722',
      logoUrl: 'https://ripskis.com/logo.png',
    },
  },
  {
    name: 'Nike Global',
    slug: 'nike',
    branding: {
      primaryColor: '#000000',
      logoUrl: 'https://nike.com/logo.png',
    },
  },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed while NODE_ENV=production.');
    process.exit(1);
  }

  console.log('🌱 Starting database seeding...');
  const passwordHash = await bcrypt.hash('password123', SALT_ROUNDS);

  // 1. Seed Super Admin
  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@contestos.com' },
    update: { name: 'Super Admin', role: Role.SUPER_ADMIN, passwordHash },
    create: {
      email: 'superadmin@contestos.com',
      name: 'Super Admin',
      role: Role.SUPER_ADMIN,
      passwordHash,
    },
  });
  console.log(`✅ Super Admin: ${superAdmin.email}`);

  // 2. Seed Organizations and Tenant Users (Admins & Creators)
  for (const orgData of ORGANIZATIONS) {
    const org = await prisma.organization.upsert({
      where: { slug: orgData.slug },
      update: orgData,
      create: orgData,
    });
    console.log(`✅ Organization: ${org.name} (${org.slug})`);

    // Seed Brand Admin
    const admin = await prisma.user.upsert({
      where: { email: `admin@${org.slug}.com` },
      update: {
        name: `${org.name} Admin`,
        role: Role.BRAND_ADMIN,
        organizationId: org.id,
        passwordHash,
      },
      create: {
        email: `admin@${org.slug}.com`,
        name: `${org.name} Admin`,
        role: Role.BRAND_ADMIN,
        organizationId: org.id,
        passwordHash,
      },
    });
    console.log(`  ↳ Brand Admin: ${admin.email}`);

    // Seed Creator
    const creator = await prisma.user.upsert({
      where: { email: `creator@${org.slug}.com` },
      update: {
        name: `${org.name} Creator`,
        role: Role.CREATOR,
        organizationId: org.id,
        passwordHash,
      },
      create: {
        email: `creator@${org.slug}.com`,
        name: `${org.name} Creator`,
        role: Role.CREATOR,
        organizationId: org.id,
        passwordHash,
      },
    });
    console.log(`  ↳ Creator: ${creator.email}`);

    // Seed Sample ACTIVE Contest for Ripskis
    if (org.slug === 'ripskis') {
      const existingContest = await prisma.contest.findFirst({
        where: { organizationId: org.id, status: ContestStatus.ACTIVE },
      });
      if (!existingContest) {
        const contest = await prisma.contest.create({
          data: {
            organizationId: org.id,
            title: 'Ripskis Summer Kickoff 2026',
            description: 'Showcase your best summer action sports edits! 30-60s vertical clips judged by the community.',
            status: ContestStatus.ACTIVE,
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: new Date('2026-10-31T23:59:59.999Z'),
            prizeSummary: '$5,000 Total Prize Pool',
            autoAdvanceDelayMs: 1800,
          },
        });
        console.log(`  ↳ Sample Active Contest: ${contest.title} (${contest.id})`);
      }
    }
  }

  console.log('🎉 Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
