import { prisma } from '../config/database.js';

const warningInclude = {
  issuedBy: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} as const;

export class CreatorWarningRepository {
  static async create(data: { creatorId: string; issuedById: string; reason: string }) {
    return prisma.creatorWarning.create({
      data,
      include: warningInclude,
    });
  }

  static async listByCreator(creatorId: string) {
    return prisma.creatorWarning.findMany({
      where: { creatorId },
      include: warningInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }
}
