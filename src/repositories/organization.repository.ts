import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

const organizationBrandingSelect = {
  id: true,
  name: true,
  slug: true,
  branding: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

export type OrganizationBrandingRecord = Prisma.OrganizationGetPayload<{
  select: typeof organizationBrandingSelect;
}>;

/**
 * Organization persistence (M04-P01-T02).
 *
 * Branding reads/writes only. UserRepository still creates organizations
 * during brand registration (M02). This repository does not list users,
 * delete organizations, or change slug. Those operations are NOT SPECIFIED
 * for M04.
 */
export class OrganizationRepository {
  static async findById(id: string): Promise<OrganizationBrandingRecord | null> {
    return prisma.organization.findUnique({
      where: { id },
      select: organizationBrandingSelect,
    });
  }

  static async findBySlug(slug: string): Promise<OrganizationBrandingRecord | null> {
    return prisma.organization.findUnique({
      where: { slug },
      select: organizationBrandingSelect,
    });
  }

  /**
   * Replace the branding JSON document. Callers pass a schema-valid object.
   * This does not merge with the previous document.
   */
  static async updateBranding(
    id: string,
    branding: Prisma.InputJsonValue,
  ): Promise<OrganizationBrandingRecord> {
    return prisma.organization.update({
      where: { id },
      data: { branding },
      select: organizationBrandingSelect,
    });
  }
}
