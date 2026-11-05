import { type FastifyRequest, type FastifyReply } from 'fastify';
import { ReviewCategoryService } from '../services/review-category.service.js';
import {
  proposeCategorySchema,
  createAdminCategorySchema,
  updateAdminCategorySchema,
  approveProposalSchema,
  rejectProposalSchema,
  mergeCategoriesSchema,
  categoryIdParamSchema,
  proposalIdParamSchema,
  listAdminCategoriesQuerySchema,
  listAdminProposalsQuerySchema,
} from '../schemas/review-category.schema.js';
import { sendSuccess } from '../utils/response.js';
import { HTTP_STATUS } from '../config/constants.js';

export class ReviewCategoryController {
  static async listPublicCategories(_request: FastifyRequest, reply: FastifyReply) {
    const categories = await ReviewCategoryService.listActive();
    return sendSuccess(reply, categories, 'Active review categories retrieved');
  }

  static async getCategoryById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = categoryIdParamSchema.parse(request.params);
    const category = await ReviewCategoryService.getById(id);
    return sendSuccess(reply, category, 'Review category retrieved');
  }

  static async proposeCategory(request: FastifyRequest, reply: FastifyReply) {
    const body = proposeCategorySchema.parse(request.body);
    const proposal = await ReviewCategoryService.proposeCategory(request.user.id, body);
    return sendSuccess(
      reply,
      proposal,
      'Category proposal submitted successfully for administrator review',
      HTTP_STATUS.CREATED,
    );
  }

  static async listMyProposals(request: FastifyRequest, reply: FastifyReply) {
    const proposals = await ReviewCategoryService.listMyProposals(request.user.id);
    return sendSuccess(reply, proposals, 'Tester category proposals retrieved');
  }

  static async listAdminCategories(request: FastifyRequest, reply: FastifyReply) {
    const query = listAdminCategoriesQuerySchema.parse(request.query ?? {});
    const categories = await ReviewCategoryService.listAdmin(query);
    return sendSuccess(reply, categories, 'Admin review categories retrieved');
  }

  static async createAdminCategory(request: FastifyRequest, reply: FastifyReply) {
    const body = createAdminCategorySchema.parse(request.body);
    const category = await ReviewCategoryService.createAdminCategory(body);
    return sendSuccess(reply, category, 'Review category created', HTTP_STATUS.CREATED);
  }

  static async updateAdminCategory(request: FastifyRequest, reply: FastifyReply) {
    const { id } = categoryIdParamSchema.parse(request.params);
    const body = updateAdminCategorySchema.parse(request.body);
    const category = await ReviewCategoryService.updateAdminCategory(id, body);
    return sendSuccess(reply, category, 'Review category updated');
  }

  static async deactivateAdminCategory(request: FastifyRequest, reply: FastifyReply) {
    const { id } = categoryIdParamSchema.parse(request.params);
    const category = await ReviewCategoryService.deactivateCategory(id);
    return sendSuccess(reply, category, 'Review category deactivated');
  }

  static async listAdminProposals(request: FastifyRequest, reply: FastifyReply) {
    const query = listAdminProposalsQuerySchema.parse(request.query ?? {});
    const proposals = await ReviewCategoryService.listAdminProposals(query.status);
    return sendSuccess(reply, proposals, 'Category proposals retrieved');
  }

  static async approveProposal(request: FastifyRequest, reply: FastifyReply) {
    const { id } = proposalIdParamSchema.parse(request.params);
    const body = approveProposalSchema.parse(request.body ?? {});
    const result = await ReviewCategoryService.approveProposal(id, request.user.id, body);
    return sendSuccess(
      reply,
      result,
      'Category proposal approved and published to scorecard',
    );
  }

  static async rejectProposal(request: FastifyRequest, reply: FastifyReply) {
    const { id } = proposalIdParamSchema.parse(request.params);
    const body = rejectProposalSchema.parse(request.body);
    const proposal = await ReviewCategoryService.rejectProposal(
      id,
      request.user.id,
      body.rejectionReason,
    );
    return sendSuccess(reply, proposal, 'Category proposal rejected');
  }

  static async mergeCategories(request: FastifyRequest, reply: FastifyReply) {
    const body = mergeCategoriesSchema.parse(request.body);
    const result = await ReviewCategoryService.mergeCategories(
      body.sourceCategoryId,
      body.targetCategoryId,
    );
    return sendSuccess(reply, result, 'Review categories merged successfully');
  }
}
