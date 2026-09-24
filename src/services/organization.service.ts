import { Role } from '@prisma/client';
import { OrganizationRepository } from '../repositories/organization.repository.js';
import { OrganizationBrandingInput } from '../schemas/organization.schema.js';
import { ForbiddenError, NotFoundError } from '../utils/response.js';

/**
 * Actor taken from JWT claims `{ id, email, role, organizationId }`.
 * Only `role` and `organizationId` are used for branding writes.
 */
export interface OrganizationBrandingActor {
  role: Role;
  organizationId: string | null;
}

/**
 * Organization branding rules (M04-P01-T03).
 *
 * SUPER_ADMIN may update any existing organization (architecture: cross-tenant
 * operational access). BRAND_ADMIN may update only the organization whose id
 * equals JWT `organizationId`. A BRAND_ADMIN with a null organizationId matches
 * no organization. CREATOR and VIEWER are rejected here as well as by
 * `authorizeRoles` on the route.
 *
 * Cross-tenant BRAND_ADMIN writes return 403 without a lookup, so a foreign
 * id does not reveal whether that organization exists.
 *
 * Users cannot belong to multiple organizations in this schema (one nullable
 * organizationId). Organization switching, transfer, invitation, and deletion
 * are NOT SPECIFIED and are not implemented.
 */
export class OrganizationService {
  static async getBrandingBySlug(slug: string) {
    const organization = await OrganizationRepository.findBySlug(slug);
    if (!organization) {
      throw new NotFoundError('Organization not found');
    }
    return organization;
  }

  static async updateBranding(
    actor: OrganizationBrandingActor,
    organizationId: string,
    branding: OrganizationBrandingInput,
  ) {
    if (!canUpdateBranding(actor, organizationId)) {
      throw new ForbiddenError(
        'Forbidden: Brand administrators can update branding only for their own organization',
      );
    }

    const existing = await OrganizationRepository.findById(organizationId);
    if (!existing) {
      throw new NotFoundError('Organization not found');
    }

    return OrganizationRepository.updateBranding(organizationId, branding);
  }
}

export function canUpdateBranding(
  actor: OrganizationBrandingActor,
  organizationId: string,
): boolean {
  if (actor.role === Role.SUPER_ADMIN) {
    return true;
  }
  if (actor.role === Role.BRAND_ADMIN && actor.organizationId === organizationId) {
    return true;
  }
  return false;
}
