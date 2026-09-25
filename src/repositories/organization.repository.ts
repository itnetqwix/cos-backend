import { OrganizationStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

/**
 * Public view (branding GET/PUT). `status` lets the suspension overlay read the
 * tenant state; the suspension reason and timestamp stay on the admin view.
 */
const organizationBrandingSelect = {
  id: true,
  name: true,
  slug: true,
  branding: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

/** SUPER_ADMIN view (M10 list, suspend, reinstate). */
const organizationAdminSelect = {
  ...organizationBrandingSelect,
  suspendedAt: true,
  suspensionReason: true,
} satisfies Prisma.OrganizationSelect;

export type OrganizationBrandingRecord = Prisma.OrganizationGetPayload<{
  select: typeof organizationBrandingSelect;
}>;

export type OrganizationAdminRecord = Prisma.OrganizationGetPayload<{
  select: typeof organizationAdminSelect;
}>;

/**
 * Organization persistence (M04-P01-T02, M10-P01).
 *
 * UserRepository still creates organizations during brand registration (M02).
 * This repository does not list users, delete organizations, or change slug.
 * Those operations are NOT SPECIFIED.
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
   * Every organization, for the SUPER_ADMIN tenant list (M10-P01-T01).
   * Newest first, matching the other admin lists. That is display order only;
   * the master plan specifies no sort, filter, search, or pagination.
   */
  static async findAll(): Promise<OrganizationAdminRecord[]> {
    return prisma.organization.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: organizationAdminSelect,
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

  static async suspend(
    id: string,
    reason: string,
    suspendedAt: Date,
  ): Promise<OrganizationAdminRecord> {
    return prisma.organization.update({
      where: { id },
      data: {
        status: OrganizationStatus.SUSPENDED,
        suspendedAt,
        suspensionReason: reason,
      },
      select: organizationAdminSelect,
    });
  }

  static async reinstate(id: string): Promise<OrganizationAdminRecord> {
    return prisma.organization.update({
      where: { id },
      data: {
        status: OrganizationStatus.ACTIVE,
        suspendedAt: null,
        suspensionReason: null,
      },
      select: organizationAdminSelect,
    });
  }
}
