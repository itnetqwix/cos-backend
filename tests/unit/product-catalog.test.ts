import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AccountStatus, ProductApprovalStatus, Role, TesterStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { UserRepository } from '../../src/repositories/user.repository.js';
import { ProductCatalogRepository } from '../../src/repositories/product-catalog.repository.js';
import { setStorageService } from '../../src/services/storage.service.js';

const TESTER_ID = '11111111-1111-4111-8111-111111111111';
const UNVERIFIED_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = '33333333-3333-4333-8333-333333333333';
const FLOWER_TYPE_ID = '55555555-5555-4555-8555-555555555555';
const VAPE_TYPE_ID = '66666666-6666-4666-8666-666666666666';

describe('Phase 3 Product Catalog Management API', { concurrency: 1 }, () => {
  let app: FastifyInstance;
  const originalCapability = UserRepository.findReviewCapability;
  const originalFindById = UserRepository.findById;

  const originalListTypes = ProductCatalogRepository.listProductTypes;
  const originalFindTypeById = ProductCatalogRepository.findProductTypeById;
  const originalFindDuplicate = ProductCatalogRepository.findDuplicate;
  const originalListProducts = ProductCatalogRepository.listProducts;
  const originalFindProductById = ProductCatalogRepository.findProductById;
  const originalCreateProduct = ProductCatalogRepository.createProduct;
  const originalUpdateProduct = ProductCatalogRepository.updateProduct;
  const originalApproveProduct = ProductCatalogRepository.approveProduct;
  const originalRejectProduct = ProductCatalogRepository.rejectProduct;
  const originalDeactivateProduct = ProductCatalogRepository.deactivateProduct;

  const users = new Map<string, any>();
  const productTypes = new Map<string, any>();
  const products = new Map<string, any>();

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key-1234567890-cos-auth';

    users.set(TESTER_ID, {
      id: TESTER_ID,
      email: 'verified.tester@contestos.com',
      name: 'Verified Tester',
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.VERIFIED,
      reviewApprovalEnabled: false,
    });

    users.set(UNVERIFIED_ID, {
      id: UNVERIFIED_ID,
      email: 'unverified@contestos.com',
      name: 'Unverified Creator',
      role: Role.CREATOR,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.NOT_VERIFIED,
      reviewApprovalEnabled: false,
    });

    users.set(ADMIN_ID, {
      id: ADMIN_ID,
      email: 'admin@contestos.com',
      name: 'Phil Admin',
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      testerStatus: TesterStatus.NOT_VERIFIED,
      reviewApprovalEnabled: true,
    });

    productTypes.set(FLOWER_TYPE_ID, {
      id: FLOWER_TYPE_ID,
      name: 'Flower',
      slug: 'flower',
      isActive: true,
    });

    productTypes.set(VAPE_TYPE_ID, {
      id: VAPE_TYPE_ID,
      name: 'Vape',
      slug: 'vape',
      isActive: true,
    });

    // Mock storage
    setStorageService({
      createPresignedUpload: async ({ objectKey, contentType }) => ({
        uploadUrl: `https://example-bucket.s3.amazonaws.com/${objectKey}?sig=test`,
        objectKey,
        headers: { 'Content-Type': contentType },
        expiresInSeconds: 900,
        method: 'PUT',
      }),
      getPublicUrl: (objectKey) => `https://example.cdn.com/${objectKey}`,
    });

    UserRepository.findById = async (id: string) => users.get(id) ?? null;
    UserRepository.findReviewCapability = async (id: string) => {
      const u = users.get(id);
      return u
        ? {
            id: u.id,
            role: u.role,
            accountStatus: u.accountStatus,
            testerStatus: u.testerStatus,
            reviewApprovalEnabled: u.reviewApprovalEnabled,
          }
        : null;
    };

    ProductCatalogRepository.listProductTypes = async () => Array.from(productTypes.values());
    ProductCatalogRepository.findProductTypeById = async (id: string) => productTypes.get(id) ?? null;

    ProductCatalogRepository.findDuplicate = async (brandName: string, name: string, productTypeId: string, excludeId?: string) => {
      const tb = brandName.trim().toLowerCase();
      const tn = name.trim().toLowerCase();
      for (const p of products.values()) {
        if (excludeId && p.id === excludeId) continue;
        if (p.productTypeId === productTypeId && p.brandName.trim().toLowerCase() === tb && p.name.trim().toLowerCase() === tn) {
          return { ...p };
        }
      }
      return null;
    };

    ProductCatalogRepository.listProducts = async (filter) => {
      let all = Array.from(products.values());
      if (filter.productTypeId) {
        all = all.filter((p) => p.productTypeId === filter.productTypeId);
      }
      if (filter.approvalStatus) {
        all = all.filter((p) => p.approvalStatus === filter.approvalStatus);
      }
      if (filter.isActive !== undefined) {
        all = all.filter((p) => p.isActive === filter.isActive);
      }
      if (filter.search) {
        const s = filter.search.toLowerCase();
        all = all.filter((p) => p.name.toLowerCase().includes(s) || p.brandName.toLowerCase().includes(s));
      }
      return {
        items: all,
        pagination: {
          totalCount: all.length,
          totalPages: 1,
          currentPage: 1,
          limit: 20,
          hasNextPage: false,
          hasPrevPage: false,
        },
      };
    };

    ProductCatalogRepository.findProductById = async (id: string) => {
      const p = products.get(id);
      if (!p) return null;
      return {
        ...p,
        productType: productTypes.get(p.productTypeId),
        _count: { reviews: 0 },
      };
    };

    ProductCatalogRepository.createProduct = async (data: any) => {
      const id = data.id || `prod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const row = {
        id,
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        productType: productTypes.get(data.productTypeId),
        _count: { reviews: 0 },
      };
      products.set(id, row);
      return row;
    };

    ProductCatalogRepository.updateProduct = async (id: string, data: any) => {
      const existing = products.get(id);
      if (!existing) throw new Error('Not found');
      const updated = {
        ...existing,
        ...data,
        updatedAt: new Date().toISOString(),
        productType: productTypes.get(data.productTypeId ?? existing.productTypeId),
        _count: { reviews: 0 },
      };
      products.set(id, updated);
      return updated;
    };

    ProductCatalogRepository.approveProduct = async (id: string, adminId: string) => {
      const existing = products.get(id);
      if (!existing) throw new Error('Not found');
      const updated = {
        ...existing,
        approvalStatus: ProductApprovalStatus.APPROVED,
        isActive: true,
        reviewedById: adminId,
        reviewedAt: new Date().toISOString(),
        rejectionReason: null,
      };
      products.set(id, updated);
      return updated;
    };

    ProductCatalogRepository.rejectProduct = async (id: string, adminId: string, reason: string) => {
      const existing = products.get(id);
      if (!existing) throw new Error('Not found');
      const updated = {
        ...existing,
        approvalStatus: ProductApprovalStatus.REJECTED,
        isActive: false,
        reviewedById: adminId,
        reviewedAt: new Date().toISOString(),
        rejectionReason: reason,
      };
      products.set(id, updated);
      return updated;
    };

    ProductCatalogRepository.deactivateProduct = async (id: string) => {
      const existing = products.get(id);
      if (!existing) throw new Error('Not found');
      const updated = { ...existing, isActive: false };
      products.set(id, updated);
      return updated;
    };

    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    UserRepository.findReviewCapability = originalCapability;
    UserRepository.findById = originalFindById;
    ProductCatalogRepository.listProductTypes = originalListTypes;
    ProductCatalogRepository.findProductTypeById = originalFindTypeById;
    ProductCatalogRepository.findDuplicate = originalFindDuplicate;
    ProductCatalogRepository.listProducts = originalListProducts;
    ProductCatalogRepository.findProductById = originalFindProductById;
    ProductCatalogRepository.createProduct = originalCreateProduct;
    ProductCatalogRepository.updateProduct = originalUpdateProduct;
    ProductCatalogRepository.approveProduct = originalApproveProduct;
    ProductCatalogRepository.rejectProduct = originalRejectProduct;
    ProductCatalogRepository.deactivateProduct = originalDeactivateProduct;
    setStorageService(null);
    await app.close();
  });

  function token(userId: string, role: Role): string {
    return app.jwt.sign({ id: userId, email: `${userId.slice(0, 8)}@contestos.com`, role });
  }

  it('1. GET /api/v1/toke/product-types returns active types without authentication', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/product-types',
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.length, 2);
    assert.equal(body.data[0].name, 'Flower');
  });

  let testerSubmittedProductId = '';

  it('2. POST /api/v1/toke/products allows verified tester to submit product into PENDING status', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/products',
      headers: { authorization: `Bearer ${token(TESTER_ID, Role.CREATOR)}` },
      payload: {
        name: 'Sour Diesel',
        brandName: 'Top Crop',
        productTypeId: FLOWER_TYPE_ID,
        strain: 'Sativa Dominant',
        reportedThcPercent: 24.5,
        reportedCbdPercent: 0.2,
      },
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.equal(body.data.name, 'Sour Diesel');
    assert.equal(body.data.brandName, 'Top Crop');
    assert.equal(body.data.approvalStatus, 'PENDING');
    assert.equal(body.data.isActive, false);
    testerSubmittedProductId = body.data.id;
  });

  it('3. GET /api/v1/toke/products hides pending products from public search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/products?search=Sour',
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.data.items.length, 0);
  });

  it('4. POST /api/v1/toke/products rejects duplicate submission for same brand, name, and type', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/products',
      headers: { authorization: `Bearer ${token(TESTER_ID, Role.CREATOR)}` },
      payload: {
        name: '  sour diesel  ',
        brandName: 'top crop ',
        productTypeId: FLOWER_TYPE_ID,
      },
    });
    assert.equal(res.statusCode, 409);
    const body = JSON.parse(res.payload);
    assert.match(body.message, /already pending/i);
  });

  it('5. POST /api/v1/toke/products blocks unverified creators', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/products',
      headers: { authorization: `Bearer ${token(UNVERIFIED_ID, Role.CREATOR)}` },
      payload: {
        name: 'Blue Dream',
        brandName: 'Cali Gold',
        productTypeId: FLOWER_TYPE_ID,
      },
    });
    assert.equal(res.statusCode, 403);
  });

  it('6. Admin can list pending products, inspect details, and approve product', async () => {
    // List pending
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/toke/products?approvalStatus=PENDING',
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.payload);
    assert.equal(listBody.data.items.length, 1);
    assert.equal(listBody.data.items[0].id, testerSubmittedProductId);

    // Approve
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/products/${testerSubmittedProductId}/approve`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
    });
    assert.equal(approveRes.statusCode, 200);
    const approved = JSON.parse(approveRes.payload).data;
    assert.equal(approved.approvalStatus, 'APPROVED');
    assert.equal(approved.isActive, true);

    // Public search now finds it
    const publicRes = await app.inject({
      method: 'GET',
      url: '/api/v1/toke/products?search=diesel',
    });
    assert.equal(publicRes.statusCode, 200);
    const publicBody = JSON.parse(publicRes.payload);
    assert.equal(publicBody.data.items.length, 1);
    assert.equal(publicBody.data.items[0].name, 'Sour Diesel');
  });

  it('7. Admin creates active product directly and can edit specifications', async () => {
    // Create
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/toke/products',
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
      payload: {
        name: 'Live Resin Cart',
        brandName: 'Raw Garden',
        productTypeId: VAPE_TYPE_ID,
        strain: 'Indica',
        reportedThcPercent: 82.4,
      },
    });
    assert.equal(createRes.statusCode, 201);
    const product = JSON.parse(createRes.payload).data;
    assert.equal(product.approvalStatus, 'APPROVED');
    assert.equal(product.isActive, true);

    // Patch
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/toke/products/${product.id}`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
      payload: {
        batchNumber: 'BATCH-2026-RG-01',
        reportedThcPercent: 84.1,
      },
    });
    assert.equal(patchRes.statusCode, 200);
    const patched = JSON.parse(patchRes.payload).data;
    assert.equal(patched.batchNumber, 'BATCH-2026-RG-01');
    assert.equal(patched.reportedThcPercent, 84.1);
  });

  it('8. Admin deactivates product safely preserving record for reviews', async () => {
    const deactRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/toke/products/${testerSubmittedProductId}/deactivate`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
    });
    assert.equal(deactRes.statusCode, 200);
    const deact = JSON.parse(deactRes.payload).data;
    assert.equal(deact.isActive, false);

    // Public list excludes deactivated product
    const publicRes = await app.inject({
      method: 'GET',
      url: `/api/v1/toke/products?search=Sour`,
    });
    assert.equal(JSON.parse(publicRes.payload).data.items.length, 0);

    // Product still accessible by ID for admin or historical reviews
    const adminDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/toke/products?search=Sour`,
      headers: { authorization: `Bearer ${token(ADMIN_ID, Role.ADMIN)}` },
    });
    assert.equal(JSON.parse(adminDetail.payload).data.items.length, 1);
  });

  it('9. POST /api/v1/toke/products/image-presign issues presigned S3 upload URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/toke/products/image-presign',
      headers: { authorization: `Bearer ${token(TESTER_ID, Role.CREATOR)}` },
      payload: {
        contentType: 'image/jpeg',
        fileSizeBytes: 1024 * 500,
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.success, true);
    assert.match(body.data.uploadUrl, /example-bucket/);
    assert.match(body.data.objectKey, /^products\/uploads\//);
    assert.match(body.data.publicUrl, /^https:\/\/example\.cdn\.com\/products\/uploads\//);
  });
});

