/**
 * Idempotent seed for One Toke review categories and product types.
 * Upsert update is empty, so an admin change to name, weight, order, or isActive is kept.
 * Does not connect until this file is executed.
 */
import { prisma } from '../src/config/database.js';

const categories = [
  { slug: 'smell', name: 'Smell', sortOrder: 1 },
  { slug: 'taste', name: 'Taste', sortOrder: 2 },
  { slug: 'how-high-it-gets-you', name: 'How High It Gets You', sortOrder: 3 },
  { slug: 'texture', name: 'Texture', sortOrder: 4 },
  { slug: 'harshness', name: 'Harshness', sortOrder: 5 },
  { slug: 'freshness', name: 'Freshness', sortOrder: 6 },
] as const;

const productTypes = [
  { slug: 'flower', name: 'Flower' },
  { slug: 'concentrate', name: 'Concentrate' },
  { slug: 'pre-roll', name: 'Pre-Roll' },
  { slug: 'edible', name: 'Edible' },
  { slug: 'vape', name: 'Vape' },
] as const;

async function main() {
  for (const category of categories) {
    await prisma.reviewCategory.upsert({
      where: { slug: category.slug },
      update: {},
      create: {
        slug: category.slug,
        name: category.name,
        defaultWeight: 1,
        sortOrder: category.sortOrder,
      },
    });
  }

  for (const productType of productTypes) {
    await prisma.productType.upsert({
      where: { slug: productType.slug },
      update: {},
      create: { slug: productType.slug, name: productType.name },
    });
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
