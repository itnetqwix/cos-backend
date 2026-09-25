import { FastifyReply, FastifyRequest } from 'fastify';
import { OrganizationService } from '../services/organization.service.js';
import {
  organizationBrandingSchema,
  organizationIdParamSchema,
  organizationSlugParamSchema,
  reinstateOrganizationSchema,
  superAdminOrganizationsQuerySchema,
  suspendOrganizationSchema,
} from '../schemas/organization.schema.js';
import { sendSuccess } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';

export class OrganizationController {
  /**
   * Public branding read.
   * GET /api/v1/organizations/:slug/branding
   */
  static async getBrandingBySlug(request: FastifyRequest, reply: FastifyReply) {
    const { slug } = organizationSlugParamSchema.parse(request.params);
    const organization = await OrganizationService.getBrandingBySlug(slug);

    return sendSuccess(
      reply,
      organization,
      'Organization branding retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * SUPER_ADMIN tenant list.
   * GET /api/v1/super-admin/organizations
   */
  static async listForSuperAdmin(request: FastifyRequest, reply: FastifyReply) {
    superAdminOrganizationsQuerySchema.parse(request.query ?? {});
    const organizations = await OrganizationService.listOrganizations();

    return sendSuccess(
      reply,
      organizations,
      'Organizations retrieved successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * SUPER_ADMIN suspend.
   * POST /api/v1/super-admin/organizations/:id/suspend
   */
  static async suspend(request: FastifyRequest, reply: FastifyReply) {
    const { id } = organizationIdParamSchema.parse(request.params);
    const { reason } = suspendOrganizationSchema.parse(request.body ?? {});
    const organization = await OrganizationService.suspendOrganization(
      { role: request.user.role, organizationId: request.user.organizationId },
      id,
      reason,
    );

    return sendSuccess(
      reply,
      organization,
      'Organization suspended successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * SUPER_ADMIN reinstate.
   * POST /api/v1/super-admin/organizations/:id/reinstate
   */
  static async reinstate(request: FastifyRequest, reply: FastifyReply) {
    const { id } = organizationIdParamSchema.parse(request.params);
    reinstateOrganizationSchema.parse(request.body ?? {});
    const organization = await OrganizationService.reinstateOrganization(
      { role: request.user.role, organizationId: request.user.organizationId },
      id,
    );

    return sendSuccess(
      reply,
      organization,
      'Organization reinstated successfully',
      HTTP_STATUS.OK,
    );
  }

  /**
   * Authenticated branding replace.
   * PUT /api/v1/organizations/:id/branding
   */
  static async updateBranding(request: FastifyRequest, reply: FastifyReply) {
    const { id } = organizationIdParamSchema.parse(request.params);
    const branding = organizationBrandingSchema.parse(request.body);
    const organization = await OrganizationService.updateBranding(
      {
        role: request.user.role,
        organizationId: request.user.organizationId,
      },
      id,
      branding,
    );

    return sendSuccess(
      reply,
      organization,
      'Organization branding updated successfully',
      HTTP_STATUS.OK,
    );
  }
}
