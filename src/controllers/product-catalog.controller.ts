import { FastifyReply, FastifyRequest } from 'fastify';
import {
  createProductSchema,
  listProductsQuerySchema,
  presignProductImageSchema,
  rejectProductSchema,
  updateProductSchema,
} from '../schemas/product-catalog.schema.js';
import { ProductCatalogService } from '../services/product-catalog.service.js';
import { HTTP_STATUS } from '../config/constants.js';
import { sendSuccess } from '../utils/response.js';

export class ProductCatalogController {
  /**
   * GET /api/v1/toke/product-types
   * Public list of active cannabis product types.
   */
  static async getProductTypes(_request: FastifyRequest, reply: FastifyReply) {
    const types = await ProductCatalogService.getProductTypes();
    return sendSuccess(reply, types, 'Product types retrieved successfully');
  }

  /**
   * GET /api/v1/toke/products
   * Search and list active, approved products for testers and public users.
   */
  static async listProducts(request: FastifyRequest, reply: FastifyReply) {
    const query = listProductsQuerySchema.parse(request.query);
    const result = await ProductCatalogService.searchProducts(query, false);
    return sendSuccess(reply, result, 'Products retrieved successfully');
  }

  /**
   * GET /api/v1/toke/products/:id
   * Fetch active, approved product details.
   */
  static async getProductById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const product = await ProductCatalogService.getProduct(id, false);
    return sendSuccess(reply, product, 'Product details retrieved successfully');
  }

  /**
   * POST /api/v1/toke/products
   * Verified tester submits a new product entry for editorial review.
   */
  static async submitProduct(request: FastifyRequest, reply: FastifyReply) {
    const body = createProductSchema.parse(request.body);
    const user = request.user as { id: string };
    const product = await ProductCatalogService.submitProduct(user.id, body);
    return sendSuccess(
      reply,
      product,
      'Product submitted for editorial review',
      HTTP_STATUS.CREATED,
    );
  }

  /**
   * POST /api/v1/toke/products/image-presign
   * Presign an S3 upload for a product photo.
   */
  static async presignProductImage(request: FastifyRequest, reply: FastifyReply) {
    const body = presignProductImageSchema.parse(request.body);
    const user = request.user as { id: string };
    const presign = await ProductCatalogService.presignProductImage(user.id, body);
    return sendSuccess(reply, presign, 'Product image presigned upload generated');
  }

  /**
   * GET /api/v1/admin/toke/products
   * Admin product catalog list with pending approvals, archived entries, and filters.
   */
  static async listAdminProducts(request: FastifyRequest, reply: FastifyReply) {
    const query = listProductsQuerySchema.parse(request.query);
    const result = await ProductCatalogService.searchProducts(query, true);
    return sendSuccess(reply, result, 'Admin products retrieved successfully');
  }

  /**
   * POST /api/v1/admin/toke/products
   * Admin direct creation of active product.
   */
  static async createAdminProduct(request: FastifyRequest, reply: FastifyReply) {
    const body = createProductSchema.parse(request.body);
    const user = request.user as { id: string };
    const product = await ProductCatalogService.createProductAsAdmin(user.id, body);
    return sendSuccess(
      reply,
      product,
      'Product created successfully',
      HTTP_STATUS.CREATED,
    );
  }

  /**
   * PATCH /api/v1/admin/toke/products/:id
   * Admin updates product specifications, active status, or metadata.
   */
  static async updateAdminProduct(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const body = updateProductSchema.parse(request.body);
    const user = request.user as { id: string };
    const product = await ProductCatalogService.updateProductAsAdmin(user.id, id, body);
    return sendSuccess(reply, product, 'Product updated successfully');
  }

  /**
   * POST /api/v1/admin/toke/products/:id/approve
   * Admin approves a tester-submitted pending product.
   */
  static async approveAdminProduct(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const user = request.user as { id: string };
    const product = await ProductCatalogService.approveProductAsAdmin(user.id, id);
    return sendSuccess(reply, product, 'Product approved successfully');
  }

  /**
   * POST /api/v1/admin/toke/products/:id/reject
   * Admin rejects a pending product with feedback.
   */
  static async rejectAdminProduct(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const body = rejectProductSchema.parse(request.body);
    const user = request.user as { id: string };
    const product = await ProductCatalogService.rejectProductAsAdmin(
      user.id,
      id,
      body.reason,
    );
    return sendSuccess(reply, product, 'Product rejected');
  }

  /**
   * POST /api/v1/admin/toke/products/:id/deactivate
   * Admin deactivates / archives a product safely.
   */
  static async deactivateAdminProduct(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const user = request.user as { id: string };
    const product = await ProductCatalogService.deactivateProductAsAdmin(user.id, id);
    return sendSuccess(reply, product, 'Product deactivated successfully');
  }
}
