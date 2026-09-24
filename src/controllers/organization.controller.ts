import { FastifyReply, FastifyRequest } from 'fastify';
import { OrganizationService } from '../services/organization.service.js';
import {
  organizationBrandingSchema,
  organizationIdParamSchema,
  organizationSlugParamSchema,
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
