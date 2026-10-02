import { AccountStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../config/database.js';

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  accountStatus: true,
  avatarObjectKey: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export class UserRepository {
  static async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  static async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: publicUserSelect,
    });
  }

  static async createCreator(data: {
    email: string;
    passwordHash: string;
    name: string;
  }) {
    return prisma.user.create({
      data: {
        email: data.email,
        passwordHash: data.passwordHash,
        name: data.name,
        role: Role.CREATOR,
      },
      select: publicUserSelect,
    });
  }

  static async findMany(params: {
    skip: number;
    limit: number;
    role?: Role;
    search?: string;
  }) {
    const where: Prisma.UserWhereInput = {};

    if (params.role) {
      where.role = params.role;
    }

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: params.skip,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        select: publicUserSelect,
      }),
      prisma.user.count({ where }),
    ]);

    return { users, totalCount };
  }

  static async listCreators() {
    const where: Prisma.UserWhereInput = { role: Role.CREATOR };
    const [users, totalCreators] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          ...publicUserSelect,
          _count: { select: { submissions: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);
    return { users, totalCreators };
  }

  static async findCreatorById(id: string) {
    return prisma.user.findFirst({
      where: { id, role: Role.CREATOR },
      select: publicUserSelect,
    });
  }

  /**
   * Live account gate for creator routes.
   * JWT claims do not include accountStatus, so a block applies immediately.
   */
  static async findAccountGate(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        role: true,
        accountStatus: true,
      },
    });
  }

  static async updateAccountStatus(id: string, accountStatus: AccountStatus) {
    return prisma.user.update({
      where: { id },
      data: { accountStatus },
      select: publicUserSelect,
    });
  }

  /**
   * Updates only the authenticated user's own row.
   * Callers must pass the JWT user id, never a client-supplied user id.
   */
  static async updateOwnProfile(
    id: string,
    data: { name?: string; avatarObjectKey?: string | null },
  ) {
    return prisma.user.update({
      where: { id },
      data,
      select: publicUserSelect,
    });
  }
}
