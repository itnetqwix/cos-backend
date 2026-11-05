import {
  Prisma,
  TesterApplication,
  TesterApplicationStatus,
  TesterAuditLog,
  TesterStatus,
} from '@prisma/client';
import { prisma } from '../config/database.js';

export interface CreateTesterApplicationInput {
  userId: string;
  fullName: string;
  email: string;
  phoneNumber?: string | null;
  avatarUrl?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  bio?: string | null;
  experienceYears?: number | null;
  preferredProductTypes?: string[];
  languages?: string[];
  credentials?: string | null;
  sampleReviewUrl?: string | null;
  portfolioUrls?: string[];
  applicantNotes?: string | null;
}

export interface UpdateTesterApplicationInput {
  fullName?: string;
  email?: string;
  phoneNumber?: string | null;
  avatarUrl?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  bio?: string | null;
  experienceYears?: number | null;
  preferredProductTypes?: string[];
  languages?: string[];
  credentials?: string | null;
  sampleReviewUrl?: string | null;
  portfolioUrls?: string[];
  applicantNotes?: string | null;
  informationResponseNotes?: string | null;
}

export interface ListApplicationsParams {
  status?: TesterApplicationStatus;
  search?: string;
  skip: number;
  take: number;
}

export interface ListTestersParams {
  status?: TesterStatus;
  search?: string;
  skip: number;
  take: number;
}

export class TesterApplicationRepository {
  static async create(data: CreateTesterApplicationInput): Promise<TesterApplication> {
    return prisma.testerApplication.create({
      data: {
        userId: data.userId,
        status: TesterApplicationStatus.PENDING,
        fullName: data.fullName,
        email: data.email,
        phoneNumber: data.phoneNumber,
        avatarUrl: data.avatarUrl,
        city: data.city,
        state: data.state,
        country: data.country ?? 'USA',
        bio: data.bio,
        experienceYears: data.experienceYears,
        preferredProductTypes: data.preferredProductTypes ?? [],
        languages: data.languages ?? [],
        credentials: data.credentials,
        sampleReviewUrl: data.sampleReviewUrl,
        portfolioUrls: data.portfolioUrls ?? [],
        applicantNotes: data.applicantNotes,
      },
    });
  }

  static async findActiveByUserId(userId: string): Promise<TesterApplication | null> {
    return prisma.testerApplication.findFirst({
      where: {
        userId,
        status: {
          in: [
            TesterApplicationStatus.PENDING,
            TesterApplicationStatus.UNDER_REVIEW,
            TesterApplicationStatus.NEEDS_INFORMATION,
            TesterApplicationStatus.APPROVED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  static async findLatestByUserId(userId: string): Promise<TesterApplication | null> {
    return prisma.testerApplication.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: {
            actor: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  static async findById(id: string) {
    return prisma.testerApplication.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            testerStatus: true,
            testerBio: true,
            avatarObjectKey: true,
            createdAt: true,
          },
        },
        reviewedBy: {
          select: { id: true, name: true, email: true },
        },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          include: {
            actor: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  static async update(
    id: string,
    data: Prisma.TesterApplicationUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<TesterApplication> {
    const client = tx ?? prisma;
    return client.testerApplication.update({
      where: { id },
      data,
    });
  }

  static async listApplicationsPage(params: ListApplicationsParams) {
    const where: Prisma.TesterApplicationWhereInput = {};

    if (params.status) {
      where.status = params.status;
    }

    if (params.search) {
      where.OR = [
        { fullName: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
        { city: { contains: params.search, mode: 'insensitive' } },
        { state: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.testerApplication.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              testerStatus: true,
            },
          },
          reviewedBy: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.testerApplication.count({ where }),
    ]);

    return { rows, total };
  }

  static async listTestersPage(params: ListTestersParams) {
    const where: Prisma.UserWhereInput = {
      testerStatus: params.status ?? {
        in: [TesterStatus.VERIFIED, TesterStatus.SUSPENDED, TesterStatus.REVOKED],
      },
    };

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { email: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          testerStatus: true,
          testerBio: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              reviewsAuthored: true,
            },
          },
          reviewsAuthored: {
            where: { status: 'PUBLISHED' },
            select: { overallScore: true },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    const formattedRows = rows.map((user) => {
      const publishedCount = user.reviewsAuthored.length;
      const avgScore =
        publishedCount > 0
          ? Math.round(
              (user.reviewsAuthored.reduce((acc, r) => acc + r.overallScore, 0) /
                publishedCount) *
                10,
            ) / 10
          : null;

      const { reviewsAuthored: _ignored, ...cleanUser } = user;
      void _ignored;

      return {
        ...cleanUser,
        totalReviews: user._count.reviewsAuthored,
        publishedReviews: publishedCount,
        averageOverallScore: avgScore,
      };
    });

    return { rows: formattedRows, total };
  }

  static async updateUserTesterStatus(
    userId: string,
    testerStatus: TesterStatus,
    testerBio?: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? prisma;
    return client.user.update({
      where: { id: userId },
      data: {
        testerStatus,
        ...(testerBio !== undefined ? { testerBio } : {}),
      },
    });
  }

  static async recordAuditLog(
    data: {
      actorId: string;
      targetUserId: string;
      applicationId?: string | null;
      action: string;
      reason?: string | null;
      metadata?: Prisma.InputJsonValue;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<TesterAuditLog> {
    const client = tx ?? prisma;
    return client.testerAuditLog.create({
      data: {
        actorId: data.actorId,
        targetUserId: data.targetUserId,
        applicationId: data.applicationId,
        action: data.action,
        reason: data.reason,
        metadata: data.metadata,
      },
    });
  }

  static async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(fn);
  }
}
