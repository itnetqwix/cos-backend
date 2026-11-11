import { prisma } from '../config/database.js';

export interface CreateResetTokenData {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

export class PasswordResetTokenRepository {
  static async create(data: CreateResetTokenData) {
    return prisma.passwordResetToken.create({
      data,
    });
  }

  static async findValidByTokenHash(tokenHash: string) {
    return prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: {
        user: true,
      },
    });
  }

  static async findByTokenHash(tokenHash: string) {
    return prisma.passwordResetToken.findUnique({
      where: {
        tokenHash,
      },
      include: {
        user: true,
      },
    });
  }

  static async invalidateAllForUser(userId: string) {
    return prisma.passwordResetToken.updateMany({
      where: {
        userId,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });
  }

  static async markUsed(id: string) {
    return prisma.passwordResetToken.update({
      where: { id },
      data: {
        usedAt: new Date(),
      },
    });
  }
}
