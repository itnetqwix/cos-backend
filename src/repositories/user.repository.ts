import { Prisma, Role } from '@prisma/client';
import { prisma } from '../config/database.js';

export class UserRepository {
  /**
   * Find a user strictly by unique email.
   */
  static async findByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email },
      include: {
        organization: true,
      },
    });
  }

  /**
   * Find a user by their ID without sensitive data.
   * Select omits `passwordHash` (M02-P01-T04 / T03 sanitization).
   */
  static async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        organization: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Find an organization by its unique slug.
   */
  static async findOrganizationBySlug(slug: string) {
    return prisma.organization.findUnique({
      where: { slug },
    });
  }

  /**
   * Find an organization by its ID.
   */
  static async findOrganizationById(id: string) {
    return prisma.organization.findUnique({
      where: { id },
    });
  }

  /**
   * Create a new Creator user.
   */
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
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Atomically create an Organization and associated BRAND_ADMIN user in a transaction.
   *
   * Verified M02-P01-T02: both writes run inside `prisma.$transaction`.
   * If either write fails, the other rolls back. Sequential slug/email
   * uniqueness is enforced by AuthService pre-checks; mapping Prisma P2002
   * unique races to HTTP 409 is NOT SPECIFIED.
   */
  static async createBrandWithOrganization(data: {
    email: string;
    passwordHash: string;
    name: string;
    organizationName: string;
    slug: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: data.organizationName,
          slug: data.slug,
        },
      });

      const user = await tx.user.create({
        data: {
          email: data.email,
          passwordHash: data.passwordHash,
          name: data.name,
          role: Role.BRAND_ADMIN,
          organizationId: organization.id,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          organizationId: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { user, organization };
    });
  }

  /**
   * Retrieve a paginated list of users with optional filtering.
   */
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
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          organizationId: true,
          organization: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return { users, totalCount };
  }
}
