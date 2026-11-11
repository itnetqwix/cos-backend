import { prisma } from '../config/database.js';

export class EmailVerificationTokenRepository {
  static async create(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return prisma.emailVerificationToken.create({ data });
  }

  static async findValidByTokenHash(tokenHash: string) {
    return prisma.emailVerificationToken.findFirst({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  static async invalidateAllForUser(userId: string) {
    return prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }

  static async markUsed(id: string) {
    return prisma.emailVerificationToken.update({
      where: { id },
      data: { usedAt: new Date() },
    });
  }
}
