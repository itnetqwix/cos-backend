import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../src/config/database.js';

const SALT_ROUNDS = 10;

const ORGANIZATIONS = [
  {
    name: 'Ripskis Entertainment',
    slug: 'ripskis',
    branding: {
      themeColor: '#FF5722',
      logoUrl: 'https://ripskis.com/logo.png',
    },
  },
  {
    name: 'Nike Global',
    slug: 'nike',
    branding: {
      themeColor: '#000000',
      logoUrl: 'https://nike.com/logo.png',
    },
  },
];

async function main() {
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
