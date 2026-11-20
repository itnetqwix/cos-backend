import { PhotoModerationStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const photoSelect = {
  id: true,
  profileId: true,
  objectKey: true,
  sortOrder: true,
  isPrimary: true,
  caption: true,
  moderationStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DatingPhotoSelect;

export type DatingPhotoRecord = Prisma.DatingPhotoGetPayload<{
  select: typeof photoSelect;
}>;

export class DatingPhotoRepository {
  static async listByProfile(profileId: string): Promise<DatingPhotoRecord[]> {
    return prisma.datingPhoto.findMany({
      where: { profileId },
      select: photoSelect,
      orderBy: { sortOrder: 'asc' },
    });
  }

  static async count(profileId: string): Promise<number> {
    return prisma.datingPhoto.count({ where: { profileId } });
  }

  static async findById(id: string): Promise<DatingPhotoRecord | null> {
    return prisma.datingPhoto.findUnique({ where: { id }, select: photoSelect });
  }

  static async findByObjectKey(objectKey: string): Promise<DatingPhotoRecord | null> {
    return prisma.datingPhoto.findUnique({ where: { objectKey }, select: photoSelect });
  }

  static async create(data: {
    profileId: string;
    objectKey: string;
    sortOrder: number;
    isPrimary: boolean;
    caption: string | null;
    moderationStatus?: PhotoModerationStatus;
  }): Promise<DatingPhotoRecord> {
    return prisma.datingPhoto.create({
      data: {
        ...data,
        moderationStatus: data.moderationStatus ?? PhotoModerationStatus.APPROVED,
      },
      select: photoSelect,
    });
  }

  static async update(
    id: string,
    data: Prisma.DatingPhotoUpdateInput,
  ): Promise<DatingPhotoRecord> {
    return prisma.datingPhoto.update({ where: { id }, data, select: photoSelect });
  }

  static async deleteById(id: string): Promise<void> {
    await prisma.datingPhoto.delete({ where: { id } });
  }

  static async reorder(
    profileId: string,
    orderedIds: string[],
  ): Promise<DatingPhotoRecord[]> {
    return prisma.$transaction(async (tx) => {
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.datingPhoto.update({
          where: { id: orderedIds[index] },
          data: { sortOrder: index },
        });
      }
      return tx.datingPhoto.findMany({
        where: { profileId },
        select: photoSelect,
        orderBy: { sortOrder: 'asc' },
      });
    });
  }

  static async setPrimary(
    profileId: string,
    photoId: string,
  ): Promise<DatingPhotoRecord[]> {
    return prisma.$transaction(async (tx) => {
      await tx.datingPhoto.updateMany({
        where: { profileId, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.datingPhoto.update({
        where: { id: photoId },
        data: { isPrimary: true },
      });
      return tx.datingPhoto.findMany({
        where: { profileId },
        select: photoSelect,
        orderBy: { sortOrder: 'asc' },
      });
    });
  }
}
